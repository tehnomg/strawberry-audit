// serve/web/app.js - the Strata web app: Chat, Monitor, About. No framework, no network beyond this server.
// The Monitor tab rebuilds PR #22's dashboard idea (code-martin) on the server's own /metrics.
"use strict";

const $ = (id) => document.getElementById(id);
const SPRITE = "web/sprite.svg";
const icon = (name, cls = "st-icon") => `<svg class="${cls}" aria-hidden="true"><use href="${SPRITE}#i-${name}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? "–" : Number(n).toLocaleString(undefined, {maximumFractionDigits: d, minimumFractionDigits: d}));
const kfmt = (n) => (n == null ? "–" : n >= 1000 ? `${fmt(n / 1000, n >= 10000 ? 0 : 1)}k` : fmt(n));
// a context size: 32768 -> "32K" (powers of two), else like kfmt
const ctxfmt = (n) => (n && n % 1024 === 0 ? `${fmt(n / 1024)}K` : kfmt(n));
const gb = (b, d = 1) => (b == null ? "–" : fmt(b / 1073741824, d));   // memory: binary GB, as Windows shows it

const store = {
  get(k, d) { try { const v = localStorage.getItem("strata." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("strata." + k, JSON.stringify(v)); } catch (e) { /* private mode: in memory only */ } },
};

// ------------------------------------------------------------------ toasts
function toast(kind, title, text = "", ms = 3500, action = null) {
  const names = {info: "info", success: "check", warn: "warning", error: "error"};
  const el = document.createElement("div");
  el.className = `st-toast st-toast--${kind}`;
  el.innerHTML = `${icon(names[kind] || "info")}<div><div class="st-toast__title"></div><div class="t-text"></div></div>`;
  el.querySelector(".st-toast__title").textContent = title;
  el.querySelector(".t-text").textContent = text;
  if (action) {
    const b = document.createElement("button");
    b.className = "st-btn st-btn--secondary";
    b.style.height = "32px";
    b.style.marginLeft = "auto";
    b.textContent = action.label;
    b.onclick = () => { action.run(); el.remove(); };
    el.appendChild(b);
  }
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {                                   // http on another host: no async clipboard
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (btn) {
    const use = btn.querySelector("use");
    use.setAttribute("href", `${SPRITE}#i-check`);
    setTimeout(() => use.setAttribute("href", `${SPRITE}#i-copy`), 1500);
  }
  toast("success", "Copied to clipboard", "", 1800);
}

// ------------------------------------------------------------------ theme and tabs
// the system's theme until the user picks one (only a click is saved)
function setTheme(t, save) {
  document.documentElement.dataset.theme = t;
  if (save) try { localStorage.setItem("strata.theme", t); } catch (e) { /* ignore */ }
  $("theme-icon").setAttribute("href", `${SPRITE}#i-${t === "dark" ? "sun" : "moon"}`);
  $("dark-toggle").setAttribute("aria-checked", String(t === "dark"));
}
const flipTheme = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
$("theme-btn").onclick = flipTheme;
$("dark-toggle").onclick = flipTheme;
setTheme(document.documentElement.dataset.theme || "light", false);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  let saved = null;
  try { saved = localStorage.getItem("strata.theme"); } catch (err) { /* ignore */ }
  if (!saved) setTheme(e.matches ? "dark" : "light", false);
});

let tab = "chat";
function showTab(name) {
  tab = ["chat", "monitor", "about"].includes(name) ? name : "chat";
  for (const b of document.querySelectorAll(".st-tab")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  for (const v of ["chat", "monitor", "about"]) $(`view-${v}`).hidden = v !== tab;
  if (location.hash.slice(1) !== tab) history.replaceState(null, "", tab === "chat" ? location.pathname : `#${tab}`);
  if (tab === "chat") $("input").focus();
  if (tab === "monitor") loadMcp();
  if (tab === "monitor" && !isStrata()) checkMonitorStatus();
  if (tab === "about") loadConfig();
  if (lastMetrics) render(lastMetrics);
}
for (const b of document.querySelectorAll(".st-tab")) b.onclick = () => showTab(b.dataset.tab);
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

// ------------------------------------------------------------------ server access
function headers(json = false) {
  const h = {};
  const key = store.get("apikey", "");
  if (key) h.Authorization = "Bearer " + key;
  if (json) h["Content-Type"] = "application/json";
  return h;
}
$("api-key").value = store.get("apikey", "");
$("api-key").onchange = () => { store.set("apikey", $("api-key").value.trim()); toast("success", "API key saved", "Kept in this browser only."); };

let health = {model: "strata", images: false, max_context: 0};

async function loadHealth() {
  if (!isStrata()) {
    window.health = health;
    updateAttachBtnTitle();
    return;
  }
  try {
    health = await (await fetch("health")).json();
    window.health = health;
    updateAttachBtnTitle();
    $("chat-empty-sub").textContent = `${health.model} runs on this PC. Nothing leaves it.`;
  } catch (e) {
    setTimeout(loadHealth, 2000);
  }
}

// ------------------------------------------------------------------ Monitor
const METRICS = [
  {key: "speed", label: "Speed", icon: "gauge", unit: "t/s", series: "tok_s"},
  {key: "gpu", label: "GPU load", icon: "gpu", unit: "%", series: "gpu_util", max: 100},
  {key: "vram", label: "VRAM", icon: "layers", unit: "GB", series: "gpu_mem_used"},
  {key: "temp", label: "GPU temp", icon: "thermometer", unit: "°C", series: "gpu_temp", tone: "warn"},
  {key: "power", label: "Power", icon: "bolt", unit: "W", series: "gpu_power"},
  {key: "pcie", label: "PCIe", icon: "link", unit: "", series: "gpu_pcie_rx_mb", tone: "info"},
  {key: "cpu", label: "CPU", icon: "cpu", unit: "%", series: "cpu", max: 100},
  {key: "disk", label: "Disk read", icon: "disk", unit: "MB/s", series: "disk_read_mb", tone: "info"},
];
$("metrics").innerHTML = METRICS.map((m) => `
  <div class="st-card metric-card"><div class="st-metric">
    <span class="st-metric__label">${icon(m.icon, "st-icon st-icon--sm")}${esc(m.label)}</span>
    ${m.key === "speed" ? `<div class="speed-values">
      <div><span class="st-metric__value" id="mv-speed">-</span><span class="st-metric__sub" id="ms-speed">Decode</span></div>
      <div class="speed-prefill"><span class="st-metric__value" id="mv-prefill">-</span><span class="st-metric__sub" id="ms-prefill">Prefill</span></div>
    </div>` : `<span class="st-metric__value" id="mv-${m.key}">–</span>
    <span class="st-metric__sub" id="ms-${m.key}"></span>`}
    <svg class="st-metric__spark" id="sp-${m.key}" viewBox="0 0 100 32" preserveAspectRatio="none"${m.tone ? ` data-tone="${m.tone}"` : ""}>
      <path class="area" fill="currentColor" opacity=".12"/><path class="line" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      ${m.key === "speed" ? `<g id="sp-prefill" class="speed-prefill"><path class="area" fill="currentColor" opacity=".12"/>
        <path class="line" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"
        stroke-linecap="round" vector-effect="non-scaling-stroke"/></g>` : ""}</svg>
  </div></div>`).join("");

function spark(id, values, max) {
  const svg = $(id);
  const v = (values || []).map((x) => (x == null ? 0 : x));
  if (v.length < 2) { svg.querySelector(".line").setAttribute("d", ""); svg.querySelector(".area").setAttribute("d", ""); return; }
  const top = Math.max(max || 0, ...v, 1e-9);
  const pts = v.map((x, i) => [(i / (v.length - 1)) * 100, 30 - (x / top) * 26]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("");
  svg.querySelector(".line").setAttribute("d", line);
  svg.querySelector(".area").setAttribute("d", `${line}L100,32L0,32Z`);
}
function setMetric(key, value, unit, sub) {
  $(`mv-${key}`).innerHTML = value == null ? "–" : `${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ""}`;
  $(`ms-${key}`).textContent = sub || "";
}

let lastMetrics = null, metricsFailures = 0, keyWarned = false, mcpTick = 0;
let reqShowAll = false;   // the Monitor's request table: the last 12, or every one the server keeps (issue #35)

async function poll() {
  if (!isStrata()) {
    // Если детектор уже понял, что сервер офлайн, poll не должен трогать статус
    if (lastDetected && lastDetected.status === "error") {
        setTimeout(poll, 5000);
        return;
    }

    if (tab === "monitor" && Date.now() - (__monitorStatus.lastCheck || 0) > 5000) {
      checkMonitorStatus();
    }
    setTimeout(poll, 5000);
    return;
  }

  try {
    const r = await fetch(reqShowAll ? "metrics?requests=all" : "metrics", {headers: headers()});
    if (r.status === 401) {
      setPill("error", "API key needed");
      if (!keyWarned) { keyWarned = true; toast("warn", "API key needed", "This server needs a key: add it under About > Settings.", 6000); }
    } else if (r.ok) {
      lastMetrics = await r.json();
      metricsFailures = 0;
      render(lastMetrics);
    } else {
      throw new Error(`HTTP ${r.status}`);
    }
  } catch (e) {
    if (++metricsFailures === 3) setPill("error", "Server not reachable");
  }
  if (tab === "monitor" && ++mcpTick % 10 === 0) loadMcp();
  const delay = metricsFailures > 0 ? Math.min(1000 * Math.pow(2, metricsFailures), 30000) : 1000;
  setTimeout(poll, delay);
}

function setPill(state, text) {
  $("pill").dataset.state = state === "error" ? "queued" : state;
  $("pill-text").textContent = text;
}

function render(m) {
  if (!m) return;
  if (tab === "monitor" && !isStrata()) { renderMonitorPlaceholder(); return; }
  const live = m.live || {}, hw = m.hardware || {}, st = m.hardware_static || {}, eng = m.engine || {}, h = m.history || {};
  const last = (m.requests || [])[0];
  // the header pill
  if (live.state === "reading") {
    const pct = live.prompt_total ? Math.round((100 * live.prompt_read) / live.prompt_total) : null;
    setPill("reading", pct != null ? `Reading prompt · ${pct}%` : "Reading prompt");
  } else if (live.state === "generating") {
    setPill("generating", `Generating · ${fmt(live.tok_s, 1)} tok/s`);
  } else {
    const modelName = health.model || m.engine?.model;
    setPill("idle", modelName ? `Idle · ${modelName}` : "Idle");
  }
  if (live.queued > 0) setPill("queued", `${live.queued} queued`);
  if (tab === "monitor") renderMonitor(live, hw, st, eng, h, last, m.requests || [], m.totals, m.requests_kept);
  if (tab === "monitor") renderConvCache(m.conversation_cache);
  if (tab === "about") renderAbout(eng, hw, st);
}

let __monitorStatus = { state: "unknown", count: 0, lastCheck: 0, error: null };

let lastDetected = null;
let lastMismatchProvider = null;

async function runBackendCheck() {
  if (!window.BackendDetector) {
    setPill("error", "Detector missing");
    return; 
  }
  
  const currentProv = getP().id;
  const currentBaseUrl = providerSettings.base_url || getP().defaultBaseUrl || "";
  const input = $("input");
  const sendBtn = $("send-btn");

  // 1. ЗАЩИТА ТЕРРИТОРИИ (Восстановление прошлой сессии)
  // Проверяем ТОЛЬКО того провайдера, которого мы сохранили в localStorage.
  
  if (currentProv === "strata") {
    try {
      const h = await fetch("health", {signal: AbortSignal.timeout(2000)});
      if (h.ok) {
         const healthData = await h.json();
         window.health = healthData;
         if (input) { input.disabled = false; input.placeholder = "Ask anything…"; }
         if (sendBtn) sendBtn.disabled = false;
         setPill("idle", `strata · ${healthData.model || "native"}`);
         return; // Strata жива, всё отлично. Игнорируем чужаков.
      }
    } catch (e) { /* Strata умерла, идём искать */ }
  } 
  else if (currentProv === "lmstudio" || currentProv === "llamacpp") {
    try {
       const r = await fetch(`/api/proxy/v1/models?base=${encodeURIComponent(currentBaseUrl)}`, {signal: AbortSignal.timeout(2000)});
       if (r.ok) {
           if (input) { input.disabled = false; input.placeholder = "Ask anything…"; }
           if (sendBtn) sendBtn.disabled = false;
           setPill("idle", `${getP().label} · ${providerSettings.model_id || "unknown"}`);
           
           // Если это LM Studio и модель не выбрана — автоматически открываем About для JIT-загрузки!
           if (currentProv === "lmstudio" && !providerSettings.model_id && tab !== "about") {
               showTab("about");
               toast("warn", "Выберите модель", "Модель не выбрана. Нажмите Refresh в настройках LM Studio.", 6000);
           }
           return; // Текущий внешний сервер жив, не трогаем его.
       }
    } catch (e) { /* Внешний сервер умер, идём искать */ }
  }

  // 2. ЕСЛИ СТАРЫЙ СЕРВЕР УМЕР — ИЩЕМ НОВЫХ
  const res = await window.BackendDetector.detect(currentBaseUrl);
  
  if (res.status === "error") {
    if (input) { input.disabled = true; input.placeholder = "📖 Режим чтения (сервер офлайн)"; }
    if (sendBtn) sendBtn.disabled = true;
    setPill("queued", "Read-only (offline)"); 
    return;
  }

  if (input) { input.disabled = false; input.placeholder = "Ask anything…"; }
  if (sendBtn) sendBtn.disabled = false;

  // Если провайдер реально сменился — сбрасываем старую модель, чтобы не было Франкенштейна
  if (res.provider !== currentProv) {
     providerSettings.model_id = "";
     store.set("model_id", "");
     if ($("prov-model")) $("prov-model").value = "";

     store.set("provider", res.provider);
     providerSettings.provider = res.provider;
     if ($("prov-select")) $("prov-select").value = res.provider;

     if (res.detectedUrl) {
        providerSettings.base_url = res.detectedUrl;
        store.set("base_url", res.detectedUrl);
        if ($("prov-base")) $("prov-base").value = res.detectedUrl;
     }
     
     if (res.provider === "strata") {
        loadHealth();
        toast("success", "Переключено на Strata", "Модель подхвачена автоматически.");
     } else if (res.provider === "llamacpp") {
        toast("success", "Переключено на llama.cpp", "Загружаем список моделей...");
        if ($("prov-refresh")) setTimeout(() => $("prov-refresh").click(), 500);
     } else if (res.provider === "lmstudio") {
        if (tab !== "about") showTab("about");
        toast("warn", "LM Studio подключен", "Выберите модель в настройках.", 8000);
        if ($("prov-refresh")) setTimeout(() => $("prov-refresh").click(), 300);
     }
  }
}

async function checkMonitorStatus() {
  const p = getP();
  if (p.id === "strata") return;
  const base = providerSettings.base_url || store.get("base_url", "") || p.defaultBaseUrl;
  try {
    const r = await fetch(`/api/proxy/v1/models?base=${encodeURIComponent(base)}`,
                          {signal: AbortSignal.timeout(5000)});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const list = Array.isArray(j.data) ? j.data : (Array.isArray(j.models) ? j.models : []);
    __monitorStatus = { state: "connected", count: list.length, lastCheck: Date.now(), error: null };
  } catch (e) {
    __monitorStatus = { state: "disconnected", count: 0, lastCheck: Date.now(), error: String(e.message || e) };
  }
  if (tab === "monitor" && !isStrata()) renderMonitorPlaceholder();
}

function renderMonitorPlaceholder() {
  const p = getP();
  const providerLabel = p.label;
  const modelId = store.get("model_id", "") || "(no model selected)";
  const base = providerSettings.base_url || store.get("base_url", "") || p.defaultBaseUrl || "(default)";
  const st = __monitorStatus || { state: "unknown", count: 0, error: null };

  const stateLabel = st.state === "connected" ? "Connected"
                   : st.state === "disconnected" ? "Disconnected"
                   : "Checking…";
  const stateClass = st.state === "connected" ? "st-badge--generating"
                   : st.state === "disconnected" ? "st-badge--error"
                   : "st-badge--reading";
  const lastCheck = st.lastCheck ? new Date(st.lastCheck).toLocaleTimeString() : "—";

  $("metrics").innerHTML =
    `<div class="st-card" style="grid-column:1/-1;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span class="card-title">Provider status</span>
        <button class="st-btn st-btn--secondary" id="monitor-refresh" type="button">Refresh</button>
      </div>
      <dl class="facts">
        <dt>Provider</dt><dd>${esc(providerLabel)}</dd>
        <dt>Base URL</dt><dd><code>${esc(base)}</code></dd>
        <dt>Model</dt><dd>${esc(modelId)}</dd>
        <dt>Status</dt><dd><span class="st-badge ${stateClass}">${esc(stateLabel)}</span></dd>
        <dt>Models found</dt><dd>${st.count}</dd>
        <dt>Last check</dt><dd>${lastCheck}</dd>
      </dl>
      ${st.error ? `<p class="msg-error">${esc(st.error)}</p>` : ""}
      <p class="muted small">Live metrics are available only with Strata. This panel shows connection status for the current external provider.</p>
    </div>`;

  $("state-label").textContent = "—";
  $("state-detail").textContent = "";
  $("state-bar").style.width = "0%";
  $("req-body").innerHTML = `<tr><td colspan="8" class="muted">—</td></tr>`;
  $("req-totals").textContent = "";
  $("cc-card").hidden = true;
  $("mcp-card").hidden = true;

  const rb = document.getElementById("monitor-refresh");
  if (rb) rb.onclick = () => {
    __monitorStatus = { state: "unknown", count: 0, lastCheck: 0, error: null };
    renderMonitorPlaceholder();
    checkMonitorStatus();
  };
}

// #596: the conversation cache - the prompt's state the engine keeps between requests (always), and the whole
// conversations it parks in RAM when "--conversation-cache-mib N" is in the run config's args (opt-in)
function since(t) {
  if (!t) return "";
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 60 ? "just now" : s < 3600 ? `${fmt(s / 60)} min ago` : `${fmt(s / 3600, 1)} h ago`;
}
function renderConvCache(c) {
  $("cc-card").hidden = !c;
  if (!c) return;                                  // an older server
  const pct = (a, b) => (b ? `${Math.min(100, (100 * a) / b)}%` : "0%");
  $("cc-bars").hidden = !c.enabled;
  if (c.enabled) {
    $("cc-slots-text").textContent = `${fmt(c.parked)} / ${fmt(c.slots)}`;
    $("cc-slots-bar").style.width = pct(c.parked, c.slots);
    const budget = c.budget_mib * 1048576;
    $("cc-mem-text").textContent = `${gb(c.bytes)} / ${gb(budget)} GB`;
    $("cc-mem-bar").style.width = pct(c.bytes, budget);
  }
  $("cc-sum").textContent = c.requests ? `${fmt(c.requests_reused)} of ${fmt(c.requests)} requests reused part of their prompt` : "";
  const share = c.prompt_tokens ? ` (${fmt((100 * c.reused_tokens) / c.prompt_tokens)}% of all prompt tokens)` : "";
  const event = c.last_event ? `${c.last_event === "parked" ? "Parked" : "Restored"} ${fmt(c.last_tokens)} tokens, ${since(c.last_at)}` : null;
  facts($("cc-facts"), [
    ["Last request", c.last_prompt != null ? `${fmt(c.last_reused || 0)} of ${fmt(c.last_prompt)} prompt tokens reused` : null],
    ["Reused since start", c.requests ? `${fmt(c.reused_tokens)} tokens${share}` : null],
    ["Parked / restored", c.enabled ? `${fmt(c.parks)} / ${fmt(c.restores)}${c.evictions ? ` · ${fmt(c.evictions)} evicted` : ""}` : null],
    ["Last switch", c.enabled ? event : null],
  ]);
  $("cc-note").textContent = c.enabled
    ? "A request that continues a parked conversation gets its state back instead of reading it again; the oldest goes when the slots or the memory are full."
    : "The engine keeps the last conversation's state, so a follow-up reads only what is new. To keep several conversations (agents taking turns), add \"--conversation-cache-mib\", \"8192\" to the run config's args (docs/DETAILS.md).";
}

function renderTotals(t) {
  if (!t || !t.requests) return "";
  const since = new Date(t.since * 1000).toLocaleString([], {weekday: "short", hour: "2-digit", minute: "2-digit"});
  const read = t.prompt_tokens - t.reused;
  const pSpeed = t.prompt_ms > 0 && read > 0 ? ` at ${fmt(read / (t.prompt_ms / 1000))} tok/s` : "";
  const oSpeed = t.decode_ms > 0 && t.output_tokens > 0 ? ` at ${fmt(t.output_tokens / (t.decode_ms / 1000), 1)} tok/s` : "";
  return `Since ${since}: ${fmt(t.requests)} requests · ${fmt(read)} prompt tokens read${pSpeed} (${fmt(t.reused)} reused) · ` +
         `${fmt(t.output_tokens)} written${oSpeed}`;
}
function renderMonitor(live, hw, st, eng, h, last, requests, totals, kept) {
  // model state
  const on = live.queued > 0 ? "queued" : live.state;
  for (const b of document.querySelectorAll("#state-badges .st-badge")) b.classList.toggle("on", b.dataset.s === on || b.dataset.s === live.state);
  const prog = $("state-progress");
  let label = "Waiting for a request", detail = "", pct = 0;
  if (live.state === "reading") {
    label = "Reading prompt";
    prog.dataset.tone = "info";
    if (live.prompt_total) {
      pct = (100 * live.prompt_read) / live.prompt_total;
      detail = `${fmt(live.prompt_read)} / ${fmt(live.prompt_total)} tokens · ${fmt(pct)}%`;
    } else {
      detail = `${fmt(live.prompt_tokens)} tokens`;
    }
  } else if (live.state === "generating") {
    label = live.phase ? live.phase[0].toUpperCase() + live.phase.slice(1) : "Generating";
    delete prog.dataset.tone;
    pct = live.max_tokens ? Math.min(100, (100 * live.generated) / live.max_tokens) : 0;
    detail = `${fmt(live.generated)} tokens · ${fmt(live.tok_s, 1)} tok/s`;
  } else if (last) {
    delete prog.dataset.tone;
    detail = `last: ${fmt(last.output_tokens)} tokens${last.decode_tok_s ? ` at ${fmt(last.decode_tok_s, 1)} tok/s` : ""}`;
  }
  $("state-label").textContent = label;
  $("state-detail").textContent = detail;
  $("state-bar").style.width = `${pct}%`;

  // the eight cards
  const speed = live.state === "generating" ? live.tok_s : last ? last.decode_tok_s : null;
  setMetric("speed", speed == null ? null : fmt(speed, 1), "t/s",
            live.state === "generating" ? "Decode now" : last ? "Decode last request" : "Decode");
  const prefill = live.state !== "idle" ? live.prefill_tok_s_mean
                : last && last.prompt_ms > 0 ? Math.max(0, last.prompt_tokens - (last.reused || 0)) / (last.prompt_ms / 1000) : null;
  setMetric("prefill", prefill == null ? null : fmt(prefill), "t/s",
            live.state === "reading" ? "Prefill now" : live.state === "generating" ? "Prefill this request" : last ? "Prefill last request" : "Prefill");
  spark("sp-speed", h.tok_s);
  spark("sp-prefill", h.prefill_tok_s_mean);
  // a model split across several cards (issue #112): the cards show their total / mean / hottest, and each card's own
  const per = (f) => (hw.gpus || []).map((g) => `GPU ${g.index} ${f(g)}`).join(" · ");
  const multi = (hw.gpus || []).length > 1;
  setMetric("gpu", hw.gpu_util == null ? null : fmt(hw.gpu_util), "%",
            multi ? per((g) => (g.util == null ? "–" : `${fmt(g.util)}%`)) : st.gpu_name || (st.gpu_note ? "not available" : ""));
  spark("sp-gpu", h.gpu_util, 100);
  setMetric("vram", hw.gpu_mem_used == null ? null : gb(hw.gpu_mem_used), hw.gpu_mem_total ? `/ ${gb(hw.gpu_mem_total, 0)} GB` : "GB",
            multi ? per((g) => (g.mem_used == null ? "–" : `${gb(g.mem_used)} GB`))
                  : eng.expert_slots ? `${fmt(eng.expert_slots)} experts cached` : (st.gpu_note ? "not available on Windows AMD yet" : ""));
  spark("sp-vram", h.gpu_mem_used, hw.gpu_mem_total);
  setMetric("temp", hw.gpu_temp == null ? null : fmt(hw.gpu_temp), "°C",
            multi ? per((g) => (g.temp == null ? "–" : `${fmt(g.temp)}°`)) : "");
  spark("sp-temp", h.gpu_temp, 90);
  setMetric("power", hw.gpu_power == null ? null : fmt(hw.gpu_power), "W", hw.gpu_power_limit ? `of ${fmt(hw.gpu_power_limit)} W limit` : "");
  spark("sp-power", h.gpu_power, hw.gpu_power_limit);
  const gen = hw.gpu_pcie_gen_max || hw.gpu_pcie_gen;
  setMetric("pcie", gen ? `Gen${gen}` : null, hw.gpu_pcie_width ? `x${hw.gpu_pcie_width}` : "",
            hw.gpu_pcie_rx_mb == null ? "" : `to GPU ${fmt(hw.gpu_pcie_rx_mb, hw.gpu_pcie_rx_mb < 10 ? 1 : 0)} MB/s` +
            (hw.gpu_pcie_gen && gen && hw.gpu_pcie_gen < gen ? ` · idle Gen${hw.gpu_pcie_gen}` : ""));
  spark("sp-pcie", h.gpu_pcie_rx_mb);
  setMetric("cpu", hw.cpu == null ? null : fmt(hw.cpu), "%", st.threads ? `${st.cores ? `${st.cores} cores · ` : ""}${st.threads} threads` : "");
  spark("sp-cpu", h.cpu, 100);
  if (hw.disk_read_mb == null) {
    setMetric("disk", null, "", st.psutil ? "" : "needs psutil (setup installs it)");
  } else {
    const big = hw.disk_read_mb >= 1000;
    setMetric("disk", big ? fmt(hw.disk_read_mb / 1024, 2) : fmt(hw.disk_read_mb, hw.disk_read_mb < 10 ? 1 : 0), big ? "GB/s" : "MB/s",
              hw.disk_write_mb == null ? "" : `write ${fmt(hw.disk_write_mb, 1)} MB/s`);
  }
  spark("sp-disk", h.disk_read_mb);

  // context fill: the running request, else the last one
  const ctx = eng.max_context || 0;
  let used = 0;
  if (live.state !== "idle") used = (live.prompt_tokens || 0) + (live.generated || 0);
  else if (last) used = (last.prompt_tokens || 0) + (last.output_tokens || 0);
  const frac = ctx ? Math.min(1, used / ctx) : 0;
  $("ctx-fill").setAttribute("stroke-dasharray", `${(235.6 * frac).toFixed(1)} 314.2`);
  $("ctx-fill").style.opacity = 235.6 * frac >= 3 ? "1" : "0";         // a near-zero arc would draw just its round cap
  $("ctx-pct").textContent = `${Math.round(frac * 100)}%`;
  $("ctx-sub").textContent = ctx ? `${kfmt(used)} / ${ctxfmt(ctx)}` : "–";
  const cacheBytes = (eng.expert_cache_mib || 0) * 1048576;
  $("slots-text").textContent = eng.expert_slots ? `${fmt(eng.expert_slots)} · ${gb(cacheBytes)} GB` : "–";
  $("slots-bar").style.width = hw.gpu_mem_total ? `${Math.min(100, (100 * cacheBytes) / hw.gpu_mem_total)}%` : "0%";
  $("ram-text").textContent = hw.ram_total ? `${gb(hw.ram_used)} / ${gb(hw.ram_total, 0)} GB` : "–";
  const ramPct = hw.ram_total ? (100 * hw.ram_used) / hw.ram_total : 0;
  $("ram-bar").style.width = `${ramPct}%`;
  if (ramPct > 92) $("ram-progress").dataset.tone = "danger"; else delete $("ram-progress").dataset.tone;
  $("temp-text").textContent = hw.gpu_temp == null ? "–" : `${fmt(hw.gpu_temp)} °C`;
  $("temp-bar").style.width = hw.gpu_temp == null ? "0%" : `${Math.min(100, hw.gpu_temp)}%`;

  // recent requests
  const body = $("req-body");
  if (!requests.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted">No requests yet</td></tr>`;
  } else {
    const badge = {stop: ["", "Done"], length: ["", "Max tokens"], cancel: ["st-badge--queued", "Stopped"],
                   disconnect: ["st-badge--queued", "Closed"], error: ["st-badge--error", "Error"]};
    body.innerHTML = requests.slice(0, reqShowAll ? requests.length : 12).map((r) => {
      const [cls, text] = badge[r.finish] || ["", r.finish || "–"];
      const t = new Date(r.time * 1000).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"});
      const proj = r.projection == null ? "" : ` <span class="st-badge${r.projection ? " st-badge--reading" : ""}" title="experimental speed projection ${r.projection ? "on" : "off"}">${r.projection ? "ESP" : "stock"}</span>`;
      // #588: the VRAM share; the PCIe share (--pcie-frac) beside it when there is one
      const hit = r.hit_rate == null ? "–" : `${(r.hit_rate * 100).toFixed(1)}%` +
        (r.pcie_share ? ` <span class="muted" title="routed experts the GPU read over PCIe (--pcie-frac) or another GPU computed">+${(r.pcie_share * 100).toFixed(1)}% PCIe</span>` : "");
      return `<tr><td>${esc(t)}</td><td><span class="st-badge ${cls}">${esc(text)}</span>${proj}</td><td class="num">${fmt(r.prompt_tokens)}</td>
        <td class="num">${fmt(r.reused)}</td><td class="num">${fmt(r.output_tokens)}</td><td class="num">${fmt(r.decode_tok_s, 1)}</td>
        <td class="num">${hit}</td><td class="num">${fmt(r.duration_s, 1)} s</td></tr>`;
    }).join("");
  }
  const all = $("req-all");
  kept = kept == null ? requests.length : kept;
  all.hidden = kept <= 12;
  all.textContent = reqShowAll ? "Show fewer" : `Show all (${kept})`;
  $("req-wrap").classList.toggle("all", reqShowAll);
  $("req-totals").textContent = renderTotals(totals);
}

function facts(el, rows) {
  el.innerHTML = rows.filter((r) => r[1] != null && r[1] !== "").map(([k, v, copy]) =>
    `<dt>${esc(k)}</dt><dd>${copy ? `<code>${esc(v)}</code><button class="st-btn st-btn--icon" data-copy="${esc(v)}" aria-label="Copy">${icon("copy")}</button>` : esc(v)}</dd>`).join("");
}
// INFO cvec=project:4-44[:singleL] | add:A-B | 0
function projectionText(c) {
  if (!c || c === "0" || c === 0) return null;
  const [mode, range, single] = String(c).split(":");
  const [a, b] = (range || "").split("-");
  return `${mode === "project" ? "Projection" : "Additive"} control vector on layers ${a}–${b}` +
         `${single ? ` (layer ${single.replace("single", "")}'s direction)` : ""}. Per chat in Sampling. Its package ` +
         "describes the vector as a refusal-direction projection; measure the speed yourself";
}
function renderAbout(eng, hw, st) {
  const kv = {int8: "8-bit", q4_0: "4-bit (Hadamard-rotated)", fp16: "16-bit"}[eng.kv] || eng.kv;
  facts($("facts-engine"), [
    ["Model", eng.model],
    ["Engine", eng.version ? `v${eng.version}` : "built from source"],
    ["Context", eng.max_context ? `${fmt(eng.max_context)} tokens` : null],
    ["KV cache", kv ? `${kv}${eng.kv_resident ? `, streamed: ${fmt(eng.kv_resident)} positions per layer in VRAM, the rest in RAM` : ", all in VRAM"}` : null],
    ["Experts in VRAM", eng.expert_slots ? `${fmt(eng.expert_slots)} (${gb((eng.expert_cache_mib || 0) * 1048576)} GB)` : null],
    ["Speculation", eng.spec ? `MTP drafts up to ${Math.max(0, (eng.mtp_max || eng.spec) - 1)} tokens${eng.lookup ? ", prompt lookup on" : ""}` : null],
    ["Images", eng.images ? "on" : "off"],
    ["Experimental speed projection", projectionText(eng.cvec)],
  ]);
  facts($("facts-hw"), [
    ["GPU", st.gpu_name ? `${st.gpu_name}${hw.gpu_mem_total ? `, ${gb(hw.gpu_mem_total, 0)} GB` : ""}` : (st.gpu_note || "not readable (NVML)")],
    ["CPU", st.cpu_name ? `${st.cpu_name}${st.threads ? `, ${st.threads} threads` : ""}` : null],
    ["RAM", hw.ram_total ? `${gb(hw.ram_total, 0)} GB` : null],
  ]);
  const base = location.origin;
  facts($("facts-api"), [
    ["OpenAI base URL", `${base}/v1`, true],
    ["Anthropic base URL", base, true],
    ["Model name", eng.model, true],
  ]);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (b) copyText(b.dataset.copy, b);
});
$("req-all").addEventListener("click", () => { reqShowAll = !reqShowAll; if (lastMetrics) render(lastMetrics); });

// ------------------------------------------------------------------ MCP servers (GET /mcp)
// Tools from the MCP servers in the run config: the chat offers them to the model (opt-in per request,
// "strata_mcp": true, which only this page sends); the Monitor lists the servers and what they offer.
let mcpInfo = {servers: [], tools: 0}, mcpRetry = null;
async function loadMcp() {
  if (!isStrata()) return;
  try {
    const r = await fetch("mcp", {headers: headers()});
    if (!r.ok) return;
    mcpInfo = await r.json();
  } catch (e) { return; /* an older server: no MCP */ }
  renderMcp();
  clearTimeout(mcpRetry);                          // right after the start, servers may still be starting (npx downloads)
  if ((mcpInfo.servers || []).some((s) => s.status === "starting")) mcpRetry = setTimeout(loadMcp, 3000);
}
const MCP_STATE = {ready: ["st-badge--generating", "Connected"], starting: ["st-badge--reading", "Starting"],
                   failed: ["st-badge--error", "Failed"], stopped: ["st-badge--queued", "Stopped"], idle: ["", "Waiting"]};
function renderMcp() {
  const servers = mcpInfo.servers || [];
  $("mcp-card").hidden = !servers.length;
  $("mcp-row").hidden = !servers.length;
  const ready = servers.filter((s) => s.status === "ready" || s.status === "stopped");
  $("mcp-sum").textContent = servers.length ? `${fmt(mcpInfo.tools)} tools · ${ready.length} of ${servers.length} servers connected` : "";
  $("mcp-row-sub").textContent = mcpInfo.tools ? `${fmt(mcpInfo.tools)} tools from ${ready.map((s) => s.name).join(", ")}; the model calls them when it decides to`
                                               : "no server is connected yet (see the Monitor)";
  $("mcp-list").innerHTML = servers.map((s) => {
    const [cls, text] = MCP_STATE[s.status] || ["", s.status];
    const info = s.info && s.info.name ? ` · ${s.info.name}${s.info.version ? ` ${s.info.version}` : ""}` : "";
    return `<div class="mcp-server"><div class="mcp-server__head"><span class="st-badge ${cls}">${esc(text)}</span>` +
      `<strong>${esc(s.name)}</strong><span class="muted small">${esc(s.transport)} · ${fmt(s.tools.length)} tools${esc(info)}</span></div>` +
      (s.error ? `<div class="msg-error">${esc(s.error)}</div>` : "") +
      (s.tools.length ? `<div class="mcp-server__tools">${s.tools.map((t) => `<span class="chip" title="${esc(t.description || "")}">${esc(t.tool)}</span>`).join("")}</div>` : "") +
      `</div>`;
  }).join("");
}

// ------------------------------------------------------------------ Model settings (GET / POST /config, #564)
// A few documented keys of the run config (strata-<model>.json), for every client, from the next start on.  The
// server lists them, checks every value and keeps every other key of the file as it is.
let cfgKeys = [];
async function loadConfig() {
  if (!isStrata()) { $("cfg-card").hidden = true; return; }
  let r;
  try { r = await fetch("config", {headers: headers()}); } catch (e) { return; }
  if (!r.ok) { $("cfg-card").hidden = true; return; }       // no run config, an older server, or no key yet
  const c = await r.json();
  cfgKeys = c.keys || [];
  $("cfg-file").textContent = c.file || "";
  $("cfg-form").innerHTML = cfgKeys.map((k, i) => {
    const id = `cfg-${i}`, v = k.value;
    let input;
    if (k.kind === "bool" || k.kind === "enum") {
      const opts = k.kind === "bool" ? [["true", "on"], ["false", "off"]] : k.choices.map((x) => [x, x]);
      const cur = v == null ? "" : String(v);
      input = `<select class="st-input" id="${id}"><option value=""${cur === "" ? " selected" : ""}>default</option>` +
        opts.map(([val, text]) => `<option value="${esc(val)}"${cur === val ? " selected" : ""}>${esc(text)}</option>`).join("") + `</select>`;
    } else {
      const text = v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
      input = `<input class="st-input" id="${id}" ${k.kind === "number" ? 'type="number" step="any" min="0"' : 'type="text"'} ` +
        `value="${esc(text)}" placeholder="default" autocomplete="off">`;
    }
    return `<label for="${id}" title="${esc(k.help)}">${esc(k.help)}<code>${esc(k.key)}</code></label>${input}`;
  }).join("");
  $("cfg-card").hidden = false;
}
function configValue(k, el) {
  const s = el.value.trim();
  if (s === "") return null;
  if (k.kind === "bool") return s === "true";
  if (k.kind === "number") return Number(s);
  return s;                                         // enum, or names (the server splits them at commas)
}
$("cfg-save").addEventListener("click", async () => {
  const set = {};
  cfgKeys.forEach((k, i) => {
    const v = configValue(k, $(`cfg-${i}`));
    const old = Array.isArray(k.value) ? k.value.join(", ") : k.value;
    if (JSON.stringify(v) !== JSON.stringify(old ?? null)) set[k.key] = v;
  });
  if (!Object.keys(set).length) { $("cfg-msg").textContent = "Nothing changed."; return; }
  try {
    const r = await fetch("config", {method: "POST", headers: headers(true), body: JSON.stringify({set})});
    const b = await r.json();
    if (!r.ok) throw new Error((b.error || {}).message || `HTTP ${r.status}`);
    $("cfg-msg").textContent = b.changed.length
      ? `Saved (${b.changed.join(", ")}); the earlier file is ${b.file}.bak. Start the model again to use it.` : "Nothing changed.";
    loadConfig();
  } catch (e) {
    $("cfg-msg").textContent = "";
    toast("error", "Not saved", String(e.message || e), 6000);
  }
});

// ------------------------------------------------------------------ Markdown (escaped first, then formatted)
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>")
    // Картинки — ДО ссылок
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;max-height:400px;object-fit:contain;border-radius:8px;margin:8px 0;display:block;" loading="lazy">')
    // Ссылки (включая относительные /api/...)
    .replace(/(^|[^!])\[([^\]\n]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, '$1<a href="$3" target="_blank" rel="noopener noreferrer">$2</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code class="inline">${esc(codes[+i])}</code>`);
}
function codeBlock(lang, code) {
  const displayLang = (lang || "").trim() || "text";
  return `<div class="st-code"><div class="st-code__head"><span>${esc(displayLang)}</span>` +
    `<button class="st-btn st-btn--icon" data-code-copy aria-label="Copy code">${icon("copy")}</button></div>` +
    `<pre><code>${esc(code)}</code></pre></div>`;
}
function blocks(text) {
  const out = [], lines = text.split("\n");
  let para = [], list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (!l.trim()) { flushPara(); flushList(); continue; }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<${m[1].length <= 2 ? "h3" : "h4"}>${inline(m[2])}</${m[1].length <= 2 ? "h3" : "h4"}>`); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(l)) { flushPara(); flushList(); out.push("<hr>"); continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      flushPara(); flushList();
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      let html = `<table><thead><tr>${cells(l).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) html += `<tr>${cells(lines[i++]).map((c) => `<td>${c}</td>`).join("")}</tr>`;
      i--;
      out.push(html + "</tbody></table>");
      continue;
    }
    if ((m = l.match(/^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/))) {
      flushPara();
      const tag = m[1] ? "ol" : "ul";
      if (!list || list.tag !== tag) { flushList(); list = {tag, items: []}; }
      list.items.push(m[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(l)) { list.items[list.items.length - 1] += " " + l.trim(); continue; }
    flushList();
    para.push(l);
  }
  flushPara(); flushList();
  return out.join("");
}
function markdown(text) {
  let html = "", rest = text;
  for (;;) {
    const m = rest.match(/(^|\n)```([^\n`]*)\n/);
    if (!m) { html += blocks(rest); break; }
    html += blocks(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
    const end = rest.match(/(^|\n)```[ \t]*(\n|$)/);
    if (!end) { html += codeBlock(m[2].trim(), rest); break; }         // still streaming
    html += codeBlock(m[2].trim(), rest.slice(0, end.index));
    rest = rest.slice(end.index + end[0].length);
  }
  return html;
}

// ------------------------------------------------------------------ Chat
const DEFAULTS = {thinking: "high", temperature: 0.6, top_p: 0.95, top_k: 20, max: "", seed: "", show: true, esp: true, mcp: true};
// BEFORE (line ~...): let settings = {...DEFAULTS, ...store.get("sampling", {})};
// AFTER: add right below
const providerSettings = {
  provider: store.get("provider", "strata"),
  base_url: store.get("base_url", ""),
  model_id: store.get("model_id", ""),
};
function getP() { return window.Providers.getProvider(store.get("provider", "strata")); }
function isStrata() { return store.get("provider", "strata") === "strata"; }
let settings = {...DEFAULTS, ...store.get("sampling", {})};
let messages = store.get("chat", []);
let attachments = [];                 // {name, url}
let busy = null;                      // {controller, msg}

// === ДОБАВИТЬ ДЛЯ ПАМЯТИ ===
let memoryEnabled = store.get("memory_enabled", false);
let memoryText = "";
// ===========================
function saveChat() {
  store.set("chat", messages.map((m) => ({
    ...m, 
    images: (m.images || []).map((i) => ({name: i.name, url: i.url, status: i.status})),
    files: (m.files || []).map((f) => ({name: f.name, text: f.text, status: f.status}))
  })));
}
function timeStr(t) { return new Date(t).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}); }

function buildMeta(m) {
  const bits = [];
  // Для сообщений, где model не записан, берем из настроек
  const effectiveModel = m.model 
                       || window.__lastResponseModel
                       || window.health?.model
                       || (getP().id !== "strata" ? providerSettings.model_id : "")
                       || "";
  if (effectiveModel) bits.push(effectiveModel);
  if (m.tokens != null) bits.push(`${fmt(m.tokens)} tokens`);
  if (m.tokPerSec != null && m.tokPerSec > 0.25) bits.push(`${fmt(m.tokPerSec, 1)} tok/s`);
  if (m.stopped) bits.push("stopped");
  if (m.toolCalls) bits.push(`${m.toolCalls} tool call${m.toolCalls > 1 ? "s" : ""}`);
  if (m.toolLimit) bits.push(`stopped at limit ${m.toolLimit}`);
  if (bits.length) return bits.join(" · ");
  if (m.meta) return m.meta;
  return "—";
}

function msgEl(m, i) {
  const el = document.createElement("div");
  el.className = `st-msg st-msg--${m.role}`;
  el.dataset.i = i;
  if (m.role === "user") {
    if (m.files && m.files.length) {
      const wrap = document.createElement("div");
      wrap.className = "msg-images";
      for (const f of m.files) {
        const c = document.createElement("span");
        c.className = "chip";
        c.innerHTML = icon("attach", "st-icon st-icon--sm");
        c.append(f.name);
        wrap.appendChild(c);
      }
      el.appendChild(wrap);
    }
    if (m.images && m.images.length) {
      const wrap = document.createElement("div");
      wrap.className = "msg-images";
      for (const im of m.images) {
                        if (im.url) { 
                    const img = document.createElement("img"); 
                    img.src = im.url; 
                    img.alt = im.name || "image"; 
                    img.style.maxWidth = "100%"; 
                    img.style.maxHeight = "300px"; // Ограничение по высоте
                    img.style.borderRadius = "8px"; 
                    img.style.objectFit = "contain";
                    img.style.display = "block";
                    img.style.marginTop = "8px";
                    wrap.appendChild(img); 
                }
        else { const c = document.createElement("span"); c.className = "chip"; c.innerHTML = icon("image", "st-icon st-icon--sm"); c.append(im.name || "image"); wrap.appendChild(c); }
      }
      el.appendChild(wrap);
    }
    const b = document.createElement("div");
	b.className = "st-bubble";
	b.innerHTML = markdown(m.text || "");
	el.appendChild(b);
    const meta = document.createElement("div");
    meta.className = "st-msg__meta";
    meta.innerHTML = `<span>You · ${timeStr(m.time)}</span>` +
      `<button class="st-btn st-btn--icon" data-msg-delete aria-label="Delete message" title="Delete">${icon("trash")}</button>` +
      `<button class="st-btn st-btn--icon" data-msg-copy aria-label="Copy message" title="Copy">${icon("copy")}</button>`;
    el.appendChild(meta);
  } else {
    el.innerHTML = `<details class="st-collapse think" hidden><summary>${icon("thinking", "st-icon st-icon--sm")}<span class="think-title"></span>` +
      `${icon("chevron", "st-icon st-icon--sm st-chev")}</summary><div class="st-collapse__body thinking"></div></details>` +
      `<div class="st-bubble"></div><div class="st-msg__meta"><span class="meta-text"></span>` +
      `<button class="st-btn st-btn--icon" data-msg-branch aria-label="Branch from here" title="Branch from here">` +
        `<svg class="st-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/>` +
          `<path d="M8 6h8"/><path d="M6 8v8"/>` +
        `</svg></button>` +
      `<button class="st-btn st-btn--icon" data-msg-delete aria-label="Delete message" title="Delete">${icon("trash")}</button>` +
      (i === messages.length - 1
        ? `<button class="st-btn st-btn--icon" data-msg-regen aria-label="Regenerate message" title="Regenerate message">${icon("refresh")}</button>`
        : "") +
      `<button class="st-btn st-btn--icon" data-msg-copy aria-label="Copy the answer" title="Copy">${icon("copy")}</button></div>`;
    updateAssistant(el, m, false);
  }
  return el;
}
// One MCP tool call in the answer: a compact block (name, state, a one-line preview) that opens to the arguments and
// the result as the model read it.  Its body is built only while open: a result can be 20,000 characters.
const TOOL_STATE = {writing: ["st-badge--reading", "Writing"], running: ["st-badge--generating", "Running"], done: ["", "Done"],
                    error: ["st-badge--error", "Error"], skipped: ["st-badge--queued", "Not run"]};
function toolHtml(t, k) {
  const [cls, label] = TOOL_STATE[t.state] || ["", t.state];
  const args = t.arguments == null ? "" : JSON.stringify(t.arguments, null, 2);
  const preview = t.result != null ? t.result : args.replace(/\s+/g, " ");
  let body = "";
  if (t.open) {
    body = `<div class="tool-call__label">Arguments</div><pre class="tool-call__pre">${esc(args || "(being written)")}</pre>`;
    if (t.result != null) {
      body += `<div class="tool-call__label">${t.ok ? "Result" : "Error"}${t.chars ? ` · ${fmt(t.chars)} characters` : ""}` +
              `${t.truncated ? ", cut for the model" : ""}</div><pre class="tool-call__pre">${esc(t.result)}</pre>`;
    }
  }
  return `<details class="st-collapse tool-call" data-tool="${k}" data-state="${esc(t.state)}"${t.open ? " open" : ""}>` +
    `<summary>${icon("tool", "st-icon st-icon--sm")}<span class="tool-call__name" title="${esc(t.name || "")}">${esc(t.tool || t.name || "tool")}</span>` +
    (t.server ? `<span class="muted small">${esc(t.server)}</span>` : "") +
    `<span class="tool-call__preview muted">${esc(preview.slice(0, 200))}</span>` +
    `<span class="st-badge ${cls}">${esc(label)}</span>${t.ms != null && t.state !== "skipped" ? `<span class="muted small">${fmt(t.ms / 1000, 1)} s</span>` : ""}` +
    `${icon("chevron", "st-icon st-icon--sm st-chev")}</summary><div class="st-collapse__body">${body}</div></details>`;
}
// the answer's text with the tool blocks where the model called them
function answerHtml(m) {
  if (!m.tools || !m.tools.length) return markdown(m.text || "");
  let html = "", pos = 0;
  m.tools.forEach((t, k) => {
    const at = Math.min(Math.max(t.at || 0, pos), m.text.length);
    if (at > pos) html += markdown(m.text.slice(pos, at));
    pos = at;
    html += toolHtml(t, k);
  });
  return html + markdown(m.text.slice(pos));
}
// a tool event from the stream (the `strata_mcp` field of a chunk)
function onTool(m, x) {
  if (x.event === "limit") { m.limit = x.max_rounds; return; }
  m.tools = m.tools || [];
  let t = m.tools.find((y) => y.id === x.id);
  if (!t) { t = {id: x.id, name: x.name, at: m.text.length, rat: m.reasoning.length, state: "writing"}; m.tools.push(t); }
  if (x.event === "call") {
    Object.assign(t, {name: x.name, server: x.server, tool: x.tool, arguments: x.arguments, round: x.round, state: "running"});
  } else if (x.event === "result") {
    Object.assign(t, {result: x.text, ok: x.ok, chars: x.chars, truncated: x.truncated, ms: x.ms,
                      state: x.skipped ? "skipped" : x.ok ? "done" : "error"});
  }
}
function updateAssistant(el, m, streaming) {
  const det = el.querySelector("details.think");
  if (m.reasoning) {
    det.hidden = false;
    const thinkingNow = streaming && !m.text;
    el.querySelector(".think-title").textContent = thinkingNow ? "Thinking…" :
      m.thinkSecs != null ? `Thought for ${fmt(m.thinkSecs, 1)} s` : "Thoughts";
    const body = el.querySelector(".thinking");
    if (det.open || thinkingNow) body.textContent = m.reasoning;
    else body.dataset.pending = "1";
    // open while it streams (if wanted), closed once the answer starts - unless the user toggled it themselves
    if (thinkingNow && settings.show && !det.dataset.touched && !det.open) { det._auto = true; det.open = true; }
    if (!thinkingNow && det.open && !det.dataset.touched) { det._auto = true; det.open = false; }
  }
  const bubble = el.querySelector(".st-bubble");
  if (m.error) {
    bubble.innerHTML = `<div class="msg-error"></div>`;
    bubble.firstChild.textContent = m.error;
  } else if (!m.text && streaming && !(m.tools && m.tools.length)) {
    bubble.innerHTML = m.reasoning ? `<span class="muted cursor">Writing</span>` : `<span class="cursor"></span>`;
  } else {
    bubble.innerHTML = answerHtml(m);
    if (streaming) bubble.classList.add("cursor"); else bubble.classList.remove("cursor");
  }
  el.querySelector(".meta-text").textContent = streaming ? "" : buildMeta(m);
  el.querySelector("[data-msg-copy]").hidden = streaming || !m.text;
}

function scrollAfterDelete(index) {
  if (!messages.length) return;
  const target = Math.max(0, index - 1);
  requestAnimationFrame(() => {
    const el = document.querySelector(`#chat .st-msg[data-i="${target}"]`);
    if (el) el.scrollIntoView({block: "start"});
  });
}

async function regenerate(index) {
  if (busy) {
    toast("warn", "Stop first", "Wait for the answer to finish or stop it before regenerating.");
    return;
  }
  const oldM = messages[index];
  if (!oldM || oldM.role !== "assistant") return;
  if (index !== messages.length - 1) {
    toast("warn", "Not the last message", "Regenerate is available only on the last answer.");
    return;
  }

  // Сохраняем старый ответ для Undo
  const removed = {at: index, msg: oldM};

  // Заменяем на новый пустой assistant на том же месте
  const newM = {role: "assistant", text: "", reasoning: "", time: Date.now()};
  messages.splice(index, 1, newM);
  renderChat();
  const el = document.querySelector(`#chat .st-msg[data-i="${index}"]`);

  await streamAnswer(newM, el);

  // Скролл к началу сообщения
  requestAnimationFrame(() => {
    const el2 = document.querySelector(`#chat .st-msg[data-i="${index}"]`);
    if (el2) el2.scrollIntoView({block: "start"});
  });

  toast("info", "Regenerated", "Old answer kept for Undo", 6000, {
    label: "Undo",
    run: () => {
      messages.splice(index, 1, removed.msg);
      renderChat();
      window.saveChat();
      requestAnimationFrame(() => {
        const el3 = document.querySelector(`#chat .st-msg[data-i="${index}"]`);
        if (el3) el3.scrollIntoView({block: "start"});
      });
    },
  });
}

async function branchMessage(index) {
  if (busy) {
    toast("warn", "Stop first", "Wait for the answer to finish or stop it before branching.");
    return;
  }
  const m = messages[index];
  if (!m || m.role !== "assistant") return;
  const sourceId = store.get("currentHistoryId", null);
  if (!sourceId) {
    toast("warn", "Cannot branch", "Open a saved chat first");
    return;
  }
  const cloneId = await window.branchChatAndOpen(sourceId, index);
  if (cloneId) {
    toast("info", "Branched", "Continued in a copy · " + (messages.length + 1) + " messages up to here", 4000);
  }
}

function deleteMessage(index) {
  if (busy) {
    toast("warn", "Stop first", "Wait for the answer to finish or stop it before deleting messages.");
    return;
  }
  const m = messages[index];
  if (!m) return;

  const removed = [];
  if (m.role === "user") {
    removed.push({at: index, msg: messages[index]});
    messages.splice(index, 1);
    // user → удаляем и следующий assistant (если есть)
    if (messages[index] && messages[index].role === "assistant") {
      removed.push({at: index, msg: messages[index]});
      messages.splice(index, 1);
    }
  } else {
    // assistant → только себя
    removed.push({at: index, msg: messages[index]});
    messages.splice(index, 1);
  }

  renderChat();
  scrollAfterDelete(index);
  window.saveChat();

  toast("info", "Message deleted",
        removed.length === 1 ? "One message removed" : "Two messages removed",
        6000, {
    label: "Undo",
    run: () => {
      for (let i = removed.length - 1; i >= 0; i--) {
        messages.splice(removed[i].at, 0, removed[i].msg);
      }
      renderChat();
      requestAnimationFrame(() => {
        const el = document.querySelector(`#chat .st-msg[data-i="${removed[0].at}"]`);
        if (el) el.scrollIntoView({block: "start"});
      });
      window.saveChat();
    },
  });
}

function renderChat(opts = {}) {
  const chat = $("chat");
  if (!chat) return; // Защита от отсутствия HTML
  chat.querySelectorAll(".st-msg").forEach((e) => e.remove());
  $("chat-empty").hidden = messages.length > 0;
  messages.forEach((m, i) => chat.appendChild(msgEl(m, i)));
  if (!opts.keepScroll) scrollDown(true);
}

function nearBottom() { 
  const s = $("chat-scroll"); 
  if (!s) return true; 
  return s.scrollHeight - s.scrollTop - s.clientHeight < 120; 
}
function scrollDown(force) { 
  const s = $("chat-scroll"); 
  if (!s) return; 
  if (force || nearBottom()) s.scrollTop = s.scrollHeight; 
}

$("chat").addEventListener("click", (e) => {
  const cc = e.target.closest("[data-code-copy]");
  if (cc) { copyText(cc.closest(".st-code").querySelector("pre").textContent, cc); return; }
  const mc = e.target.closest("[data-msg-copy]");
  if (mc) { const i = +mc.closest(".st-msg").dataset.i; copyText(messages[i].text, mc); return; }
  const md = e.target.closest("[data-msg-delete]");
  if (md) { const i = +md.closest(".st-msg").dataset.i; deleteMessage(i); return; }
  const mb = e.target.closest("[data-msg-branch]");
  if (mb) { const i = +mb.closest(".st-msg").dataset.i; branchMessage(i); return; }
  const mr = e.target.closest("[data-msg-regen]");
  if (mr) { const i = +mr.closest(".st-msg").dataset.i; regenerate(i); return; }
  // a tool block: its open state lives in the message (the answer is rebuilt while it streams), so the click sets it
  const sum = e.target.closest(".tool-call > summary");
  if (sum) {
    e.preventDefault();
    const el = sum.closest(".st-msg"), m = messages[+el.dataset.i], t = m && m.tools && m.tools[+sum.parentElement.dataset.tool];
    if (!t) return;
    t.open = !t.open;
    updateAssistant(el, m, !!busy && busy.msg === m);
  }
});
$("chat").addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.tagName !== "DETAILS" || !d.classList.contains("think")) return;
  if (d._auto) { d._auto = false; return; }          // our own open/close, not the user's
  d.dataset.touched = "1";
  const body = d.querySelector(".thinking");
  if (d.open && body.dataset.pending) { body.textContent = messages[+d.closest(".st-msg").dataset.i].reasoning; delete body.dataset.pending; }
}, true);

function apiMessages() {
  const out = [];
  
  if (memoryEnabled) {
    const parts = [];
    
    // 1. System Prompt (глобальный)
    if (systemPromptText && systemPromptText.trim()) {
      parts.push(systemPromptText.trim());
    }
    
    // 2. Memory Profile (текущий)
    if (memoryText && memoryText.trim()) {
      parts.push(`<memory>\n${memoryText}\n</memory>`);
    }
    
    if (parts.length) {
      out.push({
        role: "system",
        content: parts.join("\n\n---\n\n")
      });
    }
  }
  // ========================  
  for (const m of messages) {
    if (m.role === "user") {
      const imgs = (m.images || []).filter((i) => i.url);
      const text = userText(m);
      out.push({role: "user", content: imgs.length ? [{type: "text", text},
        ...imgs.map((i) => ({type: "image_url", image_url: {url: i.url}}))] : text});
    } else if (!(busy && busy.msg === m)) {            // the answer being asked for now is not history yet
      out.push(...assistantMessages(m));
    }
  }
  return out;
}
// An answer that used MCP tools goes back as the model wrote it: per round the text before the calls, the calls and
// their results (as the model read them), then the rest - so the next question can build on what the tools found.
function assistantMessages(m) {
  const ran = (m.tools || []).filter((t) => t.round != null && t.result != null && t.state !== "skipped");
  // #1392: a turn with no answer text (only reasoning, a stop before the first content token, or an error) still goes
  // back as an assistant turn, so the history keeps alternating and a reasoning model sees that it already answered.
  // The server leaves such a turn out of the prompt itself (serve/frontend.py, #843); reasoning_content rides along.
  if (!ran.length) {
    const msg = {role: "assistant", content: m.text || ""};
    if (!m.text && m.reasoning) msg.reasoning_content = m.reasoning;
    return [msg];
  }
  const out = [];
  let pos = 0;
  for (const r of [...new Set(ran.map((t) => t.round))]) {
    const calls = ran.filter((t) => t.round === r);
    const at = Math.min(Math.max(pos, calls[0].at || 0), m.text.length);
    out.push({role: "assistant", content: m.text.slice(pos, at).trim(),
              tool_calls: calls.map((t) => ({id: t.id, type: "function", function: {name: t.name, arguments: JSON.stringify(t.arguments || {})}}))});
    for (const t of calls) out.push({role: "tool", tool_call_id: t.id, content: t.result});
    pos = at;
  }
  const rest = m.text.slice(pos).trim();
  if (rest) out.push({role: "assistant", content: rest});
  return out;
}

function setBusy(on) {
  $("stop-btn").hidden = !on;
  $("send-btn").disabled = on;
  $("composer-hint").textContent = on ? "" : "Shift+Enter: new line";
}

async function send() {
  const text = $("input").value.trim();
  if ((!text && !attachments.length) || busy) return;

  const p = getP();

  // PR-1: внешний провайдер без выбранной модели — не отправляем
  if (p.id !== "strata" && !providerSettings.model_id) {
    toast("warn", "No model selected", "Choose a model under About > LLM provider.");
    return;
  }

  // Синхронизируем настройки из UI (пользователь мог напечатать и не нажать Enter/Tab)
  if (p.id !== "strata") {
    const base = $("prov-base").value.trim() || providerSettings.base_url || p.defaultBaseUrl;
    const model = $("prov-model").value.trim() || providerSettings.model_id;
    providerSettings.base_url = base;
    providerSettings.model_id = model;
    store.set("base_url", base);
    store.set("model_id", model);
  }

  messages.push({role: "user", text, images: attachments.filter((a) => a.kind !== "file"),
                 files: attachments.filter((a) => a.kind === "file"), time: Date.now()});
  attachments = [];
  renderAttachments();
  $("input").value = "";
  autosize();
  const m = {role: "assistant", text: "", reasoning: "", time: Date.now()};
  messages.push(m);
  renderChat();
  const el = $("chat").lastElementChild;

  await streamAnswer(m, el);
}

async function streamAnswer(m, el) {
  const p = getP();
  const controller = new AbortController();
  busy = {controller, msg: m};
  setBusy(true);

  // ---- Сборка тела запроса ----
  const body = {
    model: p.id === "strata"
      ? (health.model || "strata")
      : providerSettings.model_id,
    messages: apiMessages(),
    stream: true,
  };
  if (p.id === "strata") body.reasoning_effort = settings.thinking;
  if (settings.temperature > 0) {
    Object.assign(body, {temperature: +settings.temperature, top_p: +settings.top_p, top_k: +settings.top_k});
  } else {
    body.temperature = 0;
  }
  if (settings.seed) body.seed = +settings.seed;
  if (settings.max) body.max_tokens = +settings.max;
  if (p.id === "strata") {
    if (projectionLoaded()) body.experimental_speed_projection = !!settings.esp;
    if (settings.mcp !== false && mcpInfo.tools > 0) body.strata_mcp = true;
  }
  if (p.id !== "strata") {
    body.stream_options = { include_usage: true };
  }

  window.__lastResponseModel = null;

  let firstAt = null, thinkStart = null, usage = null, frame = 0;
  const paint = () => { frame = 0; updateAssistant(el, m, true); scrollDown(); };

  try {
    const url = p.buildUrl({ baseUrl: providerSettings.base_url, path: "/v1/chat/completions" });
    const r = await fetch(url, {method: "POST", headers: headers(true), body: JSON.stringify(body),
                                 signal: controller.signal});
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = (await r.json()).error.message || msg; } catch (e) { /* not json */ }
      if (r.status === 401) msg = "This server needs an API key: add it under About > Settings.";
      throw new Error(msg);
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;

        const chunks = p.parseChunk(data);
        if (!chunks) continue;
        for (const c of chunks) {
          if (c.type === "error") throw new Error(c.value);
          if (c.type === "usage") { usage = c.value; continue; }
          if (c.type === "model") { window.__lastResponseModel = c.value; continue; }
          if (c.type === "tools") { onTool(m, c.value); continue; }

          const lastTool = m.tools && m.tools.length ? m.tools[m.tools.length - 1] : null;
          if (c.type === "reasoning") {
            if (!firstAt) firstAt = performance.now();
            if (!thinkStart) thinkStart = performance.now();
            if (lastTool && m.reasoning && lastTool.rat === m.reasoning.length) m.reasoning += "\n\n";
            m.reasoning += c.value;
          } else if (c.type === "text") {
            if (!firstAt) firstAt = performance.now();
            if (thinkStart && m.thinkSecs == null) m.thinkSecs = (performance.now() - thinkStart) / 1000;
            if (lastTool && m.text && lastTool.at === m.text.length) m.text += "\n\n";
            m.text += c.value;
          }
        }
        if (!frame) frame = requestAnimationFrame(paint);
      }
    }
  } catch (e) {
    if (e.name === "AbortError") {
      m.stopped = true;
      if (p.id !== "strata" && !sessionStorage.getItem("strata.stop_toast_shown")) {
        sessionStorage.setItem("strata.stop_toast_shown", "1");
        toast("info", "Stopped",
              "The backend may keep generating for a few seconds. LM Studio usually finishes the request; llama.cpp aborts.",
              8000);
      }
    } else {
      m.error = e.message || String(e);
      toast("error", "The request failed", m.error, 6000);
    }
  }
  if (thinkStart && m.thinkSecs == null) m.thinkSecs = (performance.now() - thinkStart) / 1000;
  const n = usage ? usage.completion_tokens : null;

  // PR-2.6 step 1: structured attributes
  m.model = window.__lastResponseModel
    || (p.id === "strata" ? (health.model || "") : (providerSettings.model_id || ""))
    || "";
  m.tokens = n;
  m.tokPerSec = (n && firstAt) ? n / ((performance.now() - firstAt) / 1000) : null;
  m.stopped = !!m.stopped;
  m.error = m.error || null;

  for (const t of m.tools || []) if (t.state === "writing" || t.state === "running") { t.state = "skipped"; t.ms = null; }
  const ran = (m.tools || []).filter((t) => t.state === "done" || t.state === "error").length;
  if (ran) m.toolCalls = ran;
  if (m.toolLimit) delete m.toolLimit;
  if (m.limit) m.toolLimit = m.limit;

  busy = null;
  setBusy(false);
  if (frame) cancelAnimationFrame(frame);
  updateAssistant(el, m, false);
  saveChat();
  scrollDown();
}

$("composer").onsubmit = (e) => { e.preventDefault(); send(); };
$("stop-btn").onclick = () => { if (busy) busy.controller.abort(); };
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
function autosize() { const t = $("input"); t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, innerHeight * 0.4)}px`; }
$("input").addEventListener("input", autosize);

$("new-btn").onclick = () => {
  if (busy) { toast("warn", "Still writing", "Stop the answer first."); return; }
  if (!messages.length) return;
  const backup = messages;
  messages = [];
  saveChat();
  renderChat();
  toast("info", "New chat", "The last one was cleared.", 6000, {label: "Undo", run: () => { messages = backup; saveChat(); renderChat(); }});
};
$("export-btn").onclick = () => {
  if (!messages.length) { toast("info", "Nothing to save yet"); return; }
  const tools = (m) => (m.tools || []).filter((t) => t.result != null).map((t) =>
    `<details><summary>Tool ${t.server ? `${t.server} / ` : ""}${t.tool || t.name}${t.ok ? "" : " (error)"}</summary>\n\n` +
    `\`\`\`json\n${JSON.stringify(t.arguments || {}, null, 2)}\n\`\`\`\n\n\`\`\`\n${t.result}\n\`\`\`\n\n</details>\n\n`).join("");
  const md = messages.map((m) => m.role === "user" ? `## You\n\n${m.text}\n` :
    `## ${health.model}\n\n${m.reasoning ? `<details><summary>Thinking</summary>\n\n${m.reasoning}\n\n</details>\n\n` : ""}${tools(m)}${m.text || m.error || ""}\n`).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([md], {type: "text/markdown"}));
  a.download = `strata-chat-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// ================= ИМПОРТ ЧАТОВ =================
$("import-btn").onclick = () => $("import-input").click();

$("import-input").onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  
  console.log(`[Import] Selected ${files.length} files`);
  const formData = new FormData();
  for (const f of files) formData.append("files", f, f.name);
  
  toast("info", "Importing...", `${files.length} файл(ов) на сервере`, 60000);
  
  try {
    const r = await fetch("/api/import/upload", {
      method: "POST",
      body: formData
    });
    
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const result = await r.json();
    
    if (result.failed > 0 || result.errors.length) {
      toast("warn", "Импорт завершен с ошибками",
            `Импортировано: ${result.imported}, пропущено: ${result.skipped}, ошибок: ${result.failed}. ${result.errors.slice(0,2).join("; ")}`,
            12000);
    } else {
      toast("success", "Импорт завершен",
            `Импортировано: ${result.imported}, пропущено (дубли): ${result.skipped}`,
            5000);
    }
    
    // Обновляем список чатов в истории
    if (window.loadHistoryFromServer) {
	  await window.loadHistoryFromServer();
	  console.log('[Import] History reloaded from server');
	} else {
	  console.warn('[Import] loadHistoryFromServer not exported — reload page manually');
	  toast("info", "Updating history...", "Reloading list", 2000);
	  // Fallback: перезагружаем страницу через 1 сек, чтобы кэш обновился из HTML
	  setTimeout(() => location.reload(), 1500);
	}
    
  } catch (err) {
    console.error("[Import] Error:", err);
    toast("error", "Импорт упал", String(err.message || err), 10000);
  }
  
  $("import-input").value = "";
};
// =================================================


// pictures and text files: the attach button, dropping them on the chat, or pasting a picture (issue #30)
const TEXT_EXT = /\.(txt|md|markdown|rst|tex|py|pyi|ipynb|js|mjs|cjs|ts|tsx|jsx|vue|svelte|json|jsonl|csv|tsv|log|ya?ml|toml|ini|cfg|conf|env|xml|html?|css|scss|less|c|cc|cpp|cxx|h|hh|hpp|cu|cuh|rs|go|java|kt|kts|swift|rb|php|pl|lua|r|jl|scala|sql|sh|bash|zsh|fish|ps1|psm1|bat|cmd|diff|patch|gradle|cmake|mk|dockerfile|gitignore|proto|graphql)$/i;
const MAX_TEXT_FILE = 512 * 1024;
function isTextFile(f) {
  return f.type.startsWith("text/") || /json|xml|javascript|yaml|toml|x-sh|x-python/.test(f.type) ||
         TEXT_EXT.test(f.name) || /(^|[\\/])(makefile|dockerfile|readme|license)$/i.test(f.name);
}
function visionEnabled() {
  const p = getP();
  if (p.id === "strata") return !!health.images;
  // Ручной переключатель — для llama.cpp (--mmproj) и LM Studio, если caps неизвестны.
  // Проверяем первым: пользователь явно включил — доверяем ему.
  if (store.get("vision_manual", false)) return true;
  // LM Studio: caps выбранной модели
  if (p.id === "lmstudio") {
    const caps = store.get("model_caps", null);
    const mid = store.get("model_id", "");
    if (Array.isArray(caps) && mid) {
      const m = caps.find(c => c.id === mid);
      if (m && m.capabilities && typeof m.capabilities.vision === "boolean") {
        return m.capabilities.vision;
      }
    }
  }
  return false;
}

function updateAttachBtnTitle() {
  const btn = $("attach-btn");
  if (!btn) return;
  btn.title = visionEnabled() ? "Attach a text file or a picture (or drop it here)"
                              : "Attach a text file (or drop it here)";
}

function updateVisionHint() {
  const row = $("vision-manual-row");
  const btn = $("prov-vision-manual");
  const hint = $("vision-hint");
  if (!row || !btn || !hint) return;
  const p = getP();
  if (p.id === "strata") { row.style.display = "none"; return; }
  row.style.display = "flex";
  const manual = !!store.get("vision_manual", false);
  btn.setAttribute("aria-checked", String(manual));
  if (p.id === "llamacpp") {
    hint.textContent = "llama.cpp needs --mmproj to accept images";
  } else if (p.id === "lmstudio") {
    const caps = store.get("model_caps", null);
    const mid = store.get("model_id", "");
    let capValue = null;
    if (Array.isArray(caps) && mid) {
      const m = caps.find(c => c.id === mid);
      if (m && m.capabilities && typeof m.capabilities.vision === "boolean") capValue = m.capabilities.vision;
    }
    if (capValue === true) hint.textContent = "Server reports vision: yes (auto-detected)";
    else if (capValue === false) hint.textContent = "Server reports vision: no";
    else hint.textContent = "Server didn't report vision; enable manually if the model supports images";
  }
  updateAttachBtnTitle();
}
function addFiles(files) {
  for (const f of files) {
    if (f.type.startsWith("image/")) {
      if (!visionEnabled()) { toast("warn", "Pictures are off", "Enable vision in About → LLM provider, or use a vision-capable model."); continue; }
      if (f.size > 20e6) { toast("warn", "Picture too large", `${f.name} is over 20 MB.`); continue; }
      const r = new FileReader();
      r.onload = () => { attachments.push({kind: "image", name: f.name || "pasted image", url: r.result}); renderAttachments(); };
      r.readAsDataURL(f);
      continue;
    }
    if (!isTextFile(f)) { toast("warn", "Not a text file", `${f.name}: attach text files (code, notes, logs, data)${visionEnabled() ? " or pictures" : ""}.`); continue; }
    if (f.size > MAX_TEXT_FILE) { toast("warn", "File too large", `${f.name} is over 512 KB.`); continue; }
    const r = new FileReader();
    r.onload = () => {
      const text = String(r.result);
      if (text.includes("\u0000")) { toast("warn", "Not a text file", `${f.name} looks like a binary file.`); return; }
      attachments.push({kind: "file", name: f.name, text});
      renderAttachments();
    };
    r.readAsText(f);
  }
}
// a file's text in the message, fenced with more backticks than it contains itself
function fileBlock(f) {
  const longest = Math.max(2, ...(f.text.match(/`+/g) || []).map((s) => s.length));
  const fence = "`".repeat(longest + 1);
  return `File: ${f.name}\n${fence}\n${f.text}\n${fence}`;
}
function userText(m) {
  const files = (m.files || []).filter((f) => f.text != null);
  return [m.text, ...files.map(fileBlock)].filter((s) => s).join("\n\n");
}
function renderAttachments() {
  const box = $("attachments");
  box.hidden = !attachments.length;
  box.innerHTML = "";
  attachments.forEach((a, i) => {
    const c = document.createElement("span");
    c.className = "chip";
    c.innerHTML = icon(a.kind === "file" ? "attach" : "image", "st-icon st-icon--sm");
    c.append(a.name);
    const x = document.createElement("button");
    x.type = "button"; x.className = "st-btn st-btn--icon"; x.setAttribute("aria-label", "Remove");
    x.innerHTML = icon("trash");
    x.onclick = () => { attachments.splice(i, 1); renderAttachments(); };
    c.appendChild(x);
    box.appendChild(c);
  });
}
$("attach-btn").onclick = () => $("file").click();
// drop files on the chat or the message box
for (const id of ["chat", "composer"]) {
  const el = $(id);
  el.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer || {}).types || []].includes("Files")) return;
    e.preventDefault();
    $("composer").classList.add("dragging");
  });
  el.addEventListener("dragleave", () => $("composer").classList.remove("dragging"));
  el.addEventListener("drop", (e) => {
    $("composer").classList.remove("dragging");
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
    $("input").focus();
  });
}
$("file").onchange = () => { addFiles($("file").files); $("file").value = ""; };
$("input").addEventListener("paste", (e) => {
  if (!visionEnabled()) return;
  const files = [...(e.clipboardData || {}).files || []].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); addFiles(files); }
});

// ------------------------------------------------------------------ the sampling drawer
function openDrawer(open) {
  $("drawer").dataset.open = String(open);
  $("drawer").setAttribute("aria-hidden", String(!open));
  $("scrim").hidden = !open;
  if (open) { loadDrawer(); loadShared(); loadMcp(); }
}
function loadDrawer(s = settings) {
  for (const b of $("s-thinking").children) b.setAttribute("aria-checked", String(b.dataset.v === s.thinking));
  $("s-temp").value = s.temperature; $("s-topp").value = s.top_p; $("s-topk").value = s.top_k;
  $("s-max").value = s.max; $("s-seed").value = s.seed;
  $("s-show").setAttribute("aria-checked", String(!!s.show));
  $("s-esp").setAttribute("aria-checked", String(s.esp !== false));
  $("esp-row").hidden = !projectionLoaded();
  $("s-mcp").setAttribute("aria-checked", String(s.mcp !== false));
  $("s-share").setAttribute("aria-checked", String(sharedOn));
  outputs();
}
// "Use for other apps too": the server keeps these settings as every client's defaults (GET/POST /settings)
let sharedOn = false;
async function loadShared() {
  if (!isStrata()) { sharedOn = false; $("s-share").setAttribute("aria-checked", "false"); return; }
  try {
    const r = await fetch("settings", {headers: headers()});
    if (r.ok) sharedOn = !!(await r.json()).shared;
  } catch (e) { /* an older server: the switch just stays off */ }
  $("s-share").setAttribute("aria-checked", String(sharedOn));
}
function sharedDefaults(s) {
  const d = {reasoning_effort: s.thinking, temperature: +s.temperature};
  if (+s.temperature > 0) Object.assign(d, {top_p: +s.top_p, top_k: +s.top_k});
  if (s.seed) d.seed = +s.seed;
  if (s.max) d.max_tokens = +s.max;
  if (projectionLoaded()) d.experimental_speed_projection = s.esp !== false;
  return d;
}
async function saveShared(on, s) {
  if (!isStrata()) {
    sharedOn = false;
    $("s-share").setAttribute("aria-checked", "false");
    throw new Error("Shared defaults are available only with Strata.");
  }
  const r = await fetch("settings", {method: "POST", headers: headers(true),
                                      body: JSON.stringify({defaults: on ? sharedDefaults(s) : null})});
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).error.message || msg; } catch (e) { /* not json */ }
    throw new Error(msg);
  }
  sharedOn = !!(await r.json()).shared;
}
// the engine was started with the experimental-speed-projection control vector (INFO cvec=...)
function projectionLoaded() {
  const c = lastMetrics && lastMetrics.engine ? lastMetrics.engine.cvec : 0;
  return !!c && c !== "0";
}
function outputs() {
  const t = +$("s-temp").value;
  $("o-temp").textContent = t === 0 ? "0 · greedy" : t.toFixed(2);
  $("o-topp").textContent = (+$("s-topp").value).toFixed(2);
  $("o-topk").textContent = $("s-topk").value;
  const sel = [...$("s-thinking").children].find((b) => b.getAttribute("aria-checked") === "true");
  $("o-thinking").textContent = sel ? {none: "answers right away", low: "short", medium: "medium", high: "thorough (default)"}[sel.dataset.v] : "";
  for (const id of ["s-topp", "s-topk"]) $(id).disabled = t === 0;
}
for (const b of $("s-thinking").children) b.onclick = () => { for (const x of $("s-thinking").children) x.setAttribute("aria-checked", String(x === b)); outputs(); };
for (const id of ["s-temp", "s-topp", "s-topk"]) $(id).oninput = outputs;
$("s-show").onclick = () => $("s-show").setAttribute("aria-checked", String($("s-show").getAttribute("aria-checked") !== "true"));
$("s-esp").onclick = () => $("s-esp").setAttribute("aria-checked", String($("s-esp").getAttribute("aria-checked") !== "true"));
$("s-mcp").onclick = () => $("s-mcp").setAttribute("aria-checked", String($("s-mcp").getAttribute("aria-checked") !== "true"));
$("s-share").onclick = () => $("s-share").setAttribute("aria-checked", String($("s-share").getAttribute("aria-checked") !== "true"));
$("s-reset").onclick = () => loadDrawer(DEFAULTS);
$("s-apply").onclick = async () => {
  const sel = [...$("s-thinking").children].find((b) => b.getAttribute("aria-checked") === "true");
  settings = {thinking: sel ? sel.dataset.v : "high", temperature: +$("s-temp").value, top_p: +$("s-topp").value,
              top_k: +$("s-topk").value, max: $("s-max").value.trim(), seed: $("s-seed").value.trim(),
              show: $("s-show").getAttribute("aria-checked") === "true",
              esp: $("s-esp").getAttribute("aria-checked") === "true",
              mcp: $("s-mcp").getAttribute("aria-checked") === "true"};
  store.set("sampling", settings);
  const share = $("s-share").getAttribute("aria-checked") === "true";
  openDrawer(false);
  if (share || sharedOn) {
    try {
      await saveShared(share, settings);
      toast("success", "Sampling saved", share ? "Other apps (omp, API clients) use these settings from their next request."
                                               : "Other apps use their own settings again.");
    } catch (e) {
      toast("error", "Saved here, but not for other apps", e.message, 6000);
    }
    return;
  }
  toast("success", "Sampling saved", settings.temperature === 0 ? "Greedy: the same question gives the same answer." : "");
};
$("sampling-btn").onclick = () => openDrawer(true);
$("drawer-close").onclick = () => openDrawer(false);
$("scrim").onclick = () => openDrawer(false);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("drawer").dataset.open === "true") openDrawer(false); });

// ------------------------------------------------------------------ start
setBusy(false);
renderChat();
const startQuestion = new URLSearchParams(location.search).get("q");   // /?q=... starts a chat (a shortcut)
if (startQuestion) history.replaceState(null, "", location.pathname + location.hash);
loadHealth().then(loadMcp).then(() => {
  if (startQuestion) { $("input").value = startQuestion; send(); }
});
showTab(location.hash.slice(1) || "chat");
poll();

setInterval(runBackendCheck, 5000);
runBackendCheck(); // Запуск сразу при загрузке
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") runBackendCheck();
});
// ==================================================================
// MEMORY MODULE (MVP + PROFILES + PENDING)
// ==================================================================
console.log("[Memory] Module initialized");
let systemPromptText = "";
let currentProfile = store.get("memory_profile", "core");
let pendingFacts = [];
let filteredFacts = [];

// === Состояние единого редактора профилей ===
// currentProfile — активный профиль для чата. Меняется ТОЛЬКО в closeMemoryModal.
// editorViewingProfile — что сейчас открыто в редакторе (null = draft).
// editorSaveName — под каким именем запишется Save.
// editorMode — "readonly" | "edit".
// editorLastSavedText — baseline для dirty-проверки.
let editorViewingProfile = null;
let editorSaveName = "";
let editorMode = "edit";
let editorLastSavedText = "";
let memorySaveInProgress = false;

// 1. Создание HTML модалки
function createMemoryModalHTML() {
  if (document.getElementById("memory-modal")) return;

  const modalHTML = `
    <div id="memory-modal-scrim" class="st-scrim" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 999;"></div>
    <div id="memory-modal" class="st-drawer" style="display: none; position: fixed; width: 900px; max-width: 95vw; left: 50%; transform: translateX(-50%); top: 5%; bottom: 5%; border-radius: 12px; overflow: hidden; flex-direction: column; z-index: 1000; background: var(--st-bg, #1e1e1e); border: 1px solid var(--st-border, #333); box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
      
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid var(--st-border, #333);">
        <div style="display: flex; gap: 10px;">
          <button class="st-btn st-btn--secondary" id="mem-tab-dossier" type="button" style="background: var(--st-primary, #007bff); color: white;">Профили</button>
          <button class="st-btn st-btn--secondary" id="mem-tab-system" type="button">System Prompt</button>
          <button class="st-btn st-btn--secondary" id="mem-tab-pending" type="button">Предложения (<span id="mem-pending-count">0</span>)</button>
        </div>
        <button class="st-btn st-btn--icon" id="memory-modal-close" type="button" style="background: none; border: none; cursor: pointer; font-size: 1.2rem; color: var(--st-text, #fff);">✕</button>
      </div>

      <div id="mem-view-dossier" style="flex: 1; padding: 16px; display: flex; flex-direction: column; min-height: 0;">
		<div style="margin-bottom: 10px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
		  <label style="color: var(--st-text, #fff);">Профиль:</label>
		  <select id="memory-profile-select" class="st-input" style="flex: 1; min-width: 150px; padding: 8px; background: var(--st-bg, #1e1e1e); color: var(--st-text, #fff); border: 1px solid var(--st-border, #333);">
			<option value="">— не выбран —</option>
		  </select>
		  <button class="st-btn" id="memory-edit-toggle" type="button" title="Редактировать профиль" aria-label="Edit" style="display: none; background: #dc3545; border: 1px solid #dc3545; color: #fff; padding: 4px 10px; font-size: 12px; height: 32px; border-radius: 4px; cursor: pointer;">Edit</button>
		  <button class="st-btn st-btn--secondary" id="memory-profile-new" type="button">+ Новый</button>
          <button class="st-btn tooltip-btn" id="mem-lamp-btn" type="button" data-tooltip="Ламповый профиль по запросу" style="height: 32px; width: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; background: transparent; border: 1px solid #f5b301; color: #f5b301; border-radius: 4px;">💡</button>
          <button class="st-btn tooltip-btn" id="memory-build-btn" type="button" data-tooltip="Сгенерировать по ключевым словам" style="height: 32px; width: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; background: transparent; border: 1px solid #8b5cf6; color: #8b5cf6; border-radius: 4px;">⚡</button>
		</div>

		<div style="margin-bottom: 10px; display: flex; gap: 10px; align-items: center;">
		  <label style="color: var(--st-text, #fff); white-space: nowrap;">Имя для сохранения:</label>
		  <input type="text" id="memory-save-name" class="st-input" placeholder="my_profile" autocomplete="off" style="flex: 1; padding: 8px; background: var(--st-bg, #1e1e1e); color: var(--st-text, #fff); border: 1px solid var(--st-border, #333);">
		</div>
        
        <!-- НОВАЯ ФОРМА ДЛЯ ГЕНЕРАЦИИ -->
        <div id="mem-build-form" style="display: none; background: var(--st-surface-2, #2a2a2a); padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--st-border, #444); flex-direction: column; gap: 8px;">
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input type="text" id="build-anchor" class="st-input" placeholder="Anchor: krea,wangp" style="flex: 2; min-width: 150px; padding: 6px;">
            <input type="text" id="build-generic" class="st-input" placeholder="Generic: модели,генерация" style="flex: 2; min-width: 150px; padding: 6px;">
            <input type="number" id="build-budget" class="st-input" value="4000" title="Бюджет символов" style="width: 80px; padding: 6px;">
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
            <button class="st-btn st-btn--secondary" id="build-cancel" type="button" style="height: 28px; font-size: 12px;">Отмена</button>
            <button class="st-btn st-btn--primary" id="build-start" type="button" style="height: 28px; font-size: 12px; background: #8b5cf6; border-color: #8b5cf6;">Сгенерировать</button>
          </div>
        </div>
        <!-- НОВАЯ ФОРМА ЛАМПОВОГО ПРОФИЛЯ -->
		<div id="mem-lamp-form" style="display: none; background: var(--st-surface-2, #2a2a2a); padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #f5b301; flex-direction: column; gap: 8px;">
		  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
			<input type="number" id="lamp-budget" class="st-input" value="4000" title="Бюджет символов" style="width: 90px; padding: 6px;">
		  </div>
		  <textarea id="lamp-prompt" class="st-input" rows="3" style="padding: 6px; font-family: var(--st-font); resize: vertical; min-height: 60px;" placeholder="Например: хочу обсудить природу времени, без психоанализа. Интересует физика и философия, но не эзотерика."></textarea>
		  <div id="lamp-route-result" style="display: none; background: var(--st-bg, #1e1e1e); padding: 8px; border-radius: 4px; font-size: 12px; line-height: 1.5;">
			<div><strong>Anchor:</strong> <span id="lamp-r-anchors">—</span></div>
			<div><strong>Generic:</strong> <span id="lamp-r-generic">—</span></div>
			<div><strong>Exclude:</strong> <span id="lamp-r-exclude">—</span></div>
			<div style="color: #888; font-style: italic; margin-top: 4px;" id="lamp-r-note"></div>
		  </div>
		  <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
			<button class="st-btn st-btn--secondary" id="lamp-cancel" type="button" style="height: 28px; font-size: 12px;">Отмена</button>
		    <button class="st-btn st-btn--secondary" id="lamp-route" type="button" style="height: 32px; font-size: 12px;">Анализ темы</button>
            <button class="st-btn st-btn--primary" id="lamp-build" type="button" style="height: 32px; font-size: 12px; background: #8b5cf6; border-color: #8b5cf6; color: #fff;" disabled>Создать профиль</button>
		  </div>
		</div>
        <p class="muted small" style="margin-top: 0; margin-bottom: 10px;">Факты о тебе.
        <div style="flex: 1; display: flex; flex-direction: column; min-height: 0; margin-bottom: 16px;">
          <textarea id="memory-textarea" style="flex: 1; width: 100%; height: 100%; min-height: 300px; font-family: monospace; padding: 12px; border: 1px solid var(--st-border, #333); border-radius: 8px; background: var(--st-bg, #1e1e1e); color: var(--st-text, #fff); resize: none;"></textarea>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button class="st-btn st-btn--secondary" id="memory-save-exit-btn" type="button">Save &amp; Exit</button>
          <button class="st-btn st-btn--primary" id="memory-save-btn" type="button">Save</button>
        </div>
      </div>

      <div id="mem-view-system" style="flex: 1; padding: 16px; display: none; flex-direction: column; min-height: 0;">
        <p class="muted small" style="margin-top: 0; margin-bottom: 10px;">Глобальные инструкции для модели (язык, стиль, ограничения). Работают во всех профилях и чатах.</p>
        <textarea id="system-prompt-textarea" style="flex: 1; width: 100%; min-height: 300px; font-family: monospace; padding: 12px; border: 1px solid var(--st-border, #333); border-radius: 8px; background: var(--st-bg, #1e1e1e); color: var(--st-text, #fff); resize: none;"></textarea>
        <div style="padding-top: 16px; text-align: right;">
          <button class="st-btn st-btn--primary" id="system-prompt-save-btn" type="button">Save System Prompt</button>
        </div>
      </div>

      <div id="mem-view-pending" style="flex: 1; padding: 16px; display: none; flex-direction: column; min-height: 0;">
        <div style="display: flex; gap: 10px; margin-bottom: 12px;">
          <input type="text" id="mem-search" class="st-input" placeholder="Поиск по фактам..." style="flex: 1; padding: 8px; border-radius: 4px; border: 1px solid var(--st-border, #333); background: var(--st-bg, #1e1e1e); color: var(--st-text, #fff);">
          <button class="st-btn st-btn--secondary" id="mem-approve-all" type="button" style="background: #28a745; color: white; border: none;">Approve Selected</button>
          <button class="st-btn st-btn--secondary" id="mem-reject-all" type="button" style="background: #dc3545; color: white; border: none;">Reject Selected</button>
        </div>
        <div id="mem-pending-list" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;"></div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modalHTML);
}
createMemoryModalHTML();

// === Helpers для единого редактора ===
function editorIsDirty() {
    const ta = $("memory-textarea");
    return !!ta && ta.value !== editorLastSavedText;
}

function updateEditorUI() {
    const ta = $("memory-textarea");
    const select = $("memory-profile-select");
    const editBtn = $("memory-edit-toggle");
    const saveBtn = $("memory-save-btn");
    const saveExitBtn = $("memory-save-exit-btn");
    const snInput = $("memory-save-name");
    if (!ta) return;

    // Во время сохранения — всё заблокировано
    if (memorySaveInProgress) {
        ta.readOnly = true;
        if (select) select.disabled = true;
        if (editBtn) editBtn.style.display = "none";
        if (saveBtn) saveBtn.disabled = true;
        if (saveExitBtn) saveExitBtn.disabled = true;
        if (snInput) snInput.disabled = true;
        return;
    }

    if (select) select.disabled = false;
    if (snInput) snInput.disabled = false;

    ta.readOnly = (editorMode === "readonly");

    // Edit виден только в readonly и только для существующего профиля
    if (editBtn) {
        editBtn.style.display = (editorMode === "readonly" && editorViewingProfile) ? "inline-flex" : "none";
    }

    // Save разрешён только в edit-режиме и при непустом имени
    const canSave = (editorMode !== "readonly") && (editorSaveName.trim() !== "");
    if (saveBtn) saveBtn.disabled = !canSave;
    if (saveExitBtn) saveExitBtn.disabled = !canSave;

    // Синхронизация поля имени
    if (snInput && snInput.value !== editorSaveName) {
        snInput.value = editorSaveName;
    }
}

async function doSave(closeAfter) {
    if (memorySaveInProgress) return;
    if (!editorSaveName.trim()) {
        toast("warn", "Введи имя профиля для сохранения");
        return;
    }
    if (!/^[a-z0-9_-]+$/i.test(editorSaveName)) {
        toast("warn", "Плохое имя", "Только латиница, цифры, дефис, подчёркивание");
        return;
    }

    // Confirm при перезаписи чужого профиля
    const isExisting = (editorSaveName === editorViewingProfile);
    if (!isExisting) {
        const opts = Array.from($("memory-profile-select").options).map(o => o.value).filter(v => v);
        if (opts.includes(editorSaveName)) {
            if (!confirm(`Профиль «${editorSaveName}» уже существует. Перезаписать?`)) return;
        }
    }

    memorySaveInProgress = true;
    updateEditorUI();

    const text = $("memory-textarea").value;
    const target = editorSaveName;

    try {
        const r = await fetch(`api/memory?profile=${encodeURIComponent(target)}`, {
            method: "POST",
            headers: headers(true),
            body: JSON.stringify({content: text})
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
        toast("error", "Save failed", String(e.message || e));
        return;
    } finally {
        memorySaveInProgress = false;
        updateEditorUI();
    }

    // Успех — обновляем локальное состояние
    editorViewingProfile = target;
    editorSaveName = target;
    editorLastSavedText = text;
    editorMode = "edit";   // остаёмся в edit — для сборки из фрагментов

    try {
        await loadProfiles();
        if ($("memory-profile-select")) $("memory-profile-select").value = target;
    } catch (err) {
        console.error("[Memory] Save OK, but loadProfiles failed:", err);
    }
    updateEditorUI();
    toast("success", `Сохранено [${target}]`, "");

    if (closeAfter) {
        closeMemoryModal(true);
    }
}

// 2. Загрузка и сохранение профилей
async function loadProfiles() {
  try {
    const r = await fetch("api/memory/profiles", {headers: headers()});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const select = $("memory-profile-select");
    if (select) {
      const selected = editorViewingProfile || "";
      select.innerHTML = `<option value="">— не выбран —</option>` +
        (data.profiles || []).map(p =>
          `<option value="${esc(p)}"${p === selected ? " selected" : ""}>${esc(p)}</option>`
        ).join("");
    }
  } catch (e) {
    console.error("[Memory] Failed to load profiles", e);
    toast("error", "Не удалось загрузить список профилей", String(e.message || e), 6000);
  }
}

async function loadSystemPrompt() {
  try {
    const r = await fetch("api/system-prompt", {headers: headers()});
    if (r.ok) {
      const data = await r.json();
      systemPromptText = data.content || "";
    }
  } catch (e) { console.error("[SystemPrompt] Load error:", e); }
}


async function loadMemory() {
  try {
    const r = await fetch(`api/memory?profile=${encodeURIComponent(currentProfile)}`, {headers: headers()});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    memoryText = data.content || "";
    const ta = $("memory-textarea");
    if (ta) ta.value = memoryText;
  } catch (e) {
    console.error("[Memory] Load error:", e);
    toast("error", "Не удалось загрузить профиль", String(e.message || e), 6000);
  }
  updateMemoryUI();
}

function updateMemoryUI() {
  const btn = $("memory-btn");
  if (btn) {
    btn.setAttribute("aria-checked", String(memoryEnabled));
    btn.innerHTML = `${icon("brain")} Memory [${currentProfile}]: ${memoryEnabled ? "ON" : "OFF"}`;
  }
}

// 3. Логика Pending (Предложения)
async function loadPending() {
  try {
    const r = await fetch("api/memory/pending", {headers: headers()});
    if (r.ok) {
      const data = await r.json();
      pendingFacts = data.items || [];
      if ($("mem-pending-count")) $("mem-pending-count").textContent = pendingFacts.length;
      renderPending();
    }
  } catch (e) { console.error("[Memory] Failed to load pending", e); }
}

function renderPending() {
  const query = ($("mem-search")?.value || "").toLowerCase();
  filteredFacts = pendingFacts.filter(p => 
    p.fact.toLowerCase().includes(query) || 
    (p.category && p.category.toLowerCase().includes(query))
  );

  const list = $("mem-pending-list");
  if (!list) return;
  
  if (!filteredFacts.length) {
    list.innerHTML = `<div class="muted" style="text-align: center; padding: 20px;">Ничего не найдено.</div>`;
    return;
  }

  const displayFacts = filteredFacts.slice(0, 150); // Ограничение для браузера
  
  list.innerHTML = displayFacts.map((p, i) => `
    <div style="display: flex; gap: 10px; align-items: flex-start; padding: 8px; border-bottom: 1px solid var(--st-border, #333);">
      <input type="checkbox" class="mem-cb" data-index="${i}" style="margin-top: 4px;">
      <div style="flex: 1;">
        <div style="color: var(--st-text, #fff); font-size: 0.95em;">${esc(p.fact)}</div>
        <div style="font-size: 0.8em; color: #888; margin-top: 4px;">
          <span class="badge" style="background: #444; padding: 2px 6px; border-radius: 4px;">${esc(p.category || 'unknown')}</span>
          <span style="margin-left: 8px;">Conf: ${esc(p.confidence || '?')}</span>
        </div>
      </div>
    </div>
  `).join("") + (filteredFacts.length > 150 ? `<div class="muted" style="text-align: center; padding: 10px;">...и еще ${filteredFacts.length - 150} фактов (уточните поиск)</div>` : "");
}

// 4. Обработчики событий
const memBtn = $("memory-btn");
if (memBtn) {
  memBtn.onclick = () => {
    memoryEnabled = !memoryEnabled;
    store.set("memory_enabled", memoryEnabled);
    updateMemoryUI();
    toast("info", "Memory " + (memoryEnabled ? "Enabled" : "Disabled"), "");
  };
}

const memEditBtn = $("memory-edit-btn");
if (memEditBtn) {
  memEditBtn.onclick = async () => {
    // Сброс редактора в пустое состояние (Вариант B: не грузим currentProfile)
    editorViewingProfile = null;
    editorSaveName = "";
    editorMode = "edit";
    editorLastSavedText = "";
    $("memory-textarea").value = "";
    $("memory-profile-select").value = "";
    $("memory-save-name").value = "";

    // Досье — вкладка по умолчанию
    $("mem-view-dossier").style.display = "flex";
    $("mem-view-pending").style.display = "none";
    if ($("mem-view-system")) $("mem-view-system").style.display = "none";
    $("mem-tab-dossier").style.background = "var(--st-primary, #007bff)";
    $("mem-tab-pending").style.background = "transparent";
    if ($("mem-tab-system")) $("mem-tab-system").style.background = "transparent";

    $("memory-modal").style.display = "flex";
    $("memory-modal-scrim").style.display = "block";

    await loadProfiles();
    updateEditorUI();
  };
}

// Закрытие модалки: мгновенно скрываем + фоном сохраняем изменения
const closeMemoryModal = async (force = false) => {
  if (memorySaveInProgress && !force) {
    toast("info", "Сохранение…", "Подожди завершения записи", 3000);
    return;
  }
  if (!force && editorIsDirty()) {
    if (!confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
  }

  // Скрываем модалку сразу
  if ($("memory-modal")) $("memory-modal").style.display = "none";
  if ($("memory-modal-scrim")) $("memory-modal-scrim").style.display = "none";

  // Обновляем активный профиль только при наличии выбранного в редакторе
  if (editorViewingProfile && editorViewingProfile !== currentProfile) {
    currentProfile = editorViewingProfile;
    store.set("memory_profile", currentProfile);
    try {
      await loadMemory();
    } catch (e) {
      console.error("[Memory] loadMemory after close failed:", e);
    }
  }
};

// Обработчик крестика (кнопка X)
if ($("memory-modal-close")) {
  $("memory-modal-close").onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMemoryModal();
  };
}

// Обработчик клика по подложке (закрывает модалку)
if ($("memory-modal-scrim")) {
  $("memory-modal-scrim").onclick = (e) => {
    e.preventDefault();
    closeMemoryModal();
  };
}
if ($("mem-tab-dossier")) {
  $("mem-tab-dossier").onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Только переключение вкладок, БЕЗ loadMemory (иначе затрём правки в textarea)
    $("mem-view-dossier").style.display = "flex";
    $("mem-view-pending").style.display = "none";
    if ($("mem-view-system")) $("mem-view-system").style.display = "none";
    $("mem-tab-dossier").style.background = "var(--st-primary, #007bff)";
    $("mem-tab-pending").style.background = "transparent";
    if ($("mem-tab-system")) $("mem-tab-system").style.background = "transparent";
  };
}

if ($("mem-tab-system")) {
  $("mem-tab-system").onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
        // Автосохранение убрано — новая модель: только явный Save пишет на диск
    // Показать System Prompt
    $("mem-view-dossier").style.display = "none";
    $("mem-view-pending").style.display = "none";
    $("mem-view-system").style.display = "flex";
    $("mem-tab-dossier").style.background = "transparent";
    $("mem-tab-pending").style.background = "transparent";
    $("mem-tab-system").style.background = "var(--st-primary, #007bff)";
    
    await loadSystemPrompt();
    $("system-prompt-textarea").value = systemPromptText;
  };
}

if ($("mem-tab-pending")) {
  $("mem-tab-pending").onclick = async () => {
        // Автосохранение убрано — новая модель
    $("mem-view-dossier").style.display = "none";
	$("mem-view-pending").style.display = "flex";
	if ($("mem-view-system")) $("mem-view-system").style.display = "none";
	if ($("mem-tab-system")) $("mem-tab-system").style.background = "transparent";
    loadPending();
  };
}

if ($("mem-search")) $("mem-search").addEventListener("input", renderPending);
if ($("system-prompt-save-btn")) {
  $("system-prompt-save-btn").onclick = async () => {
    const ta = $("system-prompt-textarea");
    if (!ta) return;
    const text = ta.value;
    try {
      const r = await fetch("api/system-prompt", {
        method: "POST", headers: headers(true), body: JSON.stringify({content: text})
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      systemPromptText = text;
      toast("success", "System Prompt saved", "");
    } catch (e) { toast("error", "Save failed", e.message); }
  };
}

if ($("memory-save-btn")) {
  $("memory-save-btn").onclick = async () => {
    await doSave(false);
  };
}

if ($("memory-save-exit-btn")) {
  $("memory-save-exit-btn").onclick = async () => {
    await doSave(true);
  };
}

if ($("memory-profile-select")) {
  $("memory-profile-select").addEventListener("change", async (e) => {
    if (memorySaveInProgress) {
      e.target.value = editorViewingProfile || "";
      toast("info", "Сохранение…", "Подожди завершения", 3000);
      return;
    }

    const newName = e.target.value;

    // Пустой селект = "— не выбран —"
    if (!newName) {
      if (editorIsDirty()) {
        if (!confirm("Есть несохранённые изменения. Продолжить без сохранения?")) {
          e.target.value = editorViewingProfile || "";
          return;
        }
      }
      editorViewingProfile = null;
      editorSaveName = "";
      editorMode = "edit";
      editorLastSavedText = "";
      $("memory-textarea").value = "";
      updateEditorUI();
      return;
    }

    // Dirty check перед переключением на другой профиль
    if (editorIsDirty()) {
      if (!confirm("Есть несохранённые изменения. Продолжить без сохранения?")) {
        e.target.value = editorViewingProfile || "";
        return;
      }
    }

    // Загрузка профиля — read-only, без автосохранения
    try {
      const r = await fetch(`api/memory?profile=${encodeURIComponent(newName)}`, {headers: headers()});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const content = data.content || "";
      $("memory-textarea").value = content;
      editorViewingProfile = newName;
      editorSaveName = newName;
      editorLastSavedText = content;
      editorMode = "readonly";
      updateEditorUI();
    } catch (err) {
      toast("error", "Ошибка загрузки", String(err.message || err), 8000);
      e.target.value = editorViewingProfile || "";
    }
  });
}

if ($("memory-profile-new")) {
  $("memory-profile-new").onclick = async () => {
    if (memorySaveInProgress) {
      toast("info", "Сохранение…", "Подожди завершения", 3000);
      return;
    }
    if (editorIsDirty()) {
      if (!confirm("Есть несохранённые изменения. Продолжить без сохранения?")) return;
    }
    const name = prompt("Введите название нового профиля (латиницей, без пробелов):");
    if (!name || !/^[a-z0-9_-]+$/i.test(name)) return toast("warn", "Некорректное имя");

    editorViewingProfile = null;
    editorSaveName = name;
    editorMode = "edit";
    editorLastSavedText = "";
    $("memory-textarea").value = "";
    $("memory-profile-select").value = "";
    $("memory-save-name").value = name;
    updateEditorUI();

    toast("info", `Черновик «${name}»`, "Нажми Save, чтобы записать на диск", 6000);
  };
}

if ($("memory-save-name")) {
  $("memory-save-name").addEventListener("input", (e) => {
    editorSaveName = e.target.value.trim();
    updateEditorUI();
  });
}

if ($("memory-edit-toggle")) {
  $("memory-edit-toggle").onclick = () => {
    if (memorySaveInProgress) return;
    editorMode = "edit";
    // Baseline НЕ сбрасываем — если пользователь откроет и не изменит, dirty=false
    updateEditorUI();
  };
}

// Логика формы генерации
if ($("memory-build-btn")) {
  $("memory-build-btn").onclick = () => {
    $("mem-build-form").style.display = "flex";
    $("memory-build-btn").style.display = "none"; // Прячем кнопку
    
    // Подставляем текущее имя профиля, если это не core
    $("build-name").value = currentProfile !== "core" ? currentProfile : "krea";
  };

  $("build-cancel").onclick = () => {
    $("mem-build-form").style.display = "none";
    $("memory-build-btn").style.display = "inline-flex"; // Возвращаем кнопку
  };

  $("build-start").onclick = async () => {
    if (memorySaveInProgress) {
      toast("info", "Сохранение…", "Подожди завершения", 3000);
      return;
    }

    const name = "build_" + new Date().toISOString().slice(0,10).replace(/-/g,"");
    const anchor = $("build-anchor").value.trim();
    const keywords = $("build-generic").value.trim();
    const budget = parseInt($("build-budget").value) || 4000;

    if (!name || !anchor || !keywords) {
      return toast("warn", "Заполните поля", "Имя, Anchor и Generic обязательны");
    }

    if (editorIsDirty()) {
      if (!confirm("В редакторе есть несохранённые изменения. Продолжить генерацию? Несохранённый текст будет потерян.")) return;
    }

    // Прячем форму, показываем оверлей
    $("mem-build-form").style.display = "none";
    const btn = $("memory-build-btn");
    btn.innerHTML = "⏳ Сборка...";
    btn.disabled = true;
    
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:var(--st-font);";
    overlay.innerHTML = `
      <div style="border: 4px solid rgba(255,255,255,0.2); border-top: 4px solid #8b5cf6; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px;"></div>
      <div style="font-size: 18px; font-weight: 600;">Анализирую память...</div>
      <div style="font-size: 14px; opacity: 0.7; margin-top: 8px;">Это может занять до минуты</div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(overlay);

    try {
      const r = await fetch("api/memory/build-profile", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({
          name: name,
          keywords: keywords,
          anchor: anchor,
          min_generic: 2,
          budget: budget
        })
      });
      
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Server error");
      
      $("memory-textarea").value = data.markdown;
	  $("memory-save-name").value = name; // Подставляем имя для сохранения
      editorViewingProfile = null;
      editorSaveName = name;
      editorMode = "edit";
      editorLastSavedText = "";   // всегда dirty: пользователь должен сохранить
      $("memory-save-name").value = name;
      await loadProfiles();
      $("memory-profile-select").value = "";
      updateEditorUI();

      
      toast("success", "Профиль собран", "Проверьте текст и нажмите Save", 8000);
      
    } catch (e) {
      console.error("[Build Profile] Error:", e);
      toast("error", "Ошибка сборки", String(e.message || e), 10000);
      $("mem-build-form").style.display = "flex"; // Возвращаем форму при ошибке
    } finally {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      btn.innerHTML = "⚡ Сгенерировать";
      btn.disabled = false;
      btn.style.display = "inline-flex"; // Возвращаем кнопку
    }
  };
	// ================= ЛАМПОВЫЙ ПРОФИЛЬ =================
	// Три шага: показать форму → route (LLM вытащила ключи) → build (LLM собрала markdown).
	// Результат кладётся в тот же memory-textarea, что и у ⚡ Сгенерировать.
	// Сохранение — обычной кнопкой "Save Profile".

	let lampRouted = false;

	function showLampForm() {
		$("mem-lamp-form").style.display = "flex";
		$("memory-build-btn").style.display = "none";
		$("mem-lamp-btn").style.display = "none";
		lampRouted = false;
		$("lamp-route-result").style.display = "none";
		$("lamp-build").disabled = true;
		if (!$("lamp-name").value) {
			$("lamp-name").value = "lamp_" + new Date().toISOString().slice(0, 10).replace(/-/g, "");
		}
	}

	function hideLampForm() {
		$("mem-lamp-form").style.display = "none";
		$("memory-build-btn").style.display = "inline-flex";
		$("mem-lamp-btn").style.display = "inline-flex";
		lampRouted = false;
	}

	if ($("mem-lamp-btn")) {
		$("mem-lamp-btn").onclick = showLampForm;

		$("lamp-cancel").onclick = () => {
			hideLampForm();
			$("lamp-route-result").style.display = "none";
			$("lamp-prompt").value = "";
			$("lamp-name").value = "";
		};

		$("lamp-route").onclick = async () => {
			const text = $("lamp-prompt").value.trim();
			if (!text) return toast("warn", "Опиши тему", "Например: природа времени без психоанализа");

			const routeBtn = $("lamp-route");
			routeBtn.disabled = true;
			routeBtn.textContent = "Маршрут…";

			try {
				const r = await fetch("/api/profile/route", {
					method: "POST",
					headers: headers(true),
					body: JSON.stringify({text}),
				});
				const data = await r.json();
				if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);

				const p = data.profile;
				$("lamp-route-result").style.display = "block";
				$("lamp-r-anchors").textContent = (p.anchors || []).join(", ") || "—";
				$("lamp-r-generic").textContent = (p.generic || []).join(", ") || "—";
				$("lamp-r-exclude").textContent = (p.exclude || []).join(", ") || "—";
				$("lamp-r-note").textContent = p.note || "";

				lampRouted = true;
				$("lamp-build").disabled = false;
				// Меняем стиль кнопки, когда она становится активной
                $("lamp-build").style.background = "#8b5cf6";
                routeBtn.textContent = "Анализ выполнен ✓";
				
			} catch (e) {
				console.error("[Lamp] Route failed:", e);
				toast("error", "Маршрут не проложен", String(e.message || e), 8000);
				routeBtn.textContent = "1. Проложить";
			} finally {
				routeBtn.disabled = false;
			}
		};

		$("lamp-build").onclick = async () => {
			if (memorySaveInProgress) {
				toast("info", "Сохранение…", "Подожди завершения", 3000);
				return;
			}
			if (!lampRouted) return;
	        const name = "lamp_" + new Date().toISOString().slice(0,10).replace(/-/g,""); // авто-имя
			const budget = parseInt($("lamp-budget").value) || 4000;

			if (!/^[a-z0-9_-]+$/i.test(name)) {
				return toast("warn", "Плохое имя", "Латиница, цифры, дефис, подчёркивание");
			}

			if (editorIsDirty()) {
				if (!confirm("В редакторе есть несохранённые изменения. Продолжить генерацию? Несохранённый текст будет потерян.")) return;
			}

			const buildBtn = $("lamp-build");
			buildBtn.disabled = true;
			buildBtn.textContent = "Сборка…";

			// Оверлей — как у ⚡ Сгенерировать
			const overlay = document.createElement("div");
			overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:var(--st-font);";
			overlay.innerHTML = `
			  <div style="border: 4px solid rgba(255,255,255,0.2); border-top: 4px solid #f5b301; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px;"></div>
			  <div style="font-size: 18px; font-weight: 600;">Собираю ламповый профиль…</div>
			  <div style="font-size: 14px; opacity: 0.7; margin-top: 8px;">Может занять до минуты</div>
			`;
			document.body.appendChild(overlay);

			try {
				const r = await fetch(
					`/api/profile/build-from-current?name=${encodeURIComponent(name)}&budget=${budget}`,
					{method: "POST", headers: headers(true)}
				);
				const data = await r.json();
				if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);

            // Кладём в общий редактор
            $("memory-textarea").value = data.markdown;
			$("memory-save-name").value = name;
            editorViewingProfile = null;
            editorSaveName = name;
            editorMode = "edit";
            editorLastSavedText = "";   // всегда dirty
            $("memory-save-name").value = name;
            await loadProfiles();
            $("memory-profile-select").value = "";
            updateEditorUI();

            hideLampForm();
            toast("success", `Собран «${name}»`, "Проверь текст и нажми Save", 8000);
				} catch (e) {
					console.error("[Lamp] Build failed:", e);
					const msg = String(e.message || e);
					if (msg.includes("No facts passed keyword filter")) {
						toast("warn", "Ключи слишком узкие",
							  "Router выдал фразы, не совпадающие с фактами. Нажми '1. Проложить' ещё раз (LLM переформулирует) или впиши имя покороче/другие ключи.",
							  12000);
					} else {
						toast("error", "Сборка не удалась", msg, 10000);
					}
				} finally {
				if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
				buildBtn.disabled = false;
				buildBtn.textContent = "2. Собрать";
			}
		};
	}
	// ======================================================    
}

const getSelectedFacts = () => {
  const cbs = document.querySelectorAll(".mem-cb:checked");
  return Array.from(cbs).map(cb => filteredFacts[+cb.dataset.index].fact);
};

if ($("mem-approve-all")) {
  $("mem-approve-all").onclick = async () => {
    const facts = getSelectedFacts();
    if (!facts.length) return toast("warn", "Не выбрано ни одного факта");
    
    console.log(`[Memory] Approving ${facts.length} facts to profile: ${currentProfile}`);
    
    try {
      const r = await fetch(`api/memory/approve?profile=${currentProfile}`, {
        method: "POST", headers: headers(true), body: JSON.stringify({facts})
      });
      
      const respText = await r.text();
      console.log(`[Memory] Approve response (${r.status}):`, respText);
      
      if (!r.ok) throw new Error(`Server error: ${respText}`);
      
      toast("success", `Одобрено ${facts.length} фактов`);
      await loadPending(); // ЖДЕМ загрузку pending
      await loadMemory();  // ЖДЕМ загрузку памяти (и она сама обновит textarea)
    } catch (e) { 
      console.error("[Memory] Approve failed:", e);
      toast("error", "Ошибка: " + e.message); 
    }
  };
}

if ($("mem-reject-all")) {
  $("mem-reject-all").onclick = async () => {
    const facts = getSelectedFacts();
    if (!facts.length) return toast("warn", "Выберите факты для отклонения");
    
    try {
      const r = await fetch("api/memory/reject", {
        method: "POST", headers: headers(true), body: JSON.stringify({facts})
      });
      if (!r.ok) throw new Error("Server error");
      toast("info", `Отклонено ${facts.length} фактов`);
      loadPending();
    } catch (e) { toast("error", "Ошибка: " + e.message); }
  };
}

// Загружаем память при старте
loadMemory();
loadSystemPrompt();

// ---- Provider settings UI ----
$("prov-select").value = providerSettings.provider;
$("prov-base").value = providerSettings.base_url || getP().defaultBaseUrl;
$("prov-model").value = providerSettings.model_id;
function refreshProviderUI() {
  const p = getP();
  $("prov-base").disabled = p.id === "strata";
  $("prov-refresh").disabled = p.id === "strata";
  $("prov-models-list").innerHTML = "";
  $("prov-model-status").textContent = "";
  updateVisionHint();
}
refreshProviderUI();

async function maybeAutoDetectStrata() {
  // Один раз за сессию
  if (sessionStorage.getItem("strata.autodetect_done")) return;
  sessionStorage.setItem("strata.autodetect_done", "1");

  // Если пользователь явно выбрал провайдера за последние 30 минут — не трогаем
  const lastChange = store.get("provider_changed_at", 0);
  if (Date.now() - lastChange < 30 * 60 * 1000) return;

  // Уже на Strata — нечего менять
  if (store.get("provider", "strata") === "strata") return;

  // Проверяем /health (это всегда LLM_BACKEND_URL = порт Strata)
  let healthData;
  try {
    const r = await fetch("health", {signal: AbortSignal.timeout(3000)});
    if (!r.ok) return;
    healthData = await r.json();
  } catch (e) {
    return;                       // Strata не запущена — оставляем выбор пользователя
  }
  if (!healthData || typeof healthData.model !== "string" || !healthData.model) return;

  // Меняем провайдера на Strata
  const prev = {
    provider: store.get("provider", "strata"),
    base_url: store.get("base_url", ""),
    model_id: store.get("model_id", ""),
  };

  store.set("provider", "strata");
  store.set("base_url", "");
  providerSettings.provider = "strata";
  providerSettings.base_url = "";
  if ($("prov-select")) $("prov-select").value = "strata";
  if ($("prov-base")) $("prov-base").value = "";
  refreshProviderUI();
  loadHealth();
  updateVisionHint();

  toast("info", "Detected Strata",
        `Switched to Strata (native) · ${healthData.model}`, 10000, {
    label: "Undo",
    run: () => {
      store.set("provider", prev.provider);
      store.set("base_url", prev.base_url);
      store.set("model_id", prev.model_id);
      providerSettings.provider = prev.provider;
      providerSettings.base_url = prev.base_url;
      if ($("prov-select")) $("prov-select").value = prev.provider;
      if ($("prov-base")) $("prov-base").value = prev.base_url;
      if ($("prov-model")) $("prov-model").value = prev.model_id;
      refreshProviderUI();
      loadHealth();
      updateVisionHint();
    },
  });
}

$("prov-select").onchange = () => {
  providerSettings.provider = $("prov-select").value;
  store.set("provider", providerSettings.provider);
  store.set("provider_changed_at", Date.now());
  if (getP().id === "strata") {
    providerSettings.base_url = "";
  } else if (!providerSettings.base_url || /localhost/.test(providerSettings.base_url)) {
    providerSettings.base_url = getP().defaultBaseUrl;   // ← сюда попадает 127.0.0.1
  }
  store.set("base_url", providerSettings.base_url);
  $("prov-base").value = providerSettings.base_url;
  refreshProviderUI();
  loadHealth();
};

$("prov-base").onchange = () => {
  providerSettings.base_url = $("prov-base").value.trim();
  store.set("base_url", providerSettings.base_url);
};
$("prov-model").onchange = () => {
  const v = $("prov-model").value.trim();
  if (v === providerSettings.model_id) return;
  providerSettings.model_id = v;
  store.set("model_id", v);
  updateVisionHint();  
  if (v) toast("info", "Model selected", v, 3000);
};
$("prov-refresh").onclick = async () => {
  $("prov-vision-manual").onclick = () => {
  const cur = $("prov-vision-manual").getAttribute("aria-checked") === "true";
  store.set("vision_manual", !cur);
  $("prov-vision-manual").setAttribute("aria-checked", String(!cur));
  updateVisionHint();
  };
  const p = getP();
  if (p.id === "strata") return;
  $("prov-model-status").textContent = "loading…";
  const base = providerSettings.base_url || p.defaultBaseUrl;
  const r = await p.fetchCapabilities({ baseUrl: base });
  if (r.error) { $("prov-model-status").textContent = r.error; return; }
  if (!r.models.length) {
    $("prov-model-status").textContent = "no models reported; enter id manually";
    return;
  }
  providerSettings._caps = r.models;
  store.set("model_caps", r.models);
  updateVisionHint();  
  $("prov-model-status").textContent = `${r.models.length} model(s)`;
  $("prov-models-list").innerHTML = r.models
    .map((m) => `<button type="button" class="chip" data-pick-model="${esc(m.id)}">${esc(m.name)}</button>`)
    .join(" ");
  $("prov-models-list").querySelectorAll("[data-pick-model]").forEach((b) => {
    b.onclick = () => {
      $("prov-model").value = b.dataset.pickModel;
      providerSettings.model_id = b.dataset.pickModel;
      store.set("model_id", providerSettings.model_id);
      updateVisionHint();
      toast("info", "Model selected", b.dataset.pickModel, 4000);
    };
  });
};

$("prov-vision-manual").onclick = () => {
  const cur = $("prov-vision-manual").getAttribute("aria-checked") === "true";
  store.set("vision_manual", !cur);
  $("prov-vision-manual").setAttribute("aria-checked", String(!cur));
  updateVisionHint();
};
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if ($("mem-lamp-form") && $("mem-lamp-form").style.display !== "none") {
            $("lamp-cancel").click();
        }
        if ($("mem-build-form") && $("mem-build-form").style.display !== "none") {
            $("build-cancel").click();
        }
    }
});
// ==================================================================
// HISTORY MODULE API EXPORTS
// В "use strict" объявления function/let/var НЕ попадают в window
// Этот блок обязателен для работы history-module.js
// ==================================================================
window.$ = $;
window.store = store;
window.toast = toast;
window.esc = esc;
Object.defineProperty(window, "messages", {
    configurable: true,
    get: () => messages,
    set: (value) => { messages = value; }
});
window.saveChat = saveChat;
window.renderChat = renderChat;
window.openDrawer = openDrawer;
window.loadDrawer = loadDrawer;
window.loadShared = loadShared;
window.loadMcp = loadMcp;
window.setBusy = setBusy;
window.busy = busy; // Для проверки состояния стрима из модуля истории
window.health = health;  // ← ДОБАВЛЕНО: модель и возможности сервера

// Сеттер: прямое присваивание window.messages НЕ обновляет
// локальную переменную let messages внутри этого модуля
window.setMessages = (newMessages) => {
    messages = newMessages;
};

// Геттер/сеттер для busy (объект mutable, но ссылка может меняться)
window.getBusy = () => busy;
window.setBusyState = (state) => { busy = state; };

Object.defineProperty(window, "lastMetrics", {
    configurable: true,
    get: () => lastMetrics
});