// ============================================================================
// Strawberry — менеджер подключений (этап 15).
//
// Единственное место, где живёт состояние «к какому серверу мы подключены».
// Connection — стабильный ID, название, base URL, тип (kind), model ID, каталог
// моделей этого сервера, capabilities, состояние доступности, время обновления.
// Тип != подключение: несколько подключений одного типа допустимы, у каждого —
// свой каталог, своя модель и свои capabilities.
//
// Чего здесь НЕТ (сознательно):
//   * автоматического переключения на другой сервер при недоступности;
//   * автоматической загрузки/выгрузки моделей;
//   * автосканирования портов;
//   * переноса модели или capabilities между подключениями.
//
// Хранилище — только браузер: localStorage, один ключ strata.v1.
// Старые ключи (provider/base_url/model_id/model_caps/vision_probe/vision_manual/
// provider_changed_at) больше не читаются и удаляются при первом запуске.
// ============================================================================
window.Connections = (function () {

  const KEY = "strata.v1";
  const LEGACY_KEYS = ["provider", "base_url", "model_id", "model_caps",
                       "vision_probe", "vision_manual", "provider_changed_at"];

  let state = null;
  const listeners = [];

  // ---------------------------------------------------------------- утилиты
  const uid = () => "c" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  const isNative = (conn) => !!conn && conn.base === "";

  function blank({ name, base }) {
    return {
      id: uid(),
      name: String(name || "").trim() || "Подключение",
      base: Transport.cleanBaseUrl(base || ""),          // "" = тот же origin (родной движок)
      kind: "openai", kindState: "unverified", kindPrev: null, markers: [],
      model: "", catalog: [], catalogAt: null,
      state: "unknown", lastOkAt: null, lastErrAt: null, lastError: null,
      flags: { vision: null, reasoning: null },
      createdAt: Date.now(),
    };
  }

  function sanitize(c) {
    const b = blank({ name: (c && c.name) || "", base: (c && c.base) || "" });
    if (c && typeof c.id === "string" && c.id) b.id = c.id;
    if (c) {
      if (["openai", "strata", "strata2", "llamacpp", "lmstudio"].indexOf(c.kind) >= 0) b.kind = c.kind;
      if (["unverified", "detected", "manual", "needs-redetect", "mismatch"].indexOf(c.kindState) >= 0) b.kindState = c.kindState;
      b.kindPrev = c.kindPrev || null;
      b.markers = Array.isArray(c.markers) ? c.markers.slice(0, 8) : [];
      b.model = typeof c.model === "string" ? c.model : "";
      b.catalog = Array.isArray(c.catalog) ? c.catalog.filter((m) => m && typeof m.id === "string") : [];
      b.catalogAt = typeof c.catalogAt === "number" ? c.catalogAt : null;
      if (["unknown", "ok", "error"].indexOf(c.state) >= 0) b.state = c.state;
      b.lastOkAt = typeof c.lastOkAt === "number" ? c.lastOkAt : null;
      b.lastErrAt = typeof c.lastErrAt === "number" ? c.lastErrAt : null;
      b.lastError = typeof c.lastError === "string" ? c.lastError.slice(0, 200) : null;
      if (c.flags && typeof c.flags === "object") {
        b.flags.vision = typeof c.flags.vision === "boolean" ? c.flags.vision : null;
        b.flags.reasoning = typeof c.flags.reasoning === "boolean" ? c.flags.reasoning : null;
      }
      // Отметка «сохранённая модель исчезла из каталога» — тоже часть состояния подключения.
      if (typeof c.staleModel === "string" && c.staleModel) b.staleModel = c.staleModel;
    }
    return b;
  }

  // ---------------------------------------------------------------- хранилище
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } }

  function dropLegacy() {
    try { for (const k of LEGACY_KEYS) localStorage.removeItem("strata." + k); } catch (e) { /* ignore */ }
  }

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { raw = null; }
    if (raw && raw.version === 1 && raw.connections && typeof raw.connections === "object") {
      const conns = {};
      for (const id of Object.keys(raw.connections)) conns[id] = sanitize(raw.connections[id]);
      state = { version: 1, active: "", connections: conns };
      if (!state.connections[state.active] ) {
        const ids = Object.keys(state.connections);
        state.active = (raw.active && state.connections[raw.active]) ? raw.active : (ids[0] || "");
      }
    } else {
      state = { version: 1, active: "", connections: {} };
    }
    if (!Object.keys(state.connections).length) {
      const native = blank({ name: "Этот сервер", base: "" });   // base "" — способ маршрутизации, НЕ тип
      state.connections[native.id] = native;
      state.active = native.id;
    }
    dropLegacy();
    save();
    return state;
  }

  // ---------------------------------------------------------------- события
  function subscribe(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function emit() { for (const fn of listeners) { try { fn(snapshot()); } catch (e) { /* UI-ошибка не ломает менеджер */ } } }

  // ---------------------------------------------------------------- чтение
  // Ленивая инициализация: читать можно из любого места, порядок скриптов не важен.
  function ensure() { if (!state) load(); return state; }

  const all = () => Object.keys(ensure().connections).map((id) => state.connections[id]);
  const get = (id) => ensure().connections[id] || null;
  const active = () => ensure().connections[state.active] || null;
  const activeId = () => ensure().active;

  function snapshot() {
    return {
      active: state.active,
      connections: all().map((c) => ({
        id: c.id, name: c.name, base: c.base, native: isNative(c), kind: c.kind,
        kindState: c.kindState, kindPrev: c.kindPrev, markers: c.markers.slice(),
        model: c.model, modelCount: c.catalog.length, catalogAt: c.catalogAt,
        state: c.state, lastOkAt: c.lastOkAt, lastErrAt: c.lastErrAt, lastError: c.lastError,
        flags: { vision: c.flags.vision, reasoning: c.flags.reasoning },
      })),
    };
  }

  function byModel(conn, modelId) {
    if (!conn || !modelId) return null;
    return conn.catalog.find((m) => m.id === modelId ||
             (Array.isArray(m.aliases) && m.aliases.indexOf(modelId) >= 0)) || null;
  }

  // Модель для запроса: только своя модель подключения. Если выбор ещё не сделан и
  // сервер сообщает ровно одну модель — берём её (это не переключение сервера).
  function selectedModel(conn) {
    if (!conn) return "";
    if (conn.model) return conn.model;
    if (conn.catalog.length === 1) return conn.catalog[0].id;
    return "";
  }

  // ---------------------------------------------------------------- изменение
  function add({ name, base }) {
    const c = blank({ name, base });
    if (Object.keys(state.connections).some((id) => state.connections[id].base === c.base && c.base !== "")) {
      // не запрещаем, но и не объединяем: два подключения к одному адресу — разные записи
    }
    state.connections[c.id] = c;
    save();
    return c;
  }

  function rename(id, name) {
    const c = get(id); if (!c) return false;
    c.name = String(name || "").trim() || c.name;
    save(); emit();
    return true;
  }

  // Смена адреса = новое подключение по смыслу: каталог, модель, тип и флаги сбрасываются.
  function setBase(id, base) {
    const c = get(id); if (!c) return false;
    const nb = Transport.cleanBaseUrl(base || "");
    if (nb === c.base) return false;
    c.kindPrev = c.kind;
    c.base = nb;
    c.kind = "openai";
    c.kindState = "unverified";
    c.markers = [];
    c.catalog = [];
    c.catalogAt = null;
    c.model = "";
    c.flags = { vision: null, reasoning: null };
    c.state = "unknown";
    c.lastError = null;
    save(); emit();
    return true;
  }

  // Ручной выбор типа — всегда возможное исправление, включая конфликт отпечатков.
  function setKind(id, kind) {
    const c = get(id); if (!c) return false;
    if (["openai", "strata", "strata2", "llamacpp", "lmstudio"].indexOf(kind) < 0) return false;
    c.kindPrev = c.kind;
    c.kind = kind;
    c.kindState = "manual";
    c.catalog = [];
    c.catalogAt = null;
    c.model = "";
    save(); emit();
    return true;
  }

  function setModel(id, modelId) {
    const c = get(id); if (!c) return false;
    c.model = String(modelId || "").trim();
    save(); emit();
    return true;
  }

  function setFlag(id, name, value) {
    const c = get(id); if (!c) return false;
    if (name !== "vision" && name !== "reasoning") return false;
    c.flags[name] = (typeof value === "boolean") ? value : null;
    save(); emit();
    return true;
  }

  function setActive(id) {
    if (!ensure().connections[id]) return false;
    if (state.active === id) return false;
    state.active = id;          // никакого автопереключения: только явное действие пользователя
    save(); emit();
    return true;
  }

  function remove(id) {
    if (!state.connections[id]) return false;
    if (Object.keys(state.connections).length <= 1) return false;   // последнее подключение не удаляем
    delete state.connections[id];
    if (state.active === id) state.active = Object.keys(state.connections)[0];
    save(); emit();
    return true;
  }

  // ---------------------------------------------------------------- сеть
  async function ping(id) {
    const c = get(id || state.active); if (!c) return { ok: false, error: "no such connection" };
    const r = await Providers.ping(c);
    if (r.ok) { c.state = "ok"; c.lastOkAt = Date.now(); c.lastError = null; }
    else { c.state = "error"; c.lastErrAt = Date.now(); c.lastError = String(r.error || "unreachable").slice(0, 200); }
    save(); emit();
    return r;
  }

  // Обновление каталога ТОЛЬКО этого подключения. Тип перезаписывается только если он
  // не задан вручную; ручной выбор (kindState "manual") сохраняется.
  async function refresh(id) {
    const c = get(id || state.active); if (!c) return { ok: false, error: "no such connection" };
    const r = await Providers.fetchCatalog(c);
    c.state = r.ok ? "ok" : "error";
    if (r.ok) c.lastOkAt = Date.now(); else { c.lastErrAt = Date.now(); c.lastError = "catalog unavailable"; }
    c.markers = r.markers.slice();
    c.catalog = r.models;
    c.catalogAt = Date.now();
    if (c.kindState === "manual") {
      // пользователь выбрал тип сам: каталог берём по его выбору, тип не меняем
      if (c.kind !== r.kind) c.kindPrev = r.kind;
    } else if (r.kindState === "mismatch") {
      c.kindPrev = c.kind; c.kind = "openai"; c.kindState = "mismatch";
    } else if (r.kindState === "detected" || r.kindState === "needs-redetect") {
      if (c.kind !== r.kind) c.kindPrev = c.kind;
      c.kind = r.kind; c.kindState = r.kindState;
    }
    if (c.model && !byModel(c, c.model) && c.catalog.length) c.staleModel = c.model; else delete c.staleModel;
    save(); emit();
    return r;
  }

  function caps(connOrId, modelId) {
    const c = (typeof connOrId === "string") ? get(connOrId) : connOrId;
    if (!c) return { vision: null, reasoning: null, tools: null };
    return Providers.capabilities(c, byModel(c, modelId || selectedModel(c)));
  }

  function init() { load(); emit(); return state; }

  return {
    KEY, init, subscribe, snapshot,
    all, get, active, activeId, byModel, selectedModel, caps,
    add, rename, setBase, setKind, setModel, setFlag, setActive, remove,
    ping, refresh,
    isNative,
  };
})();
