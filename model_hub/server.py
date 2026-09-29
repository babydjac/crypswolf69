"""
ComfyUI Model Hub - backend
Civitai browser + fast resumable, multi-connection downloader.

All UI talks to these aiohttp routes (registered on ComfyUI's PromptServer),
so the browser never hits Civitai/HF directly (no CORS, tokens stay server-side).
"""

import os
import re
import html
import json
import time
import asyncio
import logging
import threading
from urllib.parse import quote, unquote

import aiohttp
from yarl import URL

try:
    import folder_paths  # provided by ComfyUI
except Exception:  # pragma: no cover - lets the file be imported standalone
    folder_paths = None

from server import PromptServer

log = logging.getLogger("ModelHub")

HERE = os.path.dirname(os.path.realpath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")
UA = "ComfyUI-ModelHub/1.1"

# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------
DEFAULT_CONFIG = {
    "civitai_token": "",
    "hf_token": "",
    "connections": 8,          # parallel segments per download
    "chunk_mb": 8,             # segment size
    "show_nsfw": False,
    "organize_by_base": True,  # put files in <folder>/<base model>/ subfolders
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    except Exception:
        pass
    return cfg


def save_config(patch):
    cfg = load_config()
    for k, v in (patch or {}).items():
        if k not in DEFAULT_CONFIG:
            continue
        try:
            if k == "connections":
                v = max(1, min(32, int(v or 8)))
            elif k == "chunk_mb":
                v = max(1, min(256, int(v or 8)))
            elif k in ("show_nsfw", "organize_by_base"):
                v = bool(v)
            else:
                v = str(v or "").strip()
        except (TypeError, ValueError):
            continue
        cfg[k] = v
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        log.error("[ModelHub] could not save config: %s", e)
    return cfg


# ---------------------------------------------------------------------------
# names & folders
# ---------------------------------------------------------------------------
_BAD = '<>:"/\\|?*'


def _clean(s):
    return "".join("_" if (c in _BAD or ord(c) < 32) else c for c in str(s))


def safe_folder(name):
    """Base-model label like 'Flux.2 Klein 9B' -> safe single folder name."""
    if not name:
        return ""
    return _clean(name).strip().strip(".").strip()[:80]


def safe_filename(name):
    """Keep only the final path component; never allow traversal."""
    name = str(name or "").replace("\\", "/").split("/")[-1]
    name = _clean(unquote(name)).strip()
    if name in ("", ".", ".."):
        return ""
    return name[:200]


TYPE_TO_FOLDER = {
    "Checkpoint": "checkpoints",
    "TextualInversion": "embeddings",
    "Embedding": "embeddings",
    "Hypernetwork": "hypernetworks",
    "AestheticGradient": "embeddings",
    "LORA": "loras",
    "LoCon": "loras",
    "DoRA": "loras",
    "Controlnet": "controlnet",
    "ControlNet": "controlnet",
    "Upscaler": "upscale_models",
    "VAE": "vae",
    "Poses": "poses",
    "Wildcards": "wildcards",
    "Workflows": "workflows",
    "Detection": "ultralytics",
    "MotionModule": "animatediff_models",
    "Unet": "diffusion_models",
    "Diffusers": "diffusers",
    "Other": "checkpoints",
}

# Folders offered in the "Save to" picker (order = display order).
FOLDER_KEYS = [
    "checkpoints", "diffusion_models", "loras", "vae", "text_encoders",
    "clip_vision", "controlnet", "upscale_models", "embeddings",
    "hypernetworks", "animatediff_models", "ultralytics", "diffusers",
    "poses", "wildcards", "workflows",
]

# Families whose Civitai "Checkpoint" files are normally diffusion-model-only
# (loaded with Load Diffusion Model / GGUF loaders, not Load Checkpoint).
DIT_BASES = re.compile(
    r"^(krea|minimax|flux|zimage|qwen|hidream|chroma|wan\b|ltxv|hunyuan|mochi|cogvideo)",
    re.I)

WEIGHT_EXT = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".onnx", ".sft")


# For links with no model type (pasted Hugging Face files), guess from the file name.
_NAME_HINTS = [
    (re.compile(r"esrgan|ultrasharp|upscal|swinir|realesr|(^|[^a-z0-9])[248]x([^a-z0-9]|$)", re.I), "upscale_models"),
    (re.compile(r"lora", re.I), "loras"),
    (re.compile(r"controlnet|control[_-]", re.I), "controlnet"),
    (re.compile(r"(^|[^a-z])vae([^a-z]|$)", re.I), "vae"),
    (re.compile(r"t5xxl|umt5|clip_[lg]|text[_-]?encoder|qwen[\d.]*[_-]?vl|mmproj", re.I), "text_encoders"),
]


def default_target(model_type, base, filename=""):
    fn = (filename or "").lower()
    if model_type in (None, "", "Other"):
        for rx, key in _NAME_HINTS:
            if rx.search(fn):
                return key
    if model_type in ("Checkpoint", "Unet", "Other", None, ""):
        if fn.endswith(".gguf"):
            return "diffusion_models"
        if model_type == "Checkpoint" and base and DIT_BASES.match(str(base)):
            return "diffusion_models"
    return TYPE_TO_FOLDER.get(model_type or "", "checkpoints")


def _models_dir():
    return getattr(folder_paths, "models_dir", None) if folder_paths else None


def _workflows_dir():
    try:
        return os.path.join(folder_paths.get_user_directory(), "default", "workflows")
    except Exception:
        return None


def known_folders():
    """folder key -> the real directory we download into."""
    out = {}
    base = _models_dir()
    for name in FOLDER_KEYS:
        if name == "workflows":
            p = _workflows_dir()
            if p:
                out[name] = p
            continue
        path = None
        if folder_paths is not None:
            try:
                paths = folder_paths.get_folder_paths(name)
                if paths:
                    # prefer models/<name> over aliases (e.g. diffusion_models -> unet)
                    path = next((p for p in paths
                                 if os.path.basename(os.path.normpath(p)) == name), paths[0])
            except Exception:
                path = None
        if path is None and base:
            path = os.path.join(base, name)
        if path:
            out[name] = path
    return out


def folder_for(target):
    folders = known_folders()
    if target in folders:
        return folders[target]
    base = _models_dir() or os.path.join(HERE, "downloads")
    return os.path.join(base, target or "checkpoints")


def _rel(path):
    base = _models_dir()
    try:
        if base:
            r = os.path.relpath(path, base)
            if not r.startswith(".."):
                return r.replace(os.sep, "/")
        wf = _workflows_dir()
        if wf:
            r = os.path.relpath(path, wf)
            if not r.startswith(".."):
                return "workflows/" + r.replace(os.sep, "/")
    except Exception:
        pass
    return os.path.basename(path)


_owned_cache = {"t": 0.0, "names": set()}


def existing_filenames(max_age=8.0):
    """Lower-cased names of every model file already on disk (for 'owned' marks)."""
    now = time.time()
    if now - _owned_cache["t"] < max_age:
        return _owned_cache["names"]
    roots = set()
    base = _models_dir()
    if base:
        roots.add(os.path.realpath(base))
    if folder_paths is not None:
        for name in FOLDER_KEYS:
            try:
                for p in folder_paths.get_folder_paths(name):
                    roots.add(os.path.realpath(p))
            except Exception:
                pass
    names = set()
    for root in roots:
        for _dp, _dn, files in os.walk(root):
            for fn in files:
                if fn.lower().endswith(WEIGHT_EXT):
                    names.add(fn.lower())
    wf = _workflows_dir()
    if wf and os.path.isdir(wf):
        for _dp, _dn, files in os.walk(wf):
            names.update(fn.lower() for fn in files)
    _owned_cache.update(t=now, names=names)
    return names


# ---------------------------------------------------------------------------
# download manager - multi-connection, resumable, queued
# ---------------------------------------------------------------------------
MAX_ACTIVE = 3  # downloads running at once; the rest wait as "queued"


class Download:
    _id = 0
    _lock = threading.Lock()

    def __init__(self, url, dest, headers, source, name, thumb):
        with Download._lock:
            Download._id += 1
            self.id = Download._id
        self.url = url
        self.final_url = None
        self._resolved_at = 0.0
        self.dest = dest
        self.part = dest + ".part"
        self.sidecar = dest + ".hubdl"
        self.headers = dict(headers or {})
        self.source = source
        self.name = name
        self.thumb = thumb
        self.total = 0
        self.done = 0
        self.status = "queued"   # queued|running|done|error|cancelled
        self.error = ""
        self.speed = 0.0
        self.cancel = False
        self.task = None
        self._last_t = time.time()
        self._last_b = 0

    def snapshot(self):
        total = self.total
        done = min(self.done, total) if total else self.done
        pct = (100.0 * done / total) if total else 0.0
        eta = (total - done) / self.speed if (total and self.speed > 1) else None
        return {
            "id": self.id, "name": self.name, "source": self.source,
            "thumb": self.thumb, "rel": _rel(self.dest),
            "total": total, "done": done, "status": self.status,
            "error": self.error, "speed": round(self.speed, 1),
            "eta": int(eta) if eta is not None else None,
            "pct": round(pct, 1),
        }

    def _tick(self):
        now = time.time()
        dt = now - self._last_t
        if dt >= 0.5:
            inst = max(0.0, (self.done - self._last_b) / dt)
            self.speed = inst if self.speed <= 0 else 0.6 * self.speed + 0.4 * inst
            self._last_t = now
            self._last_b = self.done


DOWNLOADS = {}  # id -> Download
_sem_holder = {}


def _sem():
    s = _sem_holder.get("s")
    if s is None:
        s = _sem_holder["s"] = asyncio.Semaphore(MAX_ACTIVE)
    return s


def _origin(u):
    try:
        p = URL(str(u), encoded=True)
        return (p.scheme, p.host, p.port)
    except Exception:
        return None


def _auth_for(dl, url):
    """Only send our token to the origin it belongs to - never to signed CDN URLs."""
    return dl.headers if _origin(url) == _origin(dl.url) else {}


class _Retry(Exception):
    pass


async def _resolve(sess, dl):
    """Follow redirects once (manually, so the token never leaves its origin).
    Sets dl.final_url; returns (total_bytes, supports_ranges)."""
    url = dl.url
    for _ in range(10):
        hdr = {"Range": "bytes=0-0", **_auth_for(dl, url)}
        async with sess.get(URL(url, encoded=True), headers=hdr, allow_redirects=False) as r:
            loc = r.headers.get("Location")
            if r.status in (301, 302, 303, 307, 308) and loc:
                url = str(URL(url, encoded=True).join(URL(loc, encoded=True)))
                continue
            dl.final_url = url
            dl._resolved_at = time.time()
            if r.status in (401, 403):
                hint = (" - add your Civitai API token in Settings" if dl.source == "civitai"
                        else " - the repo may be gated; add a Hugging Face token in Settings")
                raise RuntimeError(f"HTTP {r.status} (not authorized){hint}")
            if r.status >= 400:
                raise RuntimeError(f"HTTP {r.status} from {URL(url, encoded=True).host}")
            if r.status == 206:
                cr = r.headers.get("Content-Range", "")
                tail = cr.rsplit("/", 1)[-1] if "/" in cr else ""
                return (int(tail) if tail.isdigit() else 0), True
            return int(r.headers.get("Content-Length") or 0), False
    raise RuntimeError("too many redirects")


async def _reresolve(sess, dl, lock):
    """Signed CDN URLs expire; refresh at most once per few seconds."""
    async with lock:
        if time.time() - dl._resolved_at < 5:
            return
        await _resolve(sess, dl)


async def _run_download(dl: Download, connections: int, chunk_size: int):
    try:
        async with _sem():
            if dl.cancel:
                dl.status = "cancelled"
                return
            dl.status = "running"
            timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=120)
            conn = aiohttp.TCPConnector(limit=max(4, connections + 2), ttl_dns_cache=300)
            os.makedirs(os.path.dirname(dl.dest), exist_ok=True)
            async with aiohttp.ClientSession(timeout=timeout, connector=conn,
                                             headers={"User-Agent": UA}) as sess:
                total, ranges = await _resolve(sess, dl)
                dl.total = total
                if total and ranges and connections > 1 and total > chunk_size:
                    await _segmented(sess, dl, total, chunk_size, connections)
                else:
                    await _single(sess, dl)
            if dl.cancel:
                dl.status = "cancelled"
                return
            if dl.total and os.path.getsize(dl.part) != dl.total:
                raise RuntimeError("size mismatch after download")
            os.replace(dl.part, dl.dest)
            _clean_sidecar(dl)
            dl.done = dl.total or dl.done
            dl.status = "done"
            _owned_cache["t"] = 0.0
            log.info("[ModelHub] downloaded %s", dl.dest)
    except asyncio.CancelledError:
        dl.status = "cancelled"
    except Exception as e:
        dl.status = "error"
        dl.error = str(e) or e.__class__.__name__
        log.error("[ModelHub] download failed (%s): %s", dl.name, dl.error)
    finally:
        dl.speed = 0.0


def _chunks(total, chunk_size):
    n = (total + chunk_size - 1) // chunk_size
    return [(i * chunk_size, min((i + 1) * chunk_size, total) - 1) for i in range(n)]


def _load_sidecar(dl, total, chunk_size):
    try:
        with open(dl.sidecar, "r") as f:
            meta = json.load(f)
        if meta.get("total") == total and meta.get("chunk") == chunk_size \
                and os.path.exists(dl.part) and os.path.getsize(dl.part) == total:
            return set(int(x) for x in meta.get("done", []))
    except Exception:
        pass
    return set()


def _save_sidecar(dl, total, chunk_size, done):
    try:
        tmp = dl.sidecar + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"total": total, "chunk": chunk_size, "done": sorted(done)}, f)
        os.replace(tmp, dl.sidecar)
    except Exception:
        pass


def _clean_sidecar(dl):
    for p in (dl.sidecar, dl.sidecar + ".tmp"):
        try:
            os.remove(p)
        except Exception:
            pass


async def _segmented(sess, dl, total, chunk_size, connections):
    chunks = _chunks(total, chunk_size)
    done = _load_sidecar(dl, total, chunk_size)
    if not done:
        with open(dl.part, "wb") as f:
            f.truncate(total)
    dl.done = sum(chunks[i][1] - chunks[i][0] + 1 for i in done)
    dl._last_b = dl.done
    q = asyncio.Queue()
    for i in range(len(chunks)):
        if i not in done:
            q.put_nowait(i)
    fh = open(dl.part, "r+b")
    rlock = asyncio.Lock()
    last_save = [time.time()]

    async def fetch(i):
        start, end = chunks[i]
        for attempt in range(8):
            if dl.cancel:
                return
            got = 0
            try:
                url = dl.final_url or dl.url
                hdr = {"Range": f"bytes={start}-{end}", **_auth_for(dl, url)}
                async with sess.get(URL(url, encoded=True), headers=hdr) as r:
                    if r.status in (400, 401, 403, 410) and url != dl.url:
                        await _reresolve(sess, dl, rlock)
                        raise _Retry(f"HTTP {r.status}")
                    if r.status != 206:
                        raise RuntimeError(f"HTTP {r.status} for a range request")
                    pos = start
                    async for buf in r.content.iter_chunked(1 << 20):
                        if dl.cancel:
                            dl.done -= got  # half-done chunk is refetched on resume
                            return
                        fh.seek(pos)
                        fh.write(buf)
                        n = len(buf)
                        pos += n
                        got += n
                        dl.done += n
                        dl._tick()
                if got != end - start + 1:
                    raise RuntimeError("short read")
                done.add(i)
                if time.time() - last_save[0] > 2:
                    _save_sidecar(dl, total, chunk_size, done)
                    last_save[0] = time.time()
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                dl.done -= got  # don't double-count bytes we will fetch again
                if attempt == 7:
                    raise RuntimeError(f"segment {i} failed: {e}")
                await asyncio.sleep(min(10.0, 1.0 * (attempt + 1)))

    async def worker():
        while not dl.cancel:
            try:
                i = q.get_nowait()
            except asyncio.QueueEmpty:
                return
            await fetch(i)

    workers = [asyncio.create_task(worker()) for _ in range(max(1, min(connections, q.qsize())))]
    try:
        await asyncio.gather(*workers)
    except BaseException:
        for w in workers:
            w.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        raise
    finally:
        _save_sidecar(dl, total, chunk_size, done)
        fh.close()


async def _single_once(sess, dl):
    start = os.path.getsize(dl.part) if os.path.exists(dl.part) else 0
    if dl.total and start == dl.total:
        dl.done = start
        return
    if dl.total and start > dl.total:
        start = 0
    url = dl.final_url or dl.url
    hdr = dict(_auth_for(dl, url))
    if start:
        hdr["Range"] = f"bytes={start}-"
    async with sess.get(URL(url, encoded=True), headers=hdr) as r:
        if r.status not in (200, 206):
            raise RuntimeError(f"HTTP {r.status}")
        if start and r.status == 200:
            start = 0  # server ignored Range - rewrite from scratch, never append
        dl.done = start
        dl._last_b = start
        if not dl.total:
            cl = int(r.headers.get("Content-Length") or 0)
            dl.total = start + cl if cl else 0
        with open(dl.part, "ab" if start else "wb") as f:
            async for buf in r.content.iter_chunked(1 << 20):
                if dl.cancel:
                    return
                f.write(buf)
                dl.done += len(buf)
                dl._tick()


async def _single(sess, dl):
    for attempt in range(6):
        try:
            await _single_once(sess, dl)
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            if dl.cancel or attempt == 5:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))


def start_download(url, dest, headers, source, name, thumb):
    # never run two writers on the same file
    for d in DOWNLOADS.values():
        if d.dest == dest and d.status in ("queued", "running"):
            return d.id
    dl = Download(url, dest, headers, source, name, thumb)
    DOWNLOADS[dl.id] = dl
    cfg = load_config()
    conns = int(cfg.get("connections", 8))
    chunk = int(cfg.get("chunk_mb", 8)) * 1024 * 1024
    dl.task = PromptServer.instance.loop.create_task(_run_download(dl, conns, chunk))
    return dl.id


# ---------------------------------------------------------------------------
# providers
# ---------------------------------------------------------------------------
CIVITAI_API = "https://civitai.com/api/v1"
HF_API = "https://huggingface.co/api"


def _plain(desc, limit=1600):
    """Civitai descriptions are HTML - reduce to plain text (never render HTML)."""
    if not desc:
        return ""
    s = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</h\d>|</div>", "\n", str(desc))
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s).strip()
    return s[:limit] + ("…" if len(s) > limit else "")


def _civ_headers():
    tok = load_config().get("civitai_token")
    return {"Authorization": "Bearer " + tok} if tok else {}


def _hf_headers():
    tok = load_config().get("hf_token")
    return {"Authorization": "Bearer " + tok} if tok else {}


async def _get_json(session, url, params=None, headers=None):
    async with session.get(url, params=params, headers=headers) as r:
        if r.status == 429:
            raise RuntimeError("rate limited by the server - wait a moment and retry")
        if r.status >= 400:
            raise RuntimeError(f"HTTP {r.status} from {URL(url).host}")
        return await r.json(content_type=None)


def _media(i):
    return {"url": i.get("url"), "type": i.get("type") or "image",
            "w": i.get("width"), "h": i.get("height"),
            "nsfw": i.get("nsfwLevel") or 1}


def _civ_version(v, model_type):
    files = []
    for f in v.get("files", []):
        if not f.get("downloadUrl"):
            continue
        md = f.get("metadata") or {}
        files.append({
            "name": f.get("name"),
            "sizeKB": f.get("sizeKB"),
            "url": f.get("downloadUrl"),
            "format": md.get("format"),
            "fp": md.get("fp"),
            "kind": f.get("type"),
            "primary": bool(f.get("primary")),
            "target": default_target(model_type, v.get("baseModel"), f.get("name")),
        })
    files.sort(key=lambda f: not f["primary"])
    return {
        "id": v.get("id"), "name": v.get("name"),
        "baseModel": v.get("baseModel"),
        "words": [w for w in (v.get("trainedWords") or []) if w][:40],
        "files": files,
        "images": [_media(i) for i in v.get("images", []) if i.get("url")],
    }


async def civitai_search(session, q, types, sort, period, nsfw, base_models, cursor):
    params = {"limit": 24, "sort": sort or "Highest Rated",
              "period": period or "AllTime", "nsfw": "true" if nsfw else "false"}
    if q:
        params["query"] = q
    if types:
        params["types"] = types
    if base_models:
        params["baseModels"] = base_models
    if cursor:
        params["cursor"] = cursor
    data = await _get_json(session, CIVITAI_API + "/models", params, _civ_headers())
    items = []
    for m in data.get("items", []):
        mtype = m.get("type")
        versions = [_civ_version(v, mtype) for v in m.get("modelVersions", [])]
        cover = next((img for v in versions for img in v["images"]), None)
        stats = m.get("stats", {}) or {}
        items.append({
            "id": m.get("id"), "name": m.get("name") or "", "type": mtype,
            "nsfw": bool(m.get("nsfw")), "cover": cover,
            "creator": (m.get("creator") or {}).get("username") or "",
            "downloads": stats.get("downloadCount", 0),
            "likes": stats.get("thumbsUpCount", stats.get("favoriteCount", 0)),
            "tags": [t for t in (m.get("tags") or []) if isinstance(t, str)][:10],
            "desc": _plain(m.get("description")),
            "versions": versions,
            "url": f"https://civitai.com/models/{m.get('id')}",
        })
    return {"items": items, "nextCursor": (data.get("metadata") or {}).get("nextCursor")}


async def hf_search(session, q, sort, pipeline, page):
    params = {"limit": 24, "full": "true",
              "sort": {"trending": "trendingScore"}.get(sort, sort or "downloads"),
              "direction": "-1"}
    if q:
        params["search"] = q
    if pipeline:
        params["pipeline_tag"] = pipeline
    data = await _get_json(session, HF_API + "/models", params, _hf_headers())
    items = []
    for m in data if isinstance(data, list) else []:
        rid = m.get("id") or m.get("modelId")
        sib = [s.get("rfilename") for s in m.get("siblings", []) if s.get("rfilename")]
        items.append({
            "id": rid, "name": rid, "type": "HF",
            "downloads": m.get("downloads", 0), "likes": m.get("likes", 0),
            "tags": [t for t in (m.get("tags") or []) if isinstance(t, str)][:8],
            "pipeline": m.get("pipeline_tag"),
            "files": [s for s in sib if s.lower().endswith(WEIGHT_EXT)],
            "url": f"https://huggingface.co/{rid}",
        })
    return {"items": items, "nextCursor": None}


# --- turning a pasted link into a concrete download --------------------------
_CIV_MODEL = re.compile(r"^https?://(?:www\.)?civitai\.com/models/(\d+)", re.I)
_CIV_DL = re.compile(r"^https?://(?:www\.)?civitai\.com/api/download/models/(\d+)", re.I)
_HF_BLOB = re.compile(r"^https?://(?:www\.)?huggingface\.co/([^/]+/[^/]+)/(?:blob|resolve)/([^/]+)/(.+?)(?:\?.*)?$", re.I)


async def normalize_paste(session, url):
    """Return dict(url, filename, model_type, base, source) for a pasted link."""
    m = _HF_BLOB.match(url)
    if m:
        repo, rev, path = m.group(1), m.group(2), m.group(3)
        return {"url": f"https://huggingface.co/{repo}/resolve/{rev}/{path}",
                "filename": path.split("/")[-1], "model_type": None,
                "base": repo.split("/")[-1], "source": "huggingface"}
    vid = None
    m = _CIV_DL.match(url)
    if m:
        vid = m.group(1)
    else:
        m = _CIV_MODEL.match(url)
        if m:
            mv = re.search(r"modelVersionId=(\d+)", url)
            if mv:
                vid = mv.group(1)
            else:
                model = await _get_json(session, f"{CIVITAI_API}/models/{m.group(1)}",
                                        None, _civ_headers())
                vers = model.get("modelVersions") or []
                if not vers:
                    raise RuntimeError("that Civitai model has no downloadable versions")
                vid = str(vers[0].get("id"))
    if vid:
        v = await _get_json(session, f"{CIVITAI_API}/model-versions/{vid}", None, _civ_headers())
        mtype = (v.get("model") or {}).get("type")
        files = [f for f in (v.get("files") or []) if f.get("downloadUrl")]
        f = next((f for f in files if f.get("primary")), files[0] if files else None)
        if not f:
            raise RuntimeError("no downloadable file on that Civitai version")
        return {"url": f["downloadUrl"], "filename": f.get("name"),
                "model_type": mtype, "base": v.get("baseModel"), "source": "civitai"}
    host = (URL(url).host or "").lower()
    src = "huggingface" if host.endswith(("huggingface.co", "hf.co")) else \
          "civitai" if host.endswith("civitai.com") else "web"
    return {"url": url, "filename": URL(url).path.rsplit("/", 1)[-1],
            "model_type": None, "base": None, "source": src}


async def filename_from_headers(session, url, headers):
    """Content-Disposition filename (for links like .../download/models/123)."""
    try:
        async with session.get(URL(url, encoded=True), headers={"Range": "bytes=0-0", **headers}) as r:
            cd = r.headers.get("Content-Disposition", "")
    except Exception:
        return ""
    m = re.search(r"filename\*\s*=\s*[^']*''([^;]+)", cd) or re.search(r'filename\s*=\s*"?([^";]+)"?', cd)
    return unquote(m.group(1).strip()) if m else ""


def _auth_headers_for(url, cfg):
    host = (URL(url).host or "").lower()
    if host == "civitai.com" or host.endswith(".civitai.com"):
        tok = cfg.get("civitai_token")
    elif host in ("huggingface.co", "hf.co") or host.endswith((".huggingface.co", ".hf.co")):
        tok = cfg.get("hf_token")
    else:
        tok = ""
    return {"Authorization": "Bearer " + tok} if tok else {}


# ---------------------------------------------------------------------------
# facets
# ---------------------------------------------------------------------------
CIV_TYPES = [
    "Checkpoint", "LORA", "LoCon", "DoRA", "TextualInversion", "Hypernetwork",
    "Controlnet", "Upscaler", "VAE", "MotionModule", "Poses", "Wildcards",
    "Workflows", "Detection", "AestheticGradient", "Other",
]
# Real Civitai `baseModel` strings, harvested live and ordered by prevalence.
# The frontend also merges any values it sees in results, so new models
# show up in the filter automatically.
CIV_BASES = [
    "SD 1.5", "Illustrious", "SDXL 1.0", "Pony", "Anima", "Krea 2", "Flux.1 D",
    "NoobAI", "ZImageTurbo", "ZImageBase", "MiniMax H3", "Qwen", "Qwen 2.1",
    "Qwen 2", "SDXL Lightning", "SDXL Hyper", "Hunyuan Video",
    "Wan Video 2.2 I2V-A14B", "Wan Video 2.2 T2V-A14B", "Wan Video 2.2 TI2V-5B",
    "Wan Video", "Wan Video 14B t2v", "Wan Video 14B i2v 720p",
    "Wan Video 14B i2v 480p", "Wan Video 1.3B t2v", "Wan Image 2.7",
    "Flux.2 Klein 9B", "Flux.2 Klein 9B-base", "Flux.2 Klein 4B",
    "Flux.2 Klein 4B-base", "Flux.2 D", "Flux.1 S", "Flux.1 Krea",
    "Flux.1 Kontext", "LTXV 2.5", "LTXV 2.3", "Chroma", "HiDream",
    "Ideogram 4.0", "Ernie", "SD 1.5 LCM", "SD 1.5 Hyper", "SDXL 1.0 LCM",
    "SDXL 0.9", "SD 2.1", "SD 2.0", "SD 1.4", "Pony V7", "Upscaler", "Other",
]
CIV_SORT = ["Highest Rated", "Most Downloaded", "Most Liked", "Most Discussed",
            "Most Collected", "Most Images", "Newest", "Oldest"]
CIV_PERIOD = ["AllTime", "Year", "Month", "Week", "Day"]
HF_SORT = ["downloads", "trending", "likes", "lastModified", "createdAt"]
HF_PIPELINES = [
    "text-to-image", "image-to-image", "text-to-video", "image-to-video",
    "text-to-3d", "image-to-3d", "unconditional-image-generation",
    "text-generation", "feature-extraction",
]


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------
routes = PromptServer.instance.routes
_session_holder = {}


async def _session():
    s = _session_holder.get("s")
    if s is None or s.closed:
        s = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40),
                                  headers={"User-Agent": UA})
        _session_holder["s"] = s
    return s


def _json(data, status=200):
    from aiohttp import web
    return web.json_response(data, status=status)


async def _body(req):
    try:
        data = await req.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


@routes.get("/model_hub/facets")
async def r_facets(req):
    return _json({
        "civitai": {"types": CIV_TYPES, "bases": CIV_BASES,
                    "sort": CIV_SORT, "period": CIV_PERIOD},
        "huggingface": {"sort": HF_SORT, "pipelines": HF_PIPELINES},
        "folders": [k for k in FOLDER_KEYS if k in known_folders()],
    })


@routes.get("/model_hub/config")
async def r_get_config(req):
    cfg = load_config()
    safe = dict(cfg)
    # never hand tokens to the browser - just whether they are set
    safe["civitai_token"] = bool(cfg.get("civitai_token"))
    safe["hf_token"] = bool(cfg.get("hf_token"))
    safe["folders"] = [k for k in FOLDER_KEYS if k in known_folders()]
    return _json(safe)


@routes.post("/model_hub/config")
async def r_set_config(req):
    save_config(await _body(req))
    return _json({"ok": True})


@routes.get("/model_hub/search")
async def r_search(req):
    p = req.rel_url.query
    try:
        session = await _session()
        if p.get("source") == "huggingface":
            data = await hf_search(session, p.get("q"), p.get("sort"),
                                   p.get("filter"), p.get("page"))
        else:
            data = await civitai_search(
                session, p.get("q"), p.get("types"), p.get("sort"),
                p.get("period"), p.get("nsfw") == "true",
                p.get("baseModels"), p.get("cursor"))
        return _json(data)
    except asyncio.TimeoutError:
        return _json({"error": "the server took too long to answer - try again", "items": []})
    except Exception as e:
        return _json({"error": str(e) or e.__class__.__name__, "items": []})


@routes.get("/model_hub/owned")
async def r_owned(req):
    return _json({"names": sorted(existing_filenames())})


@routes.get("/model_hub/hf_files")
async def r_hf_files(req):
    """Full file tree of a HF repo, with sizes."""
    repo = req.rel_url.query.get("repo", "")
    if not re.match(r"^[\w.-]+/[\w.-]+$", repo):
        return _json({"files": [], "error": "bad repo id"})
    try:
        session = await _session()
        data = await _get_json(session, f"{HF_API}/models/{repo}/tree/main",
                               {"recursive": "1"}, _hf_headers())
        files = []
        for it in data if isinstance(data, list) else []:
            if it.get("type") != "file":
                continue
            path = it.get("path") or ""
            files.append({
                "name": path,
                "size": it.get("size") or (it.get("lfs") or {}).get("size") or 0,
                "url": f"https://huggingface.co/{repo}/resolve/main/{quote(path)}",
                "lfs": bool(it.get("lfs")),
            })
        files.sort(key=lambda f: (not f["name"].lower().endswith(WEIGHT_EXT), -f["size"]))
        return _json({"repo": repo, "files": files})
    except Exception as e:
        return _json({"files": [], "error": str(e) or e.__class__.__name__})


@routes.post("/model_hub/download")
async def r_download(req):
    body = await _body(req)
    url = str(body.get("url") or "").strip()
    if not re.match(r"^https?://", url, re.I):
        return _json({"error": "only http(s) links are supported"}, status=400)
    cfg = load_config()
    model_type, base, source = body.get("model_type"), body.get("base"), body.get("source")
    filename = body.get("filename")
    try:
        session = await _session()
        if body.get("paste"):
            info = await normalize_paste(session, url)
            url, filename = info["url"], info["filename"]
            model_type, base, source = info["model_type"], info["base"], info["source"]
        headers = _auth_headers_for(url, cfg)
        name = safe_filename(filename)
        if not name or "." not in name:
            name = safe_filename(await filename_from_headers(session, url, headers)) or name
    except Exception as e:
        return _json({"error": str(e) or e.__class__.__name__}, status=400)
    if not name:
        return _json({"error": "could not work out a file name for that link"}, status=400)
    target = body.get("target") or default_target(model_type, base, name)
    folder = folder_for(target)
    if cfg.get("organize_by_base", True):
        sub = safe_folder(base)
        if sub:
            folder = os.path.join(folder, sub)
    dest = os.path.join(folder, name)
    if not os.path.realpath(dest).startswith(os.path.realpath(folder) + os.sep):
        return _json({"error": "refusing to write outside the models folder"}, status=400)
    dl_id = start_download(url, dest, headers, source or "web", name, body.get("thumb"))
    return _json({"id": dl_id, "name": name, "rel": _rel(dest)})


@routes.get("/model_hub/downloads")
async def r_downloads(req):
    return _json({"downloads": [d.snapshot() for d in
                                sorted(DOWNLOADS.values(), key=lambda x: -x.id)]})


@routes.post("/model_hub/cancel")
async def r_cancel(req):
    body = await _body(req)
    dl = DOWNLOADS.get(int(body.get("id") or 0))
    if dl and dl.status in ("queued", "running"):
        dl.cancel = True
        if dl.status == "queued" and dl.task:
            dl.task.cancel()
    return _json({"ok": True})


@routes.post("/model_hub/retry")
async def r_retry(req):
    body = await _body(req)
    old = DOWNLOADS.get(int(body.get("id") or 0))
    if not old:
        return _json({"error": "unknown download"}, status=404)
    if old.status in ("queued", "running"):
        return _json({"id": old.id})
    DOWNLOADS.pop(old.id, None)
    new_id = start_download(old.url, old.dest, old.headers, old.source, old.name, old.thumb)
    return _json({"id": new_id})


@routes.post("/model_hub/clear")
async def r_clear(req):
    for k in [k for k, v in DOWNLOADS.items() if v.status in ("done", "error", "cancelled")]:
        DOWNLOADS.pop(k, None)
    return _json({"ok": True})


log.info("[ModelHub] backend routes registered")
