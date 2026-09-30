"""LoRA library for the Advanced LoRA Loader: lookup, header summaries, sidecars, previews.

Nothing here reads tensor data — summaries come from the safetensors header and
the sidecar files other tools leave next to a LoRA:

  <stem>.metadata.json   ComfyUI-Lora-Manager (sha256, base model, Civitai version)
  <stem>.civitai.info    Civitai Helper (Civitai model-version payload)
  <stem>.json            A1111 user metadata ("activation text", "preferred weight")
  <stem>[.preview].png|jpg|jpeg|webp|gif|mp4|webm   preview image / video

Everything is cached by (path, size, mtime) so a changed file is re-read.
"""

import collections
import json
import os
import re
import struct
import threading

import folder_paths

FOLDER = "loras"
PREVIEW_SUFFIXES = (
    ".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp", ".preview.gif",
    ".preview.mp4", ".preview.webm",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm",
)
VIDEO_SUFFIXES = (".mp4", ".webm")
SIDECARS = {"lm": ".metadata.json", "ci": ".civitai.info", "a1": ".json"}
MAX_HEADER = 32 * 1024 * 1024
MAX_SIDECAR = 16 * 1024 * 1024

_lock = threading.RLock()
_dir_cache = {}                        # dir -> (mtime_ns, {lower name: real name})
_json_cache = {}                       # path -> ((size, mtime_ns), data)
_summary_cache = collections.OrderedDict()   # stat key -> summary
_card_cache = {}                       # lora path -> (signature, card)
_SUMMARY_MAX = 2048


# --------------------------------------------------------------------- lookup
def names():
    try:
        return list(folder_paths.get_filename_list(FOLDER))
    except Exception:
        return []


def full_path(name):
    if not isinstance(name, str) or not name.strip():
        return None
    try:
        path = folder_paths.get_full_path(FOLDER, name)
    except Exception:
        return None
    return path if path and os.path.isfile(path) else None


def _base(name):
    return os.path.basename(str(name).replace("\\", "/")).lower()


def resolve(name, available=None):
    """-> (name, path, how). how: "exact", "moved" (same file name in another
    loras subfolder, e.g. after Model Hub sorted it into <base>/), or None."""
    path = full_path(name)
    if path:
        return name, path, "exact"
    want = _base(name)
    if not want:
        return None, None, None
    pool = names() if available is None else available
    cands = [n for n in pool if _base(n) == want]
    if not cands:
        stem = os.path.splitext(want)[0]
        cands = [n for n in pool if os.path.splitext(_base(n))[0] == stem]
    cands.sort(key=lambda n: (n.replace("\\", "/").count("/"), n.lower()))
    for cand in cands:
        path = full_path(cand)
        if path:
            return cand, path, "moved"
    return None, None, None


def stat_key(path):
    st = os.stat(path)
    return (os.path.realpath(path), st.st_size, st.st_mtime_ns)


def _dir_index(directory):
    try:
        mt = os.stat(directory).st_mtime_ns
    except OSError:
        return {}
    with _lock:
        hit = _dir_cache.get(directory)
        if hit and hit[0] == mt:
            return hit[1]
    try:
        entries = os.listdir(directory)
    except OSError:
        entries = []
    index = {e.lower(): e for e in entries}
    with _lock:
        _dir_cache[directory] = (mt, index)
    return index


def preview_for(path, index=None):
    """-> (preview path, "image"|"video") next to the LoRA, or (None, None)."""
    directory, fname = os.path.split(path)
    stem = os.path.splitext(fname)[0].lower()
    index = _dir_index(directory) if index is None else index
    for suffix in PREVIEW_SUFFIXES:
        real = index.get(stem + suffix)
        if real:
            kind = "video" if suffix.endswith(VIDEO_SUFFIXES) else "image"
            return os.path.join(directory, real), kind
    return None, None


# ------------------------------------------------------------------- sidecars
def _read_json(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    sig = (st.st_size, st.st_mtime_ns)
    with _lock:
        hit = _json_cache.get(path)
        if hit and hit[0] == sig:
            return hit[1]
    data = None
    if 0 < st.st_size <= MAX_SIDECAR:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = None
    if not isinstance(data, dict):
        data = None
    with _lock:
        _json_cache[path] = (sig, data)
    return data


def sidecars(path, index=None):
    """-> {"lm": dict|None, "ci": dict|None, "a1": dict|None}."""
    directory, fname = os.path.split(path)
    stem = os.path.splitext(fname)[0]
    index = _dir_index(directory) if index is None else index
    out = {}
    for key, suffix in SIDECARS.items():
        real = index.get((stem + suffix).lower())
        out[key] = _read_json(os.path.join(directory, real)) if real else None
    return out


def civitai_version(side):
    """The Civitai model-version payload a sidecar holds, if any."""
    lm = side.get("lm") or {}
    civ = lm.get("civitai")
    if isinstance(civ, dict) and civ.get("id"):
        return civ, "LoRA Manager"
    ci = side.get("ci")
    if isinstance(ci, dict) and ci.get("id"):
        return ci, "Civitai Helper"
    return None, None


def _split_words(text):
    if not isinstance(text, str):
        return []
    return [w.strip() for w in re.split(r"[,\n]", text) if w.strip()]


def preferred_strength(side):
    a1 = side.get("a1") or {}
    for value in (a1.get("preferred weight"),):
        try:
            f = float(value)
            if f:
                return round(f, 2)
        except (TypeError, ValueError):
            pass
    tips = (side.get("lm") or {}).get("usage_tips")
    if isinstance(tips, str):
        try:
            tips = json.loads(tips)
        except ValueError:
            tips = None
    if isinstance(tips, dict):
        try:
            f = float(tips.get("strength"))
            if f:
                return round(f, 2)
        except (TypeError, ValueError):
            pass
    return None


# ------------------------------------------------------------ header summary
_SUFFIX = re.compile(
    r"[._](?:lora_(?:up|down|mid|A|B)(?:\.default)?\.weight|lora\.(?:up|down)\.weight"
    r"|lora_linear_layer\.(?:up|down)\.weight|alpha|dora_scale|hada_w[12]_[ab]|hada_t[12]"
    r"|lokr_w[12](?:_[ab])?|lokr_t[12]|oft_blocks|oft_diag|boft_blocks|rescale"
    r"|diff|diff_b|set_weight|w_norm|b_norm|reshape_weight)$"
)
_DOWN = re.compile(r"(?:lora_down|lora_A|lora\.down|lora_linear_layer\.down)(?:\.default)?\.weight$")


def _maybe_json(value):
    if isinstance(value, str) and value[:1] in "{[":
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def read_header(path):
    """(tensor table, __metadata__) of a .safetensors file; ({}, {}) for anything else."""
    if not path.lower().endswith(".safetensors"):
        return {}, {}
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            raw = f.read(8)
            if len(raw) != 8:
                return {}, {}
            n = struct.unpack("<Q", raw)[0]
            if not 0 < n <= min(MAX_HEADER, size - 8):
                return {}, {}
            header = json.loads(f.read(n))
    except (OSError, ValueError, struct.error):
        return {}, {}
    if not isinstance(header, dict):
        return {}, {}
    meta = header.pop("__metadata__", None)
    meta = {str(k): v for k, v in meta.items()} if isinstance(meta, dict) else {}
    tensors = {k: v for k, v in header.items() if isinstance(v, dict)}
    return tensors, meta


def _algo(keys):
    if any("lokr_w" in k for k in keys):
        return "LoKr"
    if any("hada_w" in k for k in keys):
        return "LoHa"
    if any(k.endswith("boft_blocks") for k in keys):
        return "BOFT"
    if any(k.endswith(("oft_blocks", "oft_diag")) for k in keys):
        return "OFT"
    lora = any(_DOWN.search(k) for k in keys)
    if lora and any(k.endswith("dora_scale") for k in keys):
        return "DoRA"
    if lora:
        return "LoRA"
    if any(k.endswith((".diff", ".diff_b", "set_weight")) for k in keys):
        return "Diff"
    return None


def arch_hint(meta):
    arch = str(meta.get("modelspec.architecture") or "").strip()
    arch = re.sub(r"/(?:lora|lycoris|lokr|loha|dora|lora-[a-z]+)$", "", arch, flags=re.I)
    return arch or str(meta.get("ss_base_model_version") or "").strip() or None


def tag_words(meta, limit=30):
    """ss_tag_frequency ({bucket: {tag: count}}) summed across buckets, most frequent first."""
    counts = collections.Counter()
    freq = _maybe_json(meta.get("ss_tag_frequency"))
    if isinstance(freq, dict):
        for bucket in freq.values():
            if not isinstance(bucket, dict):
                continue
            for tag, n in bucket.items():
                tag = str(tag).strip()
                if not tag:
                    continue
                try:
                    counts[tag] += int(n)
                except (TypeError, ValueError):
                    counts[tag] += 1
    words = [{"word": w, "count": c} for w, c in counts.most_common(limit)]
    for w in _split_words(meta.get("modelspec.trigger_phrase")):
        if all(x["word"].lower() != w.lower() for x in words):
            words.insert(0, {"word": w, "count": 0})
    return words


def _training(meta):
    out = {}
    info = _maybe_json(meta.get("training_info"))
    if isinstance(info, dict):
        out["steps"] = info.get("step")
        out["epochs"] = info.get("epoch")
    for src, dst in (("ss_max_train_steps", "steps"), ("ss_steps", "steps"), ("ss_epoch", "epochs"),
                     ("ss_num_epochs", "epochs"), ("ss_network_dim", "dim"), ("ss_network_alpha", "alpha"),
                     ("ss_resolution", "resolution"), ("modelspec.resolution", "resolution"),
                     ("ss_learning_rate", "lr"), ("ss_num_train_images", "images"),
                     ("modelspec.date", "date"), ("modelspec.author", "author")):
        if out.get(dst) in (None, "", "None") and meta.get(src) not in (None, "", "None"):
            out[dst] = meta.get(src)
    software = _maybe_json(meta.get("software"))
    if isinstance(software, dict) and software.get("name"):
        out["software"] = software["name"]
    elif isinstance(software, str) and software:
        out["software"] = software[:60]
    return {k: v for k, v in out.items() if v not in (None, "", "None")}


def header_summary(path):
    """Cheap facts about a LoRA from its header: layers, rank, algo, audio split, arch."""
    key = stat_key(path)
    with _lock:
        hit = _summary_cache.get(key)
        if hit is not None:
            _summary_cache.move_to_end(key)
            return hit
    tensors, meta = read_header(path)
    keys = list(tensors)
    modules = {_SUFFIX.sub("", k) for k in keys}
    ranks = collections.Counter()
    for k, v in tensors.items():
        shape = v.get("shape") or []
        if _DOWN.search(k) and len(shape) >= 2:
            ranks[int(shape[0])] += 1
    dtypes = collections.Counter(str(v.get("dtype")) for v in tensors.values() if v.get("dtype"))
    title = str(meta.get("modelspec.title") or "").strip()
    summary = {
        "format": os.path.splitext(path)[1].lstrip(".").lower(),
        "size": key[1],
        "keys": len(keys),
        "layers": len(modules),
        "audioKeys": sum(1 for k in keys if "audio" in k.lower()),
        "audioLayers": sum(1 for m in modules if "audio" in m.lower()),
        "rank": ranks.most_common(1)[0][0] if ranks else None,
        "rankMixed": len(ranks) > 1,
        "algo": _algo(keys),
        "dtype": dtypes.most_common(1)[0][0] if dtypes else None,
        "arch": arch_hint(meta),
        "title": title if title and title.lower() not in ("lora", "krea 2 lora") else None,
        "words": tag_words(meta),
        "train": _training(meta),
        "pdd": bool(meta.get("pdd_num_steps") or meta.get("pdd_block_size")),
    }
    with _lock:
        _summary_cache[key] = summary
        while len(_summary_cache) > _SUMMARY_MAX:
            _summary_cache.popitem(last=False)
    return summary


# ---------------------------------------------------------------- picker cards
def _mtime(path):
    try:
        return os.stat(path).st_mtime_ns
    except OSError:
        return 0


def card(name, path, index=None):
    """Everything the picker shows for one LoRA (small; the list holds all of them)."""
    directory, fname = os.path.split(path)
    index = _dir_index(directory) if index is None else index
    stem = os.path.splitext(fname)[0]
    st = os.stat(path)
    side_real = [index.get((stem + s).lower()) for s in SIDECARS.values()]
    prev_path, prev_kind = preview_for(path, index)
    sig = (st.st_size, st.st_mtime_ns, prev_path, _mtime(prev_path) if prev_path else 0,
           tuple(_mtime(os.path.join(directory, r)) if r else 0 for r in side_real))
    with _lock:
        hit = _card_cache.get(path)
        if hit and hit[0] == sig:
            return hit[1]

    side = sidecars(path, index)
    civ, _src = civitai_version(side)
    lm = side.get("lm") or {}
    a1 = side.get("a1") or {}
    model = (civ or {}).get("model") if isinstance((civ or {}).get("model"), dict) else {}
    words = [w for w in ((civ or {}).get("trainedWords") or []) if isinstance(w, str) and w.strip()]
    if not words:
        words = _split_words(a1.get("activation text"))
    base = lm.get("base_model") or (civ or {}).get("baseModel")
    if not base and isinstance(a1.get("sd version"), str) and a1["sd version"].lower() not in ("", "unknown"):
        base = a1["sd version"]
    title = lm.get("model_name") or model.get("name") or None
    head = None
    if not base or not title:
        try:
            head = header_summary(path)
        except OSError:
            head = None
    rel_dir = os.path.dirname(name.replace("\\", "/"))
    data = {
        "name": name,
        "dir": rel_dir,
        "file": fname,
        "title": title or (head or {}).get("title"),
        "version": (civ or {}).get("name"),
        "base": base or None,
        "arch": None if base else (head or {}).get("arch"),
        "words": words[:16],
        "strength": preferred_strength(side),
        "preview": prev_kind,
        "pv": int(_mtime(prev_path) // 1_000_000_000) if prev_path else 0,
        "size": st.st_size,
        "mtime": int(st.st_mtime),
        "fav": bool(lm.get("favorite")),
        "civ": bool(civ),
    }
    with _lock:
        _card_cache[path] = (sig, data)
    return data


def list_cards():
    out = []
    seen = set()
    for name in names():
        path = full_path(name)
        if not path or path in seen:
            continue
        seen.add(path)
        try:
            out.append(card(name, path))
        except OSError:
            continue
    return out


def preview_file(name):
    _name, path, _how = resolve(name)
    if not path:
        return None, None
    return preview_for(path)
