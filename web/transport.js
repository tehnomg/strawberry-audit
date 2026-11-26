// ============================================================================
// Strawberry — общий OpenAI-совместимый транспорт (этап 15).
//
// Здесь живёт ОДИН разбор потока и ОДНА сборка адреса. Никакого UI, никаких
// provider-специфичных полей тела: их добавляет адаптер (providers.js), а
// отрисовку, Stop, метрики и историю ведёт app.js.
//
// Границы (см. AUDIT_STAGE15_plan_v2.md, раздел 2.1):
//   transport: адрес, fetch, HTTP-ошибки, SSE, разбор чанка, responseModel, usage;
//   app.js:    тело запроса, AbortController/Stop, отрисовка, тайминги, история.
// ============================================================================
window.Transport = (function () {

  // ---------------------------------------------------------------- адрес
  // Нормализация: без хвостовых /, без хвостового /v1 или /api/v1, localhost → 127.0.0.1
  // (валидация серверной стороны — history-server.py:230-257: http/https, только хост,
  //  порт в диапазоне 1..65535, хост из PROXY_ALLOWED_HOSTS).
  function cleanBaseUrl(b) {
    if (!b) return "";
    b = String(b).trim().replace(/\/+$/, "");
    b = b.replace(/\/(api\/)?v\d+$/, "");
    b = b.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, "$1127.0.0.1");
    return b;
  }

  // base === "" — тот же origin (history-server сам проксирует на «родной» движок),
  // иначе — сквозной прокси /api/proxy/<path>?base=<base>.
  function urlFor(conn, path) {
    const base = conn ? cleanBaseUrl(conn.base) : "";
    if (!base) return path;
    return "/api/proxy" + path + "?base=" + encodeURIComponent(base);
  }

  // ---------------------------------------------------------------- заголовки
  function headers(json = false) {
    const h = {};
    let key = "";
    try { key = JSON.parse(localStorage.getItem("strata.apikey") || '""'); } catch (e) { key = ""; }
    if (key) h.Authorization = "Bearer " + key;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  // ---------------------------------------------------------------- чанк потока
  // Единый формат событий для приложения. type: model | usage | tools | reasoning | text | error
  function parseChunk(dataString) {
    if (dataString === "[DONE]") return null;
    let j;
    try { j = JSON.parse(dataString); } catch (e) { return null; }
    if (j.error) return [{ type: "error", value: (j.error && j.error.message) || "engine error" }];

    const out = [];
    if (j.model) out.push({ type: "model", value: j.model });
    if (j.usage) out.push({ type: "usage", value: j.usage });
    if (j.strata_mcp) out.push({ type: "tools", value: j.strata_mcp });   // только Strata

    const d = (j.choices && j.choices[0] && j.choices[0].delta) || {};
    if (d.reasoning_content) out.push({ type: "reasoning", value: d.reasoning_content });
    if (d.content) out.push({ type: "text", value: d.content });

    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- ошибки
  // Форматы ошибок различаются (проверено живыми запросами):
  //   Strata2   : {"error":"No route for GET /api/v0/models"}
  //   llama.cpp : {"error":{"code":400,"message":"...","type":"invalid_request_error"}}
  //   LM Studio : {"error":"Unexpected endpoint or method. (GET /health)"} (статус 200!)
  //   FastAPI   : {"detail":"Not Found"}
  function extractMessage(text) {
    if (!text) return "";
    try {
      const j = JSON.parse(text);
      if (j.error) {
        if (typeof j.error === "string") return j.error;
        if (typeof j.error.message === "string") return j.error.message;
      }
      if (j.detail) return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      if (typeof j.message === "string") return j.message;
    } catch (e) {
      return text.slice(0, 200);            // HTML-заглушка и прочее — как есть
    }
    return "";
  }

  function errorFrom(r, text) {
    let msg = extractMessage(text) || `HTTP ${r.status}`;
    if (r.status === 401) msg = "This server needs an API key: add it under About > Settings.";
    const err = new Error(msg);
    err.name = "TransportError";
    err.status = r.status;
    try { err.body = JSON.parse(text); } catch (e) { err.body = null; }
    return err;
  }

  // ------------------------------------------------- JSON-запросы (каталоги, /props)
  // Не бросает исключение на HTTP-ошибке: возвращает ok:false + сообщение сервера,
  // чтобы адаптер отличал «эндпоинта нет» от «сервер не ответил».
  // Ответ с content-type не JSON (SPA-заглушка) = notJson:true, это НЕ API-ответ.
  async function json(conn, path, opts = {}) {
    const { method = "GET", body = null, timeout = 6000 } = opts;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(urlFor(conn, path), {
        method,
        headers: headers(!!body),
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const text = await r.text();
      const ctype = r.headers.get("content-type") || "";
      let parsed = null;
      let isJson = false;
      if (ctype.indexOf("json") >= 0) {
        try { parsed = JSON.parse(text); isJson = true; } catch (e) { isJson = false; }
      }
      if (!r.ok) {
        return { ok: false, status: r.status, isJson, json: parsed,
                 notJson: !isJson, error: extractMessage(text) || `HTTP ${r.status}` };
      }
      // LM Studio отдаёт {"error": ...} со статусом 200: это не API-ответ данного пути.
      if (isJson && parsed && typeof parsed === "object" && parsed.error && !parsed.data && !parsed.models) {
        return { ok: false, status: r.status, isJson: true, json: parsed, notJson: false,
                 error: typeof parsed.error === "string" ? parsed.error : (parsed.error.message || "error") };
      }
      if (!isJson) return { ok: false, status: r.status, isJson: false, json: null, notJson: true, error: "not JSON" };
      return { ok: true, status: r.status, isJson: true, json: parsed, notJson: false, error: null };
    } catch (e) {
      if (e && e.name === "AbortError") {
        return { ok: false, status: 0, isJson: false, json: null, notJson: false, error: "timeout" };
      }
      return { ok: false, status: 0, isJson: false, json: null, notJson: false,
               error: String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------ генерация (stream)
  // onEvent получает только текстовые события (reasoning | text | tools);
  // model и usage собираются здесь и возвращаются в результате.
  async function chat({ conn, body, signal, onEvent }) {
    const out = { model: null, usage: null, aborted: false, status: 0, chunks: 0, finished: false };
    const r = await fetch(urlFor(conn, "/v1/chat/completions"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(body),
      signal: signal || undefined,
    });
    out.status = r.status;
    if (!r.ok) throw errorFrom(r, await r.text().catch(() => ""));

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const events = parseChunk(data);
          if (!events) continue;
          out.chunks++;
          for (const ev of events) {
            if (ev.type === "error") throw new Error(ev.value);
            if (ev.type === "model") { if (out.model === null) out.model = ev.value; continue; }
            if (ev.type === "usage") { out.usage = ev.value; continue; }
            if (onEvent) onEvent(ev);
          }
        }
      }
      out.finished = true;
    } catch (e) {
      if (e && e.name === "AbortError") { out.aborted = true; return out; }
      throw e;
    }
    return out;
  }

  // Одиночный не-стримовый запрос (проба vision и подобные проверки возможностей).
  async function completionOnce({ conn, body, timeout = 30000 }) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(urlFor(conn, "/v1/chat/completions"), {
        method: "POST", headers: headers(true), body: JSON.stringify(body), signal: ctl.signal,
      });
      const text = await r.text();
      if (!r.ok) return { ok: false, status: r.status, error: extractMessage(text) || `HTTP ${r.status}`, json: null };
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { /* не JSON */ }
      return { ok: true, status: r.status, error: null, json: parsed };
    } catch (e) {
      return { ok: false, status: 0, error: (e && e.name === "AbortError") ? "timeout" : String((e && e.message) || e), json: null };
    } finally {
      clearTimeout(timer);
    }
  }

  return { cleanBaseUrl, urlFor, headers, parseChunk, json, chat, completionOnce, errorFrom };
})();
