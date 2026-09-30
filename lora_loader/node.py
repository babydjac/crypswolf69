"""✦ ADVANCED LORA LOADER — a whole LoRA stack in one node.

Rows come from the list UI (web/lora_loader.js) as JSON in the hidden `stack`
widget; see stack.py for the format. Compared with DaSiWa's Advanced LoRA Loader:

  * CLIP is optional; LoRAs that train the text encoder still reach it when wired.
  * The audio split is automatic: keys containing "audio" (LTX-2.3 branches, H3
    audio heads) get STR x A, everything else STR x VIS — no model-type switch.
  * trigger_words / lora_tags outputs; missing LoRAs fail at queue time by name;
    LoRAs moved into another loras/ subfolder are found by file name.
  * Every row reports how many weights it actually patched, so a LoRA made for
    another base model shows up as "0 matched" instead of silently doing nothing.
  * A PDD head-bank / model width mismatch is a readable error, not a shape crash.
  * Changing only trigger words or switched-off rows re-uses the previous MODEL,
    so the sampler doesn't re-patch weights.
"""

import collections
import inspect
import logging
import threading
import weakref

import comfy.sd
import comfy.utils
from comfy_api.latest import io

from . import files
from . import stack as st

log = logging.getLogger("crypswolf69.lora")
TITLE = "Advanced LoRA Loader"
DEFAULT_STACK = '{"v":1,"cache":false,"rows":[]}'

_load_lora = comfy.sd.load_lora_for_models
try:
    _TAKES_META = "lora_metadata" in inspect.signature(_load_lora).parameters
except (TypeError, ValueError):
    _TAKES_META = False


# ------------------------------------------------------------ tensor cache
def _ram_budget():
    try:
        import psutil
        total = psutil.virtual_memory().total
    except Exception:
        total = 8 << 30
    return int(min(2 << 30, total * 0.15))


class _TensorCache:
    """Opt-in (the ⚡ toggle): LoRA tensors kept in RAM, LRU, capped at 15% of RAM / 2 GB."""

    def __init__(self):
        self._items = collections.OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            hit = self._items.get(key)
            if hit is None:
                return None
            self._items.move_to_end(key)
            return hit[0]

    def put(self, key, value, nbytes):
        budget = _ram_budget()
        if nbytes > budget:
            return
        with self._lock:
            old = self._items.pop(key, None)
            if old:
                self._bytes -= old[1]
            self._items[key] = (value, nbytes)
            self._bytes += nbytes
            while self._bytes > budget and self._items:
                _k, (_v, n) = self._items.popitem(last=False)
                self._bytes -= n

    def clear(self):
        with self._lock:
            self._items.clear()
            self._bytes = 0

    def __len__(self):
        return len(self._items)


_CACHE = _TensorCache()


def _load(path, use_cache):
    key = files.stat_key(path)
    if use_cache:
        hit = _CACHE.get(key)
        if hit is not None:
            return hit
    try:
        sd, md = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
    except TypeError:
        sd, md = comfy.utils.load_torch_file(path, safe_load=True), None
    if use_cache:
        nbytes = sum(t.numel() * t.element_size() for t in sd.values() if hasattr(t, "element_size"))
        _CACHE.put(key, (sd, md), nbytes)
    return sd, md


# ------------------------------------------------------------------ apply
def _npatches(patcher):
    try:
        return sum(len(v) for v in patcher.patches.values())
    except Exception:
        return 0


def _clip_patches(clip):
    return _npatches(clip.patcher) if clip is not None else 0


def pdd_mismatch(sd, md, model):
    """(bank width, model width) when a PDD LoRA's head bank can't fit this model, else None."""
    md = md if isinstance(md, dict) else {}
    if not (md.get("pdd_num_steps") or md.get("pdd_block_size")):
        return None
    bank = None
    for suffix in ("video_out.set_weight", "video_out.diff", "video_out.weight"):
        for k, v in sd.items():
            if k.endswith(suffix) and getattr(v, "ndim", 0) >= 1:
                bank = int(v.shape[0])
                break
        if bank:
            break
    try:
        width = int(model.model.diffusion_model.final_layer.video_out.weight.shape[0])
    except Exception:
        width = None
    return (bank, width) if bank and width and bank != width else None


def apply_lora(model, clip, sd, md, sm, sa, sc):
    """Apply one LoRA. -> (model, clip, model patches added, clip patches added, audio keys)."""
    kw = {"lora_metadata": md} if _TAKES_META and md else {}
    rest, audio = st.split_audio(sd) if sa != sm else (sd, {})
    m0, c0 = _npatches(model), _clip_patches(clip)
    if rest and (sm != 0 or (clip is not None and sc != 0)):
        m, c = _load_lora(model, clip, rest, sm, sc, **kw)
        model = m if m is not None else model
        clip = c if c is not None else clip
    if audio and sa != 0:
        # audio keys never belong to the text encoder
        m, _c = _load_lora(model, None, audio, sa, 0.0, **kw)
        model = m if m is not None else model
    return model, clip, _npatches(model) - m0, _clip_patches(clip) - c0, len(audio)


# ------------------------------------------------------------------- memo
_MEMO = collections.OrderedDict()   # node id -> previous run (weak refs only)
_MEMO_MAX = 32


def _same(ref, obj):
    return obj is None if ref is None else ref() is obj


def _fmt_names(names, limit=4):
    shown = ", ".join(f"'{n}'" for n in names[:limit])
    return shown + (f" (+{len(names) - limit} more)" if len(names) > limit else "")


class CrypsAdvancedLoraLoader(io.ComfyNode):
    """Stack LoRAs in one node, with per-LoRA strength, CLIP and audio/video control."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="CrypsAdvancedLoraLoader",
            display_name="✦ ADVANCED LORA LOADER",
            category="model/loaders",
            description=(
                "Stack any number of LoRAs in one node: on/off, strength, optional CLIP strength and "
                "a separate audio strength for audio-video models (LTX-2.3, MiniMax H3). Search picker "
                "with previews, Civitai info and trigger words; trigger_words carries the picked words."
            ),
            search_aliases=[
                "lora", "lora stack", "lora stacker", "multi lora", "power lora", "advanced lora",
                "lora loader", "load lora", "trigger words", "ltx lora", "h3 lora", "krea2 lora",
            ],
            inputs=[
                io.Model.Input("model", tooltip="Diffusion model the LoRA stack is applied to."),
                io.Clip.Input(
                    "clip", optional=True,
                    tooltip="Optional. Wire it when your LoRAs also train the text encoder (SDXL/Pony/SD1.5).",
                ),
                io.String.Input(
                    "stack", default=DEFAULT_STACK,
                    tooltip="The LoRA list, edited in the node UI (JSON).",
                ),
            ],
            outputs=[
                io.Model.Output(display_name="MODEL"),
                io.Clip.Output(display_name="CLIP", tooltip="Patched CLIP (empty when no CLIP is wired)."),
                io.String.Output(
                    display_name="trigger_words",
                    tooltip="Trigger words picked in each LoRA's ⓘ panel, for the active LoRAs, comma separated.",
                ),
                io.String.Output(
                    display_name="lora_tags",
                    tooltip="<lora:name:strength> for each active LoRA — for metadata, captions or file names.",
                ),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def validate_inputs(cls, stack=None):
        if not isinstance(stack, str):
            return True  # linked from another node: checked when it runs
        rows, _opts, err = st.parse_stack(stack)
        if err:
            return err
        pool = files.names()
        missing = [r["lora"] for r in rows if st.is_active(r) and not files.resolve(r["lora"], pool)[1]]
        if missing:
            return f"LoRA not found: {_fmt_names(missing)} — pick it again or switch the row off"
        return True

    @classmethod
    def execute(cls, model, stack, clip=None) -> io.NodeOutput:
        rows, opts, err = st.parse_stack(stack)
        if err:
            raise ValueError(f"{TITLE}: {err}")
        use_cache = opts["cache"]
        if not use_cache and len(_CACHE):
            _CACHE.clear()

        pool = files.names()
        report, plan, missing = [], [], []
        for i, row in enumerate(rows):
            entry = {"i": i, "lora": row["lora"]}
            report.append(entry)
            if not st.is_active(row):
                entry["status"] = "off"
                continue
            rname, path, how = files.resolve(row["lora"], pool)
            if not path:
                entry["status"] = "missing"
                missing.append(row["lora"])
                continue
            if how == "moved":
                entry["resolved"] = rname
            plan.append((row, path, entry))
        if missing:
            raise FileNotFoundError(f"{TITLE}: LoRA not found: {_fmt_names(missing)}")

        sig = tuple((files.stat_key(path), st.strengths(row)) for row, path, _e in plan) + (_TAKES_META,)
        uid = getattr(cls.hidden, "unique_id", None) if cls.hidden is not None else None
        memo = _MEMO.get(uid) if uid is not None else None
        if memo and memo["sig"] == sig and _same(memo["model_in"], model) and _same(memo["clip_in"], clip):
            m_out = memo["model_out"]()
            c_out = memo["clip_out"]() if memo["clip_out"] is not None else None
            if m_out is not None and (clip is None or c_out is not None):
                for (_row, _path, entry), stats in zip(plan, memo["stats"]):
                    entry.update(stats)
                return cls._out(m_out, c_out, rows, report)

        m, c, all_stats = model, clip, []
        for row, path, entry in plan:
            sm, sa, sc = st.strengths(row)
            sd, md = _load(path, use_cache)
            bad = pdd_mismatch(sd, md, m)
            if bad:
                raise ValueError(
                    f"{TITLE}: '{row['lora']}' is a PDD LoRA whose head bank is {bad[0]} wide, but this "
                    f"model's final_layer.video_out is {bad[1]} wide. Use it with a PDD model or pick "
                    f"the non-PDD Acc LoRA."
                )
            m, c, dm, dc, n_audio = apply_lora(m, c, sd, md, sm, sa, sc)
            try:
                layers = files.header_summary(path).get("layers") or 0
            except OSError:
                layers = 0
            applied = dm + dc
            status = "nomatch" if applied == 0 else ("partial" if layers and applied < layers * 0.9 else "ok")
            stats = {"status": status, "model": dm, "clip": dc, "layers": layers, "audio": n_audio}
            entry.update(stats)
            all_stats.append(stats)
            log.info("[✦ LoRA] %s  model %.2f%s  clip %.2f  -> %d model / %d clip weights%s",
                     row["lora"], sm, f" audio {sa:.2f}" if n_audio else "", sc, dm, dc,
                     "" if status == "ok" else f"  ({status}: {applied}/{layers})")
            if status == "nomatch":
                log.warning("[✦ LoRA] '%s' matched no weights in this model — made for another base model?",
                            row["lora"])

        if uid is not None:
            _MEMO[uid] = {
                "sig": sig,
                "model_in": weakref.ref(model),
                "clip_in": weakref.ref(clip) if clip is not None else None,
                "model_out": weakref.ref(m),
                "clip_out": weakref.ref(c) if c is not None else None,
                "stats": all_stats,
            }
            _MEMO.move_to_end(uid)
            while len(_MEMO) > _MEMO_MAX:
                _MEMO.popitem(last=False)
        return cls._out(m, c, rows, report)

    @classmethod
    def _out(cls, m, c, rows, report):
        return io.NodeOutput(m, c, st.trigger_text(rows), st.lora_tags(rows), ui={"cryps_lora": report})
