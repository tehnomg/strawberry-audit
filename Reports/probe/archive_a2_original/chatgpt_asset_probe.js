/**
 * StrawBerry Edition, этап 3 (контрольная точка A) — диагностический зонд ChatGPT.
 *
 * Назначение: измерить, что реально отдаёт ChatGPT про чат и его вложения, BEFORE мы
 * что-либо реализуем. Зонд только читает.
 *
 * Гарантии безопасности (см. STAGE3_PRECODING_REVIEW.md, раздел A):
 *  - только GET-запросы; POST/PUT/PATCH/DELETE нет ни одного;
 *  - адресаты запросов: chatgpt.com (backend-api) и тот CDN-хост, который сам ChatGPT
 *    вернул в поле download_url. Других хостов зонд не трогает, ничего никуда не
 *    отправляет (кроме заголовков авторизации этих же GET-ов);
 *  - секреты НЕ сохраняются: токен берётся из страницы только чтобы подставить его в
 *    заголовок Authorization; в отчёт попадают булевы признаки hasAuthToken/hasDeviceId;
 *    подписанные ссылки сохраняются как host + path + ИМЕНА параметров запроса, без значений;
 *  - из cookies читается ровно один не-секретный идентификатор устройства oai-did
 *    (флаг READ_DEVICE_COOKIE; если false — не читается вообще);
 *  - страница не меняется: DOM_SURVEY только читает; единственный изменяющий действие —
 *    создание временного <a> для скачивания отчёта и его удаление;
 *  - SCROLL_TEST по умолчанию false (он прокручивает страницу; данные аккаунта не меняет).
 *
 * Запуск: авторизованная вкладка chatgpt.com → F12 → Console → вставить файл целиком → Enter.
 * Отчёт сохранится в «Загрузки» как se_probe_<время>.json.
 */
(async () => {
  // ============================== НАСТРОЙКИ ==============================
  // Чаты для проверки. Берём свои же чаты из архива StrawBerry: по ним уже есть эталоны
  // (sha256 и размер) в probe\archive_reference.json, и можно сравнить старые и новые.
  const CHATS = [
    { id: '6aaa1f50-0e78-83eb-8c01-9153effd07ea', note: 'новый чат, загруженные фото' },
    { id: '6a955f43-2a48-83ed-ab8f-a4f00a4c114b', note: 'файлы .py' },
    { id: '6a422372-6368-83ea-b57d-380fa30c29e3', note: '.json и .py' },
    { id: '67a47e8f-7be4-800d-b293-f6607dfa0ee6', note: 'webp' },
    { id: '69c1e80d-2f94-832b-ae42-194947247be0', note: 'PDF 10 МБ, в архиве статус missing' },
    { id: '69beca28-ad34-8326-818a-dba8c39e883c', note: 'старый чат (март), фото' },
  ];
  // Дополнительные идентификаторы ассетов, которые нужно проверить напрямую (из архива).
  const EXTRA_ASSET_IDS = [
    'file_000000007c50722f9fb6ad9dc546a213', // Younger_Lens_Availability_Guide.pdf (missing)
    'file_000000002dd481f4951b20e4ef2083c6', // jpg из чата 6aaa1f50
  ];
  const READ_DEVICE_COOKIE = true; // читать только oai-did (идентификатор устройства)
  const DOM_SURVEY = true; // только чтение DOM текущей вкладки
  const SCROLL_TEST = false; // true = прокрутить страницу вверх и измерить подгрузку
  const MAX_FILES_PER_CHAT = 12; // сколько вложений одного чата скачивать
  const MAX_TOTAL_FILES = 30; // сколько файлов качать за весь прогон
  const MAX_BYTES_PER_FILE = 40 * 1024 * 1024; // файл больше — не качаем, фиксируем причину
  const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // суммарный лимит скачанного за прогон
  const RECHECK_AFTER_MS = 90000; // через сколько секунд перепроверить подписанные ссылки

  // ============================== СЛУЖЕБНОЕ ==============================
  const requests = { total: 0, byHost: {}, byPath: {} };
  const note = (kind, url) => {
    try {
      const u = new URL(url);
      requests.total += 1;
      requests.byHost[u.host] = (requests.byHost[u.host] || 0) + 1;
      const tpl = `${kind} ${u.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/<id>')}`;
      requests.byPath[tpl] = (requests.byPath[tpl] || 0) + 1;
    } catch {
      /* ignore */
    }
  };
  const sha256 = async (buf) => {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const head = (buf, n = 12) =>
    [...new Uint8Array(buf.slice(0, n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Подписанную ссылку показываем без значений параметров: в них подпись доступа.
  const urlShape = (u) => {
    try {
      const x = new URL(u);
      return {
        host: x.host,
        path: x.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/<id>'),
        queryParamNames: [...new Set([...x.searchParams.keys()])].sort(),
      };
    } catch {
      return { unparseable: true };
    }
  };

  const bootstrap = (() => {
    const el =
      document.getElementById('client-bootstrap') || document.getElementById('__NEXT_DATA__');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch {
      return null;
    }
  })();
  const token =
    bootstrap?.session?.accessToken ?? bootstrap?.auth?.accessToken ?? bootstrap?.accessToken ?? null;
  const deviceId = READ_DEVICE_COOKIE
    ? (document.cookie.match(/(?:^|;\s*)oai-did=([^;]+)/) || [])[1] ?? null
    : null;
  const sharePage = /\/(share|s)\//.test(location.pathname);
  let downloadedBytesTotal = 0;
  let filesDownloaded = 0;

  const api = async (url) => {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (deviceId) headers['oai-device-id'] = deviceId;
    note('GET', url);
    const t0 = performance.now();
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include', headers });
      const ct = r.headers.get('content-type') || '';
      const out = {
        status: r.status,
        contentType: ct,
        ms: Math.round(performance.now() - t0),
        ok: r.ok,
        json: ct.includes('json') ? await r.json().catch(() => null) : null,
      };
      return out;
    } catch (e) {
      return { status: null, error: String(e?.message ?? e), ms: Math.round(performance.now() - t0) };
    }
  };

  // ---------------- извлечение структуры сообщений и ссылок на вложения ----------------
  const REF_FIELDS = ['name', 'mime_type', 'mime', 'size', 'width', 'height', 'file_name', 'filename'];
  const collectFromMessage = (msg) => {
    // msg — объект сообщения в любой из двух известных форм ответа API
    const refs = [];
    const push = (id, via, obj) => {
      if (!id || typeof id !== 'string') return;
      const rec = { id, via };
      if (obj && typeof obj === 'object') {
        for (const k of REF_FIELDS) if (obj[k] !== undefined) rec[k] = obj[k];
        rec.objectKeys = Object.keys(obj).sort();
      }
      refs.push(rec);
    };
    const content = msg.content;
    if (content && typeof content === 'object') {
      const parts = Array.isArray(content.parts) ? content.parts : [];
      for (const p of parts) {
        if (p && typeof p === 'object') {
          if (p.asset_pointer) push(String(p.asset_pointer).split('://')[1] ?? p.asset_pointer, `part.asset_pointer:${p.content_type ?? '?'}`, p);
          if (p.image_asset_pointer) push(String(p.image_asset_pointer).split('://')[1] ?? p.image_asset_pointer, 'part.image_asset_pointer', p);
          if (p.id && p.type && /image|file|attachment/i.test(String(p.type))) push(p.id, `part.type:${p.type}`, p);
        }
      }
    }
    const md = msg.metadata;
    if (md && typeof md === 'object') {
      if (Array.isArray(md.attachments)) {
        for (const a of md.attachments) {
          push(a?.id ?? a?.file_id ?? a?.asset_pointer, 'metadata.attachments', a);
        }
      }
      if (Array.isArray(md.attachment_ids)) for (const id of md.attachment_ids) push(id, 'metadata.attachment_ids', null);
      if (Array.isArray(md.content_references)) {
        for (const cr of md.content_references) {
          push(cr?.id ?? cr?.reference_id, `metadata.content_references:${cr?.type ?? '?'}`, cr);
        }
      }
    }
    return refs;
  };

  const readMessages = (data) => {
    const list = [];
    if (data && data.mapping && typeof data.mapping === 'object') {
      for (const [key, node] of Object.entries(data.mapping)) {
        const m = node?.message ?? node;
        if (!m || typeof m !== 'object') continue;
        list.push({
          nodeId: key,
          id: m.id ?? null,
          parentId: m.parent_id ?? null,
          role: m.author?.role ?? m.role ?? null,
          contentStructure: m.content && typeof m.content === 'object' ? Object.keys(m.content).sort() : null,
          contentTypes: Array.isArray(m.content?.parts)
            ? m.content.parts.map((p) => p?.content_type ?? p?.type ?? null)
            : null,
          metadataKeys: m.metadata && typeof m.metadata === 'object' ? Object.keys(m.metadata).sort() : null,
          children: Array.isArray(m.children) ? m.children.length : null,
          refs: collectFromMessage(m),
        });
      }
    } else if (data && Array.isArray(data.messages)) {
      for (const m of data.messages) {
        if (!m || typeof m !== 'object') continue;
        list.push({
          nodeId: null,
          id: m.id ?? null,
          parentId: m.parent_id ?? m.parentId ?? null,
          role: m.role ?? m.author?.role ?? null,
          contentStructure: m.content && typeof m.content === 'object' ? Object.keys(m.content).sort() : typeof m.content,
          contentTypes: Array.isArray(m.content?.parts)
            ? m.content.parts.map((p) => p?.content_type ?? p?.type ?? null)
            : null,
          metadataKeys: m.metadata && typeof m.metadata === 'object' ? Object.keys(m.metadata).sort() : null,
          children: Array.isArray(m.children) ? m.children.length : null,
          refs: collectFromMessage(m),
        });
      }
    }
    return list;
  };

  const metaOf = (data) => ({
    topKeys: data ? Object.keys(data).sort().slice(0, 30) : null,
    shape: data?.mapping ? 'mapping' : Array.isArray(data?.messages) ? 'messages' : null,
    mappingCount: data?.mapping ? Object.keys(data.mapping).length : null,
    messagesCount: Array.isArray(data?.messages) ? data.messages.length : null,
    title: data?.title ?? null,
    created: data?.created ?? null,
    updated: data?.update_time ?? data?.modified_time ?? null,
    completionCodes: data?.mapping
      ? [...new Set(Object.values(data.mapping).map((n) => n?.message?.metadata?.finish_code ?? n?.message?.status ?? null))].slice(0, 6)
      : null,
  });

  // ---------------- скачивание файла и вердикт ----------------
  const probeAsset = async (ref, expected) => {
    const rec = {
      id: ref.id,
      foundVia: ref.via,
      nameFromApi: ref.name ?? ref.file_name ?? ref.filename ?? null,
      mimeFromApi: ref.mime_type ?? ref.mime ?? null,
      sizeFromApi: ref.size ?? null,
      apiObjectKeys: ref.objectKeys ?? null,
      expectedFromArchive: expected ?? null,
    };
    const dl = await api(`https://chatgpt.com/backend-api/files/download/${ref.id}`);
    rec.filesDownloadEndpoint = { status: dl.status, ms: dl.ms, error: dl.error ?? null };
    const signed = dl.json?.download_url ?? dl.json?.url ?? null;
    rec.signedUrlPresent = Boolean(signed);
    if (signed) {
      rec.signedUrl = urlShape(signed);
      rec.signedUrlExpiry = dl.json?.expires_datetime ?? dl.json?.expires ?? dl.json?.expires_at ?? null;
      const declared = Number(ref.size ?? 0);
      if (declared && declared > MAX_BYTES_PER_FILE) {
        rec.bytes = { skipped: 'declared_size_over_limit', declaredSize: declared, limit: MAX_BYTES_PER_FILE };
      } else if (downloadedBytesTotal >= MAX_TOTAL_BYTES) {
        rec.bytes = { skipped: 'total_bytes_limit', limit: MAX_TOTAL_BYTES };
      } else {
        try {
          note('GET-bytes', signed);
          const t0 = performance.now();
          const resp = await fetch(signed, { method: 'GET', credentials: 'omit' });
          const buf = await resp.arrayBuffer();
          downloadedBytesTotal += buf.byteLength;
          filesDownloaded += 1;
          const s = await sha256(buf);
          rec.bytes = {
            status: resp.status,
            servedType: resp.headers.get('content-type'),
            sizeBytes: buf.byteLength,
            sha256: s,
            firstBytesHex: head(buf),
            ms: Math.round(performance.now() - t0),
            sizeEqualsApiSize: declared ? buf.byteLength === declared : null,
            shaEqualsArchive: expected?.sha256 ? s === expected.sha256 : null,
            sizeEqualsArchive: expected?.size ? buf.byteLength === Number(expected.size) : null,
            host: urlShape(signed).host,
          };
          rec._signed = signed;
        } catch (e) {
          rec.bytes = { error: String(e?.message ?? e) };
        }
      }
    }
    return rec;
  };

  // ---------------- отчёт ----------------
  const report = {
    probeVersion: 'A-2',
    at: new Date().toISOString(),
    page: location.href.replace(/[?#].*$/, ''),
    pageKind: sharePage ? 'share/public' : 'normal chat',
    hasAuthToken: Boolean(token),
    tokenSourceElementId: bootstrap ? (document.getElementById('client-bootstrap') ? 'client-bootstrap' : '__NEXT_DATA__') : null,
    hasDeviceId: Boolean(deviceId),
    flags: { READ_DEVICE_COOKIE, DOM_SURVEY, SCROLL_TEST, MAX_FILES_PER_CHAT, MAX_TOTAL_FILES, MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES, RECHECK_AFTER_MS },
    requests,
    chats: [],
    extraAssets: [],
    dom: null,
    scrollTest: null,
    signedUrlRecheck: [],
  };

  const ids = [];
  for (const c of CHATS) ids.push(typeof c === 'string' ? c : c.id);
  const current = (location.pathname.match(/\/(?:c|share|s)\/([A-Za-z0-9_-]+)/) || [])[1];
  if (current && !ids.includes(current)) ids.push(current);

  for (const convId of ids) {
    const chat = { convId, fetch: null, meta: null, messagesSummary: null, assets: [] };
    const conv = await api(`https://chatgpt.com/backend-api/conversation/${convId}`);
    chat.fetch = { status: conv.status, ms: conv.ms, error: conv.error ?? null, contentType: conv.contentType ?? null };
    if (!conv.ok || !conv.json) {
      report.chats.push(chat);
      continue;
    }
    chat.meta = metaOf(conv.json);
    const msgs = readMessages(conv.json);
    const withRefs = msgs.filter((m) => m.refs.length > 0);
    chat.messagesSummary = {
      nodesInResponse: msgs.length,
      nodesWithAttachments: withRefs.length,
      attachmentRefsTotal: withRefs.reduce((s, m) => s + m.refs.length, 0),
      roles: [...new Set(msgs.map((m) => m.role))],
      contentStructures: [...new Set(msgs.map((m) => JSON.stringify(m.contentStructure)))].slice(0, 6),
      contentTypes: [...new Set(msgs.flatMap((m) => m.contentTypes ?? []))].filter(Boolean).slice(0, 20),
      metadataKeys: [...new Set(msgs.flatMap((m) => m.metadataKeys ?? []))].sort().slice(0, 25),
      sampleWithAttachments: withRefs.slice(0, 6).map((m) => ({
        nodeId: m.nodeId,
        id: m.id,
        parentId: m.parentId,
        role: m.role,
        metadataKeys: m.metadataKeys,
        refs: m.refs,
      })),
    };
    const allRefs = withRefs.flatMap((m) => m.refs);
    const uniq = [];
    const seen = new Set();
    for (const r of allRefs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      uniq.push(r);
    }
    chat.uniqueAssetRefs = uniq.length;
    for (const r of uniq.slice(0, MAX_FILES_PER_CHAT)) {
      if (filesDownloaded >= MAX_TOTAL_FILES) {
        chat.assets.push({ id: r.id, foundVia: r.via, skipped: 'max_files_per_run' });
        continue;
      }
      chat.assets.push(await probeAsset(r, null));
    }
    if (uniq.length > MAX_FILES_PER_CHAT) {
      chat.notProbed = uniq.length - MAX_FILES_PER_CHAT;
    }
    report.chats.push(chat);
  }

  // ---------------- прямая проверка известных идентификаторов из архива ----------------
  for (const id of EXTRA_ASSET_IDS) {
    const ref = { id, via: 'extra_list_from_archive' };
    const rec = await probeAsset(ref, null);
    // эталон ищем здесь же: размер и sha из архива подставляет пользовательский скрипт-отчёт,
    // в самом зонде эталонов нет (файл archive_reference.json остаётся у меня)
    report.extraAssets.push(rec);
  }

  // ---------------- дополнительные маршруты API (существуют ли) ----------------
  const firstAsset = report.chats.flatMap((c) => c.assets).find((a) => a.id);
  const firstConv = ids[0];
  report.endpointProbes = {};
  const probeEndpoints = [
    ['files_metadata', firstAsset ? `https://chatgpt.com/backend-api/files/${firstAsset.id}/metadata` : null],
    ['files_list', 'https://chatgpt.com/backend-api/files'],
    ['conversation_files', firstConv ? `https://chatgpt.com/backend-api/conversations/${firstConv}/files` : null],
  ];
  for (const [name, url] of probeEndpoints) {
    if (!url) continue;
    const r = await api(url);
    report.endpointProbes[name] = {
      status: r.status,
      ms: r.ms,
      keys: r.json ? Object.keys(r.json).sort().slice(0, 12) : null,
      isArrayRoot: Array.isArray(r.json),
      error: r.error ?? null,
    };
  }

  // ---------------- DOM-обследование текущей вкладки (только чтение) ----------------
  if (DOM_SURVEY) {
    const TURN_SELECTOR =
      'article, [data-testid^="conversation-turn-"], section[data-turn-id], [data-message-author-role], [data-message-role]';
    const turns = [...document.querySelectorAll(TURN_SELECTOR)];
    const scrollable = (el) => el && el.scrollHeight > el.clientHeight + 80;
    let root = turns[0]?.parentElement ?? null;
    while (root && !scrollable(root)) root = root.parentElement;
    if (!root && scrollable(document.querySelector('main'))) root = document.querySelector('main');
    if (!root) root = document.scrollingElement || document.documentElement;
    const imgs = [...document.querySelectorAll('img')];
    const hostOf = (u) => {
      try {
        return new URL(u, location.origin).host;
      } catch {
        return 'unknown';
      }
    };
    report.dom = {
      url: location.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/<id>'),
      turnSelector: TURN_SELECTOR,
      turnsFound: turns.length,
      turnsWithDataTestId: turns.filter((t) => t.getAttribute('data-testid')).length,
      turnsWithTurnId: turns.filter((t) => t.getAttribute('data-turn-id')).length,
      turnIndexRange: turns
        .map((t) => {
          const m = (t.getAttribute('data-testid') || '').match(/^conversation-turn-(\d+)$/);
          if (m) return Number(m[1]);
          const id = t.getAttribute('data-turn-id');
          return /^\d+$/.test(id || '') ? Number(id) : null;
        })
        .filter((x) => x !== null)
        .reduce((acc, x) => [Math.min(acc[0], x), Math.max(acc[1], x)], [Infinity, -Infinity]),
      scrollRootTag: root?.tagName,
      scrollRootId: root?.id || null,
      scrollRootClass: root?.className ? String(root.className).slice(0, 80) : null,
      scrollHeight: root?.scrollHeight ?? null,
      clientHeight: root?.clientHeight ?? null,
      scrollTop: root ? Math.round(root.scrollTop) : null,
      hasContentAbove: root ? root.scrollTop > 200 : null,
      hasContentBelow: root ? root.scrollHeight - root.scrollTop - root.clientHeight > 200 : null,
      imagesTotal: imgs.length,
      imageSchemes: imgs.reduce((acc, i) => {
        const s = (i.currentSrc || i.src || '').split(':')[0] || 'none';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {}),
      imageHosts: [...new Set(imgs.map((i) => hostOf(i.currentSrc || i.src || '')))].slice(0, 12),
      imagesWithDataUri: imgs.filter((i) => (i.currentSrc || i.src || '').startsWith('data:')).length,
      linksToFiles: [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => /\.(pdf|docx?|xlsx?|csv|txt|py|json|md)(\?|$)/i.test(h || ''))
        .slice(0, 10),
      dataMessageIdElements: document.querySelectorAll('[data-message-id]').length,
      recoveryPlaceholders: document.querySelectorAll('[data-conversation-recovery]').length,
    };
    const apiNodes = report.chats[0]?.meta?.mappingCount ?? report.chats[0]?.meta?.messagesCount ?? null;
    report.dom.completenessHint = {
      apiNodesForFirstCheckedChat: apiNodes,
      domTurns: turns.length,
      domLessThanApi: apiNodes !== null ? turns.length < apiNodes : null,
      note: 'сравнение количества узлов из API и тегов-turn в DOM: если DOM меньше, история в DOM неполная',
    };
  }

  // ---------------- измеренная подгрузка истории (по согласованию) ----------------
  if (SCROLL_TEST) {
    const sel = '[data-testid^="conversation-turn-"], section[data-turn-id], article';
    const countNow = () => document.querySelectorAll(sel).length;
    const scrollable = (el) => el && el.scrollHeight > el.clientHeight + 80;
    let root = document.querySelector('main');
    if (!scrollable(root)) root = document.scrollingElement || document.documentElement;
    const samples = [];
    let stable = 0;
    let prev = countNow();
    samples.push({ scrollTop: Math.round(root.scrollTop), turns: prev, tMs: 0 });
    const t0 = performance.now();
    for (let step = 0; step < 40 && stable < 4; step += 1) {
      root.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 600));
      const now = countNow();
      samples.push({ scrollTop: Math.round(root.scrollTop), turns: now, tMs: Math.round(performance.now() - t0) });
      if (now === prev) stable += 1;
      else stable = 0;
      prev = now;
    }
    report.scrollTest = {
      selector: sel,
      samples,
      turnsFinal: prev,
      grewFromTo: [samples[0]?.turns, prev],
      stopRule: 'остановка после 4 одинаковых подряд измерений количества turn (измерение, а не фиксированная пауза)',
    };
  }

  // ---------------- живость подписанных ссылок ----------------
  const signedList = report.chats
    .flatMap((c) => c.assets)
    .concat(report.extraAssets)
    .filter((a) => a._signed)
    .slice(0, 5);
  await new Promise((r) => setTimeout(r, RECHECK_AFTER_MS));
  report.signedUrlRecheck = [];
  for (const a of signedList) {
    try {
      note('GET-recheck', a._signed);
      const t0 = performance.now();
      const r = await fetch(a._signed, { method: 'GET', credentials: 'omit' });
      const buf = await r.arrayBuffer();
      report.signedUrlRecheck.push({
        id: a.id,
        status: r.status,
        sizeBytes: buf.byteLength,
        shaUnchanged: (await sha256(buf)) === a.bytes?.sha256,
        ms: Math.round(performance.now() - t0),
        host: urlShape(a._signed).host,
      });
    } catch (e) {
      report.signedUrlRecheck.push({ id: a.id, error: String(e?.message ?? e) });
    }
  }
  for (const c of report.chats) for (const a of c.assets) delete a._signed;
  for (const a of report.extraAssets) delete a._signed;

  report.downloaded = { filesDownloaded, downloadedBytesTotal };

  console.log(JSON.stringify(report, null, 2));
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `se_probe_${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
  return report;
})();
