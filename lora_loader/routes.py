"""HTTP routes for the Advanced LoRA Loader UI (everything under /cryps_lora/).

File work runs in worker threads so a big LoRA library never stalls the server.
"""

import asyncio

from aiohttp import web
from server import PromptServer

from . import files, info

routes = PromptServer.instance.routes
MAX_BATCH = 64


def _json(data, status=200):
    return web.json_response(data, status=status)


@routes.get("/cryps_lora/list")
async def r_list(req):
    return _json({"loras": await asyncio.to_thread(files.list_cards)})


def _summaries(names):
    pool = files.names()
    out = {}
    for name in names:
        rname, path, how = files.resolve(name, pool)
        if not path:
            out[name] = {"missing": True}
            continue
        try:
            summary = {k: v for k, v in files.header_summary(path).items() if k != "words"}
        except OSError:
            out[name] = {"missing": True}
            continue
        summary["resolved"] = rname if how == "moved" else None
        out[name] = summary
    return out


@routes.post("/cryps_lora/summary")
async def r_summary(req):
    try:
        body = await req.json()
    except Exception:
        body = None
    raw = body.get("names") if isinstance(body, dict) else None
    names = [n for n in raw if isinstance(n, str)][:MAX_BATCH] if isinstance(raw, list) else []
    return _json({"summaries": await asyncio.to_thread(_summaries, names)})


@routes.get("/cryps_lora/info")
async def r_info(req):
    name = req.rel_url.query.get("name", "")
    refresh = req.rel_url.query.get("refresh", "") in ("1", "true")
    try:
        data = await info.get_info(name, refresh)
    except OSError as e:
        return _json({"error": f"could not read the LoRA ({e.strerror or e})"}, 500)
    if data is None:
        return _json({"error": "LoRA not found"}, 404)
    return _json(data)


@routes.get("/cryps_lora/preview")
async def r_preview(req):
    path, _kind = await asyncio.to_thread(files.preview_file, req.rel_url.query.get("name", ""))
    if not path:
        return _json({"error": "no preview next to this LoRA"}, 404)
    return web.FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})
