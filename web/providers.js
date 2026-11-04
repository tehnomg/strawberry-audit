// providers.js — изолированный слой адаптеров Strawberry.
// PR-1: подключается глобально как window.Providers (без ES-модулей).
// Контракт и UnifiedChunk см. в комментариях ниже.

// UnifiedChunk:
//   { type: 'text' | 'reasoning', value: string }
//   { type: 'model' | 'usage' | 'tools', value: any }
//   { type: 'error', value: string }
// ModelInfo:
//   { id, name, capabilities: { vision, reasoning, tools } }

function parseOpenAIStreamChunk(dataString) {
  if (dataString === "[DONE]") return null;
  let j;
  try { j = JSON.parse(dataString); } catch (e) { return null; }
  if (j.error) return [{ type: "error", value: j.error.message || "engine error" }];

  const out = [];
  if (j.model)      out.push({ type: "model", value: j.model });
  if (j.usage)      out.push({ type: "usage", value: j.usage });
  if (j.strata_mcp) out.push({ type: "tools", value: j.strata_mcp });   // Strata-only

  const d = (j.choices && j.choices[0] && j.choices[0].delta) || {};
  if (d.reasoning_content) out.push({ type: "reasoning", value: d.reasoning_content });
  if (d.content)           out.push({ type: "text",      value: d.content });

  return out.length ? out : null;
}
function cleanBaseUrl(b) {
  if (!b) return b;
  b = b.trim().replace(/\/+$/, "");                  // обрезаем хвостовые /
  b = b.replace(/\/(api\/)?v\d+$/, "");              // убираем хвостовой /v1 или /api/v1
  b = b.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, "$1127.0.0.1"); // localhost → 127.0.0.1
  return b;
}
function normalizeReasoningCapability(rc) {
  if (typeof rc === "boolean") return rc;
  if (rc && typeof rc === "object") return rc.default !== "off";
  return false;
}

// ================= Strata (native) =================
const strata = {
  id: "strata",
  label: "Strata (native)",
  defaultBaseUrl: "",
  uiHints: { metricsSupported: true, visionIsManual: false, reasoningNote: null },

  buildUrl({ path }) { return path; },   // тот же origin

  parseChunk: parseOpenAIStreamChunk,

  async fetchCapabilities({ baseUrl }) {
    try {
      const r = await fetch((baseUrl || "") + "/health");
      if (!r.ok) return { models: [], error: `HTTP ${r.status}` };
      const h = await r.json();
      return {
        models: [{
          id: h.model,
          name: h.model,
          capabilities: { vision: !!h.images, reasoning: true, tools: true },
        }],
      };
    } catch (e) {
      return { models: [], error: String(e.message || e) };
    }
  },
};

// ================= LM Studio =================
// list-models: НАТИВНЫЙ /api/v1/models, корень models[], id = key.
const lmstudio = {
  id: "lmstudio",
  label: "LM Studio",
  defaultBaseUrl: "http://127.0.0.1:1234",
  uiHints: { metricsSupported: false, visionIsManual: false, reasoningNote: null },

  buildUrl({ baseUrl, path }) {
  return `/api/proxy${path}?base=${encodeURIComponent(cleanBaseUrl(baseUrl))}`;
  },

  parseChunk: parseOpenAIStreamChunk,

  async fetchCapabilities({ baseUrl }) {
    try {
      const r = await fetch(`/api/proxy/api/v1/models?base=${encodeURIComponent(baseUrl)}`);
      if (!r.ok) return { models: [], error: `HTTP ${r.status}` };
      const j = await r.json();
      const models = (j.models || []).map((m) => ({
        id: m.key,
        name: m.display_name || m.key,
        capabilities: {
          vision:    (m.capabilities && typeof m.capabilities.vision === "boolean") ? m.capabilities.vision : null,
          reasoning: normalizeReasoningCapability(m.capabilities?.reasoning),
          tools:     (m.capabilities && typeof m.capabilities.trained_for_tool_use === "boolean") ? m.capabilities.trained_for_tool_use : null,
        },
      }));
      return { models };
    } catch (e) {
      return { models: [], error: String(e.message || e) };
    }
  },
};

// ================= llama.cpp =================
// list-models: OpenAI-совместимый /v1/models (data[]), id = m.id.
// Capabilities не определяем — только id/name. Vision/reasoning — PR-2.
const llamacpp = {
  id: "llamacpp",
  label: "llama.cpp",
  defaultBaseUrl: "http://127.0.0.1:8080",
  uiHints: {
    metricsSupported: false,
    visionIsManual: true,
    reasoningNote: "Запускайте сервер с флагом --reasoning-format deepseek",
  },

  buildUrl({ baseUrl, path }) {
  return `/api/proxy${path}?base=${encodeURIComponent(cleanBaseUrl(baseUrl))}`;
  },

  parseChunk: parseOpenAIStreamChunk,

  async fetchCapabilities({ baseUrl }) {
    try {
      const r = await fetch(`/api/proxy/v1/models?base=${encodeURIComponent(baseUrl)}`);
      if (!r.ok) return { models: [] };           // эндпоинта нет — ручной ввод
      const j = await r.json();
      const list = Array.isArray(j.data) ? j.data : [];
      const models = list
        .filter((m) => m && typeof m.id === "string" && m.id)
        .map((m) => ({
          id: m.id,
          name: m.id,
          capabilities: { vision: null, reasoning: null, tools: null },
        }));
      return { models };
    } catch (e) {
      return { models: [] };                      // fallback — ручной ввод
    }
  },
};

// ================= Реестр =================
const REGISTRY = { strata, lmstudio, llamacpp };
function getProvider(id) { return REGISTRY[id] ?? REGISTRY.strata; }

window.Providers = { REGISTRY, getProvider };