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
 *    заголовок Authorization, живёт только в памяти прогона и нигде не печатается; в отчёт
 *    попадают булевы признаки hasAuthToken/hasDeviceId; подписанные ссылки сохраняются как
 *    host + path + ИМЕНА параметров запроса, без значений;
 *  - cookies не читаются вообще (в том числе oai-did) и не передаются: все fetch идут с
 *    credentials: 'omit'. Авторизация backend-api — только Bearer-токеном из страницы. Если
 *    endpoint требует cookie, зонд это не обходит, а фиксирует AUTH_REQUIRED с фактическим
 *    HTTP-статусом;
 *  - скачивание по подписной ссылке — без Authorization и без cookies;
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
  // cookies в этом зонде не читаются и не передаются вообще (этап 2 задачи A-2)
  const DOM_SURVEY = true; // только чтение DOM текущей вкладки
  const SCROLL_TEST = false; // true = прокрутить страницу вверх и измерить подгрузку
  const MAX_FILES_PER_CHAT = 12; // сколько вложений одного чата скачивать
  const MAX_TOTAL_FILES = 30; // сколько файлов качать за весь прогон
  const MAX_BYTES_PER_FILE = 40 * 1024 * 1024; // файл больше — не качаем, фиксируем причину
  const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // суммарный лимит скачанного за прогон
  // ---------- повторная проверка живости подписной ссылки (этап 5) ----------
  // По умолчанию выключена: в обычном прогоне повторных загрузок файлов нет.
  const LINK_LIFETIME_CHECK = false; // отдельный режим, включается явно
  const LINK_LIFETIME_MAX_ASSETS = 5; // сколько подписных ссылок проверять в этом режиме
  const LINK_LIFETIME_RANGE_BYTES = 1024; // GET Range: читается не более этого числа байт
  const LINK_LIFETIME_MAX_BYTES_TOTAL = 16 * 1024 * 1024; // потолок чтения второй фазы целиком
  const LINK_LIFETIME_DELAY_MS = 0; // 0 = сразу; фиксированной 90-секундной паузы больше нет
  const LINK_LIFETIME_WAIT_USER = false; // true = ждать window.__se_probe_go = true (сигнал, а не пауза)
  // Диагностический режим идентификаторов: по умолчанию выключен. При true в отчёт добавляется
  // раздел idAliases (локальное обозначение -> реальный id), нужен только для технического сопоставления.
  const DIAGNOSTIC_IDS = false;

  // ---------- адреса и маршруты (этап 3) ----------
  const API_HOST = 'chatgpt.com'; // единственный разрешённый хост backend-api
  const API_PORT = '443'; // явный порт в адресе запрещён, кроме этого
  // Разрешённые CDN-хосты. Пустой список = адрес загрузки неизвестен: зонд только фиксирует
  // hostname со статусом UNTRUSTED_DOWNLOAD_HOST и ничего не качает. Пополняется только явным
  // списком по фактическим замерам (поле cdnHostsSeen в отчёте), а не догадками.
  const CDN_HOSTS = [];
  const CDN_FOLLOW_REDIRECTS = false; // следовать за redirect подписной ссылки (Location читается не всегда)
  const MAX_REDIRECT_HOPS = 2;
  const API_ROUTES = [
    /^\/backend-api\/conversation\/[A-Za-z0-9_-]{1,120}$/,
    /^\/backend-api\/files\/download\/[A-Za-z0-9_-]{1,120}$/,
    /^\/backend-api\/files\/[A-Za-z0-9_-]{1,120}\/metadata$/,
    /^\/backend-api\/files$/,
    /^\/backend-api\/conversations\/[A-Za-z0-9_-]{1,120}\/files$/,
  ];

  // ============================== СЛУЖЕБНОЕ ==============================
  const requests = { total: 0, byHost: {}, byPath: {}, blocked: [] };
  // Пути в статистике нормализуются: смысловым считается только сегмент без цифр,
  // остальные (uuid, file_…, подпись в пути) заменяются на <id>.
  const PLAIN_SEGMENT = /^[A-Za-z][A-Za-z_-]*$/;
  const templatePath = (pathname) =>
    '/' +
    String(pathname || '')
      .split('/')
      .filter(Boolean)
      .map((s) => (PLAIN_SEGMENT.test(s) ? s : '<id>'))
      .join('/');
  // Локальные обозначения вместо реальных идентификаторов: связи внутри отчёта сохраняются.
  const LABELS = { chat: {}, message: {}, asset: {} };
  const LABEL_SEQ = { chat: 0, message: 0, asset: 0 };
  const LABEL_OF = {};
  const labelOf = (kind, id) => {
    const key = `${kind}:${id}`;
    if (!LABEL_OF[key]) {
      LABEL_SEQ[kind] += 1;
      LABEL_OF[key] = `${kind}_${LABEL_SEQ[kind]}`;
      if (DIAGNOSTIC_IDS) (LABELS[kind] ??= {})[`${kind}_${LABEL_SEQ[kind]}`] = String(id).slice(0, 120);
    }
    return LABEL_OF[key];
  };
  const note = (kind, url) => {
    try {
      const u = new URL(url);
      requests.total += 1;
      requests.byHost[u.host] = (requests.byHost[u.host] || 0) + 1;
      const tpl = `${kind} ${templatePath(u.pathname)}`;
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
        path: templatePath(x.pathname),
        pathSegments: x.pathname.split('/').filter(Boolean).length,
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
  // cookie не читаются: ни oai-did, ни какие-либо иные (значение device id из cookie недоступно)
  const deviceId = null;
  const sharePage = /\/(share|s)\//.test(location.pathname);
  let downloadedBytesTotal = 0;
  let filesDownloaded = 0;
  let downloadAttempts = 0; // сколько загрузок начато: считается и лимит прогона по попыткам
  let downloadsInFlight = 0;
  let downloadsMaxInFlight = 0; // доказательство последовательности: должно быть равно 1
  let linkBytesTotal = 0; // объём, прочитанный в опциональной фазе проверки живости ссылок
  const cdnHostsSeen = new Set(); // какие хосты реально встречались в подписных ссылках
  const refIdsSeen = []; // идентификаторы живут только в памяти зонда, в отчёт не пишутся

  // Проверка адреса до запроса: только HTTPS, hostname из явного списка, без userinfo, без
  // посторонних портов. Широких совпадений вида includes("openai") здесь нет сознательно.
  const targetIssues = (u, purpose) => {
    const issues = [];
    if (u.protocol !== 'https:') issues.push('not_https');
    if (purpose === 'api') {
      if (u.hostname !== API_HOST) issues.push('host_not_allowlisted');
    } else if (!CDN_HOSTS.includes(u.hostname)) {
      issues.push('host_not_allowlisted');
    }
    if (u.port && u.port !== API_PORT) issues.push('unexpected_port');
    if (u.username || u.password) issues.push('userinfo_in_url');
    return issues;
  };
  // Идентификаторы подставляются в путь только если это безопасный токен: иначе нельзя
  // сменить маршрут символами / ? # ..
  const safeId = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(x);

  const api = async (url) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      requests.blocked.push({ purpose: 'api', reason: 'url_unparseable' });
      return { status: null, error: 'url_unparseable', ms: 0 };
    }
    const issues = targetIssues(u, 'api');
    if (!API_ROUTES.some((re) => re.test(u.pathname))) issues.push('route_not_allowed');
    if (issues.length) {
      requests.blocked.push({ purpose: 'api', host: u.hostname, issues });
      return { status: null, error: 'target_blocked', issues, ms: 0 };
    }
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`; // только в памяти прогона; в отчёт/консоль/URL не попадает
    // заголовок oai-device-id не отправляем: его значение живёт в cookie, а cookie мы не читаем
    note('GET', u.href);
    const t0 = performance.now();
    try {
      const r = await fetch(u.href, { method: 'GET', credentials: 'omit', headers, redirect: 'manual' });
      // redirect по backend-api не обслуживаем: автоматически следовать нельзя, а кросс-доменный
      // Location браузер не отдаёт. Фиксируем отказ явно, статус сохраняем.
      if (r.status >= 300 && r.status < 400) {
        return { status: r.status, contentType: '', ms: Math.round(performance.now() - t0), ok: false, json: null, redirectBlocked: true };
      }
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

  // Единая классификация ответа. Cookie мы не отправляем, поэтому 401/403 — это нехватка
  // авторизации, а не временный сбой: обхода через cookie не делаем, фиксируем как есть.
  const authClass = (r) => {
    if (r?.error) return 'NETWORK_ERROR';
    if (r?.status === 401 || r?.status === 403) return 'AUTH_REQUIRED';
    if (typeof r?.status === 'number' && (r.status < 200 || r.status >= 300)) return 'HTTP_ERROR';
    return 'OK';
  };

  // Потоковое чтение ответа: объём контролируется во время загрузки, а не после неё.
  // room = сколько байтов ещё можно принять (учитывает лимит на файл и остаток общего лимита).
  const readCapped = async (resp, room) => {
    const declaredLen = Number(resp.headers.get('content-length') || 0) || null;
    if (declaredLen && declaredLen > room) {
      return { status: 'SKIPPED_LIMIT', reason: 'content_length_over_limit', declaredSize: declaredLen, limitBytes: room, receivedBytes: 0 };
    }
    const reader = resp.body && typeof resp.body.getReader === 'function' ? resp.body.getReader() : null;
    if (!reader) {
      // Потока нет: операцию завершаем с понятным статусом, на неограниченный arrayBuffer не уходим.
      return { status: 'UNSUPPORTED', reason: 'stream_unavailable', declaredSize: declaredLen, limitBytes: room, receivedBytes: 0 };
    }
    let acc = declaredLen && declaredLen <= room ? new Uint8Array(declaredLen) : null;
    const chunks = [];
    let got = 0;
    for (;;) {
      let item;
      try {
        item = await reader.read();
      } catch (e) {
        return { status: 'NETWORK_ERROR', reason: 'stream_read_failed', receivedBytes: got, declaredSize: declaredLen, limitBytes: room, error: String(e?.message ?? e) };
      }
      if (item && item.done) break;
      const v = item && item.value;
      if (!v) continue;
      if (got + v.byteLength > room) {
        try {
          await reader.cancel('over_limit');
        } catch {
          /* already cancelled */
        }
        return {
          status: 'SKIPPED_LIMIT',
          reason: 'stream_over_limit',
          receivedBytes: got,
          attemptedBytes: got + v.byteLength,
          limitBytes: room,
          declaredSize: declaredLen,
        };
      }
      if (acc && got + v.byteLength > acc.length) {
        chunks.push(acc.subarray(0, got));
        acc = null;
      }
      if (acc) acc.set(v, got);
      else chunks.push(v);
      got += v.byteLength;
    }
    let bytes = acc;
    if (!bytes) {
      bytes = new Uint8Array(got);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.byteLength;
      }
    }
    return {
      status: 'OK',
      bytes,
      receivedBytes: got,
      declaredSize: declaredLen,
      contentLengthMatchesActual: declaredLen === null ? null : got === declaredLen,
      limitBytes: room,
    };
  };
  // Скачивание по подписной ссылке: только GET, без Authorization и без cookie. Адрес проверяется
  // до каждого запроса; автоматический redirect выключен (redirect: 'manual'), каждый переход,
  // если он разрешён, проходит ту же проверку allowlist.
  const fetchDownload = async (raw, extraHeaders = {}) => {
    let u;
    try {
      u = new URL(raw);
    } catch {
      requests.blocked.push({ purpose: 'download', reason: 'url_unparseable' });
      return { status: 'UNTRUSTED_DOWNLOAD_HOST', reason: 'url_unparseable' };
    }
    let issues = targetIssues(u, 'download');
    let hops = 0;
    for (;;) {
      cdnHostsSeen.add(u.hostname);
      if (issues.length) {
        requests.blocked.push({ purpose: 'download', host: u.hostname, issues, hops });
        return { status: 'UNTRUSTED_DOWNLOAD_HOST', host: u.hostname, issues, redirectHops: hops };
      }
      note(extraHeaders.Range ? 'GET-range' : 'GET-bytes', u.href);
      downloadAttempts += 1;
      downloadsInFlight += 1;
      if (downloadsInFlight > downloadsMaxInFlight) downloadsMaxInFlight = downloadsInFlight;
      const t0 = performance.now();
      let resp;
      try {
        resp = await fetch(u.href, { method: 'GET', credentials: 'omit', redirect: 'manual', headers: extraHeaders });
      } catch (e) {
        downloadsInFlight -= 1;
        return { status: 'NETWORK_ERROR', host: u.hostname, error: String(e?.message ?? e), ms: Math.round(performance.now() - t0) };
      }
      downloadsInFlight -= 1;
      const ms = Math.round(performance.now() - t0);
      if ((resp.status >= 300 && resp.status < 400) || resp.type === 'opaqueredirect') {
        if (!CDN_FOLLOW_REDIRECTS) {
          return { status: 'UNTRUSTED_DOWNLOAD_HOST', host: u.hostname, reason: 'redirect_not_followed', httpStatus: resp.status, redirectHops: hops, ms };
        }
        const loc = resp.headers.get('location');
        if (!loc) {
          return { status: 'UNTRUSTED_DOWNLOAD_HOST', host: u.hostname, reason: 'redirect_location_unreadable', httpStatus: resp.status, ms };
        }
        if (hops >= MAX_REDIRECT_HOPS) {
          return { status: 'UNTRUSTED_DOWNLOAD_HOST', host: u.hostname, reason: 'redirect_hops_exceeded', ms };
        }
        let nu;
        try {
          nu = new URL(loc, u);
        } catch {
          return { status: 'UNTRUSTED_DOWNLOAD_HOST', reason: 'redirect_unparseable', ms };
        }
        u = nu;
        issues = targetIssues(u, 'download');
        hops += 1;
        continue;
      }
      if (!resp.ok) return { status: 'HTTP_ERROR', host: u.hostname, httpStatus: resp.status, ms, resp };
      return { status: 'OK', host: u.hostname, ms, resp };
    }
  };

  // ---------------- извлечение структуры сообщений и ссылок на вложения ----------------
  // Имена файлов в отчёт не попадают (этап 6): фиксируется только сам факт наличия имени.
  const REF_FIELDS = ['mime_type', 'mime', 'size', 'width', 'height'];
  const NAME_FIELDS = ['name', 'file_name', 'filename'];
  const collectFromMessage = (msg) => {
    // msg — объект сообщения в любой из двух известных форм ответа API
    const refs = [];
    const push = (id, via, obj) => {
      if (!id || typeof id !== 'string') return;
      const rec = { id, label: labelOf('asset', id), via };
      if (obj && typeof obj === 'object') {
        for (const k of REF_FIELDS) if (obj[k] !== undefined) rec[k] = obj[k];
        rec.namePresent = NAME_FIELDS.some((k) => typeof obj[k] === 'string' && obj[k].length > 0);
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
          nodeLabel: labelOf('message', key),
          msgLabel: m.id != null ? labelOf('message', m.id) : null,
          parentLabel: m.parent_id != null ? labelOf('message', m.parent_id) : null,
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
          nodeLabel: null,
          msgLabel: m.id != null ? labelOf('message', m.id) : null,
          parentLabel:
            m.parent_id != null ? labelOf('message', m.parent_id) : m.parentId != null ? labelOf('message', m.parentId) : null,
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
    titlePresent: typeof data?.title === 'string' && data.title.length > 0, // название беседы в отчёт не пишется
    created: data?.created ?? null,
    updated: data?.update_time ?? data?.modified_time ?? null,
    completionCodes: data?.mapping
      ? [...new Set(Object.values(data.mapping).map((n) => n?.message?.metadata?.finish_code ?? n?.message?.status ?? null))].slice(0, 6)
      : null,
  });

  // ---------------- скачивание файла и вердикт ----------------
  const probeAsset = async (ref, expected) => {
    const rec = {
      assetLabel: ref.label ?? labelOf('asset', ref.id),
      foundVia: ref.via,
      namePresentApi: ref.namePresent ?? null, // имя файла в отчёт не пишется
      mimeFromApi: ref.mime_type ?? ref.mime ?? null,
      sizeFromApi: ref.size ?? null,
      widthFromApi: ref.width ?? null,
      heightFromApi: ref.height ?? null,
      apiObjectKeys: ref.objectKeys ?? null,
      expectedFromArchive: expected
        ? { sizeBytes: expected.size ?? null, sha256Known: Boolean(expected.sha256) }
        : null,
    };
    if (!safeId(ref.id)) {
      rec.filesDownloadEndpoint = { status: null, auth: 'UNSUPPORTED', reason: 'asset_id_unsafe' };
      return rec;
    }
    const dl = await api(`https://chatgpt.com/backend-api/files/download/${ref.id}`);
    rec.filesDownloadEndpoint = { status: dl.status, ms: dl.ms, error: dl.error ?? null, auth: authClass(dl) };
    const signed = dl.json?.download_url ?? dl.json?.url ?? null;
    rec.signedUrlPresent = Boolean(signed);
    if (signed) {
      rec.downloadTarget = urlShape(signed); // hostname + нормализованный путь + имена параметров
      rec.signedUrlExpiry = dl.json?.expires_datetime ?? dl.json?.expires ?? dl.json?.expires_at ?? null;
      const declared = Number(ref.size ?? 0);
      const room = Math.min(MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES - downloadedBytesTotal);
      if (declared && declared > MAX_BYTES_PER_FILE) {
        rec.bytes = { status: 'SKIPPED_LIMIT', reason: 'api_declared_over_file_limit', declaredSizeFromApi: declared, limitBytes: MAX_BYTES_PER_FILE };
      } else if (room <= 0) {
        rec.bytes = { status: 'SKIPPED_LIMIT', reason: 'total_limit_before_start', limitBytes: MAX_TOTAL_BYTES, downloadedBytesTotal };
      } else if (downloadAttempts >= MAX_TOTAL_FILES) {
        rec.bytes = { status: 'SKIPPED_LIMIT', reason: 'file_count_limit', limitFiles: MAX_TOTAL_FILES, downloadAttempts };
      } else {
        try {
          const d = await fetchDownload(signed);
          if (d.status !== 'OK') {
            rec.bytes = {
              status: d.status,
              reason: d.reason ?? null,
              host: d.host ?? null,
              httpStatus: d.httpStatus ?? null,
              addressIssues: d.issues ?? null,
              redirectHops: d.redirectHops ?? 0,
              ms: d.ms ?? null,
              countedInTotals: false,
            };
          } else {
            const r = await readCapped(d.resp, room);
            if (r.status !== 'OK') {
              rec.bytes = {
                status: r.status,
                reason: r.reason,
                host: d.host,
                httpStatus: d.resp.status,
                declaredSizeFromApi: declared || null,
                declaredSizeFromContentLength: r.declaredSize ?? null,
                limitBytes: r.limitBytes,
                receivedBytes: r.receivedBytes ?? 0,
                attemptedBytes: r.attemptedBytes ?? null,
                countedInTotals: false,
                ms: d.ms,
              };
            } else {
              downloadedBytesTotal += r.receivedBytes;
              filesDownloaded += 1;
              const s = await sha256(r.bytes);
              rec.bytes = {
                status: 'OK',
                httpStatus: d.resp.status,
                servedType: d.resp.headers.get('content-type'),
                sizeBytes: r.receivedBytes,
                declaredSizeFromApi: declared || null,
                declaredSizeFromContentLength: r.declaredSize ?? null,
                contentLengthMatchesActual: r.contentLengthMatchesActual,
                sha256: s,
                firstBytesHex: head(r.bytes),
                ms: d.ms,
                sizeEqualsApiSize: declared ? r.receivedBytes === declared : null,
                shaEqualsArchive: expected?.sha256 ? s === expected.sha256 : null,
                sizeEqualsArchive: expected?.size ? r.receivedBytes === Number(expected.size) : null,
                host: d.host,
                redirectHops: d.redirectHops ?? 0,
                countedInTotals: true,
              };
              rec._signed = signed;
            }
          }
        } catch (e) {
          rec.bytes = { status: 'NETWORK_ERROR', error: String(e?.message ?? e), countedInTotals: false };
        }
      }
    }
    return rec;
  };

  // ---------------- отчёт ----------------
  const report = {
    probeVersion: 'A-2',
    at: new Date().toISOString(),
    pagePathTemplate: templatePath(location.pathname), // адрес без значений: uuid беседы свёрнут в <id>
    pageKind: sharePage ? 'share/public' : 'normal chat',
    hasAuthToken: Boolean(token),
    tokenSourceElementId: bootstrap ? (document.getElementById('client-bootstrap') ? 'client-bootstrap' : '__NEXT_DATA__') : null,
    hasDeviceId: deviceId, // cookie не читаем, поэтому всегда null; обхода через cookie не делаем
    cookiePolicy: 'cookies не читаются и не передаются: все fetch идут с credentials: omit',
    flags: { DOM_SURVEY, SCROLL_TEST, MAX_FILES_PER_CHAT, MAX_TOTAL_FILES, MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES, LINK_LIFETIME_CHECK, LINK_LIFETIME_MAX_ASSETS, LINK_LIFETIME_RANGE_BYTES, LINK_LIFETIME_MAX_BYTES_TOTAL },
    addressPolicy: {
      apiHost: API_HOST,
      apiRoutes: API_ROUTES.map(String),
      cdnHostsAllowlist: CDN_HOSTS.slice(),
      cdnFollowRedirects: CDN_FOLLOW_REDIRECTS,
      maxRedirectHops: MAX_REDIRECT_HOPS,
    },
    cdnHostsSeen: [...cdnHostsSeen],
    requests,
    chats: [],
    extraAssets: [],
    dom: null,
    scrollTest: null,
    linkLifetimeCheck: { enabled: false },
    idAliases: null, // заполняется только при DIAGNOSTIC_IDS = true
  };

  const ids = [];
  for (const c of CHATS) ids.push(typeof c === 'string' ? c : c.id);
  const current = (location.pathname.match(/\/(?:c|share|s)\/([A-Za-z0-9_-]+)/) || [])[1];
  if (current && !ids.includes(current)) ids.push(current);

  for (const convId of ids) {
    const chat = {
      chatLabel: labelOf('chat', convId), // реальный uuid беседы в отчёте не печатается
      currentTab: convId === current,
      fetch: null,
      meta: null,
      messagesSummary: null,
      assets: [],
    };
    const conv = await api(`https://chatgpt.com/backend-api/conversation/${convId}`);
    chat.fetch = { status: conv.status, ms: conv.ms, error: conv.error ?? null, contentType: conv.contentType ?? null, auth: authClass(conv) };
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
      // Связи сохраняются через локальные обозначения: сообщение -> найденное вложение.
      sampleWithAttachments: withRefs.slice(0, 6).map((m) => ({
        nodeLabel: m.nodeLabel,
        messageLabel: m.msgLabel,
        parentLabel: m.parentLabel,
        role: m.role,
        metadataKeys: m.metadataKeys,
        refs: m.refs.map((r) => ({
          assetLabel: r.label,
          via: r.via,
          mimeFromApi: r.mime_type ?? r.mime ?? null,
          sizeFromApi: r.size ?? null,
          namePresentApi: r.namePresent ?? null,
        })),
      })),
    };
    const allRefs = withRefs.flatMap((m) => m.refs);
    const uniq = [];
    const seen = new Set();
    for (const r of allRefs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      refIdsSeen.push(r.id);
      uniq.push(r);
    }
    chat.uniqueAssetRefs = uniq.length;
    for (const r of uniq.slice(0, MAX_FILES_PER_CHAT)) {
      if (downloadAttempts >= MAX_TOTAL_FILES) {
        chat.assets.push({ assetLabel: r.label, foundVia: r.via, bytes: { status: 'SKIPPED_LIMIT', reason: 'file_count_limit', limitFiles: MAX_TOTAL_FILES, downloadAttempts }, countedInTotals: false });
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
    const ref = { id, label: labelOf('asset', id), via: 'extra_list_from_archive' };
    refIdsSeen.push(id);
    const rec = await probeAsset(ref, null);
    // эталон ищем здесь же: размер и sha из архива подставляет пользовательский скрипт-отчёт,
    // в самом зонде эталонов нет (файл archive_reference.json остаётся у меня)
    report.extraAssets.push(rec);
  }

  // ---------------- дополнительные маршруты API (существуют ли) ----------------
  // Маршрут metadata проверяется на первом идентификаторе из памяти зонда:
  // в отчёт идут только статус и имена ключей ответа, без самого идентификатора.
  const firstAssetId = refIdsSeen.find((x) => safeId(x)) ?? null;
  const firstConv = ids.find((x) => safeId(x)) ?? null;
  report.endpointProbes = {};
  const probeEndpoints = [
    ['files_metadata', firstAssetId ? `https://chatgpt.com/backend-api/files/${firstAssetId}/metadata` : null],
    ['files_list', 'https://chatgpt.com/backend-api/files'],
    ['conversation_files', firstConv ? `https://chatgpt.com/backend-api/conversations/${firstConv}/files` : null],
  ];
  for (const [name, url] of probeEndpoints) {
    if (!url) continue;
    const r = await api(url);
    report.endpointProbes[name] = {
      status: r.status,
      auth: authClass(r), // без cookie авторизация только Bearer-токеном; при отказе — AUTH_REQUIRED
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
      pagePathTemplate: templatePath(location.pathname),
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
      // Ссылки на файлы в DOM: только количество, расширения и хосты — сами href и имена файлов не пишутся.
      fileLinks: (() => {
        const hrefs = [...document.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href'))
          .filter((h) => /\.(pdf|docx?|xlsx?|csv|txt|py|json|md)(\?|#|$)/i.test(h || ''));
        const ext = {};
        const hosts = {};
        for (const h of hrefs) {
          const m = String(h || '').match(/\.([a-z0-9]{1,6})(?:\?|#|$)/i);
          const e = m ? m[1].toLowerCase() : 'unknown';
          ext[e] = (ext[e] || 0) + 1;
          const hh = hostOf(h);
          hosts[hh] = (hosts[hh] || 0) + 1;
        }
        return { count: hrefs.length, extensions: ext, hosts: Object.keys(hosts).slice(0, 12) };
      })(),
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

  // ---------------- живость подписной ссылки: отдельный режим, по умолчанию выключено ----------
  report.linkLifetimeCheck = { enabled: false, method: null, maxAssets: LINK_LIFETIME_MAX_ASSETS, results: [] };
  if (LINK_LIFETIME_CHECK) {
    const signedList = report.chats
      .flatMap((c) => c.assets)
      .concat(report.extraAssets)
      .filter((a) => a._signed)
      .slice(0, LINK_LIFETIME_MAX_ASSETS);
    report.linkLifetimeCheck = {
      enabled: true,
      method: `GET Range: bytes=0-${LINK_LIFETIME_RANGE_BYTES - 1} (полный файл не скачивается)`,
      maxAssets: LINK_LIFETIME_MAX_ASSETS,
      rangeBytes: LINK_LIFETIME_RANGE_BYTES,
      maxBytesTotal: LINK_LIFETIME_MAX_BYTES_TOTAL,
      delayMs: LINK_LIFETIME_DELAY_MS,
      waitedForUserSignal: LINK_LIFETIME_WAIT_USER,
      results: [],
    };
    if (LINK_LIFETIME_DELAY_MS > 0) await new Promise((r) => setTimeout(r, LINK_LIFETIME_DELAY_MS));
    while (LINK_LIFETIME_WAIT_USER && !globalThis.__se_probe_go) {
      await new Promise((r) => setTimeout(r, 2000)); // ждём сигнал оператора, а не фиксированную паузу
    }
    for (const a of signedList) {
      if (linkBytesTotal >= LINK_LIFETIME_MAX_BYTES_TOTAL) {
        report.linkLifetimeCheck.results.push({ assetLabel: a.assetLabel, status: 'SKIPPED_LIMIT', reason: 'link_lifetime_bytes_limit', limitBytes: LINK_LIFETIME_MAX_BYTES_TOTAL });
        continue;
      }
      const room = Math.min(LINK_LIFETIME_RANGE_BYTES + 1, LINK_LIFETIME_MAX_BYTES_TOTAL - linkBytesTotal);
      const d = await fetchDownload(a._signed, { Range: `bytes=0-${LINK_LIFETIME_RANGE_BYTES - 1}` });
      if (d.status !== 'OK') {
        report.linkLifetimeCheck.results.push({ assetLabel: a.assetLabel, status: d.status, reason: d.reason ?? null, host: d.host ?? null });
        continue;
      }
      const r = await readCapped(d.resp, room);
      const headNow = r.status === 'OK' || r.bytes ? head(r.bytes ?? new Uint8Array(0)) : null;
      linkBytesTotal += r.receivedBytes ?? 0;
      report.linkLifetimeCheck.results.push({
        assetLabel: a.assetLabel,
        method: 'range_get',
        status: r.status === 'OK' ? 'OK' : r.status,
        reason: r.status === 'OK' ? null : r.reason,
        httpStatus: d.resp.status,
        rangeHonored: d.resp.status === 206,
        contentRange: d.resp.headers.get('content-range'),
        receivedBytes: r.receivedBytes ?? 0,
        fullFileDownloaded: r.receivedBytes > LINK_LIFETIME_RANGE_BYTES,
        firstBytesHexNow: headNow,
        firstBytesUnchanged: a.bytes?.firstBytesHex && headNow ? headNow === a.bytes.firstBytesHex : null,
        ms: d.ms,
        host: d.host,
      });
    }
    report.linkLifetimeCheck.bytesTotalRead = linkBytesTotal;
  }
  for (const c of report.chats) for (const a of c.assets) delete a._signed;
  for (const a of report.extraAssets) delete a._signed;

  report.cdnHostsSeen = [...cdnHostsSeen]; // итоговый список хостов из подписных ссылок (заполняется перед выводом)
  report.downloaded = {
    filesDownloaded,
    downloadedBytesTotal,
    downloadAttempts,
    maxConcurrentDownloads: downloadsMaxInFlight, // должно быть 1: загрузки строго последовательные
    limitBytesPerFile: MAX_BYTES_PER_FILE,
    limitBytesTotalRun: MAX_TOTAL_BYTES,
    limitFilesPerChat: MAX_FILES_PER_CHAT,
    limitFilesPerRun: MAX_TOTAL_FILES,
  };

  if (DIAGNOSTIC_IDS) report.idAliases = LABELS; // только по явному включению: обозначение -> реальный id

  // Краткая сводка перед полным JSON: в консоли сразу виден объём работы и отказы.
  const byStatus = {};
  for (const a of report.chats.flatMap((c) => c.assets).concat(report.extraAssets)) {
    const s = a.bytes?.status ?? 'NOT_PROBED';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  console.log(
    `зонд A-2 завершён: чатов ${report.chats.length}, попыток загрузки ${report.downloaded.downloadAttempts}, ` +
      `скачано байт ${report.downloaded.downloadedBytesTotal}, статусы: ${JSON.stringify(byStatus)}`,
  );
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

