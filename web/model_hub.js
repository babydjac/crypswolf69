import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/* =========================================================================
 * ComfyUI Model Hub
 *   - Civitai browser: thumbnails/video previews, filters, detail + lightbox,
 *     fast resumable downloads that land in the right models/ folder.
 *   - "Hugging Face" tab: the HF Model Downloader panel mounted inside the hub
 *     (a small built-in repo/file browser is the fallback if it isn't loaded).
 *   - aria2 status + one-click install in the header (aria2 runs the HF downloads).
 *
 * Security note: every piece of text that comes from Civitai/HF is written
 * with textContent. innerHTML is only used for the static icon markup below.
 * ======================================================================= */

const PREF_KEY = "modelhub.prefs.v2";

// ------------------------------------------------------------------ helpers
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null && text !== "") e.textContent = String(text);
  return e;
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  grid: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/>',
  masonry: '<rect x="3" y="3" width="7" height="11" rx="1.5"/><rect x="14" y="3" width="7" height="6" rx="1.5"/><rect x="3" y="17" width="7" height="4" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/>',
  list: '<rect x="3" y="4" width="4" height="4" rx="1"/><rect x="3" y="10" width="4" height="4" rx="1"/><rect x="3" y="16" width="4" height="4" rx="1"/><path d="M10 6h11M10 12h11M10 18h11"/>',
  compact: '<rect x="3" y="3" width="4" height="4" rx="1"/><rect x="10" y="3" width="4" height="4" rx="1"/><rect x="17" y="3" width="4" height="4" rx="1"/><rect x="3" y="10" width="4" height="4" rx="1"/><rect x="10" y="10" width="4" height="4" rx="1"/><rect x="17" y="10" width="4" height="4" rx="1"/><rect x="3" y="17" width="4" height="4" rx="1"/><rect x="10" y="17" width="4" height="4" rx="1"/><rect x="17" y="17" width="4" height="4" rx="1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  retry: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  alert: '<path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  hub: '<path d="M12 2.5 3.5 7.3v9.4l8.5 4.8 8.5-4.8V7.3z"/><path d="M12 12 3.5 7.3M12 12l8.5-4.7M12 12v9.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
function icon(name, size = 16) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", size); s.setAttribute("height", size);
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || "";          // static constant markup only
  return s;
}
function iconBtn(name, title, cls = "mh-ico") {
  const b = el("button", cls); b.type = "button"; b.title = title; b.setAttribute("aria-label", title);
  b.appendChild(icon(name)); return b;
}

const fmtNum = (n) => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : String(n); };
const fmtBytes = (b) => { b = +b || 0; if (b <= 0) return ""; const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (i ? b.toFixed(b >= 100 ? 0 : 1) : Math.round(b)) + " " + u[i]; };
const fmtSpeed = (s) => (s > 0 ? fmtBytes(s) + "/s" : "");
const fmtEta = (s) => (s == null ? "" : s < 60 ? `${s}s left` : s < 3600 ? `${Math.round(s / 60)}m left` : `${(s / 3600).toFixed(1)}h left`);

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ } }

async function call(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await api.fetchApi(path, opt);
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data || {};
}

// Civitai CDN: https://image.civitai.com/<key>/<uuid>/<transform>/<file>
// (verified: width=450,optimized=true -> ~18 KB webp instead of a multi-MB original;
//  transcode=true,width=450 -> small mp4; anim=false,... <stem>.jpeg -> poster frame)
const CIV = /^(https:\/\/image\.civitai\.com\/[^/]+\/[^/]+\/)(?:[^/]+\/)?([^/?#]+)$/;
const cvImg = (u, w = 450) => { const m = CIV.exec(u || ""); return m ? `${m[1]}width=${w},optimized=true/${m[2]}` : u; };
const cvVid = (u, w = 450) => { const m = CIV.exec(u || ""); return m ? `${m[1]}transcode=true,width=${w}/${m[2]}` : u; };
const cvPoster = (u, w = 450) => { const m = CIV.exec(u || ""); return m ? `${m[1]}anim=false,transcode=true,width=${w}/${m[2].replace(/\.[^.]+$/, "")}.jpeg` : ""; };
const mediaThumb = (md) => (md ? (md.type === "video" ? cvPoster(md.url) : cvImg(md.url)) : "");

// ------------------------------------------------------------------- styles
const STYLE = `
.mh-root{--bg:#0b0b10;--panel:#101017;--surf:#15151e;--surf2:#1b1b26;--line:rgba(255,255,255,.075);--line2:rgba(255,255,255,.13);
  --txt:#ececf3;--mut:#9494a8;--dim:#6b6b80;--acc:#8b5cf6;--acc2:#a78bfa;--ok:#34d399;--bad:#f87171;--warn:#fbbf24;
  font-family:Inter,ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;color:var(--txt)}
.mh-root *,.mh-root *::before,.mh-root *::after{box-sizing:border-box}
.mh-root button{font:inherit;color:inherit}
.mh-root :focus-visible{outline:2px solid var(--acc2);outline-offset:2px;border-radius:8px}
#mh-launch{position:fixed;z-index:2147483000;top:70px;right:16px;display:flex;align-items:center;gap:7px;padding:8px 12px 8px 10px;
  border:1px solid rgba(255,255,255,.14);border-radius:12px;cursor:grab;color:#ececf3;font:600 12.5px Inter,system-ui,sans-serif;
  background:rgba(17,17,25,.94);backdrop-filter:blur(10px);box-shadow:0 8px 26px rgba(0,0,0,.5);user-select:none;transition:border-color .15s,transform .1s}
#mh-launch:hover{border-color:#8b5cf6;transform:translateY(-1px)}
#mh-launch svg{color:#a78bfa}
#mh-launch .mh-lbadge{min-width:17px;height:17px;padding:0 5px;border-radius:9px;background:#8b5cf6;color:#fff;font-size:10px;font-weight:800;display:none;align-items:center;justify-content:center}
#mh-launch .mh-lbadge.on{display:inline-flex}
.mh-overlay{position:fixed;inset:0;z-index:2147483200;display:none;background:rgba(3,3,7,.72);backdrop-filter:blur(6px)}
.mh-overlay.open{display:flex;animation:mhIn .16s ease}
@keyframes mhIn{from{opacity:0}to{opacity:1}}
.mh-panel{position:relative;margin:auto;width:min(1440px,96vw);height:min(94vh,1100px);display:flex;flex-direction:column;overflow:hidden;
  border-radius:16px;border:1px solid var(--line);background:var(--panel);box-shadow:0 40px 110px rgba(0,0,0,.7)}
.mh-head{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--line)}
.mh-logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;letter-spacing:.4px;white-space:nowrap}
.mh-logo svg{color:var(--acc2)}
.mh-tabs{display:flex;gap:2px;background:rgba(255,255,255,.04);padding:3px;border-radius:10px}
.mh-tab{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:600;font-size:12.5px;color:var(--mut);border:0;background:transparent;transition:.15s}
.mh-tab:hover{color:var(--txt)}
.mh-tab.active{color:#fff;background:var(--acc)}
.mh-tab svg{opacity:.8}
.mh-search{flex:1;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:10px;padding:0 10px;min-width:160px;height:36px;transition:border-color .15s}
.mh-search:focus-within{border-color:var(--acc)}
.mh-search svg{color:var(--dim);flex:none}
.mh-search input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:var(--txt);font-size:13.5px;height:100%}
.mh-kbd{font:600 10px ui-monospace,Menlo,monospace;color:var(--dim);border:1px solid var(--line2);border-radius:5px;padding:1px 5px}
.mh-ico{position:relative;flex:none;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;cursor:pointer;
  background:rgba(255,255,255,.045);border:1px solid var(--line);color:var(--txt);transition:.15s}
.mh-ico:hover{background:rgba(255,255,255,.1);border-color:var(--line2)}
.mh-ico.on{border-color:var(--acc);color:var(--acc2)}
.mh-ico .mh-cnt{position:absolute;top:-6px;right:-6px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--acc);color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center}
.mh-clear{display:none;border:0;background:transparent;color:var(--dim);cursor:pointer;padding:2px}
.mh-clear.on{display:flex}
.mh-filters{display:flex;flex-wrap:wrap;gap:7px;padding:9px 14px;border-bottom:1px solid var(--line);align-items:center}
.mh-sel{height:32px;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--txt);border-radius:9px;padding:0 9px;font-size:12px;outline:0;cursor:pointer;max-width:200px}
.mh-sel:hover,.mh-sel:focus{border-color:var(--acc)}
.mh-sel option{background:#15151e}
.mh-combo{position:relative;display:flex;align-items:center}
.mh-combo input{cursor:text;min-width:160px;padding-right:24px}
.mh-combo .mh-clear{position:absolute;right:6px}
.mh-chip{height:32px;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--mut);padding:0 11px;border-radius:9px;
  background:rgba(255,255,255,.04);border:1px solid var(--line);cursor:pointer;user-select:none;transition:.15s}
.mh-chip:hover{border-color:var(--line2);color:var(--txt)}
.mh-chip.on{color:#fff;background:rgba(248,113,113,.18);border-color:rgba(248,113,113,.55)}
.mh-count{font-size:11.5px;color:var(--dim);white-space:nowrap}
.mh-seg{display:inline-flex;background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:9px;padding:2px;gap:2px}
.mh-seg button{width:30px;height:26px;display:flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--dim);cursor:pointer}
.mh-seg button.on{background:rgba(139,92,246,.22);color:var(--acc2)}
.mh-body{position:relative;flex:1;min-height:0;overflow-y:auto;padding:14px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.14) transparent}
.mh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.mh-root.v-compact .mh-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.mh-root.v-masonry .mh-grid{display:block;columns:5 236px;column-gap:12px}
.mh-root.v-list .mh-grid{grid-template-columns:1fr;gap:6px}
.mh-card,.mh-sk{border-radius:12px;overflow:hidden;background:var(--surf);border:1px solid var(--line);position:relative;display:block}
.mh-root.v-masonry .mh-card,.mh-root.v-masonry .mh-sk{break-inside:avoid;margin:0 0 12px}
.mh-root.v-compact .mh-card,.mh-root.v-compact .mh-sk{border-radius:10px}
.mh-card{cursor:pointer;transition:transform .16s ease,box-shadow .2s,border-color .2s;outline-offset:3px}
.mh-card:hover{transform:translateY(-2px);border-color:rgba(139,92,246,.6);box-shadow:0 12px 32px rgba(139,92,246,.22)}
.mh-media{position:relative;width:100%;aspect-ratio:4/5;background:linear-gradient(135deg,#191927,#231a2b);overflow:hidden}
.mh-media img,.mh-media video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.mh-media img{opacity:0;transition:opacity .35s ease}
.mh-media.ready img{opacity:1}
.mh-media::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.06) 50%,transparent 80%);animation:mhSh 1.3s infinite}
.mh-media.ready::after{display:none}
.mh-media video{opacity:0;transition:opacity .2s}
.mh-media.playing video{opacity:1}
.mh-vid{position:absolute;right:8px;bottom:8px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:none;transition:opacity .2s}
.mh-media.playing .mh-vid{opacity:0}
.mh-blur img,.mh-blur video{filter:blur(22px) saturate(.6);transform:scale(1.1)}
.mh-nsfwtag{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;letter-spacing:.6px;color:#fecaca;pointer-events:none}
.mh-noimg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--dim);font-size:11px}
.mh-badge{position:absolute;top:8px;left:8px;font-size:9.5px;font-weight:800;padding:3px 7px;border-radius:6px;background:rgba(0,0,0,.62);color:#fff;text-transform:uppercase;letter-spacing:.45px;backdrop-filter:blur(4px)}
.mh-owned{position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:4px;font-size:9.5px;font-weight:800;padding:3px 7px;border-radius:6px;background:rgba(16,185,129,.92);color:#032014}
.mh-prog{position:absolute;top:8px;right:8px;font-size:10px;font-weight:800;padding:3px 7px;border-radius:6px;background:rgba(139,92,246,.92);color:#fff}
.mh-cbar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.12)}
.mh-cbar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--acc),#ec4899);transition:width .4s}
.mh-quick{position:absolute;right:8px;bottom:8px;display:flex;align-items:center;gap:5px;opacity:0;transform:translateY(4px);transition:.15s;
  background:var(--acc);color:#fff;border:0;border-radius:8px;padding:6px 9px;font-size:11px;font-weight:700;cursor:pointer;z-index:2}
.mh-card:hover .mh-quick,.mh-card:focus-within .mh-quick{opacity:1;transform:none}
.mh-meta{padding:9px 10px 10px}
.mh-name{font-weight:700;font-size:12.5px;line-height:1.3;margin:0 0 3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mh-by{font-size:11px;color:var(--dim);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mh-sub{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10.5px;color:var(--mut)}
.mh-sub span{display:inline-flex;align-items:center;gap:3px}
.mh-pill{font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:5px;background:rgba(139,92,246,.18);color:#c4b5fd}
.mh-pill.g{background:rgba(255,255,255,.07);color:var(--mut)}
.mh-root .mh-ltype,.mh-root .mh-lget{display:none}
.mh-root.v-masonry .mh-media{aspect-ratio:var(--ar)}
.mh-root.v-compact .mh-by,.mh-root.v-compact .mh-sub{display:none}
.mh-root.v-compact .mh-meta{padding:6px 8px 7px}
.mh-root.v-compact .mh-name{font-size:11px;-webkit-line-clamp:1}
.mh-root.v-compact .mh-quick{padding:5px 7px}
.mh-root.v-list .mh-card{display:flex;align-items:center;gap:14px;padding:6px 12px 6px 6px;border-radius:10px}
.mh-root.v-list .mh-card:hover{transform:none;box-shadow:none;background:var(--surf2)}
.mh-root.v-list .mh-media{flex:none;width:64px;aspect-ratio:1;border-radius:8px}
.mh-root.v-list .mh-badge,.mh-root.v-list .mh-quick,.mh-root.v-list .mh-vid,.mh-root.v-list .mh-nsfwtag{display:none}
.mh-root.v-list .mh-owned,.mh-root.v-list .mh-prog{top:3px;right:3px;padding:2px 4px;font-size:8.5px}
.mh-root.v-list .mh-owned span{display:none}
.mh-root.v-list .mh-meta{flex:1;min-width:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"name sub" "by sub";column-gap:18px;align-items:center}
.mh-root.v-list .mh-name{grid-area:name;font-size:13px;-webkit-line-clamp:1;margin:0}
.mh-root.v-list .mh-by{grid-area:by;margin:2px 0 0}
.mh-root.v-list .mh-sub{grid-area:sub;flex-wrap:nowrap;gap:12px;font-size:11.5px}
.mh-root.v-list .mh-ltype{display:inline-flex}
.mh-root.v-list .mh-lget{display:inline-flex;flex:none;min-width:96px}
.mh-sk{aspect-ratio:4/6;background:var(--surf)}
.mh-root.v-masonry .mh-sk{aspect-ratio:auto;height:var(--h)}
.mh-root.v-compact .mh-sk{aspect-ratio:4/5.6}
.mh-root.v-list .mh-sk{aspect-ratio:auto;height:78px}
.mh-sk::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.05) 50%,transparent 80%);animation:mhSh 1.2s infinite}
@keyframes mhSh{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.mh-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:70px 20px;color:var(--mut);font-size:13.5px;text-align:center}
.mh-state svg{color:var(--dim)}
.mh-sentinel{height:1px}
.mh-more{display:flex;justify-content:center;padding:10px 0 4px;color:var(--dim);font-size:12px}
.mh-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border:0;border-radius:9px;cursor:pointer;
  font-weight:700;font-size:12px;color:#fff;background:var(--acc);transition:filter .15s,background .15s;white-space:nowrap;position:relative;overflow:hidden}
.mh-btn:hover{filter:brightness(1.12)}
.mh-btn:disabled{cursor:default;filter:none}
.mh-btn.ghost{background:rgba(255,255,255,.07);color:var(--txt)}
.mh-btn.ok{background:rgba(52,211,153,.16);color:var(--ok)}
.mh-btn.bad{background:rgba(248,113,113,.16);color:var(--bad)}
.mh-btn .mh-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.18);transition:width .4s}
.mh-btn span{position:relative}
/* drawer */
.mh-drawer{position:absolute;top:0;right:0;height:100%;width:420px;max-width:94vw;background:#0d0d14;border-left:1px solid var(--line);
  transform:translateX(100%);transition:transform .22s ease;display:flex;flex-direction:column;z-index:6;box-shadow:-20px 0 50px rgba(0,0,0,.4)}
.mh-drawer.open{transform:none}
.mh-dhead{display:flex;align-items:center;gap:10px;padding:13px 14px;border-bottom:1px solid var(--line)}
.mh-dhead h3{margin:0;font-size:13.5px;flex:1}
.mh-dsum{font-size:11px;color:var(--mut)}
.mh-link{border:0;background:transparent;color:var(--mut);cursor:pointer;font-size:11.5px;padding:4px 6px;border-radius:6px}
.mh-link:hover{color:var(--txt);background:rgba(255,255,255,.06)}
.mh-dlist{flex:1;overflow-y:auto}
.mh-dl{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.04)}
.mh-dthumb{width:44px;height:44px;border-radius:8px;overflow:hidden;background:var(--surf2);display:flex;align-items:center;justify-content:center;color:var(--dim)}
.mh-dthumb img{width:100%;height:100%;object-fit:cover;display:block}
.mh-dname{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mh-dpath{font:500 10.5px ui-monospace,Menlo,monospace;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0 6px}
.mh-bar{height:5px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
.mh-bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),#ec4899);transition:width .4s}
.mh-bar.ok>i{background:var(--ok)}.mh-bar.bad>i{background:var(--bad)}
.mh-dsub{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;color:var(--mut);margin-top:5px}
.mh-derr{font-size:10.5px;color:var(--bad);margin-top:4px;word-break:break-word}
.mh-dact{display:flex;gap:4px}
.mh-dact .mh-ico{width:30px;height:30px;border-radius:8px}
/* modal */
.mh-modal{position:absolute;inset:0;z-index:10;display:none;align-items:center;justify-content:center;background:rgba(3,3,8,.7);padding:18px}
.mh-modal.open{display:flex;animation:mhIn .14s ease}
.mh-sheet{position:relative;width:min(1180px,100%);max-height:100%;display:flex;flex-direction:column;background:#12121a;border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.mh-sheet:not(.narrow){height:100%}
.mh-sheet.narrow{width:min(560px,100%)}
.mh-sheet>.mh-x{position:absolute;top:10px;right:10px;z-index:3}
.mh-detail{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);min-height:0;flex:1}
.mh-stagewrap{display:flex;flex-direction:column;min-height:0;background:#07070b;border-right:1px solid var(--line)}
.mh-stage{position:relative;flex:1;min-height:320px;display:flex;align-items:center;justify-content:center;cursor:zoom-in;overflow:hidden}
.mh-stage img,.mh-stage video{width:100%;height:100%;object-fit:contain;display:block}
.mh-stage.mh-blur img,.mh-stage.mh-blur video{filter:blur(28px)}
.mh-reveal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.mh-nav{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2}
.mh-nav:hover{background:rgba(139,92,246,.8)}
.mh-nav.l{left:10px}.mh-nav.r{right:10px}
.mh-strip{display:flex;gap:6px;padding:8px;overflow-x:auto;border-top:1px solid var(--line);scrollbar-width:thin}
.mh-strip button{position:relative;flex:none;width:58px;height:58px;border-radius:8px;overflow:hidden;border:2px solid transparent;padding:0;cursor:pointer;background:var(--surf2)}
.mh-strip button.on{border-color:var(--acc)}
.mh-strip img{width:100%;height:100%;object-fit:cover;display:block}
.mh-strip .mh-vid{right:3px;bottom:3px;width:16px;height:16px}
.mh-info{overflow-y:auto;padding:22px 22px 18px;display:flex;flex-direction:column;gap:14px;scrollbar-width:thin}
.mh-info h2{margin:0;font-size:19px;line-height:1.25;padding-right:34px}
.mh-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mh-a{display:inline-flex;align-items:center;gap:4px;color:var(--acc2);font-size:12px;text-decoration:none}
.mh-a:hover{text-decoration:underline}
.mh-lbl{font-size:10.5px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.6px;margin-bottom:7px}
.mh-vers{display:flex;gap:6px;flex-wrap:wrap}
.mh-ver{height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.04);cursor:pointer;font-size:12px;font-weight:600;color:var(--mut)}
.mh-ver:hover{color:var(--txt);border-color:var(--line2)}
.mh-ver.on{background:rgba(139,92,246,.2);border-color:var(--acc);color:#fff}
.mh-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.mh-stat{background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.mh-stat b{display:block;font-size:13px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mh-stat small{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px}
.mh-word{display:inline-flex;align-items:center;gap:5px;font:500 11.5px ui-monospace,Menlo,monospace;padding:5px 9px;border-radius:7px;background:rgba(139,92,246,.14);color:#d4c8ff;cursor:pointer;border:1px solid transparent}
.mh-word:hover{border-color:rgba(139,92,246,.5)}
.mh-word.done{background:rgba(52,211,153,.16);color:var(--ok)}
.mh-desc{font-size:12.5px;line-height:1.6;color:#c6c6d4;white-space:pre-wrap;word-break:break-word;max-height:9.6em;overflow:hidden;position:relative}
.mh-desc.open{max-height:none}
.mh-file{display:flex;flex-direction:column;gap:8px;padding:11px 12px;border-radius:11px;background:rgba(255,255,255,.03);border:1px solid var(--line)}
.mh-ftop{display:flex;align-items:center;gap:8px;min-width:0}
.mh-fname{font:600 12px ui-monospace,Menlo,monospace;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mh-fbot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mh-dest{flex:1;min-width:120px;font:500 10.5px ui-monospace,Menlo,monospace;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mh-savesel{height:30px;font-size:11.5px}
/* lightbox */
.mh-lb{position:absolute;inset:0;z-index:20;display:none;flex-direction:column;background:rgba(0,0,0,.94)}
.mh-lb.open{display:flex}
.mh-lbbar{display:flex;align-items:center;gap:10px;padding:10px 14px;color:var(--mut);font-size:12px}
.mh-lbbar .mh-sp{flex:1}
.mh-lbstage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 60px 20px}
.mh-lbstage img,.mh-lbstage video{width:100%;height:100%;object-fit:contain}
/* forms */
.mh-form{padding:22px;display:flex;flex-direction:column;gap:14px;overflow-y:auto}
.mh-form h2{margin:0;font-size:18px}
.mh-hint{font-size:11.5px;color:var(--mut);line-height:1.5}
.mh-field label{display:flex;justify-content:space-between;font-size:12px;color:var(--mut);margin-bottom:6px}
.mh-field input[type=text],.mh-field input[type=password],.mh-field input[type=number]{width:100%;height:38px;background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:9px;padding:0 12px;color:var(--txt);outline:0;font-size:13px}
.mh-field input:focus{border-color:var(--acc)}
.mh-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.mh-check{display:flex;align-items:flex-start;gap:10px;font-size:12.5px;cursor:pointer;line-height:1.45}
.mh-check input{accent-color:var(--acc);width:16px;height:16px;margin-top:1px}
.mh-actions{display:flex;justify-content:flex-end;gap:8px}
.mh-set{color:var(--ok);font-weight:700}
/* toasts */
.mh-toasts{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.mh-toast{display:flex;align-items:center;gap:8px;max-width:min(560px,90vw);background:#1b1b27;border:1px solid var(--line2);color:var(--txt);padding:10px 14px;border-radius:11px;
  font-size:12.5px;font-weight:600;box-shadow:0 12px 30px rgba(0,0,0,.5);animation:mhUp .18s ease}
.mh-toast.ok svg{color:var(--ok)}.mh-toast.bad{border-color:rgba(248,113,113,.5)}.mh-toast.bad svg{color:var(--bad)}
.mh-toast span{overflow:hidden;text-overflow:ellipsis}
@keyframes mhUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
/* hugging face fallback (only used when the HF Model Downloader isn't installed) */
.mh-hf{display:grid;grid-template-columns:minmax(240px,38%) 1fr;gap:12px;height:100%}
.mh-hfcol{display:flex;flex-direction:column;min-height:0;overflow-y:auto;gap:6px;padding:10px;background:#12100a;border:1px solid rgba(255,210,30,.16);border-radius:12px}
.mh-hfrepo{padding:10px 11px;border-radius:9px;border:1px solid transparent;background:#1a1710;cursor:pointer;text-align:left}
.mh-hfrepo:hover{border-color:#ffd21e}
.mh-hfrepo.on{border-color:#ff9d00;background:#241f0f}
.mh-hfid{font:700 12px ui-monospace,Menlo,monospace;color:#f6efd6;word-break:break-all}
.mh-hfmeta{margin-top:4px;font-size:10.5px;color:#b6ac86}
.mh-hffile{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;background:#1a1710}
.mh-hffile .mh-fname{color:#f6efd6}
/* Hugging Face tab (embedded HF Model Downloader) */
.mh-hfhost{display:none;flex:1;min-height:0;overflow:hidden}
.mh-root.hfmode .mh-hfhost{display:flex;flex-direction:column}
.mh-root.hfmode .mh-body,.mh-root.hfmode .mh-filters,.mh-root.hfmode .mh-search{display:none}
.mh-root.hfmode .mh-tabs{margin-right:auto}
/* aria2 status / installer */
.mh-aria{flex:none;height:36px;display:none;align-items:center;gap:6px;padding:0 12px;border-radius:10px;border:1px solid var(--line);
  background:rgba(255,255,255,.045);color:var(--mut);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:.15s}
.mh-aria.on{display:inline-flex}
.mh-aria:hover{border-color:var(--line2);color:var(--txt)}
.mh-aria.ok{color:var(--ok);border-color:rgba(52,211,153,.35)}
.mh-aria.miss{color:#1c1300;background:linear-gradient(135deg,#fbbf24,#f59e0b);border-color:transparent}
.mh-aria.miss:hover{filter:brightness(1.08);color:#1c1300}
.mh-aria.bad{color:var(--bad);border-color:rgba(248,113,113,.5)}
.mh-aria.busy{cursor:progress;opacity:.8}
.mh-spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:mhSpin .7s linear infinite}
@keyframes mhSpin{to{transform:rotate(360deg)}}
/* sidebar tab */
.mh-side{padding:14px;display:flex;flex-direction:column;gap:10px}
.mh-side .mh-btn{width:100%}
@media (max-width:900px){
  .mh-detail{grid-template-columns:1fr}.mh-stagewrap{border-right:0;border-bottom:1px solid var(--line)}.mh-stage{min-height:260px;max-height:46vh}
  .mh-hf{grid-template-columns:1fr}.mh-two{grid-template-columns:1fr}.mh-kbd{display:none}
}
@media (prefers-reduced-motion:reduce){.mh-root *{animation:none!important;transition:none!important}}
`;

const VIEWS = [["grid", "Grid"], ["masonry", "Masonry"], ["compact", "Compact grid"], ["list", "List"]];

// HF categories used by the fallback browser
const HF_CATS = [
  { label: "All", q: "" }, { label: "Diffusion", q: "diffusion gguf", target: "diffusion_models" },
  { label: "LoRA", q: "lora", target: "loras" }, { label: "Text encoders", q: "text encoder", target: "text_encoders" },
  { label: "VAE", q: "vae", target: "vae" }, { label: "ControlNet", q: "controlnet", target: "controlnet" },
  { label: "Upscale", q: "upscaler esrgan", target: "upscale_models" },
];

// ================================================================== the hub
class ModelHub {
  constructor() {
    const p = loadPrefs();
    this.prefs = {
      source: "civitai", types: "", base: "", sort: "Highest Rated", period: "AllTime",
      nsfw: false, view: p.density === "compact" ? "compact" : "grid", ...p,
    };
    delete this.prefs.density;
    if (!VIEWS.some(([k]) => k === this.prefs.view)) this.prefs.view = "grid";
    if (!["civitai", "huggingface", "hf-fallback"].includes(this.prefs.source)) this.prefs.source = "civitai";
    this.aria2 = null; this._ariaBusy = false; this._hfMounted = false;
    this.q = "";
    this.cursor = null; this.hasMore = true; this.busy = false; this.count = 0; this.gen = 0;
    this.owned = new Set();
    this.facets = null; this.cfg = null;
    this.seenBases = new Set();
    this.dls = new Map();          // lower-case filename -> latest snapshot
    this.bindings = new Set();     // live UI bits that react to download state
    this.pollTimer = null; this.active = 0;
    this.revealed = new Set();     // media urls the user chose to un-blur
    this._build();
    this._init();
  }

  async _init() {
    try { this.facets = await call("/model_hub/facets"); } catch { this.facets = null; }
    try { this.cfg = await call("/model_hub/config"); } catch { this.cfg = null; }
    this._renderFilters();
    this.refreshOwned();
    this.refreshAria2();
    this.poll();
  }

  _save() { savePrefs(this.prefs); }

  // ---------------------------------------------------------------- build
  _build() {
    const st = el("style"); st.textContent = STYLE; document.head.appendChild(st);

    // launcher (draggable, remembers where you left it)
    const L = el("div"); L.id = "mh-launch"; L.setAttribute("role", "button"); L.tabIndex = 0;
    L.title = "Model Hub (Alt+M)";
    L.append(icon("hub", 16), el("span", null, "Model Hub"));
    this.lbadge = el("span", "mh-lbadge"); L.appendChild(this.lbadge);
    if (this.prefs.launcher) { L.style.left = this.prefs.launcher.x + "px"; L.style.top = this.prefs.launcher.y + "px"; L.style.right = "auto"; }
    L.addEventListener("click", () => { if (!this._dragged) this.open(); });
    L.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.open(); } });
    this._draggable(L);
    document.body.appendChild(L);
    this.launch = L;

    this.root = el("div", "mh-root v-" + this.prefs.view);
    this.overlay = el("div", "mh-overlay");
    this.overlay.addEventListener("mousedown", (e) => { if (e.target === this.overlay) this.close(); });
    const panel = el("div", "mh-panel"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Model Hub");
    this.panel = panel;

    // header
    const head = el("div", "mh-head");
    const logo = el("div", "mh-logo"); logo.append(icon("hub", 18), el("span", null, "MODEL HUB"));
    const tabs = el("div", "mh-tabs"); tabs.setAttribute("role", "tablist");
    this.tabCiv = el("button", "mh-tab", "Civitai"); this.tabCiv.type = "button";
    this.tabHf = el("button", "mh-tab"); this.tabHf.type = "button";
    this.tabHf.append(el("span", null, "Hugging Face"));
    this.tabHf.title = "Hugging Face  (Ctrl/Cmd+Shift+B)";
    this.tabCiv.onclick = () => this.setSource("civitai");
    this.tabHf.onclick = () => this.setSource("huggingface");
    tabs.append(this.tabCiv, this.tabHf);
    const search = el("div", "mh-search");
    this.input = el("input"); this.input.type = "text"; this.input.placeholder = "Search models…"; this.input.setAttribute("aria-label", "Search");
    this.clearQ = el("button", "mh-clear"); this.clearQ.type = "button"; this.clearQ.title = "Clear search"; this.clearQ.appendChild(icon("x", 14));
    this.clearQ.onclick = () => { this.input.value = ""; this._onQuery(true); this.input.focus(); };
    let deb;
    this.input.addEventListener("input", () => { this.clearQ.classList.toggle("on", !!this.input.value); clearTimeout(deb); deb = setTimeout(() => this._onQuery(), 380); });
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(deb); this._onQuery(true); } });
    search.append(icon("search", 15), this.input, this.clearQ, el("span", "mh-kbd", "/"));
    this.dlBtn = iconBtn("download", "Downloads"); this.dlBtn.onclick = () => this.toggleDrawer();
    const setBtn = iconBtn("gear", "Settings"); setBtn.onclick = () => this.openSettings();
    const xBtn = iconBtn("x", "Close (Esc)"); xBtn.onclick = () => this.close();
    // aria2 status / one-click installer (aria2 powers the Hugging Face downloads)
    this.ariaBtn = el("button", "mh-aria"); this.ariaBtn.type = "button";
    this.ariaBtn.onclick = () => (this.aria2 && this.aria2.installed ? this.refreshAria2(true) : this.installAria2());
    head.append(logo, tabs, search, this.ariaBtn, this.dlBtn, setBtn, xBtn);

    this.fbar = el("div", "mh-filters");

    this.body = el("div", "mh-body");
    this.grid = el("div", "mh-grid");
    this.stateBox = el("div");
    this.moreBox = el("div", "mh-more");
    this.sentinel = el("div", "mh-sentinel");
    this.body.append(this.grid, this.stateBox, this.moreBox, this.sentinel);
    this._io = new IntersectionObserver((es) => { if (es[0].isIntersecting) this.load(); }, { root: this.body, rootMargin: "900px" });
    this._io.observe(this.sentinel);

    // downloads drawer
    this.drawer = el("div", "mh-drawer"); this.drawer.setAttribute("aria-label", "Downloads");
    const dh = el("div", "mh-dhead");
    this.dsum = el("span", "mh-dsum");
    const clr = el("button", "mh-link", "Clear finished"); clr.type = "button"; clr.onclick = () => this.clearDone();
    const dx = iconBtn("x", "Close downloads"); dx.onclick = () => this.closeDrawer();
    dh.append(el("h3", null, "Downloads"), this.dsum, clr, dx);
    this.dlist = el("div", "mh-dlist");
    this.drawer.append(dh, this.dlist);

    // modal + lightbox + toasts
    this.modal = el("div", "mh-modal");
    this.modal.addEventListener("mousedown", (e) => { if (e.target === this.modal) this.closeModal(); });
    this.lb = el("div", "mh-lb");
    this.toasts = el("div", "mh-toasts");

    // Hugging Face tab: the HF Model Downloader panel gets mounted in here
    this.hfHost = el("div", "mh-hfhost");
    panel.append(head, this.fbar, this.body, this.hfHost, this.drawer, this.modal, this.lb, this.toasts);
    panel.addEventListener("mousedown", (e) => {
      if (this.drawer.classList.contains("open") && !this.drawer.contains(e.target) && !this.dlBtn.contains(e.target)) this.closeDrawer();
    });
    this.overlay.appendChild(panel);
    this.root.appendChild(this.overlay);
    document.body.appendChild(this.root);

    // clicks on empty panel areas keep focus inside the hub (tabindex -1), and key
    // events that bubble out of the hub stop here so ComfyUI's graph shortcuts
    // (Delete, Ctrl+Z, Space…) never fire while you're typing or browsing.
    panel.tabIndex = -1;
    ["keydown", "keyup", "keypress"].forEach((t) => this.root.addEventListener(t, (e) => { if (this.isOpen()) e.stopPropagation(); }));
    document.addEventListener("keydown", (e) => this._keys(e), true);
    this._syncTabs();
  }

  // capture-phase handler for the hub's own shortcuts
  _keys(e) {
    // Alt/Option+M (on a Mac, Option+M types "µ", so check the physical key too)
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyM" || /^[mMµ]$/.test(e.key))) { e.preventDefault(); e.stopPropagation(); this.toggle(); return; }
    // Ctrl/Cmd+Shift+B: straight to the Hugging Face tab (the old HF downloader shortcut)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.code === "KeyB" || e.key === "b" || e.key === "B")) { e.preventDefault(); e.stopPropagation(); this.openHF(); return; }
    if (!this.isOpen()) return;
    // Inside the Hugging Face tab the embedded downloader handles its own keys (Esc, /,
    // arrows) - unless one of the hub's own layers (settings, drawer, lightbox) is on top.
    if (this._hfMounted && this.hfHost.contains(e.target) && !this.modal.classList.contains("open") &&
      !this.drawer.classList.contains("open") && !this.lb.classList.contains("open")) return;
    const ae = document.activeElement;
    const typing = !!ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === "Escape") {
      handled();
      if (this.lb.classList.contains("open")) this.closeLightbox();
      else if (this.modal.classList.contains("open")) this.closeModal();
      else if (this.drawer.classList.contains("open")) this.closeDrawer();
      else if (ae === this.input && this.input.value) { this.input.value = ""; this._onQuery(true); }
      else this.close();
      return;
    }
    if (this.lb.classList.contains("open")) {
      if (e.key === "ArrowLeft") { handled(); this._lbStep(-1); }
      else if (e.key === "ArrowRight") { handled(); this._lbStep(1); }
      return;
    }
    if (typing) return;
    if (this.modal.classList.contains("open") && this._stageStep) {
      if (e.key === "ArrowLeft") { handled(); this._stageStep(-1); }
      else if (e.key === "ArrowRight") { handled(); this._stageStep(1); }
      return;
    }
    if (e.key === "/") {
      handled();
      if (this._hfMounted) {
        const box = [...this.hfHost.querySelectorAll(".hfmd-live-search, .hfmd-search")].find((n) => n.offsetParent);
        if (box) box.focus();
      } else { this.input.focus(); this.input.select(); }
    }
  }

  _draggable(node) {
    node.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this._dragged = false;
      const sx = e.clientX, sy = e.clientY, r = node.getBoundingClientRect();
      const mv = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!this._dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
        this._dragged = true; node.style.cursor = "grabbing";
        const x = Math.min(window.innerWidth - r.width - 4, Math.max(4, r.left + dx));
        const y = Math.min(window.innerHeight - r.height - 4, Math.max(4, r.top + dy));
        node.style.left = x + "px"; node.style.top = y + "px"; node.style.right = "auto";
      };
      const up = () => {
        document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up);
        node.style.cursor = "grab";
        if (this._dragged) { const b = node.getBoundingClientRect(); this.prefs.launcher = { x: Math.round(b.left), y: Math.round(b.top) }; this._save(); }
      };
      document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    });
  }

  // ------------------------------------------------------------ open/close
  isOpen() { return this.overlay.classList.contains("open"); }
  toggle() { this.isOpen() ? this.close() : this.open(); }
  open() {
    this.overlay.classList.add("open");
    this._applySource();
    this.refreshOwned(); this.poll(); this.refreshAria2();
    if (!this._hfMounted) setTimeout(() => this.input.focus(), 30);
  }
  close() {
    this._unmountHF();
    this.overlay.classList.remove("open"); this.closeLightbox(); this._stopMedia(this.panel);
  }

  _hfApi() { const a = window.hfModelDownloader; return a && typeof a.mount === "function" ? a : null; }

  openHF() {
    this.prefs.source = this._hfApi() ? "huggingface" : "hf-fallback"; this._save();
    if (this.isOpen()) this._applySource(); else this.open();
  }

  setSource(s) {
    if (s === "huggingface" && !this._hfApi()) s = "hf-fallback";
    this.prefs.source = s; this._save();
    this._applySource();
  }

  // show the right tab: the Civitai grid, the embedded HF downloader, or the HF fallback pane
  _applySource() {
    const s = this.prefs.source;
    const hf = s === "huggingface" && !!this._hfApi();
    this.root.classList.toggle("hfmode", hf);
    this._syncTabs();
    if (hf) {
      this._stopMedia(this.grid);
      if (this.isOpen()) this._mountHF();
      return;
    }
    this._unmountHF();
    this._renderFilters();
    if (s === "hf-fallback" || !this.grid.children.length) this.reload();
  }

  _mountHF() {
    const api = this._hfApi();
    if (!api || this._hfMounted) return;
    this._hfMounted = true;
    try { api.mount(this.hfHost, { onClose: () => this.close() }); }
    catch (e) {
      this._hfMounted = false;
      console.error("[ModelHub] Hugging Face tab failed", e);
      this.toast("The Hugging Face tab failed to load: " + e.message, "bad");
    }
  }

  _unmountHF() {
    const api = this._hfApi();
    if (api && this._hfMounted) { try { api.unmount(); } catch { /* already gone */ } }
    this._hfMounted = false;
  }

  _syncTabs() {
    const hf = this.prefs.source !== "civitai";
    this.tabCiv.classList.toggle("active", !hf); this.tabHf.classList.toggle("active", hf);
    this.tabCiv.setAttribute("aria-selected", String(!hf)); this.tabHf.setAttribute("aria-selected", String(hf));
  }

  _onQuery(now) { const v = this.input.value.trim(); if (!now && v === this.q) return; this.q = v; this.clearQ.classList.toggle("on", !!this.input.value); this.reload(); }

  // --------------------------------------------------------------- filters
  _sel(options, value, onChange, label) {
    const s = el("select", "mh-sel"); s.setAttribute("aria-label", label);
    options.forEach(([v, t]) => { const o = el("option", null, t); o.value = v; if (v === value) o.selected = true; s.appendChild(o); });
    s.onchange = () => { onChange(s.value); this._save(); this.reload(); };
    return s;
  }

  _renderFilters() {
    const f = this.fbar; f.textContent = "";
    if (this.prefs.source === "hf-fallback") {
      this.hfCat = this.hfCat || 0;
      HF_CATS.forEach((c, i) => {
        const b = el("button", "mh-chip" + (i === this.hfCat ? " on" : ""), c.label); b.type = "button";
        b.onclick = () => { this.hfCat = i; this._renderFilters(); this.reload(); };
        f.appendChild(b);
      });
      return;
    }
    const fc = (this.facets && this.facets.civitai) || {};
    const types = ["", ...(fc.types || [])].map((t) => [t, t ? t : "All types"]);
    const sorts = (fc.sort || ["Highest Rated", "Most Downloaded", "Newest"]).map((s) => [s, s]);
    const periods = (fc.period || ["AllTime", "Year", "Month", "Week", "Day"]).map((p) => [p, p === "AllTime" ? "All time" : p]);
    f.append(this._sel(types, this.prefs.types, (v) => (this.prefs.types = v), "Model type"));

    // base model: editable combobox (any value works; list grows as you browse)
    const combo = el("div", "mh-combo");
    const bi = el("input", "mh-sel"); bi.type = "text"; bi.placeholder = "Any base model"; bi.value = this.prefs.base || ""; bi.setAttribute("aria-label", "Base model");
    const dl = el("datalist"); dl.id = "mh-bases"; bi.setAttribute("list", dl.id);
    this._baseList = dl; this._fillBases();
    const bx = el("button", "mh-clear" + (bi.value ? " on" : "")); bx.type = "button"; bx.title = "Any base model"; bx.appendChild(icon("x", 13));
    const apply = () => { const v = bi.value.trim(); if (v === (this.prefs.base || "")) return; this.prefs.base = v; bx.classList.toggle("on", !!v); this._save(); this.reload(); };
    bi.addEventListener("change", apply);
    bi.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });
    bx.onclick = () => { bi.value = ""; apply(); };
    combo.append(bi, bx, dl);
    f.append(combo,
      this._sel(sorts, this.prefs.sort, (v) => (this.prefs.sort = v), "Sort"),
      this._sel(periods, this.prefs.period, (v) => (this.prefs.period = v), "Period"));

    const ns = el("button", "mh-chip" + (this.prefs.nsfw ? " on" : ""), this.prefs.nsfw ? "NSFW on" : "NSFW off"); ns.type = "button";
    ns.title = "Include NSFW models and un-blur previews";
    ns.onclick = () => { this.prefs.nsfw = !this.prefs.nsfw; this._save(); this._renderFilters(); this.reload(); };
    f.appendChild(ns);

    f.appendChild(Object.assign(el("div"), { style: "flex:1" }));
    this.countEl = el("span", "mh-count"); f.appendChild(this.countEl); this._updCount();

    const seg = el("div", "mh-seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Layout");
    VIEWS.forEach(([k, t]) => {
      const b = el("button", this.prefs.view === k ? "on" : ""); b.type = "button"; b.title = t; b.setAttribute("aria-label", t);
      b.appendChild(icon(k, 15));
      b.onclick = () => {
        this.root.classList.replace("v-" + this.prefs.view, "v-" + k);
        this.prefs.view = k; this._save(); this._renderFilters();
      };
      seg.appendChild(b);
    });
    const paste = el("button", "mh-chip"); paste.type = "button"; paste.append(icon("link", 14), el("span", null, "Paste link"));
    paste.title = "Download from a Civitai or Hugging Face link";
    paste.onclick = () => this.openPaste();
    f.append(seg, paste);
  }

  _fillBases() {
    if (!this._baseList) return;
    const all = new Set([...(((this.facets || {}).civitai || {}).bases || []), ...this.seenBases]);
    this._baseList.textContent = "";
    all.forEach((v) => { if (v) { const o = el("option"); o.value = v; this._baseList.appendChild(o); } });
  }

  _updCount() {
    if (!this.countEl) return;
    this.countEl.textContent = this.count ? `${this.count} models${this.hasMore ? "+" : ""}` : "";
  }

  // --------------------------------------------------------------- loading
  reload() {
    this.gen++; this.cursor = null; this.hasMore = true; this.busy = false; this.count = 0;
    this._stopMedia(this.grid);
    this.grid.textContent = ""; this.stateBox.textContent = ""; this.moreBox.textContent = "";
    this.body.style.overflowY = ""; this.stateBox.style.height = ""; this.body.scrollTop = 0;
    this._updCount();
    if (this.prefs.source === "hf-fallback") { this._hfLoad(); return; }
    this.grid.style.display = "";
    [270, 200, 320, 240, 290, 210, 260, 330, 200, 250, 300, 230].forEach((h) => {
      const s = el("div", "mh-sk"); s.style.setProperty("--h", h + "px"); this.grid.appendChild(s);
    });
    this.load(true);
  }

  async load(fresh) {
    if (this.prefs.source !== "civitai" || this.busy || !this.hasMore) return;
    this.busy = true;
    const gen = this.gen;
    const p = new URLSearchParams({ source: "civitai", q: this.q, sort: this.prefs.sort, period: this.prefs.period, nsfw: String(!!this.prefs.nsfw) });
    if (this.prefs.types) p.set("types", this.prefs.types);
    if (this.prefs.base) p.set("baseModels", this.prefs.base);
    if (this.cursor) p.set("cursor", this.cursor);
    if (!fresh) this.moreBox.textContent = "Loading more…";
    let data;
    try { data = await call("/model_hub/search?" + p.toString()); }
    catch (e) { data = { error: e.message, items: [] }; }
    if (gen !== this.gen) return;        // a newer search replaced this one
    this.busy = false;
    if (fresh) this.grid.textContent = "";
    this.moreBox.textContent = "";
    if (data.error) {
      this.hasMore = false;
      if (fresh || !this.count) this._showState("alert", data.error, true);
      else this.toast(data.error, "bad");
      return;
    }
    const items = data.items || [];
    let added = false;
    items.forEach((m) => (m.versions || []).forEach((v) => { if (v.baseModel && !this.seenBases.has(v.baseModel)) { this.seenBases.add(v.baseModel); added = true; } }));
    if (added) this._fillBases();
    const frag = document.createDocumentFragment();
    items.forEach((m) => frag.appendChild(this.card(m)));
    this.grid.appendChild(frag);
    this.count += items.length;
    this.cursor = data.nextCursor; this.hasMore = !!data.nextCursor && items.length > 0;
    this._updCount();
    if (!this.count) this._showState("search", "No models match these filters.", false);
    else if (!this.hasMore) this.moreBox.textContent = "That's everything.";
    // if the first page doesn't fill the view, keep going (only while visible —
    // a hidden panel measures 0px and would otherwise page forever)
    if (this.hasMore && this.isOpen() && this.body.clientHeight > 0 &&
      this.body.scrollHeight <= this.body.clientHeight + 200) this.load();
  }

  _showState(ic, msg, retry) {
    this.grid.textContent = "";
    const s = el("div", "mh-state"); s.append(icon(ic, 28), el("div", null, msg));
    if (retry) { const b = el("button", "mh-btn ghost", "Try again"); b.type = "button"; b.onclick = () => this.reload(); s.appendChild(b); }
    this.stateBox.textContent = ""; this.stateBox.appendChild(s);
  }

  _stopMedia(scope) { scope.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch { } }); }

  // ------------------------------------------------------------------ cards
  _media(md, { autoplayHover = true, blur = false } = {}) {
    const box = el("div", "mh-media");
    const ratio = md && md.w && md.h ? Math.min(1.9, Math.max(0.55, md.h / md.w)) : 1.3;
    box.style.setProperty("--ar", `1 / ${ratio}`);
    if (!md) { box.classList.add("ready"); const n = el("div", "mh-noimg"); n.append(icon("folder", 22), el("span", null, "No preview")); box.appendChild(n); return box; }
    const img = el("img"); img.loading = "lazy"; img.decoding = "async"; img.alt = "";
    // Civitai renders resized previews on first request, so a cold one can take a few
    // seconds: shimmer until it arrives, then fade in (a flat dark box looks broken).
    img.onload = () => box.classList.add("ready");
    img.src = mediaThumb(md);
    img.onerror = () => {
      // CDN transform failed: fall back once to the untransformed URL, then give up gracefully
      if (img.dataset.f !== "1") { img.dataset.f = "1"; img.src = md.type === "video" ? cvImg(md.url) : md.url; return; }
      img.remove(); box.classList.add("ready");
      const n = el("div", "mh-noimg"); n.append(icon("folder", 22), el("span", null, "Preview unavailable")); box.prepend(n);
    };
    box.appendChild(img);
    if (md.type === "video") {
      const badge = el("div", "mh-vid"); badge.appendChild(icon("play", 11)); box.appendChild(badge);
      if (autoplayHover && !blur) {
        let v = null;
        box.addEventListener("mouseenter", () => {
          if (!v) { v = el("video"); v.muted = true; v.loop = true; v.playsInline = true; v.preload = "none"; v.src = cvVid(md.url); box.appendChild(v); }
          v.play().then(() => box.classList.add("playing")).catch(() => { });
        });
        box.addEventListener("mouseleave", () => { if (v) { v.pause(); box.classList.remove("playing"); } });
      }
    }
    if (blur) { box.classList.add("mh-blur"); box.appendChild(el("div", "mh-nsfwtag", "NSFW")); }
    return box;
  }

  _isNsfw(md, m) { return !this.prefs.nsfw && ((md && md.nsfw >= 4) || (m && m.nsfw)); }

  card(m) {
    const c = el("div", "mh-card"); c.tabIndex = 0; c.setAttribute("role", "button"); c.setAttribute("aria-label", m.name || "model");
    const v0 = (m.versions || [])[0] || {};
    const f0 = (v0.files || [])[0];
    const md = m.cover;
    const media = this._media(md, { blur: this._isNsfw(md, m) });
    media.appendChild(el("div", "mh-badge", m.type || "model"));
    const status = el("div"); media.appendChild(status);
    const cbar = el("div", "mh-cbar"); const ci = el("i"); cbar.appendChild(ci); cbar.style.display = "none"; media.appendChild(cbar);
    // grid views show the download button over the preview; list view puts it at the row's end
    const getBtn = (cls) => {
      const q = el("button", cls); q.type = "button"; q.title = `Download ${f0.name}`;
      q.append(icon("download", 13), el("span", null, f0.sizeKB ? fmtBytes(f0.sizeKB * 1024) : "Get"));
      q.onclick = (e) => { e.stopPropagation(); this.download(this._fileOpts(m, v0, f0)); };
      return q;
    };
    if (f0) media.appendChild(getBtn("mh-quick"));
    c.appendChild(media);

    const meta = el("div", "mh-meta");
    meta.appendChild(el("div", "mh-name", m.name || "Untitled"));
    if (m.creator) meta.appendChild(el("div", "mh-by", "by " + m.creator));
    const sub = el("div", "mh-sub");
    sub.appendChild(el("span", "mh-pill g mh-ltype", m.type || "model"));
    const d = el("span"); d.append(icon("download", 11), el("span", null, fmtNum(m.downloads))); sub.appendChild(d);
    const l = el("span"); l.append(icon("heart", 11), el("span", null, fmtNum(m.likes))); sub.appendChild(l);
    if (v0.baseModel) sub.appendChild(el("span", "mh-pill", v0.baseModel));
    meta.appendChild(sub);
    c.appendChild(meta);
    if (f0) c.appendChild(getBtn("mh-btn ghost mh-lget"));

    const names = [];
    (m.versions || []).forEach((v) => (v.files || []).forEach((f) => f.name && names.push(f.name.toLowerCase())));
    this._bind(c, () => {
      const snap = names.map((n) => this.dls.get(n)).find((s) => s && (s.status === "running" || s.status === "queued"));
      status.textContent = ""; status.className = "";
      if (snap) {
        status.className = "mh-prog"; status.textContent = snap.status === "queued" ? "queued" : Math.floor(snap.pct) + "%";
        cbar.style.display = ""; ci.style.width = snap.pct + "%";
      } else {
        cbar.style.display = "none";
        if (names.some((n) => this.owned.has(n))) { status.className = "mh-owned"; status.append(icon("check", 11), el("span", null, "Owned")); }
      }
    });

    c.onclick = () => this.detail(m);
    c.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); this.detail(m); } };
    return c;
  }

  _fileOpts(m, v, f, target) {
    const md = (v.images || [])[0] || m.cover;
    return {
      url: f.url, filename: f.name, source: "civitai", model_type: m.type,
      base: v.baseModel, target: target || f.target, thumb: mediaThumb(md) || null,
    };
  }

  // binding: fn() is re-run whenever download/owned state changes
  _bind(node, fn) { const b = { node, fn }; this.bindings.add(b); fn(); return b; }
  _refreshBindings() {
    for (const b of this.bindings) {
      if (!b.node.isConnected) { this.bindings.delete(b); continue; }
      try { b.fn(); } catch { }
    }
  }

  // ----------------------------------------------------------------- detail
  detail(m) {
    this._stopMedia(this.grid);
    const sheet = this._openModal(false);
    const wrap = el("div", "mh-detail");
    const stageWrap = el("div", "mh-stagewrap");
    const stage = el("div", "mh-stage");
    const strip = el("div", "mh-strip");
    stageWrap.append(stage, strip);
    const info = el("div", "mh-info");
    wrap.append(stageWrap, info);
    sheet.appendChild(wrap);

    let vi = 0, mi = 0;
    const versions = m.versions || [];
    const renderStage = () => {
      this._stopMedia(stage);
      stage.textContent = "";
      const imgs = (versions[vi] || {}).images || [];
      const md = imgs[mi];
      if (!md) { const n = el("div", "mh-noimg"); n.append(icon("folder", 26), el("span", null, "No preview images")); stage.appendChild(n); return; }
      const blur = this._isNsfw(md, m) && !this.revealed.has(md.url);
      let node;
      if (md.type === "video") {
        node = el("video"); node.src = cvVid(md.url, 1024); node.poster = cvPoster(md.url, 1024);
        node.muted = true; node.loop = true; node.playsInline = true; node.autoplay = !blur; node.controls = !blur;
      } else { node = el("img"); node.alt = ""; node.src = cvImg(md.url, 1280); }
      stage.appendChild(node);
      stage.classList.toggle("mh-blur", blur);
      if (blur) {
        const r = el("div", "mh-reveal"); const b = el("button", "mh-btn ghost"); b.type = "button"; b.append(icon("eye", 14), el("span", null, "Show sensitive preview"));
        b.onclick = (e) => { e.stopPropagation(); this.revealed.add(md.url); renderStage(); }; r.appendChild(b); stage.appendChild(r);
      }
      if (imgs.length > 1) {
        const l = el("button", "mh-nav l"); l.type = "button"; l.title = "Previous (←)"; l.appendChild(icon("left", 18)); l.onclick = (e) => { e.stopPropagation(); step(-1); };
        const r = el("button", "mh-nav r"); r.type = "button"; r.title = "Next (→)"; r.appendChild(icon("right", 18)); r.onclick = (e) => { e.stopPropagation(); step(1); };
        stage.append(l, r);
      }
      stage.onclick = () => { if (!blur) this.openLightbox(imgs, mi); };
      strip.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === mi));
    };
    const step = (d) => { const n = ((versions[vi] || {}).images || []).length; if (n > 1) { mi = (mi + d + n) % n; renderStage(); } };
    this._stageStep = step;
    const renderStrip = () => {
      strip.textContent = "";
      const imgs = (versions[vi] || {}).images || [];
      strip.style.display = imgs.length > 1 ? "" : "none";
      imgs.slice(0, 40).forEach((md, i) => {
        const b = el("button"); b.type = "button"; b.title = md.type === "video" ? "Video" : "Image";
        const im = el("img"); im.loading = "lazy"; im.alt = ""; im.src = mediaThumb(md);
        if (this._isNsfw(md, m) && !this.revealed.has(md.url)) im.style.filter = "blur(8px)";
        b.appendChild(im);
        if (md.type === "video") { const vb = el("div", "mh-vid"); vb.appendChild(icon("play", 8)); b.appendChild(vb); }
        b.onclick = () => { mi = i; renderStage(); };
        strip.appendChild(b);
      });
    };

    // ---- info column
    const title = el("h2", null, m.name || "Untitled");
    const by = el("div", "mh-row");
    by.appendChild(el("span", "mh-pill g", m.type || "model"));
    if (m.creator) by.appendChild(el("span", "mh-by", "by " + m.creator));
    const a = el("a", "mh-a"); a.href = m.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.append(el("span", null, "Open on Civitai"), icon("ext", 12));
    by.appendChild(a);
    info.append(title, by);

    const verBox = el("div");
    if (versions.length > 1) {
      verBox.appendChild(el("div", "mh-lbl", `Version (${versions.length})`));
      if (versions.length <= 8) {
        const vs = el("div", "mh-vers");
        versions.forEach((v, i) => {
          const b = el("button", "mh-ver" + (i === vi ? " on" : ""), v.name || `v${i + 1}`); b.type = "button";
          b.onclick = () => { vi = i; mi = 0; vs.querySelectorAll(".mh-ver").forEach((x, j) => x.classList.toggle("on", j === i)); renderVersion(); };
          vs.appendChild(b);
        });
        verBox.appendChild(vs);
      } else {
        const s = el("select", "mh-sel"); s.style.maxWidth = "100%";
        versions.forEach((v, i) => { const o = el("option", null, `${v.name || "v" + (i + 1)} · ${v.baseModel || "?"}`); o.value = i; s.appendChild(o); });
        s.onchange = () => { vi = +s.value; mi = 0; renderVersion(); };
        verBox.appendChild(s);
      }
    }
    const vbody = el("div"); vbody.style.cssText = "display:flex;flex-direction:column;gap:14px";
    info.append(verBox, vbody);

    const renderVersion = () => {
      const v = versions[vi] || {};
      renderStrip(); renderStage();
      vbody.textContent = "";
      const stats = el("div", "mh-stats");
      const stat = (k, val) => { const s = el("div", "mh-stat"); s.append(el("small", null, k), el("b", null, val)); s.title = val; return s; };
      stats.append(stat("Base model", v.baseModel || "—"), stat("Downloads", fmtNum(m.downloads)), stat("Likes", fmtNum(m.likes)));
      vbody.appendChild(stats);

      if (v.words && v.words.length) {
        const box = el("div"); box.appendChild(el("div", "mh-lbl", "Trigger words · click to copy"));
        const row = el("div", "mh-row");
        v.words.forEach((w) => {
          const t = el("button", "mh-word"); t.type = "button"; t.append(icon("copy", 11), el("span", null, w));
          t.onclick = async () => {
            try { await navigator.clipboard.writeText(w); t.classList.add("done"); setTimeout(() => t.classList.remove("done"), 1200); }
            catch { this.toast("Couldn't access the clipboard", "bad"); }
          };
          row.appendChild(t);
        });
        if (v.words.length > 1) {
          const all = el("button", "mh-link", "Copy all"); all.type = "button";
          all.onclick = async () => { try { await navigator.clipboard.writeText(v.words.join(", ")); this.toast("Copied all trigger words", "ok"); } catch { } };
          row.appendChild(all);
        }
        box.appendChild(row); vbody.appendChild(box);
      }

      const fbox = el("div"); fbox.appendChild(el("div", "mh-lbl", (v.files || []).length > 1 ? `Files (${v.files.length})` : "File"));
      const flist = el("div"); flist.style.cssText = "display:flex;flex-direction:column;gap:8px";
      (v.files || []).forEach((f) => flist.appendChild(this._fileRow(m, v, f)));
      if (!(v.files || []).length) flist.appendChild(el("div", "mh-hint", "No downloadable files on this version."));
      fbox.appendChild(flist); vbody.appendChild(fbox);

      if (m.desc) {
        const db = el("div"); db.appendChild(el("div", "mh-lbl", "About"));
        const d = el("div", "mh-desc", m.desc); db.appendChild(d);
        if (m.desc.length > 420) { const more = el("button", "mh-link", "Show more"); more.type = "button"; more.onclick = () => { const o = d.classList.toggle("open"); more.textContent = o ? "Show less" : "Show more"; }; db.appendChild(more); }
        vbody.appendChild(db);
      }
      if (m.tags && m.tags.length) {
        const tb = el("div", "mh-row"); m.tags.forEach((t) => tb.appendChild(el("span", "mh-pill g", t))); vbody.appendChild(tb);
      }
    };
    renderVersion();
  }

  _fileRow(m, v, f) {
    const row = el("div", "mh-file");
    const top = el("div", "mh-ftop");
    const name = el("div", "mh-fname", f.name); name.title = f.name;
    top.append(icon("folder", 14), name);
    if (f.sizeKB) top.appendChild(el("span", "mh-pill g", fmtBytes(f.sizeKB * 1024)));
    if (f.format) top.appendChild(el("span", "mh-pill g", f.format));
    if (f.fp) top.appendChild(el("span", "mh-pill g", f.fp));
    const bot = el("div", "mh-fbot");
    const folders = (this.facets && this.facets.folders) || (this.cfg && this.cfg.folders) || [f.target];
    let target = f.target;
    const sel = el("select", "mh-sel mh-savesel"); sel.title = "Save to"; sel.setAttribute("aria-label", "Save to folder");
    folders.forEach((k) => { const o = el("option", null, k); o.value = k; if (k === target) o.selected = true; sel.appendChild(o); });
    if (!folders.includes(target)) { const o = el("option", null, target); o.value = target; o.selected = true; sel.prepend(o); }
    const dest = el("div", "mh-dest");
    const organize = !this.cfg || this.cfg.organize_by_base !== false;
    const updDest = () => { dest.textContent = "→ " + target + "/" + (organize && v.baseModel ? v.baseModel.replace(/[<>:"/\\|?*]/g, "_") + "/" : ""); dest.title = dest.textContent + f.name; };
    sel.onchange = () => { target = sel.value; updDest(); };
    updDest();
    const btn = el("button", "mh-btn"); btn.type = "button";
    const fill = el("i", "mh-fill"); const lbl = el("span"); btn.append(fill, lbl);
    const key = (f.name || "").toLowerCase();
    let state = "idle";
    btn.onclick = () => {
      const snap = this.dls.get(key);
      if (state === "running") { if (snap) this.cancel(snap.id); return; }
      if (state === "error" && snap) { this.retry(snap.id); return; }
      this.download(this._fileOpts(m, v, f, target));
    };
    this._bind(row, () => {
      const snap = this.dls.get(key);
      const owned = this.owned.has(key);
      btn.className = "mh-btn"; fill.style.width = "0"; btn.disabled = false;
      if (snap && (snap.status === "running" || snap.status === "queued")) {
        state = "running"; btn.classList.add("ghost"); fill.style.width = snap.pct + "%";
        lbl.textContent = snap.status === "queued" ? "Queued · cancel" : `${Math.floor(snap.pct)}% · cancel`;
        btn.title = "Click to cancel";
      } else if (snap && snap.status === "error") {
        state = "error"; btn.classList.add("bad"); lbl.textContent = "Failed · retry"; btn.title = snap.error || "";
      } else if (owned) {
        state = "owned"; btn.classList.add("ok"); lbl.textContent = "✓ In library · re-download"; btn.title = "Already on disk – click to download again";
      } else { state = "idle"; lbl.textContent = "Download"; btn.title = ""; }
    });
    bot.append(sel, dest, btn);
    row.append(top, bot);
    return row;
  }

  // -------------------------------------------------------------- lightbox
  openLightbox(list, index) {
    this._lbList = list; this._lbIdx = index;
    this.lb.classList.add("open");
    this._lbRender();
  }
  closeLightbox() { this._stopMedia(this.lb); this.lb.classList.remove("open"); this.lb.textContent = ""; }
  _lbStep(d) { const n = (this._lbList || []).length; if (n > 1) { this._lbIdx = (this._lbIdx + d + n) % n; this._lbRender(); } }
  _lbRender() {
    const list = this._lbList || [], md = list[this._lbIdx];
    this._stopMedia(this.lb); this.lb.textContent = "";
    if (!md) return;
    const bar = el("div", "mh-lbbar");
    bar.appendChild(el("span", null, `${this._lbIdx + 1} / ${list.length}`));
    bar.appendChild(Object.assign(el("div"), { className: "mh-sp" }));
    const a = el("a", "mh-a"); a.href = md.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.append(el("span", null, "Open original"), icon("ext", 12));
    const x = iconBtn("x", "Close (Esc)"); x.onclick = () => this.closeLightbox();
    bar.append(a, x);
    const st = el("div", "mh-lbstage");
    let node;
    if (md.type === "video") { node = el("video"); node.src = cvVid(md.url, 1920); node.controls = true; node.autoplay = true; node.loop = true; node.playsInline = true; }
    else { node = el("img"); node.alt = ""; node.src = cvImg(md.url, 2048); }
    st.appendChild(node);
    if (list.length > 1) {
      const l = el("button", "mh-nav l"); l.type = "button"; l.appendChild(icon("left", 20)); l.onclick = () => this._lbStep(-1);
      const r = el("button", "mh-nav r"); r.type = "button"; r.appendChild(icon("right", 20)); r.onclick = () => this._lbStep(1);
      st.append(l, r);
    }
    st.addEventListener("mousedown", (e) => { if (e.target === st) this.closeLightbox(); });
    this.lb.append(bar, st);
  }

  // ------------------------------------------------------------------ modal
  _openModal(narrow) {
    this._stopMedia(this.modal);
    this.modal.textContent = "";
    this._stageStep = null;
    const sheet = el("div", "mh-sheet" + (narrow ? " narrow" : ""));
    const x = iconBtn("x", "Close (Esc)", "mh-ico mh-x"); x.onclick = () => this.closeModal();
    sheet.appendChild(x);
    this.modal.appendChild(sheet);
    this.modal.classList.add("open");
    this._returnFocus = document.activeElement;
    if (!narrow) setTimeout(() => x.focus({ preventScroll: true }), 20);
    return sheet;
  }
  closeModal() {
    this._stopMedia(this.modal); this.modal.classList.remove("open"); this.modal.textContent = ""; this._stageStep = null;
    const rf = this._returnFocus; this._returnFocus = null;
    if (rf && rf.isConnected && this.isOpen()) try { rf.focus({ preventScroll: true }); } catch { }
  }

  async openSettings() {
    try { this.cfg = await call("/model_hub/config"); } catch (e) { this.toast("Couldn't load settings: " + e.message, "bad"); return; }
    const cfg = this.cfg;
    const sheet = this._openModal(true);
    const form = el("div", "mh-form");
    form.appendChild(el("h2", null, "Settings"));
    const tokenField = (label, key, isSet, help) => {
      const f = el("div", "mh-field");
      const l = el("label"); l.appendChild(el("span", null, label));
      const right = el("span");
      if (isSet) {
        right.appendChild(el("span", "mh-set", "set ✓ "));
        const clr = el("button", "mh-link", "remove"); clr.type = "button";
        clr.onclick = async () => { await call("/model_hub/config", { [key]: "" }); this.toast(label + " removed", "ok"); this.openSettings(); };
        right.appendChild(clr);
      }
      l.appendChild(right);
      const i = el("input"); i.type = "password"; i.placeholder = isSet ? "paste a new token to replace it" : "paste your token"; i.autocomplete = "off"; i.dataset.key = key;
      f.append(l, i);
      if (help) f.appendChild(el("div", "mh-hint", help));
      return f;
    };
    form.appendChild(tokenField("Civitai API token", "civitai_token", cfg.civitai_token, "Needed for early-access or login-only files. Create one at civitai.com → Account settings → API keys."));
    form.appendChild(tokenField("Hugging Face token", "hf_token", cfg.hf_token, "Used for pasted Hugging Face links to gated repos."));
    const two = el("div", "mh-two");
    const num = (label, key, val, min, max) => {
      const f = el("div", "mh-field"); const l = el("label"); l.appendChild(el("span", null, label)); f.appendChild(l);
      const i = el("input"); i.type = "number"; i.min = min; i.max = max; i.value = val; i.dataset.key = key; f.appendChild(i); return f;
    };
    two.append(num("Connections per download", "connections", cfg.connections, 1, 32), num("Segment size (MB)", "chunk_mb", cfg.chunk_mb, 1, 256));
    form.appendChild(two);
    const chk = el("label", "mh-check"); const cb = el("input"); cb.type = "checkbox"; cb.checked = cfg.organize_by_base !== false;
    const txt = el("div"); txt.append(el("div", null, "Sort downloads into base-model folders"), el("div", "mh-hint", "e.g. loras/Krea 2/…  and  loras/MiniMax H3/…  so same-type files for different models never mix."));
    chk.append(cb, txt); form.appendChild(chk);
    // aria2 (Hugging Face downloads)
    const ar = el("div", "mh-field");
    const al = el("label"); al.appendChild(el("span", null, "aria2 — used for Hugging Face downloads")); ar.appendChild(al);
    const arow = el("div", "mh-row");
    const astat = el("span", "mh-hint"); astat.style.flex = "1";
    const abtn = el("button", "mh-btn ghost"); abtn.type = "button";
    const syncAria = () => {
      const a = this.aria2;
      if (!a) { astat.textContent = "The Hugging Face downloader isn't loaded."; abtn.style.display = "none"; return; }
      abtn.style.display = "";
      if (this._ariaBusy) { astat.textContent = "Installing…"; abtn.disabled = true; abtn.textContent = "Installing…"; return; }
      abtn.disabled = false;
      if (a.installed) { astat.textContent = "Installed — " + (a.version || a.path); abtn.textContent = "Check again"; abtn.onclick = () => this.refreshAria2(true); }
      else { astat.textContent = a.error ? "Not installed — last attempt: " + a.error : "Not installed"; abtn.textContent = "Install aria2"; abtn.onclick = () => this.installAria2(); }
    };
    this._settingsAria = () => { if (abtn.isConnected) syncAria(); else this._settingsAria = null; };
    syncAria();
    arow.append(astat, abtn); ar.appendChild(arow); form.appendChild(ar);
    const acts = el("div", "mh-actions");
    const cancel = el("button", "mh-btn ghost", "Cancel"); cancel.type = "button"; cancel.onclick = () => this.closeModal();
    const save = el("button", "mh-btn", "Save"); save.type = "button";
    save.onclick = async () => {
      const patch = { organize_by_base: cb.checked };
      form.querySelectorAll("input[data-key]").forEach((i) => {
        if (i.type === "password") { if (i.value.trim()) patch[i.dataset.key] = i.value.trim(); }
        else patch[i.dataset.key] = +i.value;
      });
      try { await call("/model_hub/config", patch); this.cfg = await call("/model_hub/config"); this.closeModal(); this.toast("Settings saved", "ok"); }
      catch (e) { this.toast("Couldn't save: " + e.message, "bad"); }
    };
    acts.append(cancel, save); form.appendChild(acts);
    sheet.appendChild(form);
  }

  openPaste() {
    const sheet = this._openModal(true);
    const form = el("div", "mh-form");
    form.appendChild(el("h2", null, "Download from a link"));
    form.appendChild(el("div", "mh-hint", "Paste a Civitai model page, a Civitai download link, or a Hugging Face file link. The file name, type and base model are worked out for you."));
    const f = el("div", "mh-field");
    const i = el("input"); i.type = "text"; i.placeholder = "https://civitai.com/models/…   or   https://huggingface.co/…/blob/main/…"; i.setAttribute("aria-label", "Link");
    f.appendChild(i); form.appendChild(f);
    const acts = el("div", "mh-actions");
    const go = el("button", "mh-btn"); go.type = "button"; go.append(icon("download", 14), el("span", null, "Download"));
    const submit = async () => {
      const url = i.value.trim();
      if (!/^https?:\/\//i.test(url)) { this.toast("That doesn't look like a link", "bad"); i.focus(); return; }
      go.disabled = true;
      const ok = await this.download({ url, paste: true });
      go.disabled = false;
      if (ok) this.closeModal();
    };
    go.onclick = submit;
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    acts.appendChild(go); form.appendChild(acts);
    sheet.appendChild(form);
    setTimeout(() => i.focus(), 30);
  }

  // -------------------------------------------------------------- downloads
  async download(opts) {
    try {
      const r = await call("/model_hub/download", opts);
      this.toast(`Downloading ${r.name || opts.filename || "file"} → ${r.rel ? r.rel.replace(/\/[^/]*$/, "/") : ""}`, "ok");
      this.poll();
      return true;
    } catch (e) { this.toast(e.message, "bad"); return false; }
  }
  async cancel(id) { try { await call("/model_hub/cancel", { id }); } catch { } this.poll(); }
  async retry(id) { try { await call("/model_hub/retry", { id }); this.toast("Retrying…", "ok"); } catch (e) { this.toast(e.message, "bad"); } this.poll(); }
  async clearDone() { try { await call("/model_hub/clear", {}); } catch { } this.poll(); }
  toggleDrawer() { this.drawer.classList.toggle("open"); this.dlBtn.classList.toggle("on", this.drawer.classList.contains("open")); this.poll(); }
  closeDrawer() { this.drawer.classList.remove("open"); this.dlBtn.classList.remove("on"); }

  async refreshOwned() {
    try { const r = await call("/model_hub/owned"); this.owned = new Set(r.names || []); this._refreshBindings(); } catch { }
  }

  async poll() {
    const seq = (this._pollSeq = (this._pollSeq || 0) + 1);
    clearTimeout(this.pollTimer);
    let list = [];
    try { list = (await call("/model_hub/downloads")).downloads || []; } catch { list = null; }
    if (seq !== this._pollSeq) return;   // a newer poll() superseded this one — keep a single loop
    if (list) {
      const prevActive = this.active;
      const dls = new Map();
      // newest snapshot per file name wins (list is newest-first)
      for (const d of list) { const k = (d.name || "").toLowerCase(); if (!dls.has(k)) dls.set(k, d); }
      const justDone = list.some((d) => d.status === "done" && !(this.dls.get((d.name || "").toLowerCase()) || {}).status?.startsWith("done"));
      this.dls = dls;
      this.active = list.filter((d) => d.status === "running" || d.status === "queued").length;
      this._renderBadges(list);
      if (this.drawer.classList.contains("open")) this._renderDrawer(list);
      if (justDone || (prevActive && !this.active)) await this.refreshOwned();
      else this._refreshBindings();
    }
    const delay = this.active ? 1000 : this.isOpen() ? 4000 : 0;
    if (delay) this.pollTimer = setTimeout(() => this.poll(), delay);
  }

  _renderBadges(list) {
    const n = this.active;
    this.dlBtn.querySelectorAll(".mh-cnt").forEach((c) => c.remove());
    if (n) this.dlBtn.appendChild(el("span", "mh-cnt", String(n)));
    this.lbadge.textContent = n ? String(n) : ""; this.lbadge.classList.toggle("on", !!n);
    const speed = list.reduce((s, d) => s + (d.status === "running" ? d.speed : 0), 0);
    this.dsum.textContent = n ? `${n} active${speed ? " · " + fmtSpeed(speed) : ""}` : "";
    if (this.sidePanel) this._renderSide();
  }

  // keyed rows: updated in place so buttons don't get replaced under your cursor
  _renderDrawer(list) {
    this._rows = this._rows || new Map();
    if (!list.length) {
      this._rows.clear(); this.dlist.textContent = "";
      const s = el("div", "mh-state"); s.append(icon("download", 26), el("div", null, "No downloads yet"), el("div", "mh-hint", "Hit Download on any model — files land in the right models/ folder."));
      this.dlist.appendChild(s); return;
    }
    const empty = this.dlist.querySelector(".mh-state"); if (empty) empty.remove();
    const keep = new Set();
    list.forEach((d, idx) => {
      keep.add(d.id);
      let r = this._rows.get(d.id);
      if (!r) {
        r = { row: el("div", "mh-dl") };
        r.th = el("div", "mh-dthumb");
        const fallback = () => { r.th.textContent = ""; r.th.appendChild(icon("folder", 18)); };
        if (d.thumb) { const im = el("img"); im.alt = ""; im.src = d.thumb; im.onerror = fallback; r.th.appendChild(im); }
        else fallback();
        const mid = el("div"); mid.style.minWidth = "0";
        r.nm = el("div", "mh-dname", d.name); r.nm.title = d.name;
        r.pth = el("div", "mh-dpath", d.rel || ""); r.pth.title = d.rel || "";
        r.bar = el("div", "mh-bar"); r.bi = el("i"); r.bar.appendChild(r.bi);
        r.sub = el("div", "mh-dsub"); r.l = el("span"); r.r = el("span"); r.sub.append(r.l, r.r);
        r.err = el("div", "mh-derr");
        mid.append(r.nm, r.pth, r.bar, r.sub, r.err);
        r.act = el("div", "mh-dact");
        r.row.append(r.th, mid, r.act);
        this._rows.set(d.id, r);
      }
      r.bar.className = "mh-bar" + (d.status === "done" ? " ok" : d.status === "error" ? " bad" : "");
      r.bi.style.width = (d.status === "done" ? 100 : d.pct) + "%";
      r.l.textContent = d.status === "done" ? `Done · ${fmtBytes(d.total)}` : d.total ? `${Math.floor(d.pct)}% · ${fmtBytes(d.done)} / ${fmtBytes(d.total)}` : (fmtBytes(d.done) || "starting…");
      r.r.textContent = d.status === "running" ? ([fmtSpeed(d.speed), fmtEta(d.eta)].filter(Boolean).join(" · ") || "connecting…")
        : d.status === "done" ? "" : d.status === "error" ? "failed" : d.status;
      r.err.textContent = d.error || ""; r.err.style.display = d.error ? "" : "none";
      if (r.status !== d.status) {          // rebuild actions only when the state changes
        r.status = d.status; r.act.textContent = "";
        if (d.status === "running" || d.status === "queued") { const b = iconBtn("x", "Cancel"); b.onclick = () => this.cancel(d.id); r.act.appendChild(b); }
        else if (d.status === "error" || d.status === "cancelled") { const b = iconBtn("retry", "Retry / resume"); b.onclick = () => this.retry(d.id); r.act.appendChild(b); }
        else if (d.status === "done") { const ok = el("span"); ok.style.color = "var(--ok)"; ok.appendChild(icon("check", 16)); r.act.appendChild(ok); }
      }
      if (this.dlist.children[idx] !== r.row) this.dlist.insertBefore(r.row, this.dlist.children[idx] || null);
    });
    for (const [id, r] of this._rows) if (!keep.has(id)) { r.row.remove(); this._rows.delete(id); }
  }

  toast(msg, kind = "") {
    const t = el("div", "mh-toast " + kind);
    t.append(icon(kind === "bad" ? "alert" : "check", 15), el("span", null, msg));
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => t.remove(), kind === "bad" ? 6000 : 3200);
  }

  // ------------------------------------------- HF fallback (no HF downloader)
  async _hfLoad() {
    const gen = this.gen;
    this.grid.style.display = "none";
    const wrap = el("div", "mh-hf"); const repos = el("div", "mh-hfcol"); const files = el("div", "mh-hfcol");
    wrap.append(repos, files); this.stateBox.appendChild(wrap);
    this.body.style.overflowY = "hidden"; wrap.style.height = "100%"; this.stateBox.style.height = "100%";
    repos.appendChild(el("div", "mh-hint", "Loading…"));
    files.appendChild(el("div", "mh-hint", "Pick a repo to see its files."));
    const cat = HF_CATS[this.hfCat || 0];
    const q = [this.q, cat.q].filter(Boolean).join(" ");
    let data;
    try { data = await call("/model_hub/search?" + new URLSearchParams({ source: "huggingface", q, sort: "downloads" })); }
    catch (e) { data = { error: e.message }; }
    if (gen !== this.gen) return;
    repos.textContent = "";
    if (data.error) { repos.appendChild(el("div", "mh-hint", data.error)); return; }
    (data.items || []).forEach((m, i) => {
      const r = el("button", "mh-hfrepo"); r.type = "button";
      r.append(el("div", "mh-hfid", m.id), el("div", "mh-hfmeta", `↓ ${fmtNum(m.downloads)} · ♥ ${fmtNum(m.likes)}${m.pipeline ? " · " + m.pipeline : ""}`));
      r.onclick = () => { repos.querySelectorAll(".mh-hfrepo").forEach((x) => x.classList.remove("on")); r.classList.add("on"); this._hfFiles(m, files, cat); };
      repos.appendChild(r);
      if (i === 0) r.click();
    });
    if (!(data.items || []).length) repos.appendChild(el("div", "mh-hint", "No repos found."));
  }
  async _hfFiles(m, box, cat) {
    box.textContent = ""; box.appendChild(el("div", "mh-hint", "Loading files…"));
    let data;
    try { data = await call("/model_hub/hf_files?repo=" + encodeURIComponent(m.id)); } catch (e) { data = { error: e.message }; }
    box.textContent = "";
    if (data.error) { box.appendChild(el("div", "mh-hint", data.error)); return; }
    (data.files || []).forEach((f) => {
      const row = el("div", "mh-hffile");
      const nm = el("div", "mh-fname", f.name); nm.title = f.name;
      const b = el("button", "mh-btn"); b.type = "button"; b.textContent = f.size ? fmtBytes(f.size) : "Get";
      b.onclick = () => this.download({ url: f.url, filename: f.name.split("/").pop(), source: "huggingface", target: cat.target, base: m.id.split("/").pop() });
      row.append(nm, b); box.appendChild(row);
    });
  }

  // ------------------------------------------------------------------ aria2
  _renderAria2() {
    const b = this.ariaBtn; if (!b) return;
    const a = this.aria2;
    b.className = "mh-aria"; b.textContent = ""; b.disabled = false;
    if (!a) return;                               // HF downloader not installed: nothing to show
    b.classList.add("on");
    if (this._ariaBusy) {
      b.classList.add("busy"); b.disabled = true;
      b.append(el("span", "mh-spin"), el("span", null, "Installing aria2…"));
      b.title = "Installing aria2 – this can take a minute"; return;
    }
    if (a.installed) {
      b.classList.add("ok"); b.append(icon("check", 13), el("span", null, "aria2"));
      b.title = `${a.version || "aria2"}${a.path ? "\n" + a.path : ""}\nUsed for Hugging Face downloads – click to re-check`; return;
    }
    b.classList.add(a.error ? "bad" : "miss");
    b.append(icon("download", 13), el("span", null, a.error ? "Retry aria2 install" : "Install aria2"));
    b.title = a.error ? "Last attempt failed: " + a.error : "aria2 is needed for Hugging Face downloads – click to install it";
  }

  async refreshAria2(announce) {
    try {
      const r = await call("/hf-model-downloader/aria2");
      this.aria2 = { installed: !!r.installed, version: r.version || "", path: r.path || "" };
      if (announce) this.toast(r.installed ? `aria2 is installed (${r.version || r.path})` : "aria2 is not installed", r.installed ? "ok" : "bad");
    } catch { this.aria2 = null; }                // no route: the HF downloader isn't loaded
    this._renderAria2(); if (this._settingsAria) this._settingsAria();
  }

  async installAria2() {
    if (this._ariaBusy) return;
    this._ariaBusy = true; this._renderAria2(); if (this._settingsAria) this._settingsAria();
    this.toast("Installing aria2… this can take a minute", "ok");
    let r;
    try { r = await call("/hf-model-downloader/aria2", {}); } catch (e) { r = { ok: false, error: e.message }; }
    this._ariaBusy = false;
    if (r.ok) {
      this.aria2 = { installed: true, version: r.version || "", path: r.path || "" };
      this.toast(`aria2 ready${r.version ? " — " + r.version : ""}${r.via ? " (via " + r.via + ")" : ""}`, "ok");
    } else {
      this.aria2 = { installed: false, error: r.error || "install failed" };
      this.toast("aria2 install failed: " + (r.error || "unknown error"), "bad");
    }
    this._renderAria2(); if (this._settingsAria) this._settingsAria();
    try { window.hfModelDownloader?.checkAria2?.(); } catch { /* HF panel not loaded */ }
  }

  // ----------------------------------------------------------- sidebar tab
  renderSidebar(node) { this.sidePanel = node; this._renderSide(); }
  _renderSide() {
    const n = this.sidePanel; if (!n) return;
    n.textContent = "";
    const w = el("div", "mh-root"); const s = el("div", "mh-side");
    const logo = el("div", "mh-logo"); logo.append(icon("hub", 18), el("span", null, "MODEL HUB"));
    s.append(logo, el("div", "mh-hint", "Browse Civitai and Hugging Face and download straight into the right models/ folder."));
    const o = el("button", "mh-btn", "Civitai  (Alt+M)"); o.type = "button"; o.onclick = () => { this.setSource("civitai"); this.open(); };
    const h = el("button", "mh-btn ghost", "Hugging Face  (Ctrl/Cmd+Shift+B)"); h.type = "button"; h.onclick = () => this.openHF();
    s.append(o, h);
    if (this.active) s.appendChild(el("div", "mh-hint", `${this.active} download${this.active > 1 ? "s" : ""} running…`));
    w.appendChild(s); n.appendChild(w);
  }
}

app.registerExtension({
  name: "ModelHub.Browser",
  commands: [{ id: "ModelHub.open", label: "Open Model Hub", icon: "pi pi-box", function: () => window.__modelHub && window.__modelHub.toggle() }],
  async setup() {
    if (window.__modelHub) return;
    window.__modelHub = new ModelHub();
    try {
      app.extensionManager?.registerSidebarTab?.({
        id: "model-hub", icon: "pi pi-box", title: "Model Hub",
        tooltip: "Model Hub – Civitai + Hugging Face", type: "custom",
        render: (node) => window.__modelHub.renderSidebar(node),
      });
    } catch (e) { console.warn("[ModelHub] sidebar tab unavailable", e); }
  },
});
