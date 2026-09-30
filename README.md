# crypswolf69

One ComfyUI pack with three tools:

| Piece | What it does |
|---|---|
| **Alchemist** | Prompt + LoRA-caption nodes for Krea 2 and MiniMax H3, any LLM provider |
| **Prompt Rotate** | Paste a prompt list → STRING list socket, or queue one job per prompt |
| **Model Hub** | One window, two tabs: **Civitai** and **Hugging Face** — browse, filter and download straight into the right `models/` folder |

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

Hugging Face downloads use `aria2c`. If it's missing, click **Install aria2** in the Model Hub header (Homebrew, winget, Chocolatey, Scoop, apt-get, dnf/yum, pacman or apk — whichever the machine has). Civitai downloads don't need it.

## Model Hub

Open it with the draggable **Model Hub** launcher, **Alt+M** (Option+M on a Mac), the **Model Hub** sidebar tab, or the command palette. **Ctrl/Cmd+Shift+B** opens it straight on the Hugging Face tab. The header shows the aria2 status on both tabs — a green ✓ when it's installed, an **Install aria2** button when it isn't.

### Civitai tab

- **Browse** — masonry grid with fast CDN thumbnails and hover-to-play video previews (H3, Wan…), infinite scroll, comfortable / compact density.
- **Filter** — model type, base model (Krea 2, MiniMax H3, Flux.2, Illustrious… — the list grows as you browse, and any value can be typed), sort, period, NSFW (sensitive previews stay blurred until you choose to show them).
- **Details** — version picker, media viewer + full-screen lightbox (← →), click-to-copy trigger words, description, and every file with size / format / precision.
- **Download** — per-file **Save to** picker with a sensible default (Krea 2 / Flux / Wan / Qwen checkpoints and any GGUF → `diffusion_models`), sorted into base-model subfolders (`loras/Krea 2/…`, `loras/MiniMax H3/…`). Buttons show live progress; "owned" files are marked.
- **Paste link** — a Civitai model page, Civitai download link, or Hugging Face file link; name, type and folder are worked out for you.
- **Downloader** — up to 3 files at once, 8 parallel segments each, automatic retry and resume, never writes outside `models/`, tokens are only ever sent to their own site.
- ⚙ **Settings** — Civitai API token, Hugging Face token, connections, segment size, subfolder sorting, aria2 status / install.

Keyboard: `/` search · `Esc` closes the top-most panel · `←` `→` in the viewer.

### Hugging Face tab

- **Browse** — curated index from trusted owners, tabbed by category (Diffusion Models, Checkpoints, Text Encoders, VAE, LoRAs, ControlNet, Upscale Models…), installed files marked.
- **Live HF** — search the whole Hub; quick chips (Upscalers, ESRGAN, Krea 2, ControlNet, LoRAs, VAE, Encoders, GGUF); pick a repo, tick files (the destination folder is shown on each), **Download N** from the files header.
- **Downloads** — per-job and per-file progress with cancel.
- **Compact** — a denser layout for small screens (remembered).

Keyboard: `/` search · `↑` `↓` move through repos / files · `→` / `←` jump between repos and files · `Enter` open a repo · `Space` select a file · `Esc` clears the search, then closes the hub.

## ✦ Advanced LoRA Loader

One node for a whole LoRA stack (`CrypsAdvancedLoraLoader`, in *model/loaders*).

- **Rows** — on/off switch, preview, name, strength pill (drag to scrub, click to type, `‹ ›` ±0.05, Shift for ±0.01, Alt-click resets), drag handle to reorder.
- **Picker** — search by name, trigger word or base model; folder chips, Recent, LoRA Manager favorites; image/video previews; `↑` `↓` `Enter`, Shift adds several.
- **ⓘ panel** — Civitai page (.com / .red), creator, example images with prompts, file facts (LoRA/LoKr, rank, layers, training steps). Click trigger words to send them to the `trigger_words` output.
- **CLIP** — optional input; the `T` toggle gives each LoRA its own CLIP strength.
- **Audio-video models** (LTX-2.3, MiniMax H3) — LoRAs with audio layers get `V×` / `A×` multipliers: audio keys get STR × A×, everything else STR × V×.
- **Status after a run** — `✓` patched, `◐` partly matched, `⚠` matched nothing (LoRA for another base model), `✖` missing, `↪` found in another loras subfolder (click to save the new path).
- **Outputs** — `MODEL`, `CLIP`, `trigger_words`, `lora_tags` (`<lora:name:strength>`).
- `⚡` keeps LoRA files in RAM between runs (capped at 15% of RAM); compact rows and six themes are in the header.

Info comes from LoRA Manager / Civitai Helper / A1111 sidecars when present, otherwise the file is hashed once (off the UI thread) and looked up on Civitai; results are cached in `lora_loader/.cache/`. Missing LoRAs stop the queue with their names, and DaSiWa `stack_data` JSON can be pasted into the `stack` widget.

## Nodes

- `AlchemistKrea2` / `AlchemistLoraCaption` / `AlchemistH3` / `AlchemistPrompt` / `AlchemistDatasetCaptioner`
- `PromptRotate` / `PromptRotatePick`
- `CrypsAdvancedLoraLoader` (✦ ADVANCED LORA LOADER)
- The Model Hub is a UI panel (no graph nodes)

Existing workflows that used the standalone packs keep the same class names.

## License

MIT. See `LICENSE`.
