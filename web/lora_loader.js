import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/* =========================================================================
 * ✦ ADVANCED LORA LOADER — node UI
 *   rows: on/off · preview · name (click = swap) · STR [CLIP] [V× A×] · status · ⓘ · ✕
 *   picker: search (name / trigger / base), folders, previews, keyboard, Shift = add several
 *   ⓘ panel: Civitai links, trigger words (click = send to trigger_words), gallery, file facts
 * Everything from files/Civitai is written with textContent; innerHTML only for static icons.
 * ======================================================================= */

const NODE_ID = "CrypsAdvancedLoraLoader";
const STACK = "stack";
const PREF_KEY = "cryps.lora.prefs.v1";
const THEMES = ["wolf", "jade", "neon", "ember", "frost", "oled"];
const THEME_NAMES = { wolf: "Wolf", jade: "Jade", neon: "Neon", ember: "Ember", frost: "Frost", oled: "OLED" };
const ROW_H = { cozy: 48, compact: 30 };
const HEAD_H = 34, FOOT_H = 40, EMPTY_H = 66, NOTE_H = 24;
const STR_MIN = -10, STR_MAX = 10, MUL_MIN = 0, MUL_MAX = 2, MAX_ROWS = 64;

// ------------------------------------------------------------------ helpers
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null && text !== "") e.textContent = String(text);
  return e;
}
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  clip: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  rows: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  cards: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
};
function icon(name, size = 14) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", size); s.setAttribute("height", size);
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || "";          // static constant markup only
  return s;
}
function iconBtn(name, title, on, onClick, cls = "cl-ib") {
  const b = el("button", cls + (on ? " on" : ""));
  b.type = "button"; b.title = title; b.setAttribute("aria-label", title);
  b.append(icon(name));
  b.addEventListener("pointerdown", (e) => e.stopPropagation());
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e, b); });
  return b;
}
function tag(text, cls = "", title = "") {
  const t = el("span", "cl-tag" + (cls ? " " + cls : ""), text);
  if (title) t.title = title;
  return t;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);
const fmtBytes = (b) => { b = +b || 0; if (b <= 0) return ""; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (i ? b.toFixed(b >= 100 ? 0 : 1) : Math.round(b)) + " " + u[i]; };
const fmtNum = (n) => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : String(n); };
const stem = (n) => String(n || "").replace(/\\/g, "/").split("/").pop().replace(/\.(safetensors|pt|pth|ckpt|bin)$/i, "");
const baseLower = (n) => String(n || "").replace(/\\/g, "/").split("/").pop().toLowerCase();

// Civitai CDN transforms (same as the Model Hub)
const CIV = /^(https:\/\/image\.civitai\.com\/[^/]+\/[^/]+\/)(?:[^/]+\/)?([^/?#]+)$/;
const cvImg = (u, w = 450) => { const m = CIV.exec(u || ""); return m ? `${m[1]}width=${w},optimized=true/${m[2]}` : u; };
const cvVid = (u, w = 450) => { const m = CIV.exec(u || ""); return m ? `${m[1]}transcode=true,width=${w}/${m[2]}` : u; };
const cvPoster = (u, w = 450) => { const m = CIV.exec(u || ""); return m ? `${m[1]}anim=false,transcode=true,width=${w}/${m[2].replace(/\.[^.]+$/, "")}.jpeg` : ""; };

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPrefs(), ...p })); } catch { /* private mode */ } }

async function call(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await api.fetchApi(path, opt);
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data || {};
}
const previewURL = (c) => api.apiURL(`/cryps_lora/preview?name=${encodeURIComponent(c.name)}&v=${c.pv || 0}`);

function toast(msg, kind = "") {
  let t = document.querySelector(".cl-toast");
  if (!t) { t = el("div", "cl-toast"); document.body.append(t); }
  t.className = "cl-toast show" + (kind ? " " + kind : "");
  t.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), kind === "warn" ? 6000 : 2600);
}
async function copyText(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = el("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta); ta.select(); try { document.execCommand("copy"); } catch { /* ignore */ } ta.remove();
  }
  toast(label);
}
function markChanged() {
  try { app.graph?.setDirtyCanvas?.(true, true); } catch { /* ignore */ }
  try { app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.checkState?.(); } catch { /* ignore */ }
}

// ------------------------------------------------------------ stack format
function normRow(r) {
  if (!r || typeof r !== "object" || typeof r.lora !== "string") return null;
  const lora = r.lora.trim();
  if (!lora || lora.toLowerCase() === "none") return null;
  const num = (v, d, lo, hi) => { const f = parseFloat(v); return Number.isFinite(f) ? clamp(f, lo, hi) : d; };
  return {
    on: r.on === undefined ? true : !!r.on,
    lora,
    str: num(r.str ?? 1, 1, STR_MIN, STR_MAX),
    clip: r.clip == null || r.clip === "" ? null : num(r.clip, null, STR_MIN, STR_MAX),
    vs: num(r.vs ?? 1, 1, MUL_MIN, MUL_MAX),
    as: num(r.as ?? 1, 1, MUL_MIN, MUL_MAX),
    words: Array.isArray(r.words) ? r.words.filter((w) => typeof w === "string" && w.trim()).map((w) => w.trim()).slice(0, 64) : [],
  };
}
function parseStack(v) {
  let data = v, cache = false;
  if (typeof v === "string") { try { data = v.trim() ? JSON.parse(v) : []; } catch { data = []; } }
  if (data && !Array.isArray(data) && typeof data === "object") { cache = !!data.cache; data = data.rows; }
  return { rows: (Array.isArray(data) ? data : []).slice(0, MAX_ROWS).map(normRow).filter(Boolean), cache };
}
const strengths = (r) => { const m = r.str * r.vs; return [m, r.str * r.as, r.clip ?? m]; };
const isActive = (r) => r.on && strengths(r).some((x) => x !== 0);
function triggerText(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) {
    if (!isActive(r)) continue;
    for (const w of r.words) { const k = w.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(w); } }
  }
  return out.join(", ");
}

// ---------------------------------------------------------------- library
const Library = {
  cards: [], byName: new Map(), byFile: new Map(), loadedAt: 0, loading: null,
  summaries: new Map(), pending: new Set(), sumTimer: 0, subs: new Set(),
  onChange(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  emit() { for (const fn of [...this.subs]) { try { fn(); } catch (e) { console.error("[✦ LoRA]", e); } } },
  load(force = false) {
    if (this.loading) return this.loading;
    if (!force && this.loadedAt && Date.now() - this.loadedAt < 20000) return Promise.resolve(this.cards);
    this.loading = call("/cryps_lora/list").then((d) => {
      this.cards = Array.isArray(d.loras) ? d.loras : [];
      this.byName = new Map(this.cards.map((c) => [c.name, c]));
      this.byFile = new Map();
      for (const c of this.cards) if (!this.byFile.has(baseLower(c.name))) this.byFile.set(baseLower(c.name), c);
      for (const [k, s] of this.summaries) if (s.missing || s.resolved) this.summaries.delete(k);
      this.loadedAt = Date.now();
      this.emit();
      return this.cards;
    }).finally(() => { this.loading = null; });
    return this.loading;
  },
  find(name) { return this.byName.get(name) || this.byFile.get(baseLower(name)) || null; },
  want(names) {
    for (const n of names) if (!this.summaries.has(n)) this.pending.add(n);
    if (!this.pending.size || this.sumTimer) return;
    this.sumTimer = setTimeout(async () => {
      this.sumTimer = 0;
      const batch = [...this.pending].slice(0, 64);
      batch.forEach((n) => this.pending.delete(n));
      try {
        const d = await call("/cryps_lora/summary", { names: batch });
        for (const [k, v] of Object.entries(d.summaries || {})) this.summaries.set(k, v);
        this.emit();
      } catch (e) { console.warn("[✦ LoRA] summary failed", e); }
      if (this.pending.size) this.want([]);
    }, 30);
  },
};

function thumbEl(c, fallbackName, lazyRoot = null) {
  const t = el("div", "cl-thumb");
  const letters = () => { t.textContent = stem(c?.title || fallbackName).replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "✦"; };
  if (!c || !c.preview) { letters(); return t; }
  const src = previewURL(c);
  if (c.preview === "video") {
    const v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = "metadata";
    v.onerror = () => { v.remove(); letters(); };
    const load = () => { if (!v.src) v.src = src + "#t=0.1"; };
    if (lazyRoot) lazyRoot.observe(v, load); else load();
    t.addEventListener("pointerenter", () => { load(); v.play().catch(() => {}); });
    t.addEventListener("pointerleave", () => v.pause());
    t.append(v);
  } else {
    const img = new Image();
    img.loading = "lazy"; img.decoding = "async"; img.alt = "";
    img.onerror = () => { img.remove(); letters(); };
    img.src = src;
    t.append(img);
  }
  return t;
}

// ------------------------------------------------------------------ styles
const CSS = `
.cl-themed{--bg:#0e0e14;--surf:#15151e;--surf2:#1b1b26;--surf3:#242431;--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.13);
 --txt:#ececf3;--mut:#9a9ab0;--dim:#66667e;--acc:#8b5cf6;--acc2:#a78bfa;--accbg:rgba(139,92,246,.16);--accln:rgba(139,92,246,.5);
 --aud:#38bdf8;--ok:#34d399;--bad:#f87171;--warn:#fbbf24;--inf:#60a5fa;
 font-family:Inter,ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;color:var(--txt)}
.cl-themed[data-theme=jade]{--acc:#10b981;--acc2:#34d399;--accbg:rgba(16,185,129,.16);--accln:rgba(16,185,129,.5);--aud:#60a5fa}
.cl-themed[data-theme=neon]{--bg:#0a0a15;--surf:#10101f;--surf2:#161629;--surf3:#1e1e37;--acc:#ff2d88;--acc2:#ff6aa9;--accbg:rgba(255,45,136,.16);--accln:rgba(255,45,136,.55);--aud:#bf5fff}
.cl-themed[data-theme=ember]{--bg:#14100b;--surf:#1b1610;--surf2:#231c14;--surf3:#2d241a;--txt:#f5ecdf;--mut:#baa98f;--dim:#7e6e57;--acc:#f59e0b;--acc2:#fbbf24;--accbg:rgba(245,158,11,.16);--accln:rgba(245,158,11,.5);--aud:#fb7185}
.cl-themed[data-theme=frost]{--bg:#0a1016;--surf:#0f1820;--surf2:#14202b;--surf3:#1b2a37;--acc:#38bdf8;--acc2:#7dd3fc;--accbg:rgba(56,189,248,.16);--accln:rgba(56,189,248,.5);--aud:#c084fc}
.cl-themed[data-theme=oled]{--bg:#000;--surf:#060606;--surf2:#0e0e0e;--surf3:#181818;--line:rgba(255,255,255,.1);--acc:#d4d4d4;--acc2:#fff;--accbg:rgba(255,255,255,.1);--accln:rgba(255,255,255,.4);--aud:#22d3ee}
.cl-themed *,.cl-themed *::before,.cl-themed *::after{box-sizing:border-box}
.cl-themed button{font:inherit;color:inherit}
.cl-root{width:100%;height:100%;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:12px;line-height:1.25;user-select:none}
.cl-head,.cl-foot{flex:none;display:flex;align-items:center;gap:6px;padding:0 8px;background:var(--surf)}
.cl-head{height:${HEAD_H}px;border-bottom:1px solid var(--line)}
.cl-foot{height:${FOOT_H}px;border-top:1px solid var(--line)}
.cl-count{color:var(--mut);font-size:11px;white-space:nowrap}
.cl-sp{flex:1}
.cl-ib{flex:none;width:24px;height:24px;display:grid;place-items:center;border:1px solid transparent;border-radius:7px;background:none;color:var(--mut);cursor:pointer;padding:0}
.cl-ib:hover{background:var(--surf3);color:var(--txt)}
.cl-ib.on{color:var(--acc2);background:var(--accbg);border-color:var(--accln)}
.cl-ib.spin svg{animation:clspin .8s linear infinite}
@keyframes clspin{to{transform:rotate(360deg)}}
.cl-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:4px}
.cl-note{height:${NOTE_H - 4}px;display:flex;align-items:center;padding:0 8px;margin-bottom:4px;border-radius:6px;background:var(--accbg);color:var(--acc2);font-size:11px}
.cl-empty{height:${EMPTY_H - 8}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--dim);font-size:11.5px}
.cl-empty b{color:var(--mut);font-weight:600}
.cl-row{position:relative;display:flex;align-items:center;gap:7px;padding:0 4px 0 2px;border-radius:8px;height:var(--rowh)}
.cl-row:hover{background:var(--surf2)}
.cl-row.off .cl-thumb,.cl-row.off .cl-main,.cl-row.off .cl-knobs{opacity:.35}
.cl-row.missing .cl-name{color:var(--bad)}
.cl-row.dragging{opacity:.35}
.cl-drop{height:2px;margin:-1px 6px;border-radius:2px;background:var(--acc2)}
.cl-grip{flex:none;width:9px;align-self:stretch;display:grid;place-items:center;color:var(--dim);cursor:grab;opacity:0;font-size:11px;letter-spacing:-3px;touch-action:none}
.cl-row:hover .cl-grip{opacity:1}
.cl-sw{flex:none;position:relative;width:26px;height:15px;padding:0;border-radius:99px;border:1px solid var(--line2);background:var(--surf3);cursor:pointer;transition:background .15s,border-color .15s}
.cl-sw::after{content:"";position:absolute;top:1px;left:1px;width:11px;height:11px;border-radius:50%;background:var(--dim);transition:transform .15s,background .15s}
.cl-sw.on{background:var(--accbg);border-color:var(--accln)}
.cl-sw.on::after{transform:translateX(11px);background:var(--acc2)}
.cl-sw.some::after{transform:translateX(5.5px);background:var(--acc)}
.cl-thumb{flex:none;width:var(--thumb,34px);height:var(--thumb,34px);border-radius:6px;background:var(--surf3);overflow:hidden;display:grid;place-items:center;color:var(--dim);font-weight:700;font-size:11px;cursor:pointer}
.cl-thumb img,.cl-thumb video{width:100%;height:100%;object-fit:cover;display:block}
.cl-main{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px;cursor:pointer;align-self:stretch}
.cl-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.cl-main:hover .cl-name{color:var(--acc2)}
.cl-sub{display:flex;gap:4px;align-items:center;white-space:nowrap;overflow:hidden;min-width:0}
.cl-tag{flex:none;padding:0 5px;border-radius:5px;background:var(--surf3);color:var(--mut);font-size:10px;line-height:15px;max-width:140px;overflow:hidden;text-overflow:ellipsis}
.cl-tag.base{color:var(--acc2);background:var(--accbg)}
.cl-tag.av{color:var(--aud);background:rgba(56,189,248,.12)}
.cl-tag.tw{color:var(--txt);border:1px solid var(--line2);background:none;line-height:13px}
.cl-tag.hint{background:none;color:var(--dim);padding:0}
.cl-knobs{flex:none;display:flex;gap:4px}
.cl-pill{display:flex;align-items:center;height:22px;border:1px solid var(--line2);border-radius:7px;background:var(--surf);overflow:hidden}
.cl-pill .k{font-size:8.5px;font-weight:700;color:var(--dim);padding-left:5px;letter-spacing:.3px}
.cl-pill button{flex:none;border:0;background:none;color:var(--dim);width:14px;height:100%;cursor:pointer;padding:0;font-size:12px;line-height:1}
.cl-pill button:hover{color:var(--txt);background:var(--surf3)}
.cl-pill .v{min-width:34px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600;cursor:ew-resize;outline:none;touch-action:none}
.cl-pill .v:focus-visible{box-shadow:inset 0 0 0 1px var(--acc2);border-radius:4px}
.cl-pill.str .v{color:var(--acc2)}
.cl-pill.aud .v{color:var(--aud)}
.cl-pill.zero .v,.cl-pill.auto .v{color:var(--dim)}
.cl-pill.auto .v{font-style:italic}
.cl-pill input{width:40px;height:100%;border:0;outline:none;background:var(--surf3);color:var(--txt);font:inherit;text-align:center}
.cl-stat{flex:none;width:16px;text-align:center;font-size:12px;font-weight:700}
.cl-stat.ok{color:var(--ok)}.cl-stat.warn{color:var(--warn)}.cl-stat.bad{color:var(--bad)}.cl-stat.inf{color:var(--inf);cursor:pointer}
.cl-row .cl-ib{width:22px;height:22px;opacity:.5}
.cl-row:hover .cl-ib{opacity:1}
.cl-add{flex:none;display:flex;align-items:center;gap:5px;height:26px;padding:0 11px;border-radius:8px;border:1px solid var(--accln);background:var(--accbg);color:var(--acc2);font-weight:600;cursor:pointer}
.cl-add:hover{filter:brightness(1.25)}
.cl-tw{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--mut);font-size:11px}
.cl-tw.has{cursor:copy}
.cl-tw.none{color:var(--dim)}
/* picker */
.cl-pop{position:fixed;z-index:10050;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line2);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.6);overflow:hidden;font-size:12.5px}
.cl-pop-head{flex:none;display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid var(--line)}
.cl-pop-title{font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
.cl-search{flex:1;min-width:0;height:30px;border:1px solid var(--line2);border-radius:8px;background:var(--surf);color:var(--txt);padding:0 10px;font:inherit;outline:none}
.cl-search:focus{border-color:var(--accln)}
.cl-chips{flex:none;display:flex;gap:4px;padding:6px 8px;overflow-x:auto;border-bottom:1px solid var(--line);scrollbar-width:none}
.cl-chip{flex:none;height:22px;padding:0 9px;border-radius:99px;border:1px solid var(--line2);background:none;color:var(--mut);cursor:pointer;font-size:11px}
.cl-chip:hover{color:var(--txt)}
.cl-chip.on{background:var(--accbg);border-color:var(--accln);color:var(--acc2)}
.cl-opts{flex:1;min-height:0;overflow-y:auto;padding:4px}
.cl-opt{display:flex;gap:10px;align-items:center;padding:5px 7px;border-radius:9px;cursor:pointer}
.cl-opt.act{background:var(--surf2);box-shadow:inset 0 0 0 1px var(--line2)}
.cl-opt .cl-thumb{--thumb:46px;border-radius:8px}
.cl-opt-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.cl-opt-t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cl-opt-f{color:var(--dim);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cl-opt-tags{display:flex;gap:4px;overflow:hidden}
.cl-in{flex:none;color:var(--ok);font-size:10.5px;font-weight:600}
.cl-none,.cl-more{padding:18px 10px;text-align:center;color:var(--dim)}
.cl-more{padding:8px}
.cl-pop-foot{flex:none;display:flex;gap:12px;padding:6px 10px;border-top:1px solid var(--line);color:var(--dim);font-size:10.5px}
.cl-pop-foot kbd,.cl-modal kbd{font:10px ui-monospace,Menlo,monospace;padding:0 4px;border-radius:4px;border:1px solid var(--line2);color:var(--mut)}
/* info panel */
.cl-back{position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,4,8,.62);backdrop-filter:blur(3px)}
.cl-modal{width:min(780px,100%);max-height:min(88vh,920px);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line2);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.65);overflow:hidden;font-size:12.5px;outline:none}
.cl-mhead{flex:none;display:flex;gap:12px;align-items:flex-start;padding:14px;border-bottom:1px solid var(--line)}
.cl-mhead .cl-thumb{--thumb:64px;border-radius:10px;cursor:default}
.cl-mhead-txt{flex:1;min-width:0}
.cl-mtitle{font-size:15px;font-weight:700;overflow-wrap:anywhere}
.cl-msub{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;align-items:center;color:var(--mut)}
.cl-msub .cl-tag{font-size:10.5px;line-height:17px;max-width:none}
.cl-mbody{overflow-y:auto;padding:12px 14px 18px;display:flex;flex-direction:column;gap:16px}
.cl-sec h4{margin:0 0 8px;display:flex;align-items:center;gap:8px;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--dim);font-weight:700}
.cl-sec h4 .cl-sp{flex:1}
.cl-row-btns{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.cl-btn{height:26px;display:inline-flex;align-items:center;gap:5px;padding:0 10px;border-radius:8px;border:1px solid var(--line2);background:var(--surf);color:var(--txt);cursor:pointer;font-size:12px;text-decoration:none;white-space:nowrap}
.cl-btn:hover{background:var(--surf3)}
.cl-btn.acc{border-color:var(--accln);background:var(--accbg);color:var(--acc2)}
.cl-btn.sm{height:22px;padding:0 8px;font-size:11px;text-transform:none;letter-spacing:0;font-weight:500}
.cl-words{display:flex;flex-wrap:wrap;gap:5px}
.cl-word{height:25px;padding:0 10px;border-radius:99px;border:1px solid var(--line2);background:var(--surf);color:var(--mut);cursor:pointer;font-size:12px}
.cl-word.strong{color:var(--txt)}
.cl-word.sel{background:var(--accbg);border-color:var(--accln);color:var(--acc2)}
.cl-word small{opacity:.55;margin-left:5px}
.cl-hint{color:var(--dim);font-size:11.5px}
.cl-warnline{color:var(--warn);font-size:12px}
.cl-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:6px}
.cl-gi{position:relative;aspect-ratio:3/4;border-radius:8px;overflow:hidden;background:var(--surf3);cursor:zoom-in;border:0;padding:0}
.cl-gi img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s}
.cl-gi:hover img{transform:scale(1.04)}
.cl-gi .pl{position:absolute;right:6px;bottom:6px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.6);color:#fff}
.cl-kv{display:grid;grid-template-columns:max-content 1fr;gap:5px 16px;margin:0}
.cl-kv dt{color:var(--dim)}
.cl-kv dd{margin:0;overflow-wrap:anywhere}
.cl-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--mut)}
.cl-desc{white-space:pre-wrap;color:var(--mut);max-height:8.5em;overflow:hidden;line-height:1.45}
.cl-desc.open{max-height:none}
.cl-skel{height:14px;border-radius:6px;background:linear-gradient(90deg,var(--surf2),var(--surf3),var(--surf2));background-size:200% 100%;animation:clsh 1.2s infinite}
@keyframes clsh{to{background-position:-200% 0}}
.cl-lb{position:fixed;inset:0;z-index:10070;display:flex;align-items:center;justify-content:center;gap:18px;padding:24px;background:rgba(0,0,0,.9)}
.cl-lb-media{max-width:min(68vw,1100px);max-height:90vh;border-radius:10px;object-fit:contain}
.cl-lb aside{width:300px;max-height:88vh;overflow:auto;color:#d8d8e0;font-size:12px;display:flex;flex-direction:column;gap:8px}
.cl-lb aside p{margin:0;white-space:pre-wrap;line-height:1.45}
.cl-lb .cl-ib{position:absolute;width:34px;height:34px;color:#fff;background:rgba(255,255,255,.08)}
.cl-toast{position:fixed;right:18px;bottom:18px;z-index:10090;max-width:440px;padding:9px 13px;border-radius:10px;background:#15151e;color:#ececf3;border:1px solid rgba(139,92,246,.55);font:12.5px Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s;pointer-events:none}
.cl-toast.show{opacity:1;transform:none}
.cl-toast.warn{border-color:rgba(251,191,36,.6)}
`;
function injectCSS() {
  if (document.getElementById("cl-style")) return;
  const s = el("style"); s.id = "cl-style"; s.textContent = CSS;
  document.head.append(s);
}

// ------------------------------------------------------------ number pill
function makePill(o) {
  const p = el("div", "cl-pill " + (o.cls || ""));
  p.title = o.tip;
  if (o.label) p.append(el("span", "k", o.label));
  const dec = el("button", "", "‹"), v = el("span", "v"), inc = el("button", "", "›");
  dec.type = inc.type = "button"; dec.tabIndex = inc.tabIndex = -1; v.tabIndex = 0;
  p.append(dec, v, inc);
  const cur = () => o.get() ?? o.auto?.() ?? o.def;
  const show = () => { const raw = o.get(); v.textContent = fmt(cur()); p.classList.toggle("zero", raw === 0); p.classList.toggle("auto", raw == null); };
  const set = (x) => { o.set(r2(clamp(x, o.min, o.max))); show(); };
  const bump = (d, e) => { set(cur() + d * (e.shiftKey ? 0.2 : 1)); o.commit(); };
  for (const [b, d] of [[dec, -0.05], [inc, 0.05]]) {
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => { e.stopPropagation(); bump(d, e); });
  }
  const edit = () => {
    const inp = el("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = fmt(cur());
    v.replaceWith(inp); inp.focus(); inp.select(); o.busy(true);
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      if (ok) {
        const txt = inp.value.trim().replace(",", ".");
        const f = parseFloat(txt);
        if (Number.isFinite(f)) set(f); else if (!txt && o.auto) { o.set(null); }
      }
      inp.replaceWith(v); show(); o.busy(false);
      if (ok) o.commit();
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    inp.addEventListener("blur", () => finish(true));
  };
  v.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (e.altKey) { o.auto ? o.set(null) : set(o.def); show(); o.commit(); return; }
    const start = cur(), x0 = e.clientX;
    let moved = false;
    try { v.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    o.busy(true);
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      set(start + dx * (ev.shiftKey ? 0.0025 : 0.01));
    };
    const up = () => {
      v.removeEventListener("pointermove", move); v.removeEventListener("pointerup", up); v.removeEventListener("pointercancel", up);
      o.busy(false);
      if (moved) o.commit(); else edit();
    };
    v.addEventListener("pointermove", move); v.addEventListener("pointerup", up); v.addEventListener("pointercancel", up);
  });
  v.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
    if (d) { e.preventDefault(); e.stopPropagation(); bump(d, e); } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); edit(); }
  });
  show();
  return { el: p, show };
}

// ---------------------------------------------------------------- node UI
class LoraStack {
  constructor(node, widget) {
    this.node = node;
    this.w = widget;
    this.rows = [];
    this.rep = [];
    this.cache = false;
    this.busyN = 0;
    this.dirty = false;
    this.root = el("div", "cl-root cl-themed");
    this.head = el("div", "cl-head");
    this.list = el("div", "cl-list");
    this.foot = el("div", "cl-foot");
    this.root.append(this.head, this.list, this.foot);
    this.root.addEventListener("keydown", (e) => e.stopPropagation());
    this.unsub = Library.onChange(() => this.renderRows());
    this.load();
    Library.load().catch((e) => console.warn("[✦ LoRA] list failed", e));
  }

  get props() { return (this.node.properties ||= {}); }
  get theme() { return THEMES.includes(this.props.cl_theme) ? this.props.cl_theme : "wolf"; }
  get dens() { return this.props.cl_density === "compact" ? "compact" : "cozy"; }
  get showClip() { return !!this.props.cl_clip; }
  linked() { return this.node.inputs?.find((i) => i.name === STACK)?.link != null; }
  busy(on) {
    this.busyN = Math.max(0, this.busyN + (on ? 1 : -1));
    if (!this.busyN && this.dirty) { this.dirty = false; this.renderRows(); }
  }

  load() {
    const { rows, cache } = parseStack(this.w.value);
    this.rows = rows; this.cache = cache; this.rep = rows.map(() => undefined);
    this.render();
  }
  commit(render = true) {
    const val = JSON.stringify({ v: 1, cache: this.cache, rows: this.rows });
    if (this.w.value !== val) this.w.value = val;
    markChanged();
    if (render) this.render(); else { this.renderHead(); this.renderFoot(); }
  }
  minHeight() {
    const n = this.rows.length;
    return HEAD_H + FOOT_H + (n ? n * ROW_H[this.dens] + 8 : EMPTY_H) + (this.linked() ? NOTE_H : 0) + 2;
  }
  fit() {
    const node = this.node;
    this.root.style.minHeight = this.minHeight() + "px";
    if (!node.computeSize || !node.setSize) return;
    const sz = node.computeSize();
    if (Math.abs(node.size[1] - sz[1]) > 1 || node.size[0] < sz[0]) node.setSize([Math.max(node.size[0], sz[0]), sz[1]]);
    node.setDirtyCanvas?.(true, true);
  }
  render() {
    this.root.dataset.theme = this.theme;
    this.root.style.setProperty("--rowh", ROW_H[this.dens] + "px");
    this.root.style.setProperty("--thumb", (this.dens === "compact" ? 22 : 36) + "px");
    this.renderHead();
    this.renderRows();
    this.renderFoot();
    this.fit();
  }
  setProp(k, v, pref) {
    this.props[k] = v;
    if (pref) savePrefs({ [pref]: v });
    markChanged();
    this.render();
  }

  renderHead() {
    const h = this.head;
    h.textContent = "";
    const total = this.rows.length, on = this.rows.filter((r) => r.on).length;
    const all = el("button", "cl-sw" + (total && on === total ? " on" : on ? " some" : ""));
    all.type = "button";
    all.title = on === total && total ? "Switch every LoRA off" : "Switch every LoRA on";
    all.addEventListener("pointerdown", (e) => e.stopPropagation());
    all.addEventListener("click", () => {
      if (!total) return;
      const next = on !== total;
      this.rows.forEach((r) => { r.on = next; });
      this.commit();
    });
    h.append(all, el("span", "cl-count", total ? `${on}/${total} on` : "no LoRAs"), el("span", "cl-sp"));
    h.append(
      iconBtn("bolt", this.cache ? "Keeping LoRAs in RAM between runs (click to free it)" : "Keep LoRAs in RAM between runs — faster re-runs, uses up to 15% of RAM", this.cache,
        () => { this.cache = !this.cache; this.commit(); toast(this.cache ? "⚡ LoRAs stay in RAM between runs" : "RAM cache off — freed on the next run"); }),
      iconBtn("clip", this.showClip ? "Separate CLIP strength is on (click: CLIP follows the model strength)" : "Separate CLIP strength per LoRA", this.showClip,
        () => this.toggleClip()),
      iconBtn(this.dens === "compact" ? "cards" : "rows", this.dens === "compact" ? "Cozy rows (previews + details)" : "Compact rows", false,
        () => this.setProp("cl_density", this.dens === "compact" ? "cozy" : "compact", "dens")),
      iconBtn("theme", `Theme: ${THEME_NAMES[this.theme]} — click to cycle`, false,
        () => this.setProp("cl_theme", THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length], "theme")),
    );
  }
  toggleClip() {
    const next = !this.showClip;
    this.props.cl_clip = next;
    if (!next && this.rows.some((r) => r.clip != null)) {
      this.rows.forEach((r) => { r.clip = null; });
      this.commit();
      toast("CLIP strengths reset — CLIP now follows each LoRA's strength");
    } else { markChanged(); this.render(); }
  }

  renderFoot() {
    const f = this.foot;
    f.textContent = "";
    const add = el("button", "cl-add");
    add.type = "button";
    add.title = "Add LoRAs — search by name, trigger word or base model (Shift+click adds several)";
    add.append(icon("plus", 13), el("span", "", "Add LoRA"));
    add.addEventListener("pointerdown", (e) => e.stopPropagation());
    add.addEventListener("click", () => this.openPicker(add, -1));
    const words = triggerText(this.rows);
    const tw = el("div", "cl-tw " + (words ? "has" : "none"), words ? "✦ " + words : "no trigger words picked");
    tw.title = words ? `trigger_words output:\n${words}\n\nClick to copy` : "Open a LoRA's ⓘ and click its trigger words to send them to the trigger_words output";
    if (words) tw.addEventListener("click", () => copyText(words, "Trigger words copied"));
    f.append(add, tw);
  }

  renderRows() {
    if (this.busyN) { this.dirty = true; return; }
    const list = this.list;
    list.textContent = "";
    if (this.linked()) list.append(el("div", "cl-note", "The stack comes from a linked input — edit it at the source."));
    if (!this.rows.length) {
      const e = el("div", "cl-empty");
      e.append(el("b", "", "No LoRAs yet"), el("span", "", "Add LoRA ↓ — search, previews, trigger words"));
      list.append(e);
      return;
    }
    const need = [];
    this.rows.forEach((row, i) => {
      list.append(this.rowEl(row, i));
      if (!Library.summaries.has(row.lora)) need.push(row.lora);
    });
    if (need.length) Library.want(need);
  }

  rowEl(row, i) {
    const card = Library.find(row.lora);
    const sum = Library.summaries.get(row.lora);
    const rep = this.rep[i] && this.rep[i].lora === row.lora ? this.rep[i] : null;
    const missing = !!(sum && sum.missing) || rep?.status === "missing";
    const r = el("div", "cl-row" + (row.on ? "" : " off") + (missing ? " missing" : ""));

    const grip = el("span", "cl-grip", "⋮⋮");
    grip.title = "Drag to reorder";
    grip.addEventListener("pointerdown", (e) => this.drag(e, i));

    const sw = el("button", "cl-sw" + (row.on ? " on" : ""));
    sw.type = "button";
    sw.title = row.on ? "On — click to switch off" : "Off — click to switch on";
    sw.addEventListener("pointerdown", (e) => e.stopPropagation());
    sw.addEventListener("click", () => { row.on = !row.on; this.commit(); });

    const th = thumbEl(card, row.lora);
    th.title = "LoRA info — Civitai, trigger words, examples";
    th.addEventListener("pointerdown", (e) => e.stopPropagation());
    th.addEventListener("click", () => openInfo(this, row));

    const main = el("div", "cl-main");
    main.title = `${row.lora}\nClick to swap this LoRA`;
    main.addEventListener("pointerdown", (e) => e.stopPropagation());
    main.addEventListener("click", () => this.openPicker(main, i));
    main.append(el("div", "cl-name", card?.title || stem(row.lora)));
    if (this.dens === "cozy") main.append(this.subLine(row, card, sum, missing));

    const knobs = el("div", "cl-knobs");
    const shows = [];
    const refresh = () => shows.forEach((f) => f());
    const pill = (o) => { const p = makePill({ busy: (b) => this.busy(b), commit: () => { refresh(); this.commit(false); }, ...o }); shows.push(p.show); knobs.append(p.el); };
    const av = (sum && sum.audioLayers > 0) || row.vs !== 1 || row.as !== 1;
    pill({
      label: av ? "STR" : "", cls: "str", min: STR_MIN, max: STR_MAX, def: 1,
      get: () => row.str, set: (x) => { row.str = x; },
      tip: "Strength — drag to scrub, click to type, ‹ › ±0.05 (Shift ±0.01), Alt-click resets",
    });
    if (this.showClip) {
      pill({
        label: "CLIP", cls: "", min: STR_MIN, max: STR_MAX, def: 1,
        get: () => row.clip, set: (x) => { row.clip = x; }, auto: () => r2(row.str * row.vs),
        tip: "CLIP (text encoder) strength. Italic = follows the model strength; Alt-click to go back to that",
      });
    }
    if (av) {
      pill({
        label: "V×", cls: "", min: MUL_MIN, max: MUL_MAX, def: 1,
        get: () => row.vs, set: (x) => { row.vs = x; },
        tip: "Video/visual multiplier — non-audio layers get STR × V×",
      });
      pill({
        label: "A×", cls: "aud", min: MUL_MIN, max: MUL_MAX, def: 1,
        get: () => row.as, set: (x) => { row.as = x; },
        tip: sum?.audioLayers ? `Audio multiplier — the ${sum.audioLayers} audio layers get STR × A×` : "Audio multiplier (this LoRA has no audio layers)",
      });
    }

    const stat = this.statEl(row, i, sum, rep);
    const info = iconBtn("info", "LoRA info — Civitai, trigger words, examples", false, () => openInfo(this, row));
    const del = iconBtn("x", "Remove from the stack", false, () => {
      this.rows.splice(i, 1); this.rep.splice(i, 1); this.commit();
    });
    r.append(grip, sw, th, main, knobs, stat, info, del);
    return r;
  }

  subLine(row, card, sum, missing) {
    const s = el("div", "cl-sub");
    if (missing) { s.append(tag("file not found — click to pick another", "hint")); return s; }
    const base = card?.base || sum?.arch;
    if (base) s.append(tag(base, "base", card?.base ? "Base model" : "Base model from the file's metadata"));
    if (sum && sum.algo) {
      const label = sum.algo === "LoRA" ? (sum.rank ? `r${sum.rank}${sum.rankMixed ? "*" : ""}` : "LoRA") : sum.algo + (sum.rank ? ` r${sum.rank}` : "");
      s.append(tag(label, "", `${sum.algo}${sum.rank ? " rank " + sum.rank : ""} · ${sum.layers} layers · ${fmtBytes(sum.size)}`));
    }
    if (sum && sum.audioLayers) s.append(tag("A/V", "av", `${sum.audioLayers} audio layers — A× sets their strength`));
    if (row.words.length) {
      row.words.slice(0, 2).forEach((w) => s.append(tag("✦ " + w, "tw", "Sent to trigger_words")));
      if (row.words.length > 2) s.append(tag("+" + (row.words.length - 2), "", row.words.join(", ")));
    } else if (card?.words?.length) {
      s.append(tag(`${card.words.length} trigger word${card.words.length > 1 ? "s" : ""} in ⓘ`, "hint"));
    }
    return s;
  }

  statEl(row, i, sum, rep) {
    const s = el("span", "cl-stat");
    const moved = sum?.resolved || rep?.resolved;
    if ((sum && sum.missing) || rep?.status === "missing") {
      s.classList.add("bad"); s.textContent = "✖";
      s.title = "Not found in models/loras — click the name to pick another file";
    } else if (moved) {
      s.classList.add("inf"); s.textContent = "↪";
      s.title = `Not at the saved path — using ${moved}.\nClick to save the new path.`;
      s.addEventListener("pointerdown", (e) => e.stopPropagation());
      s.addEventListener("click", () => { row.lora = moved; this.rep[i] = undefined; this.commit(); toast("Path updated"); });
    } else if (rep?.status === "ok") {
      s.classList.add("ok"); s.textContent = "✓";
      s.title = `Last run: ${rep.model} model${rep.clip ? ` + ${rep.clip} CLIP` : ""} weights patched${rep.audio ? ` (${rep.audio} audio keys split)` : ""}`;
    } else if (rep?.status === "partial") {
      s.classList.add("warn"); s.textContent = "◐";
      s.title = `Last run: only ${rep.model + rep.clip} of ${rep.layers} layers matched — wrong base model, or text-encoder layers with no CLIP wired`;
    } else if (rep?.status === "nomatch") {
      s.classList.add("bad"); s.textContent = "⚠";
      s.title = "Last run: matched NO weights in this model — this LoRA is for a different base model";
    }
    return s;
  }

  setReport(list) {
    if (!Array.isArray(list)) return;
    this.rep = this.rows.map((row, i) => {
      const e = list.find((x) => x.i === i);
      return e && e.lora === row.lora ? e : undefined;
    });
    this.renderRows();
    const bad = list.filter((e) => e.status === "nomatch");
    if (bad.length) toast(`⚠ ${bad.map((e) => stem(e.lora)).join(", ")} matched nothing in this model — wrong base model?`, "warn");
  }

  drag(e, from) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const els = [...this.list.querySelectorAll(".cl-row")];
    const src = els[from];
    if (!src) return;
    const grip = e.currentTarget;
    try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    src.classList.add("dragging");
    this.busy(true);
    const line = el("div", "cl-drop");
    let to = from;
    const move = (ev) => {
      to = els.length;
      for (let k = 0; k < els.length; k++) {
        const b = els[k].getBoundingClientRect();
        if (ev.clientY < b.top + b.height / 2) { to = k; break; }
      }
      if (els[to]) this.list.insertBefore(line, els[to]); else this.list.append(line);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
      line.remove(); src.classList.remove("dragging");
      const target = to > from ? to - 1 : to;
      this.busyN = Math.max(0, this.busyN - 1); this.dirty = false;
      if (target !== from) {
        const [row] = this.rows.splice(from, 1); this.rows.splice(target, 0, row);
        const [rp] = this.rep.splice(from, 1); this.rep.splice(target, 0, rp);
        this.commit();
      } else this.renderRows();
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  }

  openPicker(anchor, replace) {
    Picker.open({
      anchor, theme: this.theme,
      title: replace >= 0 ? "Swap LoRA" : "Add LoRA",
      multi: replace < 0,
      current: replace >= 0 ? this.rows[replace]?.lora : null,
      inStack: new Set(this.rows.map((r) => r.lora)),
      onPick: (c) => {
        const words = (c.words || []).slice(0, 8);
        if (replace >= 0) {
          const row = this.rows[replace];
          if (!row) return false;
          row.lora = c.name; row.words = words; this.rep[replace] = undefined;
        } else {
          if (this.rows.length >= MAX_ROWS) { toast(`A stack holds up to ${MAX_ROWS} LoRAs`, "warn"); return false; }
          this.rows.push({ on: true, lora: c.name, str: c.strength ?? 1, clip: null, vs: 1, as: 1, words });
          this.rep.push(undefined);
        }
        this.commit();
        return true;
      },
    });
  }

  destroy() {
    this.unsub?.();
    if (Picker.el && Picker.opts?.owner === this) Picker.close();
  }
}

// ------------------------------------------------------------------ picker
const Picker = {
  el: null, opts: null, shown: [], act: 0, q: "", folder: "", mode: "all", io: null,
  open(opts) {
    this.close();
    injectCSS();
    this.opts = opts;
    this.q = ""; this.act = 0;
    const pop = el("div", "cl-pop cl-themed");
    pop.dataset.theme = opts.theme;
    pop.setAttribute("role", "dialog");
    const head = el("div", "cl-pop-head");
    const q = el("input", "cl-search");
    q.placeholder = "Search name, trigger word, base model…";
    q.spellcheck = false;
    const ref = iconBtn("refresh", "Rescan models/loras", false, async (_e, b) => {
      b.classList.add("spin");
      try { await Library.load(true); } catch (err) { toast("Rescan failed: " + err.message, "warn"); }
      b.classList.remove("spin");
      if (this.el === pop) this.build();
    });
    head.append(el("span", "cl-pop-title", opts.title), q, ref);
    this.chips = el("div", "cl-chips");
    this.listEl = el("div", "cl-opts");
    this.listEl.setAttribute("role", "listbox");
    const foot = el("div", "cl-pop-foot");
    const k = (key, txt) => { const s = el("span"); s.append(el("kbd", "", key), document.createTextNode(" " + txt)); return s; };
    foot.append(k("↑↓", "move"), k("Enter", opts.multi ? "add" : "swap"));
    if (opts.multi) foot.append(k("Shift", "add several"));
    foot.append(k("Esc", "close"));
    pop.append(head, this.chips, this.listEl, foot);
    document.body.append(pop);
    this.el = pop;
    this.place(opts.anchor);
    q.addEventListener("input", () => { this.q = q.value; this.act = 0; this.renderList(); });
    pop.addEventListener("keydown", (e) => this.onKey(e));
    pop.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.outside = (e) => { if (this.el && !this.el.contains(e.target)) this.close(); };
    document.addEventListener("pointerdown", this.outside, true);
    this.io = "IntersectionObserver" in window ? new IntersectionObserver((ents) => {
      for (const en of ents) if (en.isIntersecting) { en.target.__load?.(); this.io.unobserve(en.target); }
    }, { root: this.listEl, rootMargin: "120px" }) : null;
    q.focus();
    if (Library.loadedAt) this.build(); else this.listEl.append(el("div", "cl-none", "Reading models/loras…"));
    Library.load().then(() => { if (this.el === pop) this.build(); }).catch((err) => {
      if (this.el === pop) { this.listEl.textContent = ""; this.listEl.append(el("div", "cl-none", "Could not list LoRAs: " + err.message)); }
    });
  },
  place(anchor) {
    const pop = this.el;
    const W = Math.min(480, innerWidth - 16);
    const r = anchor?.getBoundingClientRect?.() || { left: innerWidth / 2 - W / 2, top: innerHeight / 3, bottom: innerHeight / 3 };
    pop.style.width = W + "px";
    pop.style.left = clamp(r.left, 8, innerWidth - W - 8) + "px";
    const below = innerHeight - r.bottom - 14, above = r.top - 14, want = Math.min(620, innerHeight * 0.72);
    if (below >= Math.min(want, 380) || below >= above) {
      pop.style.top = r.bottom + 6 + "px";
      pop.style.maxHeight = Math.max(260, Math.min(want, below)) + "px";
    } else {
      pop.style.bottom = innerHeight - r.top + 6 + "px";
      pop.style.maxHeight = Math.max(260, Math.min(want, above)) + "px";
    }
  },
  build() {
    const chips = this.chips;
    chips.textContent = "";
    const cards = Library.cards;
    const dirs = [...new Set(cards.map((c) => c.dir).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (this.folder && !dirs.includes(this.folder)) this.folder = "";
    const chip = (label, on, fn, title = "") => {
      const b = el("button", "cl-chip" + (on ? " on" : ""), label); b.type = "button";
      if (title) b.title = title;
      b.addEventListener("click", () => { fn(); this.act = 0; this.build(); });
      chips.append(b);
    };
    chip(`All ${cards.length}`, !this.folder && this.mode === "all", () => { this.folder = ""; this.mode = "all"; });
    chip("Recent", this.mode === "recent", () => { this.mode = this.mode === "recent" ? "all" : "recent"; }, "Newest files first");
    if (cards.some((c) => c.fav)) chip("★", this.mode === "fav", () => { this.mode = this.mode === "fav" ? "all" : "fav"; }, "LoRA Manager favorites");
    for (const d of dirs) chip(d.replace(/\//g, " / "), this.folder === d, () => { this.folder = this.folder === d ? "" : d; });
    this.renderList();
  },
  hay(c) { return (c.__h ||= [c.name, c.title, c.version, c.base, c.arch, ...(c.words || [])].filter(Boolean).join(" ").toLowerCase()); },
  renderList() {
    if (!this.el) return;
    const toks = this.q.toLowerCase().split(/\s+/).filter(Boolean);
    let items = Library.cards.filter((c) =>
      (!this.folder || c.dir === this.folder || c.dir.startsWith(this.folder + "/")) && (this.mode !== "fav" || c.fav));
    if (toks.length) items = items.filter((c) => toks.every((t) => this.hay(c).includes(t)));
    const label = (c) => (c.title || stem(c.name)).toLowerCase();
    if (toks.length) {
      const t0 = toks[0];
      const score = (c) => (label(c).startsWith(t0) || baseLower(c.name).startsWith(t0) ? 0 : label(c).includes(t0) ? 1 : 2);
      items.sort((a, b) => score(a) - score(b) || label(a).localeCompare(label(b)));
    } else if (this.mode === "recent") items.sort((a, b) => b.mtime - a.mtime);
    else items.sort((a, b) => a.dir.localeCompare(b.dir) || label(a).localeCompare(label(b)));
    this.io?.disconnect();
    this.shown = items.slice(0, 300);
    const list = this.listEl;
    list.textContent = "";
    if (!items.length) {
      list.append(el("div", "cl-none", Library.cards.length ? "Nothing matches." : "No LoRAs in models/loras yet — grab some in the Model Hub (Alt+M)."));
      return;
    }
    this.shown.forEach((c, k) => list.append(this.optEl(c, k)));
    if (items.length > this.shown.length) list.append(el("div", "cl-more", `${items.length - this.shown.length} more — refine the search`));
    this.setAct(clamp(this.act, 0, this.shown.length - 1), true);
  },
  optEl(c, k) {
    const o = el("div", "cl-opt");
    o.setAttribute("role", "option");
    const lazy = this.io ? { observe: (node, fn) => { node.__load = fn; this.io.observe(node); } } : null;
    const txt = el("div", "cl-opt-txt");
    txt.append(el("div", "cl-opt-t", c.title || stem(c.name)));
    txt.append(el("div", "cl-opt-f", [(c.dir ? c.dir + "/" : "") + c.file, fmtBytes(c.size), c.version].filter(Boolean).join(" · ")));
    const tags = el("div", "cl-opt-tags");
    if (c.base || c.arch) tags.append(tag(c.base || c.arch, "base"));
    if (c.strength != null) tags.append(tag("@" + fmt(c.strength), "", "Recommended strength"));
    (c.words || []).slice(0, 3).forEach((w) => tags.append(tag("✦ " + w, "tw")));
    if (tags.childNodes.length) txt.append(tags);
    o.append(thumbEl(c, c.name, lazy), txt);
    if (this.opts.current === c.name) o.append(el("span", "cl-in", "current"));
    else if (this.opts.inStack.has(c.name)) o.append(el("span", "cl-in", "✓ in stack"));
    o.addEventListener("pointermove", () => { if (this.act !== k) this.setAct(k, false); });
    o.addEventListener("click", (e) => this.pick(c, e.shiftKey || e.metaKey || e.ctrlKey));
    return o;
  },
  setAct(k, scroll) {
    const opts = this.listEl.querySelectorAll(".cl-opt");
    opts[this.act]?.classList.remove("act");
    this.act = k;
    const o = opts[k];
    if (o) { o.classList.add("act"); if (scroll) o.scrollIntoView({ block: "nearest" }); }
  },
  pick(c, keep) {
    if (!this.opts.onPick(c)) return;
    if (keep && this.opts.multi) {
      this.opts.inStack.add(c.name);
      const scroll = this.listEl.scrollTop;
      this.renderList();
      this.listEl.scrollTop = scroll;
      toast(`Added ${c.title || stem(c.name)}`);
    } else this.close();
  },
  onKey(e) {
    e.stopPropagation();
    const n = this.shown.length;
    if (e.key === "Escape") { e.preventDefault(); this.close(); }
    else if (e.key === "ArrowDown" && n) { e.preventDefault(); this.setAct((this.act + 1) % n, true); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); this.setAct((this.act - 1 + n) % n, true); }
    else if (e.key === "PageDown" && n) { e.preventDefault(); this.setAct(Math.min(n - 1, this.act + 8), true); }
    else if (e.key === "PageUp" && n) { e.preventDefault(); this.setAct(Math.max(0, this.act - 8), true); }
    else if (e.key === "Enter") { e.preventDefault(); const c = this.shown[this.act]; if (c) this.pick(c, e.shiftKey); }
  },
  close() {
    if (!this.el) return;
    document.removeEventListener("pointerdown", this.outside, true);
    this.io?.disconnect(); this.io = null;
    this.el.querySelectorAll("video").forEach((v) => { v.pause(); v.removeAttribute("src"); v.load(); });
    this.el.remove();
    this.el = null; this.opts = null;
  },
};

// -------------------------------------------------------------- info panel
let infoClose = null;
function openInfo(stack, row) {
  infoClose?.();
  injectCSS();
  const back = el("div", "cl-back cl-themed");
  back.dataset.theme = stack.theme;
  const m = el("div", "cl-modal");
  m.tabIndex = -1;
  back.append(m);
  document.body.append(back);
  let closed = false, lb = null, seq = 0;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    back.querySelectorAll("video").forEach((v) => v.pause());
    back.remove();
    if (infoClose === close) infoClose = null;
  };
  infoClose = close;
  const onKey = (e) => {
    if (!back.isConnected) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (lb) lb.close(); else close(); return; }
    if (lb && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); e.stopPropagation(); lb.step(e.key === "ArrowRight" ? 1 : -1); return; }
    if (back.contains(e.target) || e.target === document.body) e.stopPropagation();
  };
  document.addEventListener("keydown", onKey, true);
  back.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (e.target === back) close(); });
  m.focus();

  const card = () => Library.find(row.lora);
  const header = (data) => {
    const h = el("div", "cl-mhead");
    const c = card();
    h.append(thumbEl(c || (data && data.preview ? { name: data.name, preview: data.preview, pv: data.pv, title: data.title } : null), row.lora));
    const t = el("div", "cl-mhead-txt");
    t.append(el("div", "cl-mtitle", data?.title || c?.title || stem(row.lora)));
    const sub = el("div", "cl-msub");
    const civ = data?.civitai;
    const version = data?.version || c?.version;
    if (version) sub.append(tag(version));
    const base = data?.base || c?.base;
    if (base) sub.append(tag(base, "base"));
    if (civ?.type) sub.append(tag(civ.type));
    if (civ?.creator) sub.append(tag("by " + civ.creator));
    if (civ?.downloads) sub.append(tag("↓ " + fmtNum(civ.downloads)));
    if (civ?.likes) sub.append(tag("♥ " + fmtNum(civ.likes)));
    t.append(sub);
    const btns = el("div", "cl-row-btns");
    btns.append(iconBtn("refresh", "Re-check Civitai", false, () => load(true)), iconBtn("x", "Close (Esc)", false, close));
    h.append(t, btns);
    return h;
  };
  const section = (title, ...extra) => {
    const s = el("div", "cl-sec");
    const h = el("h4", "", title);
    if (extra.length) { h.append(el("span", "cl-sp"), ...extra); }
    s.append(h);
    return s;
  };
  const smallBtn = (label, title, fn, cls = "") => {
    const b = el("button", "cl-btn sm " + cls, label); b.type = "button"; b.title = title;
    b.addEventListener("click", fn);
    return b;
  };
  const kv = (pairs) => {
    const dl = el("dl", "cl-kv");
    for (const [k, v] of pairs) {
      if (v == null || v === "") continue;
      dl.append(el("dt", "", k));
      const dd = el("dd");
      if (v instanceof Node) dd.append(v); else dd.textContent = String(v);
      dl.append(dd);
    }
    return dl;
  };

  const render = (d) => {
    m.textContent = "";
    m.append(header(d));
    const body = el("div", "cl-mbody");
    const civ = d.civitai;

    // links + where the data came from
    const links = el("div", "cl-row-btns");
    if (civ?.links) {
      const order = civ.domain === "red" ? ["red", "com"] : ["com", "red"];
      order.forEach((dom, k) => {
        const url = civ.links[dom];
        if (!url) return;
        const a = el("a", "cl-btn" + (k ? "" : " acc"));
        a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
        a.append(icon("ext", 12), document.createTextNode(k ? "civitai." + dom : "Open on civitai." + dom));
        links.append(a);
      });
    }
    if (d.sha256) links.append(smallBtn("sha256 " + d.sha256.slice(0, 10) + "…", "Copy the full SHA-256", () => copyText(d.sha256, "SHA-256 copied")));
    if (d.strength != null) {
      links.append(smallBtn(`Use recommended ${fmt(d.strength)}`, "Set this row's strength to the creator's recommendation", () => {
        row.str = d.strength; stack.commit(); toast(`Strength set to ${fmt(d.strength)}`);
      }, "acc"));
    }
    if (links.childNodes.length) body.append(links);
    if (d.civitaiError) {
      body.append(el("div", civ ? "cl-hint" : "cl-warnline",
        civ ? `Live Civitai check failed (${d.civitaiError}) — showing saved data.` : `Civitai: ${d.civitaiError}.`));
    }

    // trigger words
    const words = d.words || [];
    const sel = () => new Set(row.words.map((w) => w.toLowerCase()));
    const ws = section("Trigger words",
      smallBtn("Use all", "Send every word to trigger_words", () => { row.words = words.filter((w) => w.src !== "meta").map((w) => w.word).slice(0, 64); if (!row.words.length) row.words = words.map((w) => w.word).slice(0, 64); stack.commit(); paintWords(); }),
      smallBtn("None", "Send nothing", () => { row.words = []; stack.commit(); paintWords(); }),
      smallBtn("Copy", "Copy the picked words", () => copyText(row.words.join(", ") || words.map((w) => w.word).join(", "), "Words copied")));
    const wrap = el("div", "cl-words");
    const paintWords = () => {
      wrap.textContent = "";
      const s = sel();
      if (!words.length) { wrap.append(el("div", "cl-hint", "No trigger words known for this LoRA.")); return; }
      for (const w of words) {
        const b = el("button", "cl-word" + (w.src === "meta" ? "" : " strong") + (s.has(w.word.toLowerCase()) ? " sel" : ""), w.word);
        b.type = "button";
        b.title = (w.src === "civitai" ? "Civitai trigger word" : w.src === "a1111" ? "Activation text" : `From the training captions${w.count ? ` (${w.count}×)` : ""}`) + " — click to toggle";
        if (w.src === "meta" && w.count) b.append(el("small", "", String(w.count)));
        b.addEventListener("click", () => {
          const key = w.word.toLowerCase();
          if (sel().has(key)) row.words = row.words.filter((x) => x.toLowerCase() !== key);
          else row.words = [...row.words, w.word].slice(0, 64);
          stack.commit(); paintWords();
        });
        wrap.append(b);
      }
    };
    paintWords();
    ws.append(wrap, el("div", "cl-hint", "Highlighted words go out on the node's trigger_words output (only while this LoRA is on)."));
    body.append(ws);

    // examples
    const imgs = (civ?.images || []).filter((im) => im.url);
    if (imgs.length) {
      const gs = section(`Examples · ${imgs.length}`);
      const g = el("div", "cl-gal");
      imgs.forEach((im, k) => {
        const b = el("button", "cl-gi"); b.type = "button";
        const img = new Image(); img.loading = "lazy"; img.decoding = "async"; img.alt = "";
        img.src = im.type === "video" ? cvPoster(im.url, 320) : cvImg(im.url, 320);
        img.onerror = () => { if (!img.dataset.fb) { img.dataset.fb = "1"; img.src = im.url; } };
        b.append(img);
        if (im.type === "video") { const p = el("span", "pl"); p.append(icon("play", 11)); b.append(p); }
        b.addEventListener("click", () => { lb = openLightbox(imgs, k, () => { lb = null; }); });
        g.append(b);
      });
      gs.append(g);
      body.append(gs);
    }

    // file facts
    const sm = d.summary || {};
    const tr = sm.train || {};
    const shaNode = d.sha256 ? el("span", "cl-mono", d.sha256) : null;
    const src = { "LoRA Manager": "LoRA Manager sidecar", "Civitai Helper": "Civitai Helper sidecar", cache: "cached", hashed: "hashed just now" }[d.shaSource] || d.shaSource;
    const fs = section("File");
    fs.append(kv([
      ["Path", (d.dir ? d.dir + "/" : "") + d.file],
      ["Size", fmtBytes(d.size)],
      ["Type", [sm.algo, sm.rank ? `rank ${sm.rank}${sm.rankMixed ? " (mixed)" : ""}` : "", sm.dtype].filter(Boolean).join(" · ")],
      ["Layers", sm.layers ? `${sm.layers}${sm.audioLayers ? ` (${sm.audioLayers} audio — use A×)` : ""}` : ""],
      ["Trained for", sm.arch],
      ["Training", [tr.steps && `${tr.steps} steps`, tr.epochs && `${tr.epochs} epochs`, tr.dim && `dim ${tr.dim}`, tr.alpha && `alpha ${tr.alpha}`, tr.resolution && `res ${tr.resolution}`, tr.software].filter(Boolean).join(" · ")],
      ["SHA-256", shaNode],
      ["Data from", [src && `hash: ${src}`, d.civitaiSource && `Civitai: ${d.civitaiSource}`].filter(Boolean).join(" · ")],
    ]));
    body.append(fs);

    if (civ?.description) {
      const ds = section("About");
      const p = el("div", "cl-desc", civ.description);
      ds.append(p);
      if (civ.description.length > 380) {
        const more = smallBtn("Show more", "", () => { p.classList.toggle("open"); more.textContent = p.classList.contains("open") ? "Show less" : "Show more"; });
        ds.append(more);
      }
      body.append(ds);
    }
    if (d.notes) { const ns = section("Notes"); ns.append(el("div", "cl-desc open", d.notes)); body.append(ns); }
    m.append(body);
  };

  const load = async (refresh) => {
    const my = ++seq;
    m.textContent = "";
    m.append(header(null));
    const body = el("div", "cl-mbody");
    const msg = el("div", "cl-hint", refresh ? "Checking Civitai…" : "Reading the file… (big LoRAs are hashed once, then cached)");
    body.append(msg, el("div", "cl-skel"), el("div", "cl-skel"));
    m.append(body);
    try {
      const d = await call(`/cryps_lora/info?name=${encodeURIComponent(row.lora)}${refresh ? "&refresh=1" : ""}`);
      if (closed || my !== seq) return;
      render(d);
    } catch (err) {
      if (closed || my !== seq) return;
      msg.textContent = "Couldn't load info: " + err.message;
      msg.className = "cl-warnline";
      body.querySelectorAll(".cl-skel").forEach((s) => s.remove());
    }
  };
  load(false);
}

function openLightbox(items, start, onClose) {
  let k = start;
  const box = el("div", "cl-lb");
  const stage = el("div");
  const side = el("aside");
  box.append(stage, side);
  const closeBtn = iconBtn("x", "Close (Esc)", false, () => api_.close());
  closeBtn.style.cssText = "top:16px;right:16px";
  const prev = iconBtn("left", "Previous (←)", false, () => api_.step(-1));
  prev.style.cssText = "left:16px;top:50%";
  const next = iconBtn("right", "Next (→)", false, () => api_.step(1));
  next.style.cssText = "right:16px;top:50%";
  box.append(closeBtn, prev, next);
  box.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (e.target === box) api_.close(); });
  document.body.append(box);
  const paint = () => {
    const im = items[k];
    stage.querySelectorAll("video").forEach((v) => v.pause());
    stage.textContent = "";
    let media;
    if (im.type === "video") {
      media = document.createElement("video");
      media.src = cvVid(im.url, 1080); media.controls = true; media.autoplay = true; media.loop = true; media.muted = true; media.playsInline = true;
    } else {
      media = new Image(); media.src = cvImg(im.url, 1400); media.alt = "";
      media.onerror = () => { if (!media.dataset.fb) { media.dataset.fb = "1"; media.src = im.url; } };
    }
    media.className = "cl-lb-media";
    stage.append(media);
    side.textContent = "";
    side.append(el("div", "cl-mono", `${k + 1} / ${items.length}`));
    if (im.prompt) {
      side.append(el("p", "", im.prompt));
      const b = el("button", "cl-btn sm", "Copy prompt"); b.type = "button";
      b.addEventListener("click", () => copyText(im.prompt, "Prompt copied"));
      side.append(b);
    }
    if (im.negative) side.append(el("p", "cl-mono", "Negative: " + im.negative));
    const facts = [im.seed != null && `seed ${im.seed}`, im.steps && `${im.steps} steps`, im.cfg && `cfg ${im.cfg}`, im.sampler, im.model].filter(Boolean).join(" · ");
    if (facts) side.append(el("p", "cl-mono", facts));
    if (!im.prompt && !facts) side.append(el("p", "cl-mono", "No generation data on this example."));
  };
  const api_ = {
    step(d) { k = (k + d + items.length) % items.length; paint(); },
    close() { stage.querySelectorAll("video").forEach((v) => v.pause()); box.remove(); onClose?.(); },
  };
  paint();
  return api_;
}

// ------------------------------------------------------------ registration
function hideWidget(w) {
  w.hidden = true;
  w.options = w.options || {};
  w.options.hidden = true;
  w.computeSize = () => [0, -4];
}

function setup(node) {
  const sw = node.widgets?.find((w) => w.name === STACK);
  if (!sw || node.__clui) return;
  injectCSS();
  hideWidget(sw);
  const prefs = loadPrefs();
  node.properties = node.properties || {};
  if (node.properties.cl_theme === undefined && THEMES.includes(prefs.theme)) node.properties.cl_theme = prefs.theme;
  if (node.properties.cl_density === undefined && prefs.dens) node.properties.cl_density = prefs.dens;
  const ui = new LoraStack(node, sw);
  const w = node.addDOMWidget("lora_stack_ui", "cryps_lora_stack", ui.root, {
    serialize: false,
    margin: 6,
    getMinHeight: () => ui.minHeight(),
    getMaxHeight: () => ui.minHeight(),
  });
  w.serialize = false;
  node.__clui = ui;
  if (node.size[0] < 500) node.size[0] = 500;
  ui.fit();
}

app.registerExtension({
  name: "crypswolf69.AdvancedLoraLoader",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = created?.apply(this, arguments);
      try { setup(this); } catch (e) { console.error("[✦ LoRA] UI setup failed", e); }
      return r;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = configure?.apply(this, arguments);
      this.__clui?.load();
      return r;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (msg) {
      const r = executed?.apply(this, arguments);
      this.__clui?.setReport(msg?.cryps_lora);
      return r;
    };
    const conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = conn?.apply(this, arguments);
      if (this.__clui) this.__clui.render();
      return r;
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this.__clui?.destroy();
      return removed?.apply(this, arguments);
    };
  },
});
