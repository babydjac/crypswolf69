"""Model Hub — dual Civitai / Hugging Face browser + fast resumable downloader.

Importing `.server` registers all aiohttp routes on ComfyUI's PromptServer.
The UI ships as ../web/model_hub.js (auto-served via WEB_DIRECTORY).
"""
from . import server  # noqa: F401
