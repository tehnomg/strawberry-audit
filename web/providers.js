// ============================================================================
// Strawberry — реестр адаптеров бэкендов (этап 15).
//
// Адаптер отвечает ТОЛЬКО за различия API: отпечаток типа, каталог моделей,
// capabilities и специфичные поля тела запроса. Адрес, fetch, разбор потока,
// usage и ошибки — в transport.js. Состояние подключений — в connections.js.
//
// Тип (kind) никогда не выводится из имени порта и не из пустого base.
// Отпечатки подтверждены живыми ответами 08.11 (fp15.json / fp15b.txt):
//   Strata2   :8080 — /v1/models: data[].owned_by="strata", meta.instanceId
//   llama.cpp :8081 — /v1/models: data[].owned_by="llamacpp"; /props: model_alias,
//                     default_generation_settings, modalities, chat_template_caps
//   LM Studio :1234 — /api/v0/models: data[].state; /api/v1/models: models[].key
//   /health, /props, /metrics у Strata2 — HTML SPA-заглушка; /metrics llama.cpp — 501;
//   /health у LM Studio — HTTP 200 с {"error": ...}: живость проверяем по /v1/models.
// ============================================================================
window.Providers = (function () {

  const KIND_LABELS = {
    openai:   "OpenAI-совместимый",
    strata2:  "Strata 2 (OpenAI API)",
    strata:   "Strata (родной движок этого сервера)",
    llamacpp: "llama.cpp",
    lmstudio: "LM Studio",
  };
  // Ручной выбор в интерфейсе (strata — только для подключения «этот сервер»).
  const MANUAL_KINDS = ["openai", "strata2", "llamacpp", "lmstudio", "strata"];

  const PROBE_PATHS = ["/v1/models", "/props", "/api/v0/models", "/api/v1/models"];

  const has = (v) => v !== undefined && v !== null;
  const arr = (v) => Array.isArray(v) ? v : [];
  const str = (v) => (typeof v === "string" && v ? v : null);
  const bool = (v) => (typeof v === "boolean" ? v : null);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

  // ---------------------------------------------------------------- отпечаток
  // 4 GET на ОДНО подключение; Transport.json не бросает исключений.
  async function probe(conn) {
    const raw = {};
    for (const path of PROBE_PATHS) raw[path] = await Transport.json(conn, path, { timeout: 4000 });
    return raw;
  }

  // Каждый признак — отдельный факт из реального ответа. Для подтверждения типа
  // нужно два признака одного вендора; при конфликте — generic openai + ручной выбор.
  function markersOf(raw) {
    const m = [];
    const v1 = raw["/v1/models"];
    const d1 = (v1 && v1.ok) ? arr(v1.json && v1.json.data) : [];
    const pr = raw["/props"];
    const v0 = raw["/api/v0/models"];
    const vN = raw["/api/v1/models"];

    if (d1.some((x) => x && x.owned_by === "strata")) m.push("strata.owned_by");
    if (d1.some((x) => x && x.meta && has(x.meta.instanceId))) m.push("strata.instanceId");

    if (pr && pr.ok && pr.json && str(pr.json.model_alias) && pr.json.default_generation_settings) m.push("llamacpp.props");
    if (d1.some((x) => x && x.owned_by === "llamacpp")) m.push("llamacpp.owned_by");

    if (v0 && v0.ok && arr(v0.json && v0.json.data).some((x) => x && str(x.state))) m.push("lmstudio.v0.state");
    if (vN && vN.ok && arr(vN.json && vN.json.models).some((x) => x && str(x.key))) m.push("lmstudio.v1.key");

    return m;
  }

  const KIND_OF_MARKER = {
    "strata.owned_by": "strata", "strata.instanceId": "strata",
    "llamacpp.props": "llamacpp", "llamacpp.owned_by": "llamacpp",
    "lmstudio.v0.state": "lmstudio", "lmstudio.v1.key": "lmstudio",
  };

  // Отпечаток Strata один и тот же по обе стороны прокси: родной движок этого сервера
  // (base пусто) и внешний Strata2 по HTTP. Различие берём из способа маршрутизации
  // подключения, а НЕ из типа: base "" = запрос идёт на origin.
  const isNativeConn = (conn) => !conn || conn.base === "";
  function resolveKind(kind, native) {
    return (kind === "strata" && !native) ? "strata2" : kind;
  }

  function classify(raw, opts = {}) {
    const native = !!opts.native;
    const markers = markersOf(raw);
    const votes = {};
    for (const mk of markers) votes[KIND_OF_MARKER[mk]] = (votes[KIND_OF_MARKER[mk]] || 0) + 1;
    const full = Object.keys(votes).filter((k) => votes[k] >= 2);

    if (full.length === 1) return { kind: resolveKind(full[0], native), kindState: "detected", markers };
    if (full.length > 1) return { kind: "openai", kindState: "mismatch", markers };   // конфликт — только generic

    // Признаков меньше двух: это может быть и недотипизированный OpenAI-сервер, и
    // частичный API. Специфичные поля не добавляем, тип требует ручного выбора.
    if (markers.length) return { kind: "openai", kindState: "needs-redetect", markers };

    const v1 = raw["/v1/models"];
    if (v1 && v1.ok && arr(v1.json && v1.json.data).length) {
      return { kind: "openai", kindState: "detected", markers };   // OpenAI-совместимость подтверждена списком моделей
    }
    return { kind: "openai", kindState: "needs-redetect", markers };
  }

  async function fingerprint(conn) {
    const raw = await probe(conn);
    const res = classify(raw, { native: isNativeConn(conn) });
    res.raw = raw;
    return res;
  }

  // Проверка доступности подключения: один GET /v1/models без утверждений о типе.
  async function ping(conn) {
    const r = await Transport.json(conn, "/v1/models", { timeout: 4000 });
    return { ok: r.ok, status: r.status, error: r.error || null };
  }

  // ---------------------------------------------------------------- каталог
  function modelFromOpenAI(m) {
    const meta = (m && m.meta) || {};
    return {
      id: m.id,
      name: meta.label || m.name || m.id,
      aliases: Array.isArray(meta.aliases) ? meta.aliases.slice() : [],
      loaded: null,
      ctx: { max: num(meta.n_ctx), loaded: null },
      caps: {
        vision: bool(meta.vision) !== null ? bool(meta.vision) : bool((meta.capabilities || {}).vision),
        reasoning: null, tools: null,
      },
      src: "v1/models",
    };
  }

  function catalogStrata2(raw) {
    // Strata2 отвечает 400 «Choose a loaded model ID» на неизвестный id: каталог = загруженные.
    return arr(raw["/v1/models"].json && raw["/v1/models"].json.data)
      .filter((m) => m && str(m.id))
      .map((m) => { const x = modelFromOpenAI(m); x.loaded = true; return x; });
  }

  function catalogLlama(raw) {
    const props = (raw["/props"] && raw["/props"].ok) ? (raw["/props"].json || {}) : {};
    const alias = str(props.model_alias);
    const caps = props.chat_template_caps || {};
    const mod = props.modalities || {};
    const dgs = props.default_generation_settings || {};
    return arr(raw["/v1/models"].json && raw["/v1/models"].json.data)
      .filter((m) => m && str(m.id))
      .map((m) => {
        const x = modelFromOpenAI(m);
        const isLoaded = alias ? (m.id === alias || x.aliases.indexOf(alias) >= 0) : null;
        x.loaded = isLoaded;
        if (x.ctx.max === null) x.ctx.max = num(dgs.n_ctx);
        if (isLoaded) {
          x.caps.vision = bool(mod.vision);
          x.caps.tools = bool(caps.supports_tools) !== null ? bool(caps.supports_tools) : bool(caps.supports_tool_calls);
          // supports_reasoning_effort — про параметр API, а не про способность модели думать:
          // размышления llama.cpp включаются флагом сервера, поэтому тут оставляем неизвестным.
          x.caps.reasoning = null;
        }
        x.src = "v1/models+props";
        return x;
      });
  }

  function catalogLmStudio(raw) {
    const byId = new Map();
    const put = (id, patch) => {
      const cur = byId.get(id) || { id, name: id, aliases: [], loaded: null,
        ctx: { max: null, loaded: null }, caps: { vision: null, reasoning: null, tools: null }, src: [] };
      Object.assign(cur, patch);
      cur.src = Array.isArray(cur.src) ? cur.src : [cur.src];
      byId.set(id, cur);
    };
    for (const m of arr(raw["/v1/models"].json && raw["/v1/models"].json.data)) if (m && str(m.id)) put(m.id, {});
    for (const m of arr(raw["/api/v0/models"].json && raw["/api/v0/models"].json.data)) {
      if (!m || !str(m.id)) continue;
      const caps = arr(m.capabilities);
      put(m.id, {
        loaded: str(m.state) ? m.state === "loaded" : null,
        ctx: { max: num(m.max_context_length), loaded: num(m.loaded_context_length) },
        caps: { vision: null, reasoning: null, tools: caps.indexOf("tool_use") >= 0 },
      });
      const cur = byId.get(m.id); cur.src.push("api/v0/models");
    }
    for (const m of arr(raw["/api/v1/models"].json && raw["/api/v1/models"].json.models)) {
      if (!m || !str(m.key)) continue;
      const c = m.capabilities || {};
      const inst = arr(m.loaded_instances)[0] || null;
      const prev = byId.get(m.key);
      const pc = (prev && prev.caps) || {};
      const pick = (v, old) => (v !== null ? v : (old === undefined ? null : old));
      put(m.key, {
        name: m.display_name || m.key,
        loaded: inst ? true : (prev ? prev.loaded : null),
        caps: {
          vision: pick(bool(c.vision), pc.vision),
          // LM Studio сообщает только допустимый режим размышлений (off/on), а не возможность:
          // трактуем как «по умолчанию включены», если default !== "off".
          reasoning: pick(c.reasoning ? (c.reasoning.default && c.reasoning.default !== "off") : null, pc.reasoning),
          tools: pick(bool(c.trained_for_tool_use), pc.tools),
        },
      });
      const cur = byId.get(m.key);
      if (inst && inst.config && num(inst.config.context_length) !== null) cur.ctx.loaded = num(inst.config.context_length);
      if (num(m.max_context_length) !== null && cur.ctx.max === null) cur.ctx.max = num(m.max_context_length);
      cur.src.push("api/v1/models");
    }
    return Array.from(byId.values());
  }

  function catalogOpenAI(raw) {
    return arr(raw["/v1/models"].json && raw["/v1/models"].json.data)
      .filter((m) => m && str(m.id))
      .map(modelFromOpenAI);
  }

  // Обновление каталога подключения: тип неподтверждён → только generic-чтение /v1/models.
  // Читателя выбираем по факту этого ответа: если тип ещё не подтверждён, но отпечаток
  // узнался, каталог уже читаем правилами этого типа (иначе первое «Определить»
  // вернуло бы generic-каталог без loaded/ctx/capabilities).
  async function fetchCatalog(conn) {
    const raw = await probe(conn);
    const state = classify(raw, { native: isNativeConn(conn) });
    const manual = conn.kindState === "manual";
    const reader = manual ? conn.kind : (state.kindState === "detected" ? state.kind : conn.kind);
    const list = [];
    const p = (path) => raw[path] && raw[path].ok;
    if (reader === "lmstudio" && (p("/api/v0/models") || p("/api/v1/models"))) list.push(...catalogLmStudio(raw));
    else if (reader === "llamacpp" && p("/v1/models")) list.push(...catalogLlama(raw));
    else if ((reader === "strata2" || reader === "strata") && p("/v1/models")) list.push(...catalogStrata2(raw));
    else if (p("/v1/models")) list.push(...catalogOpenAI(raw));
    return { models: list, kind: state.kind, kindState: state.kindState, markers: state.markers,
             ok: p("/v1/models") || p("/api/v0/models") || p("/api/v1/models") };
  }

  // ---------------------------------------------------------------- capabilities
  // Приоритет: ручное переключатель пользователя (conn.flags) → сервер сказал → неизвестно.
  function capabilities(conn, info) {
    const c = (info && info.caps) || { vision: null, reasoning: null, tools: null };
    const f = (conn && conn.flags) || {};
    const out = { vision: c.vision, reasoning: c.reasoning, tools: c.tools };
    if (typeof f.vision === "boolean") out.vision = f.vision;
    if (typeof f.reasoning === "boolean") out.reasoning = f.reasoning;
    return out;
  }

  // ---------------------------------------------------------------- поля тела
  // Только backend-специфичные поля; sampling/seed/limit собирает app.js.
  function requestExtra(conn, modelId, opts = {}) {
    const kind = conn ? conn.kind : "openai";
    const extra = {};
    const native = (kind === "strata" || kind === "strata2");
    if (kind === "strata2") {
      const limit = Number(opts.reasoningLimit || 0);
      if (limit > 0) extra.reasoning_budget_tokens = limit;
      extra.enable_thinking = opts.thinking !== "none";
    }
    if (native) {
      extra.reasoning_effort = opts.thinking || "none";
      if (opts.projection) extra.experimental_speed_projection = !!opts.projection;
      if (opts.mcp) extra.strata_mcp = true;
      // Префиксный кэш Strata: первые N сообщений (system + память) помечаются как общее начало
      // запроса. Движок ставит на этой границе закреплённый чекпойнт KV и переиспользует его между
      // диалогами, поэтому повторный вопрос с той же «шапкой» читает только свой хвост. Поле
      // «strata_prefix» понимает только Strata — остальным провайдерам оно не отправляется.
      if (opts.prefixMessages > 0) extra.strata_prefix = { messages: opts.prefixMessages };
    }
    if (kind !== "strata") extra.stream_options = { include_usage: true };
    return extra;
  }

  // ---------------------------------------------------------------- подсказки UI
  function uiHints(conn) {
    const kind = conn ? conn.kind : "openai";
    const verified = conn && (conn.kindState === "detected" || conn.kindState === "manual");
    if (kind === "strata" || kind === "strata2") {
      return { metricsSupported: verified, visionIsManual: false,
               reasoningNote: null, supportsThinking: true, supportsMcp: true };
    }
    if (kind === "llamacpp") {
      return { metricsSupported: false, visionIsManual: true,
               reasoningNote: verified ? "Запускайте сервер с флагом --reasoning-format deepseek" : null,
               supportsThinking: false, supportsMcp: false };
    }
    if (kind === "lmstudio") {
      return { metricsSupported: false, visionIsManual: false, reasoningNote: null,
               supportsThinking: false, supportsMcp: false };
    }
    // openai / неподтверждённый тип: ничего не утверждаем.
    return { metricsSupported: false, visionIsManual: true, reasoningNote: null,
             supportsThinking: false, supportsMcp: false };
  }

  function labelOf(kind) { return KIND_LABELS[kind] || kind; }

  return {
    KIND_LABELS, MANUAL_KINDS, PROBE_PATHS,
    fingerprint, ping, probe, classify,
    fetchCatalog, capabilities, requestExtra, uiHints, labelOf,
  };
})();
