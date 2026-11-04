// web/backend-detector.js
"use strict";

async function fetchWithTimeout(url, options = {}, timeout = 2000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function detectBackend(currentBaseUrl) {
  // 1. Проверка LM Studio (по умолчанию порт 1234)
  const lmUrls = ["http://127.0.0.1:1234"];
  if (currentBaseUrl && !currentBaseUrl.includes("127.0.0.1:8080") && !currentBaseUrl.includes("127.0.0.1:1234")) {
    lmUrls.push(currentBaseUrl);
  }
  
  for (const u of lmUrls) {
    try {
      const r = await fetchWithTimeout(`/api/proxy/api/v1/models?base=${encodeURIComponent(u)}`);
      if (r.ok) {
        const j = await r.json();
        if (j.models && Array.isArray(j.models)) {
          // Мы не гадаем, какая модель загружена. 
          // Возвращаем null, чтобы app.js доверился твоим настройкам в About.
          return { provider: "lmstudio", model: null, detectedUrl: u, status: "ok" };
        }
      }
    } catch (e) {}
  }

  // 2. Проверка Strata (по эндпоинту /metrics)
  try {
    const r = await fetchWithTimeout("/metrics");
    if (r.ok) {
      const j = await r.json();
      if (j.engine && j.engine.model) {
        return { provider: "strata", model: j.engine.model, detectedUrl: "http://127.0.0.1:8080", status: "ok" };
      }
    }
  } catch (e) {}

  // 3. Проверка llama.cpp (по эндпоинту /props)
  try {
    const r = await fetchWithTimeout("/props");
    if (r.ok) {
      const j = await r.json();
      if (j.default_generation_settings && j.model_alias) {
        return { provider: "llamacpp", model: j.model_alias, detectedUrl: "http://127.0.0.1:8080", status: "ok" };
      }
    }
  } catch (e) {}

  // 4. Ничего не нашли - сервер выключен
  return { provider: "offline", model: null, detectedUrl: null, status: "error" };
}

window.BackendDetector = { detect: detectBackend };