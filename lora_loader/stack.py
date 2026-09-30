"""Stack format for the Advanced LoRA Loader. Pure Python — no ComfyUI imports.

The node's hidden `stack` widget holds JSON written by web/lora_loader.js:

    {"v": 1, "cache": false, "rows": [
        {"on": true, "lora": "Krea 2/x.safetensors", "str": 1.0,
         "clip": null, "vs": 1.0, "as": 1.0, "words": ["trigger"]}
    ]}

  str    master strength
  vs/as  video / audio multipliers: keys containing "audio" (LTX-2.3, H3 audio
         heads) get str*as, everything else str*vs
  clip   CLIP strength; null means "same as the model" (str*vs)
  words  trigger words picked in the info panel, emitted on `trigger_words`

A bare list of rows (DaSiWa's `stack_data`) is accepted as well.
"""

import json
import math
import os

STR_MIN, STR_MAX = -10.0, 10.0
MULT_MIN, MULT_MAX = 0.0, 2.0
MAX_ROWS = 64
MAX_WORDS = 64


def _num(value, default, lo, hi):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(f):
        return default
    return min(hi, max(lo, f))


def is_none_name(name):
    return not isinstance(name, str) or name.strip().lower() in ("", "none")


def normalize_row(row):
    """One row -> canonical dict, or None when it holds no LoRA."""
    if not isinstance(row, dict) or is_none_name(row.get("lora")):
        return None
    clip = row.get("clip")
    words = row.get("words")
    if isinstance(words, list):
        words = [w.strip() for w in words if isinstance(w, str) and w.strip()][:MAX_WORDS]
    else:
        words = []
    return {
        "on": bool(row.get("on", True)),
        "lora": row["lora"].strip(),
        "str": _num(row.get("str", 1.0), 1.0, STR_MIN, STR_MAX),
        "clip": None if clip is None or clip == "" else _num(clip, None, STR_MIN, STR_MAX),
        "vs": _num(row.get("vs", 1.0), 1.0, MULT_MIN, MULT_MAX),
        "as": _num(row.get("as", 1.0), 1.0, MULT_MIN, MULT_MAX),
        "words": words,
    }


def parse_stack(raw):
    """-> (rows, options, error). Never raises; bad input gives an empty stack + error text."""
    opts = {"cache": False}
    data = raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return [], opts, None
        try:
            data = json.loads(text)
        except ValueError as e:
            return [], opts, f"stack is not valid JSON ({e.msg} at char {e.pos})"
    if isinstance(data, dict):
        opts["cache"] = bool(data.get("cache", False))
        data = data.get("rows", [])
    if not isinstance(data, list):
        return [], opts, "stack must be a JSON list of rows or {\"rows\": [...]}"
    rows = [r for r in (normalize_row(x) for x in data[:MAX_ROWS]) if r]
    return rows, opts, None


def strengths(row):
    """Effective (model, audio, clip) strengths for a row."""
    s = row["str"]
    model = s * row["vs"]
    audio = s * row["as"]
    clip = row["clip"] if row["clip"] is not None else model
    return model, audio, clip


def is_active(row):
    if not row["on"]:
        return False
    return any(v != 0 for v in strengths(row))


def is_audio_key(key):
    return "audio" in key.lower()


def split_audio(weights):
    """-> (non-audio, audio) views of a LoRA state dict."""
    rest, audio = {}, {}
    for k, v in weights.items():
        (audio if is_audio_key(k) else rest)[k] = v
    return rest, audio


def trigger_text(rows):
    """Selected trigger words of the active rows, de-duplicated, in stack order."""
    seen, out = set(), []
    for row in rows:
        if not is_active(row):
            continue
        for word in row["words"]:
            key = word.lower()
            if key not in seen:
                seen.add(key)
                out.append(word)
    return ", ".join(out)


def _fmt(x):
    return f"{x:.2f}".rstrip("0").rstrip(".") if x != int(x) else str(int(x))


def lora_tags(rows):
    """A1111-style <lora:name:weight> tags for the active rows (handy for metadata/filenames)."""
    tags = []
    for row in rows:
        if not is_active(row):
            continue
        stem = os.path.splitext(os.path.basename(row["lora"].replace("\\", "/")))[0]
        model, _audio, clip = strengths(row)
        tag = f"<lora:{stem}:{_fmt(model)}"
        if row["clip"] is not None and clip != model:
            tag += f":{_fmt(clip)}"
        tags.append(tag + ">")
    return " ".join(tags)
