# crypswolf69

One ComfyUI pack with four tools:

| Piece | What it does |
|---|---|
| **Alchemist** | Prompt + LoRA-caption nodes for Krea 2 and MiniMax H3, any LLM provider |
| **Prompt Rotate** | Paste a prompt list → STRING list socket, or queue one job per prompt |
| **Model Hub** | Civitai browser — thumbnails & video previews, live filters, fast resumable downloads into the right `models/` folder |
| **HF Model Downloader** | Hugging Face browser — curated tabs, live Hub search, batch downloads via aria2 |

Sources bundled from:

- https://github.com/babydjac/ComfyUI-Alchemist
- https://github.com/babydjac/ComfyUI-PromptRotate
- https://github.com/babydjac/ComfyUI_HF_ModelDownloader

## Install

**ComfyUI-Manager / Registry**

Search `crypswolf69` and install.

**Manual**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/babydjac/crypswolf69.git
pip install -r crypswolf69/requirements.txt
```

Restart ComfyUI and hard-refresh the browser.

Hugging Face downloads use `aria2c` (macOS: `brew install aria2`). The Model Hub's own downloader is pure Python.

## Model Hub

Open it with the draggable **Model Hub** launcher, **Alt+M** (Option+M), the **Model Hub** sidebar tab, or the command palette. The **Hugging Face** tab opens the HF Model Downloader.

- **Browse** — masonry grid with fast CDN thumbnails and hover-to-play video previews (H3, Wan…), infinite scroll, comfortable / compact density.
- **Filter** — model type, base model (Krea 2, MiniMax H3, Flux.2, Illustrious… — the list grows as you browse, and any value can be typed), sort, period, NSFW (sensitive previews stay blurred until you choose to show them).
- **Details** — version picker, media viewer + full-screen lightbox (← →), click-to-copy trigger words, description, and every file with size / format / precision.
- **Download** — per-file **Save to** picker with a sensible default (Krea 2 / Flux / Wan / Qwen checkpoints and any GGUF → `diffusion_models`), sorted into base-model subfolders (`loras/Krea 2/…`, `loras/MiniMax H3/…`). Buttons show live progress; "owned" files are marked.
- **Paste link** — a Civitai model page, Civitai download link, or Hugging Face file link; name, type and folder are worked out for you.
- **Downloader** — up to 3 files at once, 8 parallel segments each, automatic retry and resume, never writes outside `models/`, tokens are only ever sent to their own site.
- ⚙ **Settings** — Civitai API token, Hugging Face token, connections, segment size, subfolder sorting.

Keyboard: `/` search · `Esc` closes the top-most panel · `←` `→` in the viewer.

## HF Model Downloader

Open it with the **Model Browser** / **HF Models** buttons, the **HF Models** sidebar tab, **Ctrl/Cmd+Shift+B**, or the Model Hub's Hugging Face tab.

- **Browse** — curated index from trusted owners, tabbed by category (Diffusion Models, Checkpoints, Text Encoders, VAE, LoRAs, ControlNet, Upscale Models…), installed files marked.
- **Live HF** — search the whole Hub; quick chips (Upscalers, ESRGAN, Krea 2, ControlNet, LoRAs, VAE, Encoders, GGUF); pick a repo, tick files (the destination folder is shown on each), **Download N** from the files header.
- **Downloads** — per-job and per-file progress with cancel.
- **Compact** — a denser layout for small screens (remembered).

Keyboard: `/` search · `↑` `↓` move through repos / files · `→` / `←` jump between repos and files · `Enter` open a repo · `Space` select a file · `Esc` clears the search, then closes.

## Nodes

- `AlchemistKrea2` / `AlchemistLoraCaption` / `AlchemistH3` / `AlchemistPrompt` / `AlchemistDatasetCaptioner`
- `PromptRotate` / `PromptRotatePick`
- Model Hub and HF Model Downloader are UI panels (no graph nodes)

Existing workflows that used the standalone packs keep the same class names.

## License

MIT. See `LICENSE`.
