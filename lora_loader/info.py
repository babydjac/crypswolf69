"""Data behind the loader's info panel: sha256, Civitai version data, trigger words, images.

Sources, cheapest first:
  sha256   LoRA Manager / Civitai Helper sidecar -> hash cache keyed by path+size+mtime
           -> hashed once in a worker thread (never on the event loop; concurrent
           requests for the same file share one hash job)
  Civitai  our cache (<sha>.json) -> sidecar payload -> live by-hash lookup on
           civitai.com, then civitai.red. A definitive "not found" is remembered for
           3 days; network errors are never cached.
"""

import asyncio
import hashlib
import html
import json
import os
import re
import threading
import time

import aiohttp

from . import files

HERE = os.path.dirname(os.path.realpath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache")
HASH_FILE = os.path.join(CACHE_DIR, "hashes.json")
CIV_DIR = os.path.join(CACHE_DIR, "civitai")
CACHE_SCHEMA = 1
NOT_FOUND_TTL = 3 * 86400
UA = "crypswolf69-LoraLoader/1.0"
CIV_HOSTS = (("com", "https://civitai.com"), ("red", "https://civitai.red"))
CHUNK = 1024 * 1024
_SHA_RE = re.compile(r"^[0-9a-fA-F]{64}$")

_hash_lock = threading.Lock()
_hashes = None          # realpath -> [size, mtime_ns, sha]
_inflight = {}          # stat key -> asyncio.Future
_session = {}


# ----------------------------------------------------------------- hashing
def _is_sha(value):
    return isinstance(value, str) and bool(_SHA_RE.match(value))


def _atomic_write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def _hash_table():
    global _hashes
    if _hashes is None:
        try:
            with open(HASH_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            _hashes = data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            _hashes = {}
    return _hashes


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def known_sha(path, side):
    """sha256 without reading the file, or (None, None)."""
    real, size, mtime = files.stat_key(path)
    lm = side.get("lm") or {}
    if _is_sha(lm.get("sha256")) and lm.get("size") in (None, size):
        return lm["sha256"].lower(), "LoRA Manager"
    ci = side.get("ci") or {}
    ci_files = [f for f in ci.get("files") or [] if isinstance(f, dict)]
    for f in ci_files:
        h = (f.get("hashes") or {}).get("SHA256")
        if _is_sha(h) and (f.get("name") == os.path.basename(path) or len(ci_files) == 1):
            return h.lower(), "Civitai Helper"
    with _hash_lock:
        rec = _hash_table().get(real)
    if isinstance(rec, list) and len(rec) == 3 and rec[0] == size and rec[1] == mtime and _is_sha(rec[2]):
        return rec[2], "cache"
    return None, None


def _hash_and_store(path):
    real, size, mtime = files.stat_key(path)
    sha = sha256_file(path)
    with _hash_lock:
        table = _hash_table()
        table[real] = [size, mtime, sha]
        try:
            _atomic_write(HASH_FILE, table)
        except OSError:
            pass
    return sha


async def file_sha(path, side):
    sha, src = known_sha(path, side)
    if sha:
        return sha, src
    key = files.stat_key(path)
    fut = _inflight.get(key)
    if fut is None:
        fut = asyncio.ensure_future(asyncio.to_thread(_hash_and_store, path))
        _inflight[key] = fut
        fut.add_done_callback(lambda _f: _inflight.pop(key, None))
    return await asyncio.shield(fut), "hashed"


# ----------------------------------------------------------------- Civitai
def _plain(desc, limit=1600):
    """Civitai descriptions are HTML — reduce to plain text (the UI never renders HTML)."""
    if not desc or not isinstance(desc, str):
        return ""
    s = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</h\d>|</div>", "\n", desc)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s).strip()
    return s[:limit] + ("…" if len(s) > limit else "")


def _text(value, limit):
    return value[:limit] if isinstance(value, str) and value.strip() else None


def _domain_of(payload):
    url = str(payload.get("downloadUrl") or "")
    return "red" if "civitai.red" in url else "com"


def civ_summary(v, domain, description=None, tags=None):
    """Model-version payload -> the compact shape the panel renders."""
    model = v.get("model") if isinstance(v.get("model"), dict) else {}
    mid, vid = v.get("modelId"), v.get("id")
    links = {}
    try:
        if mid:
            tail = f"/models/{int(mid)}" + (f"?modelVersionId={int(vid)}" if vid else "")
            links = {d: base + tail for d, base in CIV_HOSTS}
    except (TypeError, ValueError):
        links = {}
    images = []
    for im in v.get("images") or []:
        if not isinstance(im, dict):
            continue
        url = im.get("url")
        if not isinstance(url, str) or not url.startswith("https://"):
            continue
        meta = im.get("meta") if isinstance(im.get("meta"), dict) else {}
        images.append({
            "url": url,
            "type": "video" if im.get("type") == "video" else "image",
            "w": im.get("width"), "h": im.get("height"), "nsfw": im.get("nsfwLevel"),
            "prompt": _text(meta.get("prompt"), 2000),
            "negative": _text(meta.get("negativePrompt"), 800),
            "seed": meta.get("seed"), "steps": meta.get("steps"), "cfg": meta.get("cfgScale"),
            "sampler": _text(meta.get("sampler"), 60), "model": _text(meta.get("Model"), 120),
        })
        if len(images) >= 20:
            break
    creator = v.get("creator") if isinstance(v.get("creator"), dict) else {}
    stats = v.get("stats") if isinstance(v.get("stats"), dict) else {}
    tag_list = tags if isinstance(tags, list) else model.get("tags")
    return {
        "modelId": mid, "versionId": vid,
        "model": model.get("name"), "version": v.get("name"),
        "type": model.get("type"), "baseModel": v.get("baseModel"),
        "creator": creator.get("username"),
        "words": [w.strip() for w in v.get("trainedWords") or [] if isinstance(w, str) and w.strip()],
        "links": links, "domain": domain,
        "images": images,
        "description": _plain(description or model.get("description") or v.get("description")),
        "downloads": stats.get("downloadCount"), "likes": stats.get("thumbsUpCount"),
        "tags": [t for t in tag_list or [] if isinstance(t, str)][:12],
    }


def _civ_path(sha):
    return os.path.join(CIV_DIR, f"{sha}.json")


def civ_cache_read(sha):
    try:
        with open(_civ_path(sha), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("schema") != CACHE_SCHEMA:
        return None
    return data


def civ_cache_write(sha, found, data=None, error=None):
    try:
        _atomic_write(_civ_path(sha), {"schema": CACHE_SCHEMA, "ts": time.time(), "found": bool(found),
                                       "data": data, "error": error})
    except OSError:
        pass


def _civitai_token():
    try:
        from ..model_hub import server as hub  # the Model Hub's saved Civitai key, if any
        return hub.load_config().get("civitai_token") or ""
    except Exception:
        return ""


def _http():
    s = _session.get("s")
    if s is None or s.closed:
        s = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20), headers={"User-Agent": UA})
        _session["s"] = s
    return s


async def civitai_by_hash(sha):
    """-> (payload, domain, error, definitive). definitive=True only when both mirrors said 404."""
    token = _civitai_token()
    misses, error = 0, None
    for domain, base in CIV_HOSTS:
        # the key belongs to civitai.com — never send it anywhere else
        headers = {"Authorization": f"Bearer {token}"} if token and domain == "com" else {}
        try:
            async with _http().get(f"{base}/api/v1/model-versions/by-hash/{sha}", headers=headers) as r:
                if r.status == 404:
                    misses += 1
                    continue
                if r.status >= 400:
                    error = f"civitai.{domain} answered HTTP {r.status}"
                    continue
                data = await r.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
            error = f"civitai.{domain} unreachable ({type(e).__name__})"
            continue
        if isinstance(data, dict) and data.get("id"):
            return data, domain, None, False
        misses += 1
    if misses == len(CIV_HOSTS):
        return None, None, "not found on civitai.com or civitai.red", True
    return None, None, error or "Civitai lookup failed", False


# -------------------------------------------------------------- assembly
def _words(civ, side, summary):
    out, seen = [], set()

    def add(word, src, count=None):
        word = str(word).strip()
        if word and word.lower() not in seen:
            seen.add(word.lower())
            out.append({"word": word, "src": src, "count": count})

    for w in (civ or {}).get("words") or []:
        add(w, "civitai")
    a1 = side.get("a1") or {}
    for w in re.split(r"[,\n]", str(a1.get("activation text") or "")):
        add(w, "a1111")
    for w in summary.get("words") or []:
        add(w["word"], "meta", w.get("count"))
    return out[:60]


async def get_info(name, refresh=False):
    """Full info for one LoRA, or None when the file can't be found."""
    rname, path, how = await asyncio.to_thread(files.resolve, name)
    if not path:
        return None
    side = await asyncio.to_thread(files.sidecars, path)
    summary = await asyncio.to_thread(files.header_summary, path)
    card = await asyncio.to_thread(files.card, rname, path)
    sha, sha_src = await file_sha(path, side)

    lm = side.get("lm") or {}
    payload, payload_src = files.civitai_version(side)
    sidecar_civ = None
    if payload:
        sidecar_civ = civ_summary(payload, _domain_of(payload), lm.get("modelDescription"), lm.get("tags"))

    civ, civ_src, civ_err = None, None, None
    prior = civ_cache_read(sha)
    prior_hit = prior.get("data") if prior and prior.get("found") and isinstance(prior.get("data"), dict) else None
    fresh_miss = bool(prior and not prior.get("found")
                      and time.time() - float(prior.get("ts") or 0) < NOT_FOUND_TTL)
    if prior_hit and not refresh:
        civ, civ_src = prior_hit, "cache"
    elif sidecar_civ and not refresh:
        civ, civ_src = sidecar_civ, payload_src
    elif fresh_miss and not refresh:
        civ_err = prior.get("error") or "not found on Civitai"
    else:
        data, domain, err, definitive = await civitai_by_hash(sha)
        if data:
            civ, civ_src = civ_summary(data, domain), f"civitai.{domain}"
            civ_cache_write(sha, True, civ)
        else:
            civ_err = err
            if sidecar_civ or prior_hit:
                # keep showing what we already know (e.g. the model was taken down)
                civ, civ_src = (sidecar_civ, payload_src) if sidecar_civ else (prior_hit, "cache")
            elif definitive:
                civ_cache_write(sha, False, None, err)

    a1 = side.get("a1") or {}
    fname = os.path.basename(path)
    return {
        "name": rname, "requested": name, "how": how,
        "file": fname, "dir": os.path.dirname(rname.replace("\\", "/")),
        "size": summary.get("size"), "mtime": card.get("mtime"),
        "sha256": sha, "shaSource": sha_src,
        "title": card.get("title") or (civ or {}).get("model") or summary.get("title") or os.path.splitext(fname)[0],
        "version": (civ or {}).get("version") or card.get("version"),
        "base": card.get("base") or (civ or {}).get("baseModel"),
        "preview": card.get("preview"), "pv": card.get("pv"),
        "strength": card.get("strength"),
        "summary": {k: v for k, v in summary.items() if k != "words"},
        "civitai": civ, "civitaiSource": civ_src, "civitaiError": civ_err,
        "words": _words(civ, side, summary),
        "notes": _text(lm.get("notes"), 2000) or _text(a1.get("notes"), 2000),
    }
