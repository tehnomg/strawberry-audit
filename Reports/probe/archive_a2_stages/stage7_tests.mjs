/**
 * Mock-тесты зонда chatgpt_asset_probe_nocookie.js (задача A-2).
 * Только локальные стабы: реальной сети, ChatGPT и профиля браузера нет.
 * Запуск: node probe_a2_tests.mjs [id теста ...]   (например: node probe_a2_tests.mjs 01 02)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC_PATH = path.join(HERE, 'chatgpt_asset_probe_nocookie.js');
export const CDP_PATH = path.join(HERE, 'cdp_probe_run.mjs');
export const SRC = fs.readFileSync(SRC_PATH, 'utf8');
export const CDP_SRC = fs.readFileSync(CDP_PATH, 'utf8');

export const SECRET_TOKEN = 'TokS3cr3t-9f2a';
export const SECRET_TITLE = 'СекретноеНазваниеБеседы';
export const SECRET_FILE = 'СекретныйОтчёт2026.pdf';
export const SECRET_SIG = 'PODPISESECRET123';
export const CHAT_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const ASSET_ID_RE = /\bfile_[0-9a-f]{16,}\b/i;

// ---------- синтетические ответы API ----------
function convFixture(i) {
  const nodes = {};
  const mk = (id, role, content, metadata, parent) => {
    nodes[id] = { message: { id, parent_id: parent, author: { role }, content, metadata, children: [] } };
  };
  mk(`node_${i}_a`, 'user', { kind: 'message', parts: [{ content_type: 'text', text: 'ТЕКСТ_РЕПЛИКИ_НЕ_ДОЛЖЕН_ПОПАСТЬ_В_ОТЧЁТ' }] }, { attachments: [{ id: `file_0000000000000000000000000000${i}aa`, name: SECRET_FILE, mime_type: 'application/pdf', size: 1234 }] }, null);
  nodes[`node_${i}_a`].message.children = [`node_${i}_b`];
  mk(`node_${i}_b`, 'assistant', { kind: 'message', parts: [{ content_type: 'text', text: 'ответ' }] }, {}, `node_${i}_a`);
  nodes[`node_${i}_b`].message.children = [`node_${i}_c`];
  mk(`node_${i}_c`, 'user', { kind: 'message', parts: [{ content_type: 'image_asset_pointer', image_asset_pointer: `asset://${SECRET_FILE.replace('.pdf', '')}_gen_${i}` }] }, {}, `node_${i}_b`);
  return { id: `conv_uuid_${i}`, title: SECRET_TITLE, created: '2026-01-0T00:00:00Z', updated: '2026-01-0T00:00:00Z', mapping: nodes, completion_codes: { '1234': 'ok' } };
}

function bytesFixture({ body = new TextEncoder().encode('GIF89a\x01\x02\x03\x04\x05MOREBYTES').buffer, contentLength, chunkSize = 4, extraHeaders = {} } = {}, stats = {}) {
  const total = body.byteLength;
  const headers = { 'content-type': 'image/gif', ...extraHeaders };
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  else headers['content-length'] = String(total);
  return {
    ok: true, status: 200, url: '', type: 'basic',
    headers: mkHeaders(headers),
    body: {
      getReader() {
        stats.getReaderCalls = (stats.getReaderCalls ?? 0) + 1;
        let pos = 0;
        return {
          read() {
            if (pos >= total) return Promise.resolve({ done: true, value: undefined });
            const end = Math.min(pos + chunkSize, total);
            const value = new Uint8Array(body.slice(pos, end));
            pos = end;
            stats.reads = (stats.reads ?? 0) + 1;
            stats.delivered = (stats.delivered ?? 0) + value.byteLength;
            return Promise.resolve({ done: false, value });
          },
          cancel(reason) { stats.cancels = (stats.cancels ?? 0) + 1; stats.cancelReason = reason; return Promise.resolve(); },
          closed: Promise.resolve(),
        };
      },
    },
    async arrayBuffer() { stats.arrayBufferCalls = (stats.arrayBufferCalls ?? 0) + 1; return body.slice(0); },
  };
}

function mkHeaders(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (k) => (m.has(String(k).toLowerCase()) ? m.get(String(k).toLowerCase()) : null), entries: () => m.entries(), forEach: (f) => m.forEach(f) };
}

function jsonResponse(data, { status = 200, headers = { 'content-type': 'application/json' } } = {}) {
  return {
    ok: status >= 200 && status < 300, status, url: '', type: 'basic',
    headers: mkHeaders(headers),
    json: async () => data,
    text: async () => JSON.stringify(data),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(data)).buffer,
    body: null,
  };
}

// ---------- стаб среды браузера ----------
export function makeEnv({ location, routes = {}, domExtra = {}, page = {} } = {}) {
  const calls = [];
  const timers = [];
  const logs = [];
  const domTouch = { createElement: 0, cookieReads: 0, scrollTopWrites: 0, textReads: 0, innerHtmlWrites: 0 };
  const byteStats = { getReaderCalls: 0, reads: 0, cancels: 0, delivered: 0, arrayBufferCalls: 0 };

  const loc = location ?? {
    protocol: 'https:', hostname: 'chatgpt.com', host: 'chatgpt.com', origin: 'https://chatgpt.com',
    pathname: '/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea',
    href: 'https://chatgpt.com/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea',
    search: '', hash: '',
  };

  const turnStub = (i) => {
    const el = {
      tagName: 'SECTION', id: '', className: 'streaming-turn',
      getAttribute: (a) => (a === 'data-testid' ? `conversation-turn-${i}` : a === 'data-turn-id' ? String(i) : null),
      scrollHeight: 4000, clientHeight: 800,
      set scrollTop(v) { domTouch.scrollTopWrites += 1; }, get scrollTop() { return 120; },
    };
    el.parentElement = {
      tagName: 'MAIN', className: 'main-root',
      scrollHeight: 9000, clientHeight: 800,
      set scrollTop(v) { domTouch.scrollTopWrites += 1; }, get scrollTop() { return 300; },
      getAttribute: () => null,
    };
    return el;
  };
  const imgStub = (src) => ({ currentSrc: src, src });
  const linkStub = (href) => ({ getAttribute: (a) => (a === 'href' ? href : null), href });

  const doc = {
    getElementById: (id) => (id === 'client-bootstrap' || id === '__NEXT_DATA__' ? { textContent: page.bootstrap ?? JSON.stringify({ session: { accessToken: SECRET_TOKEN } }) } : null),
    querySelector: (sel) => (sel === 'main' ? { tagName: 'MAIN', scrollHeight: 9000, clientHeight: 800, set scrollTop(v) { domTouch.scrollTopWrites += 1; }, get scrollTop() { return 300; }, getAttribute: () => null } : null),
    querySelectorAll: (sel) => {
      if (sel.includes('conversation-turn') || sel.includes('article')) return [turnStub(0), turnStub(1), turnStub(2)];
      if (sel === 'img') return [imgStub('https://chatgpt.com/files/auth/1.png'), imgStub('data:image/png;base64,AAAA'), imgStub((domExtra.imgSrc ?? ''))];
      if (sel === 'a[href]') return [linkStub('/files/secret_local_name.pdf'), linkStub((domExtra.href ?? 'https://chatgpt.com/backend-api/files/download/file_0000000000000000000000000000aa?sig=SECRET_SIG_VALUE'))];
      if (sel === '[data-message-id]') return [{}, {}];
      if (sel === '[data-conversation-recovery]') return [];
      return [];
    },
    createElement: (tag) => { domTouch.createElement += 1; return { tagName: tag.toUpperCase(), href: '', download: '', style: {}, setAttribute() {}, click() { domTouch.clicks = (domTouch.clicks ?? 0) + 1; }, remove() {}, appendChild() {} }; },
    scrollingElement: { scrollHeight: 9000, clientHeight: 800, set scrollTop(v) { domTouch.scrollTopWrites += 1; }, get scrollTop() { return 300; } },
    documentElement: { scrollHeight: 9000, clientHeight: 800, set scrollTop(v) { domTouch.scrollTopWrites += 1; }, get scrollTop() { return 300; } },
    body: { innerText: 'СекретноеНазваниеБеседы и ещё текст страницы' },
  };
  Object.defineProperty(doc, 'cookie', { get() { domTouch.cookieReads += 1; throw new Error('COOKIE_READ_FORBIDDEN'); }, configurable: true });

  const fetchStub = async (url, opts = {}) => {
    const u = new URL(String(url), loc.origin);
    calls.push({
      url: String(url), host: u.host, path: u.pathname, method: opts.method ?? 'GET',
      credentials: opts.credentials ?? 'same-origin', redirect: opts.redirect ?? 'follow',
      headerNames: Object.keys(opts.headers ?? {}), hasAuth: Boolean(opts.headers?.Authorization),
      hasCookieHeader: Object.keys(opts.headers ?? {}).some((h) => h.toLowerCase() === 'cookie'),
      range: opts.headers?.Range ?? null,
    });
    if (u.host !== 'chatgpt.com') {
      return routes.bytes ? routes.bytes(u) : bytesFixture({}, byteStats);
    }
    if (u.pathname.startsWith('/backend-api/conversation/')) return routes.conversation ? routes.conversation(u) : jsonResponse(convFixture(calls.length));
    if (u.pathname.startsWith('/backend-api/files/download/')) return routes.download ? routes.download(u) : jsonResponse({ download_url: `https://cdn.test.invalid/dl/${u.pathname.split('/').pop()}?sig=${SECRET_SIG}&exp=1790000000`, expires_datetime: '2026-09-01T00:00:00Z' });
    if (u.pathname.startsWith('/backend-api/files/')) return routes.metadata ? routes.metadata(u) : jsonResponse({ ok: true });
    if (u.pathname === '/backend-api/files') return jsonResponse([]);
    if (u.pathname.startsWith('/backend-api/conversations/')) return jsonResponse({ files: [] });
    return routes.other ? routes.other(u) : jsonResponse({ unexpected: true });
  };

  class URLStable extends URL { static createObjectURL() { return 'blob:local/report'; } static revokeObjectURL() {} }
  const consoleStable = { log: (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')), warn: (...a) => logs.push('warn ' + a.join(' ')), error: (...a) => logs.push('error ' + a.join(' ')), info: () => {} };

  return {
    location: loc, document: doc, fetch: fetchStub, console: consoleStable, calls, timers, logs, domTouch, byteStats,
    performance: { now: () => Number(process.hrtime.bigint() % 1000000n) },
    setTimeout: (cb, ms) => { timers.push(ms ?? 0); cb(); return 0; },
    URL: URLStable, Blob: class Blob { constructor() {} }, crypto: globalThis.crypto,
  };
}

// Тестовые подстановки констант: меняем только значения настроек зонда, саму логику не трогаем.
// Если якорь не найден — тест падает, а не тихо проверяет неизвестно что.
const CHATS_BLOCK = `  const CHATS = [
    { id: '6aaa1f50-0e78-83eb-8c01-9153effd07ea', note: 'новый чат, загруженные фото' },
    { id: '6a955f43-2a48-83ed-ab8f-a4f00a4c114b', note: 'файлы .py' },
    { id: '6a422372-6368-83ea-b57d-380fa30c29e3', note: '.json и .py' },
    { id: '67a47e8f-7be4-800d-b293-f6607dfa0ee6', note: 'webp' },
    { id: '69c1e80d-2f94-832b-ae42-194947247be0', note: 'PDF 10 МБ, в архиве статус missing' },
    { id: '69beca28-ad34-8326-818a-dba8c39e883c', note: 'старый чат (март), фото' },
  ];`;
const EXTRA_BLOCK = `  const EXTRA_ASSET_IDS = [
    'file_000000007c50722f9fb6ad9dc546a213', // Younger_Lens_Availability_Guide.pdf (missing)
    'file_000000002dd481f4951b20e4ef2083c6', // jpg из чата 6aaa1f50
  ];`;
export const PATCH = {
  // список чатов и идентификаторов в настройках зонда подменяем синтетическими,
  // чтобы проверки меток были детерминированными
  chats: [CHATS_BLOCK, "  const CHATS = [{ id: 'conv_uuid_0', note: 'фикстура' }, { id: 'conv_uuid_1', note: 'фикстура' }];"],
  extra: [EXTRA_BLOCK, "  const EXTRA_ASSET_IDS = ['file_0000000000000000000000000000aa'];"],
  cdn: (hosts) => ['const CDN_HOSTS = [];', `const CDN_HOSTS = [${hosts.map((h) => `'${h}'`).join(', ')}];`],
  followRedirects: ['const CDN_FOLLOW_REDIRECTS = false;', 'const CDN_FOLLOW_REDIRECTS = true;'],
  fileLimit: (n) => ['const MAX_BYTES_PER_FILE = 40 * 1024 * 1024;', `const MAX_BYTES_PER_FILE = ${n};`],
  totalLimit: (n) => ['const MAX_TOTAL_BYTES = 200 * 1024 * 1024;', `const MAX_TOTAL_BYTES = ${n};`],
  perChat: (n) => ['const MAX_FILES_PER_CHAT = 12;', `const MAX_FILES_PER_CHAT = ${n};`],
  totalFiles: (n) => ['const MAX_TOTAL_FILES = 30;', `const MAX_TOTAL_FILES = ${n};`],
  diagIds: ['const DIAGNOSTIC_IDS = false;', 'const DIAGNOSTIC_IDS = true;'],
  linkCheck: ['const LINK_LIFETIME_CHECK = false;', 'const LINK_LIFETIME_CHECK = true;'],
};

export async function runProbe(env, patches = []) {
  const names = ['location', 'document', 'fetch', 'console', 'performance', 'setTimeout', 'URL', 'Blob', 'crypto'];
  let src = SRC;
  for (const [from, to] of patches) {
    if (!src.includes(from)) fail(`в исходнике нет якоря «${from}»: тестовая подстановка не применена`);
    src = src.replace(from, to);
  }
  const body = src.trimEnd().replace(/;\s*$/, '');
  const fn = new Function(...names, `"use strict"; return (${body});`);
  return await fn(env.location, env.document, env.fetch, env.console, env.performance, env.setTimeout, env.URL, env.Blob, env.crypto);
}

// ---------- мини-фреймворк ----------
const tests = [];
export const test = (id, name, fn) => tests.push({ id, name, fn });
const results = [];
const fail = (m) => { throw new Error(m); };
const expect = (cond, m) => { if (!cond) fail(m); };
export function scanLeaks(obj, label, extraBad = []) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const bad = [];
  if (CHAT_UUID_RE.test(s)) bad.push('uuid беседы');
  if (ASSET_ID_RE.test(s)) bad.push('идентификатор ассета file_…');
  if (s.includes(SECRET_TOKEN)) bad.push('значение токена');
  if (s.includes(SECRET_TITLE)) bad.push('название беседы');
  if (s.includes(SECRET_FILE)) bad.push('имя файла');
  if (s.includes(SECRET_SIG)) bad.push('значение подписи из query');
  if (/https?:\/\//.test(s)) bad.push('абсолютный URL');
  if (/ТЕКСТ_РЕПЛИКИ/.test(s)) bad.push('текст реплики');
  if (/secret_local_name/.test(s)) bad.push('href из DOM');
  if (/"(title|name|file_name|filename|href|url|bodySample|signedUrl|convId|nodeId|messageId|assetId)"\s*:/.test(s)) bad.push('запрещённое поле');
  for (const b of extraBad) if (s.includes(b)) bad.push(b);
  if (bad.length) fail(`${label}: в отчёте/консоли найдено: ${bad.join(', ')}`);
}

export { jsonResponse, bytesFixture, mkHeaders, convFixture, tests, results, expect, fail };

// ============================== ТЕСТЫ ==============================
const apiCalls = (env) => env.calls.filter((c) => c.host === 'chatgpt.com');
const dlCalls = (env) => env.calls.filter((c) => c.host !== 'chatgpt.com');

test('01', 'статические гарантии: нет cookie, include, нигет-методов', () => {
  const bad = [];
  if (/document\s*\.\s*cookie/.test(SRC)) bad.push('document.cookie');
  if (/credentials\s*:\s*['"]include['"]/.test(SRC)) bad.push("credentials: 'include'");
  if (/\b(POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) bad.push('негет-метод');
  if (/READ_DEVICE_COOKIE/.test(SRC)) bad.push('READ_DEVICE_COOKIE');
  if (/bodySample/.test(SRC)) bad.push('bodySample');
  expect(bad.length === 0, bad.join(', '));
});

test('02', 'запросы: только GET, credentials omit, Bearer только на API', async () => {
  const env = makeEnv();
  // allowlist CDN нужен, чтобы путь загрузки вообще выполнялся: по умолчанию он пуст (этап 3)
  const rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  expect(env.calls.length > 0, 'нет ни одного запроса');
  for (const c of env.calls) expect(c.method === 'GET', `метод ${c.method} на ${c.path}`);
  for (const c of apiCalls(env)) {
    expect(c.credentials === 'omit', `credentials=${c.credentials} на ${c.path}`);
    expect(!c.hasCookieHeader, 'cookie-заголовок передаётся');
  }
  expect(apiCalls(env).every((c) => c.hasAuth), 'на части API-запросов нет Authorization');
  expect(dlCalls(env).length > 0, 'нет ни одной загрузки по подписной ссылке');
  for (const c of dlCalls(env)) {
    expect(c.credentials === 'omit', `загрузка: credentials=${c.credentials}`);
    expect(!c.hasAuth, 'Authorization ушёл на CDN');
  }
  const dump = JSON.stringify(rep) + env.logs.join('\n');
  expect(!dump.includes(SECRET_TOKEN), 'значение токена попало в отчёт/консоль');
  expect(rep.hasAuthToken === true, 'hasAuthToken !== true');
  expect(rep.hasDeviceId === null || rep.hasDeviceId === false, 'hasDeviceId должен быть null/false');
  expect(env.domTouch.cookieReads === 0, 'cookie читались');
});

test('03', '401 на беседу -> AUTH_REQUIRED, без обхода через cookie', async () => {
  const env = makeEnv({ routes: { conversation: () => jsonResponse({ detail: 'unauthorized' }, { status: 401 }) } });
  const rep = await runProbe(env);
  const auths = rep.chats.map((c) => c.fetch?.auth);
  expect(auths.length > 0 && auths.every((a) => a === 'AUTH_REQUIRED'), `auth=${JSON.stringify(auths)}`);
  expect(rep.chats.every((c) => c.fetch?.status === 401), 'статус 401 не зафиксирован');
});

test('04', 'скачивание байтов: без Authorization и без cookie, адрес в allowlist', async () => {
  const env = makeEnv();
  const rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  const assets = rep.chats.flatMap((c) => c.assets).filter((a) => a.bytes?.sha256);
  expect(assets.length > 0, 'ни один файл не скачан');
  const dump = JSON.stringify(assets);
  expect(/cdn\.test\.invalid/.test(dump), 'хост загрузки не зафиксирован в отчёте');
  expect(dlCalls(env).length > 0, 'запроса к CDN не было');
  for (const c of dlCalls(env)) {
    expect(!c.hasAuth && c.credentials === 'omit', 'авторизация/cookie ушли на CDN');
    expect(c.redirect === 'manual', `redirect=${c.redirect}: автоматическое следование не отключено`);
  }
});

test('06', 'дополнительные маршруты: статус авторизации зафиксирован', async () => {
  const env = makeEnv({ routes: { metadata: () => jsonResponse({ detail: 'forbidden' }, { status: 403 }) } });
  const rep = await runProbe(env);
  const ep = rep.endpointProbes ?? {};
  const names = Object.keys(ep);
  expect(names.length >= 2, 'мало проверенных маршрутов');
  for (const n of names) expect(typeof ep[n].auth === 'string', `маршрут ${n}: нет поля auth`);
  const forbidden = names.filter((n) => /metadata/.test(n));
  if (forbidden.length) expect(ep[forbidden[0]].auth === 'AUTH_REQUIRED', '403 не помечен AUTH_REQUIRED');
});

// --- проверки, которые должны заработать на соответствующих этапах ---
test('05', 'контекст: чужой hostname / http / share -> отказ до запросов (этап 7)', async () => {
  const cases = [
    { loc: { protocol: 'http:', hostname: 'chatgpt.com', host: 'chatgpt.com', origin: 'http://chatgpt.com', pathname: '/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea', href: 'http://chatgpt.com/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea', search: '', hash: '' }, why: 'http' },
    { loc: { protocol: 'https:', hostname: 'evil.example', host: 'evil.example', origin: 'https://evil.example', pathname: '/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea', href: 'https://evil.example/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea', search: '', hash: '' }, why: 'чужой hostname' },
    { loc: { protocol: 'https:', hostname: 'chatgpt.com', host: 'chatgpt.com', origin: 'https://chatgpt.com', pathname: '/share/6aaa1f50-0e78-83eb-8c01-9153effd07ea', href: 'https://chatgpt.com/share/6aaa1f50-0e78-83eb-8c01-9153effd07ea', search: '', hash: '' }, why: 'share-страница' },
  ];
  for (const c of cases) {
    const env = makeEnv({ location: c.loc });
    let rep = null;
    try { rep = await runProbe(env); } catch { /* отказ исключением тоже допустим, если до запросов */ }
    if (env.calls.length) fail(`${c.why}: выполнено запросов ${env.calls.length}, ожидались 0`);
    const st = JSON.stringify(rep ?? {});
    if (rep && !/INVALID_CONTEXT/.test(st)) fail(`${c.why}: в отчёте нет INVALID_CONTEXT`);
    if (env.domTouch.cookieReads) fail(`${c.why}: cookie всё-таки читались`);
    if (env.domTouch.createElement) fail(`${c.why}: при отказе создаются элементы страницы`);
  }

  // 5.2 строгая проверка hostname: поддомен и «хвост» не принимаются
  const strict = [
    { pathname: '/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea', hostname: 'chatgpt.com.evil.example', host: 'chatgpt.com.evil.example', origin: 'https://chatgpt.com.evil.example', protocol: 'https:', href: 'https://chatgpt.com.evil.example/c/x', search: '', hash: '' },
    { pathname: '/c/x', hostname: 'www.chatgpt.com', host: 'www.chatgpt.com', origin: 'https://www.chatgpt.com', protocol: 'https:', href: 'https://www.chatgpt.com/c/x', search: '', hash: '' },
    { pathname: '/c/x', hostname: 'chatgpt.com', host: 'chatgpt.com:8443', origin: 'https://chatgpt.com:8443', protocol: 'https:', href: 'https://chatgpt.com:8443/c/x', search: '', hash: '', port: '8443' },
    { pathname: '/s/6aaa1f50-0e78-83eb-8c01-9153effd07ea', hostname: 'chatgpt.com', host: 'chatgpt.com', origin: 'https://chatgpt.com', protocol: 'https:', href: 'https://chatgpt.com/s/x', search: '', hash: '' },
  ];
  for (const loc of strict) {
    const env = makeEnv({ location: loc });
    const rep = await runProbe(env);
    expect(env.calls.length === 0, `${loc.host}${loc.pathname}: запросов ${env.calls.length}, ожидалось 0`);
    expect(/INVALID_CONTEXT/.test(JSON.stringify(rep)), `${loc.host}${loc.pathname}: нет INVALID_CONTEXT`);
  }

  // 5.3 нет токена на странице = нет признака авторизованного интерфейса: отказ до запросов
  const envNoTok = makeEnv({ page: { bootstrap: JSON.stringify({ session: {} }) } });
  const repNoTok = await runProbe(envNoTok);
  expect(envNoTok.calls.length === 0, `без токена выполнено запросов ${envNoTok.calls.length}`);
  expect(/no_auth_token/.test(JSON.stringify(repNoTok.context ?? {})), 'нет причины no_auth_token');

  // 5.4 корректный контекст фиксируется в отчёте, запросы идут
  const envOk = makeEnv();
  const repOk = await runProbe(envOk);
  expect(repOk.context?.status === 'OK', `контекст: ${JSON.stringify(repOk.context)}`);
  expect(envOk.calls.length > 0, 'в корректном контексте запросов не было');

  // 5.5 широкого совпадения подстрокой нет: host сверяется только строгим равенством
  expect(!/hostname\s*\.\s*(includes|startsWith|endsWith|indexOf)/.test(SRC), 'hostname проверяется нестрогим сравнением');
  expect(/location\.hostname !== API_HOST/.test(SRC), 'контекст проверяется не строгим равенством хоста');
  expect(!/\.includes\(\s*['"]openai/i.test(SRC), 'в коде есть совпадение по подстроке openai');
});

test('07', 'минимизация отчёта: нет названий, имён, url, id, текстов (этап 6)', async () => {
  const env = makeEnv();
  const rep = await runProbe(env);
  scanLeaks(rep, 'отчёт');
  scanLeaks(env.logs.join('\n'), 'консоль');
  for (const a of rep.chats.flatMap((c) => c.assets)) {
    if (a.bytes?.firstBytesHex) expect(a.bytes.firstBytesHex.length <= 24, `firstBytesHex ${a.bytes.firstBytesHex.length} символов`);
  }

  // 7.1 локальные обозначения на месте
  expect(rep.chats[0]?.chatLabel === 'chat_1', `метка чата: ${rep.chats[0]?.chatLabel}`);
  const assetLabels = rep.chats.flatMap((c) => c.assets.map((a) => a.assetLabel));
  expect(assetLabels.includes('asset_1'), `метки ассетов: ${assetLabels.join(',')}`);

  // 7.2 связи сообщение -> вложение сохранены через обозначения
  const samples = rep.chats.flatMap((c) => c.messagesSummary?.sampleWithAttachments ?? []);
  expect(samples.length > 0, 'нет выборки сообщений с вложениями');
  expect(samples.every((s) => s.messageLabel), 'у сообщения нет локальной метки');
  for (const s of samples) {
    for (const r of s.refs) expect(assetLabels.includes(r.assetLabel), `связь message->asset потеряна: ${r.assetLabel}`);
    if (s.parentLabel) expect(s.parentLabel !== s.messageLabel, 'родитель и сообщение получили одну метку');
  }

  // 7.3 маршруты в статистике запросов нормализованы
  const paths = Object.keys(rep.requests.byPath);
  expect(paths.length > 0, 'статистика запросов пуста');
  expect(paths.every((p) => /\/(conversation|download|files)\/<id>/.test(p) || !/(conversation|download|files)\//.test(p)), `не нормализовано: ${paths.join(' | ')}`);

  // 7.4 адрес загрузки: hostname + нормализованный путь + имена параметров, без значений
  const dt = rep.chats.flatMap((c) => c.assets).find((a) => a.downloadTarget)?.downloadTarget;
  expect(dt, 'нет описания адреса загрузки');
  expect(dt.host === 'cdn.test.invalid', `hostname загрузки: ${dt.host}`);
  expect(dt.path.includes('<id>'), `путь не нормализован: ${dt.path}`);
  expect(dt.queryParamNames?.includes('sig') && dt.queryParamNames.includes('exp'), `имена параметров: ${JSON.stringify(dt.queryParamNames)}`);

  // 7.5 диагностический режим идентификаторов: по умолчанию выключен, включается явно
  expect(rep.idAliases === null, 'идентификаторы включены по умолчанию');
  // для проверки сопоставления меток берём синтетический список идентификаторов
  const env2 = makeEnv();
  const rep2 = await runProbe(env2, [PATCH.chats, PATCH.extra, PATCH.diagIds]);
  expect(rep2.idAliases?.chat?.chat_1 === 'conv_uuid_0', `diagnostics: ${JSON.stringify(rep2.idAliases?.chat)}`);
  expect(Object.keys(rep2.idAliases.chat).length >= 2, 'diagnostics: чатов меньше, чем в настройках');
  const a1 = rep2.idAliases?.asset?.asset_1 ?? '';
  expect(/^file_0+1aa$/.test(a1), `diagnostics assets: ${JSON.stringify(rep2.idAliases?.asset)}`);
  const withoutAliases = { ...rep2 };
  delete withoutAliases.idAliases;
  expect(!JSON.stringify(withoutAliases).includes(a1), 'идентификатор ассета просочился в остальную часть отчёта');
  expect(!JSON.stringify(withoutAliases).includes('conv_uuid_0'), 'идентификатор беседы просочился в остальную часть отчёта');
  // в обычном режиме aliases нет, хотя идентификаторы в настройках те же
  const env3 = makeEnv();
  const rep3 = await runProbe(env3, [PATCH.chats, PATCH.extra]);
  expect(rep3.idAliases === null, 'диагностический режим не выключен по умолчанию');
  scanLeaks(rep3, 'отчёт при синтетических идентификаторах');

  // 7.6 запрещённых полей в отчёте нет: имена файлов, названия бесед, сырые id и href
  const flatKeys = new Set();
  const walk = (o) => {
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { flatKeys.add(k); walk(v); }
  };
  walk(rep);
  for (const k of ['title', 'name', 'file_name', 'filename', 'href', 'convId', 'nodeId', 'messageId', 'assetId', 'signedUrl', 'linksToFiles', 'bodySample']) {
    expect(!flatKeys.has(k), `в отчёте есть поле ${k}`);
  }
  expect(flatKeys.has('titlePresent') && flatKeys.has('namePresentApi'), 'нет булевых признаков вместо значений');
});

const redirectResponse = (loc) => ({
  ok: false, status: 302, type: 'basic', url: '',
  headers: mkHeaders({ location: loc }), body: null,
  json: async () => null, arrayBuffer: async () => new ArrayBuffer(0),
});

test('08', 'allowlist адресов, порты, userinfo, redirect, небезопасные id (этап 3)', async () => {
  // 8.1 неизвестный CDN-хост: файл не качается, фиксируется UNTRUSTED_DOWNLOAD_HOST
  let env = makeEnv();
  let rep = await runProbe(env);
  let assets = rep.chats.flatMap((c) => c.assets).filter((a) => a.bytes);
  expect(assets.length > 0, 'нет записей о попытке загрузки');
  expect(assets.every((a) => a.bytes.status === 'UNTRUSTED_DOWNLOAD_HOST'), `статусы: ${assets.map((a) => a.bytes.status).join(',')}`);
  expect(dlCalls(env).length === 0, `запрос к неразрешённому хосту: ${dlCalls(env).length}`);
  expect(JSON.stringify(rep.cdnHostsSeen ?? []).includes('cdn.test.invalid'), 'hostname загрузки не зафиксирован');

  // 8.2 http вместо https
  env = makeEnv({ routes: { download: () => jsonResponse({ download_url: 'http://cdn.test.invalid/x?sig=x' }) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  expect(dlCalls(env).length === 0, 'разрешён http-адрес загрузки');
  expect(/not_https/.test(JSON.stringify(rep.chats)), 'нет причины not_https');

  // 8.3 посторонний порт и userinfo
  env = makeEnv({ routes: { download: () => jsonResponse({ download_url: 'https://cdn.test.invalid:8443/x?sig=x' }) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  expect(dlCalls(env).length === 0, 'посторонний порт не заблокирован');
  expect(/unexpected_port/.test(JSON.stringify(rep.chats)), 'нет причины unexpected_port');
  env = makeEnv({ routes: { download: () => jsonResponse({ download_url: 'https://cdn.test.invalid@evil.example/x' }) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  expect(dlCalls(env).length === 0, 'userinfo не заблокирован');
  expect(/userinfo_in_url/.test(JSON.stringify(rep.chats)), 'нет причины userinfo_in_url');

  // 8.4 redirect по умолчанию не выполняется: ни одного запроса на хост из Location
  env = makeEnv({ routes: { bytes: () => redirectResponse('https://cdn2.test.invalid/f') } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  expect(assets.length > 0 && assets.every((a) => a.bytes.status === 'UNTRUSTED_DOWNLOAD_HOST' && /redirect/.test(String(a.bytes.reason))), `redirect не зафиксирован как отказ: ${JSON.stringify(assets.map((a) => a.bytes))}`);
  expect(dlCalls(env).every((c) => c.host === 'cdn.test.invalid'), 'выполнен запрос на хост из Location');
  const paths = dlCalls(env).map((c) => c.path);
  expect(new Set(paths).size === paths.length, 'один и тот же адрес запрошен дважды (лишний переход)');

  // 8.5 redirect с явным разрешением, но чужой хост: второй запрос не уходит
  env = makeEnv({ routes: { bytes: () => redirectResponse('https://evil.example/f') } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.followRedirects]);
  expect(dlCalls(env).every((c) => c.host === 'cdn.test.invalid'), 'переход на чужой хост выполнился');
  expect(/redirect/.test(JSON.stringify(rep.chats)), 'нет записи о redirect');

  // 8.6 redirect на разрешённый хост при явном разрешении: загрузка состоялась
  let firstHop = true;
  env = makeEnv({
    routes: {
      bytes: () => {
        if (firstHop) { firstHop = false; return redirectResponse('https://cdn2.test.invalid/f'); }
        return bytesFixture({}, {});
      },
    },
  });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid', 'cdn2.test.invalid']), PATCH.followRedirects]);
  const okAssets = rep.chats.flatMap((c) => c.assets).filter((a) => a.bytes?.status === 'OK');
  expect(okAssets.length > 0, 'redirect на разрешённый хост не привёл к загрузке');
  const hostsSeen = [...new Set(dlCalls(env).map((c) => c.host))].sort();
  expect(hostsSeen.join(',') === 'cdn.test.invalid,cdn2.test.invalid', `хосты загрузок: ${hostsSeen.join(',')}`);
  expect(dlCalls(env).every((c) => c.redirect === 'manual'), 'есть запрос с автоматическим redirect');

  // 8.7 небезопасный идентификатор ассета не меняет маршрут запроса
  const evil = convFixture(9);
  evil.mapping['node_9_a'].message.metadata.attachments[0].id = 'file_x/../other';
  evil.mapping['node_9_c'].message.content.parts[0].image_asset_pointer = 'asset://file_y/../other';
  env = makeEnv({ routes: { conversation: () => jsonResponse(evil) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  const recs = rep.chats.flatMap((c) => c.assets);
  expect(recs.length > 0 && recs.every((r) => r.filesDownloadEndpoint?.reason === 'asset_id_unsafe'), `небезопасный id не заблокирован: ${JSON.stringify(recs.slice(0, 2))}`);
  expect(env.calls.every((c) => !/\/download\/file_[xy](\/|$)/.test(c.path)), 'запрос с небезопасным id всё равно ушёл');

  // 8.8 маршруты backend-api заданы явно, хосты сравниваются точно, а не по подстроке
  expect(!/(?:host|hostname|domain)\s*\.\s*(?:includes|startsWith|endsWith|indexOf)\s*\(/.test(SRC), 'есть неточная проверка хоста');
});

const bigBody = (n) => new Uint8Array(n).fill(65).buffer;
const FL = 2000; // лимит на файл в этих тестах: больше заявленного размера фикстуры (1234 б),
                 // чтобы срабатывал именно контроль загрузки, а не предварительная отбраковка

test('09', 'потоковые лимиты объёма (этап 4)', async () => {
  // 9.1 Content-Length сверх лимита файла: чтение не начинается вообще
  let env = makeEnv({ routes: { bytes: () => bytesFixture({ body: bigBody(5000), contentLength: 999 * 1024 }, {}) } });
  let rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  let assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  expect(assets.length > 0, 'нет записей о загрузках');
  expect(assets.every((a) => a.bytes.status === 'SKIPPED_LIMIT' && a.bytes.reason === 'content_length_over_limit'), `статусы: ${assets.map((a) => a.bytes.status + '/' + a.bytes.reason).join(', ')}`);
  expect(rep.downloaded.filesDownloaded === 0 && rep.downloaded.downloadedBytesTotal === 0, 'отклонённое засчитано как скачанное');

  // 9.2 Content-Length отсутствует: лимит проверяется по фактически принятым байтам, поток прерывается
  const st = {};
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: bigBody(4000), contentLength: 0, chunkSize: 4 }, st) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  expect(assets.every((a) => a.bytes.status === 'SKIPPED_LIMIT' && a.bytes.reason === 'stream_over_limit'), `потоковый лимит не сработал: ${JSON.stringify(assets[0]?.bytes)}`);
  expect(assets.every((a) => a.bytes.receivedBytes <= FL), 'накоплено больше лимита');
  expect(st.cancels >= 1, 'поток не прерван (cancel не вызван)');
  expect(st.getReaderCalls >= 1, 'потоковое чтение не использовалось');
  expect(rep.downloaded.filesDownloaded === 0 && rep.downloaded.downloadedBytesTotal === 0, 'прерванная загрузка засчитана как успешная');
  expect(assets.every((a) => a.bytes.countedInTotals === false), 'прерванная загрузка помечена засчитанной');

  // 9.3 Общий лимит прогона не обходится последовательностью файлов
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: bigBody(900), contentLength: 900 }, {}) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL), PATCH.totalLimit(1500)]);
  assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  const ok = assets.filter((a) => a.bytes.status === 'OK');
  const skipped = assets.filter((a) => a.bytes.status === 'SKIPPED_LIMIT');
  expect(ok.length === 1, `успешных загрузок: ${ok.length}`);
  expect(ok[0].bytes.sizeBytes === 900, `фактический размер: ${ok[0].bytes.sizeBytes}`);
  expect(ok[0].bytes.contentLengthMatchesActual === true, 'размер из content-length не сверен с фактическим');
  expect(rep.downloaded.filesDownloaded === 1 && rep.downloaded.downloadedBytesTotal === 900, `итоги: ${JSON.stringify(rep.downloaded)}`);
  expect(skipped.length > 0 && skipped.every((a) => /limit/.test(String(a.bytes.reason))), 'нет отказа по общему лимиту');

  // 9.4 Лимит количества файлов за прогон считается по попыткам
  env = makeEnv({ routes: { bytes: () => bytesFixture({}, {}) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL), PATCH.totalFiles(1)]);
  expect(dlCalls(env).length === 1, `запросов на CDN: ${dlCalls(env).length}, ожидался 1`);
  assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  expect(assets.some((a) => a.bytes.reason === 'file_count_limit'), 'нет отказа file_count_limit');

  // 9.5 Загрузки строго последовательные: одновременных было не больше одной
  expect(rep.downloaded.maxConcurrentDownloads === 1, `одновременных загрузок: ${rep.downloaded.maxConcurrentDownloads}`);

  // 9.6 Лимиты в отчёте приведены фактические, а не предполагаемые
  expect(rep.downloaded.limitBytesPerFile === FL && rep.downloaded.limitBytesTotalRun === 209715200, `лимиты в отчёте: ${JSON.stringify(rep.downloaded)}`);
  expect(rep.downloaded.limitFilesPerChat === 12 && rep.downloaded.limitFilesPerRun === 1, `лимиты файлов: ${JSON.stringify(rep.downloaded)}`);

  // 9.7 При недоступном потоке — понятный статус, а не неограниченное чтение
  env = makeEnv({ routes: { bytes: () => ({ ok: true, status: 200, type: 'basic', headers: mkHeaders({ 'content-type': 'image/gif' }), body: null, arrayBuffer: async () => bigBody(10 * 1024 * 1024) }) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  expect(assets.every((a) => a.bytes.status === 'UNSUPPORTED' && a.bytes.reason === 'stream_unavailable'), `отсутствие потока не обработано: ${JSON.stringify(assets[0]?.bytes)}`);
  expect(rep.downloaded.filesDownloaded === 0, 'чтение без потока засчитано');
});

test('10', 'повторная загрузка выключена по умолчанию (этап 5)', async () => {
  // 10.1 обычный прогон: ни одного повторного запроса байтов, никаких длительных пауз
  let env = makeEnv({ routes: { bytes: () => bytesFixture({}, {}) } });
  let rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  const dl = dlCalls(env);
  expect(dl.length > 0, 'в обычном прогоне загрузок не было');
  const urls = dl.map((c) => c.url);
  expect(new Set(urls).size === urls.length, `повторный запрос байтов: ${urls.length - new Set(urls).size}`);
  expect(rep.linkLifetimeCheck?.enabled === false, 'режим проверки живости ссылки включён по умолчанию');
  expect((rep.linkLifetimeCheck?.results ?? []).length === 0, 'в обычном прогоне есть результаты второй фазы');
  const bigTimers = env.timers.filter((t) => t >= 10000);
  expect(bigTimers.length === 0, `таймер ${bigTimers.join(',')} мс в обычном режиме`);
  const dump = JSON.stringify(rep);
  expect(!/recheckAfterMs|RECHECK_AFTER_MS/.test(dump), 'в отчёте осталась 90-секундная пауза');
  expect(dl.every((c) => c.range === null), 'в обычном прогоне ушёл Range-запрос');

  // 10.2 включённый режим: ограниченный GET Range, полного файла не скачиваем
  const rangeFixture = (stats = {}) => {
    const r = bytesFixture({ body: new Uint8Array(1024).fill(66).buffer, contentLength: 1024, chunkSize: 64 }, stats);
    return { ...r, status: 206, headers: mkHeaders({ 'content-type': 'application/pdf', 'content-length': '1024', 'content-range': 'bytes 0-1023/5000' }) };
  };
  const st = {};
  env = makeEnv({ routes: { bytes: () => rangeFixture(st) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.linkCheck]);
  const range = dlCalls(env).filter((c) => String(c.range ?? '').startsWith('bytes=0-'));
  expect(range.length > 0, 'Range-запрос не отправлен');
  expect(range.length === rep.linkLifetimeCheck.results.length, `Range-запросов ${range.length}, результатов ${rep.linkLifetimeCheck.results.length}`);
  expect(rep.linkLifetimeCheck.results.every((r) => r.method === 'range_get' && r.status === 'OK'), `метод/статус: ${JSON.stringify(rep.linkLifetimeCheck.results.map((r) => [r.method, r.status]))}`);
  expect(rep.linkLifetimeCheck.results.every((r) => r.rangeHonored === true && r.httpStatus === 206), 'поддержка Range не проверена по ответу');
  expect(rep.linkLifetimeCheck.results.every((r) => r.receivedBytes <= 1024), 'прочитано больше разрешённого');
  expect(rep.linkLifetimeCheck.results.every((r) => r.fullFileDownloaded === false), 'скачан полный файл');
  expect(!st.arrayBufferCalls, 'вторая фаза читает через arrayBuffer');
  expect(rep.linkLifetimeCheck.bytesTotalRead <= 5 * 1024, `объём второй фазы: ${rep.linkLifetimeCheck.bytesTotalRead}`);
  expect(rep.linkLifetimeCheck.results.every((r) => r.firstBytesHexNow && r.firstBytesHexNow.length <= 24), 'сигнатура первых байтов не ограничена');
  expect(rep.linkLifetimeCheck.results.every((r) => r.firstBytesUnchanged === true), 'совпадение первых байтов не сравнено');

  // 10.3 если Range не поддерживается (200 + полный ответ), полный файл не накапливается
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: new Uint8Array(20000).fill(67).buffer, contentLength: 20000, chunkSize: 512 }, {}) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.linkCheck]);
  const res = rep.linkLifetimeCheck.results;
  expect(res.length > 0 && res.every((r) => r.rangeHonored === false), 'ответ без 206 не помечен как неподдержка Range');
  expect(res.every((r) => r.status === 'SKIPPED_LIMIT' && r.receivedBytes === 0), 'полный ответ прочитан целиком');

  // 10.4 Range проигнорирован, Content-Length нет: поток обрывается на лимите, память не растёт
  const st2 = {};
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: new Uint8Array(30000).fill(67).buffer, contentLength: 0, chunkSize: 400 }, st2) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.linkCheck]);
  const res2 = rep.linkLifetimeCheck.results;
  expect(res2.length > 0 && res2.every((r) => r.rangeHonored === false), 'нет отметки о неподдержке Range');
  expect(res2.every((r) => r.reason === 'stream_over_limit' && r.receivedBytes <= 1025), `лимит потока не сработал: ${JSON.stringify(res2[0])}`);
  expect(st2.cancels >= 1, 'поток не прерван');
  expect(rep.linkLifetimeCheck.bytesTotalRead <= 5 * 1025, `объём второй фазы: ${rep.linkLifetimeCheck.bytesTotalRead}`);
});

test('12', 'зонд не меняет DOM и не прокручивает (этап 7)', async () => {
  const env = makeEnv();
  await runProbe(env);
  expect(env.domTouch.scrollTopWrites === 0, `записей scrollTop: ${env.domTouch.scrollTopWrites}`);
  expect(!/location\s*=\s*|location\.assign|location\.replace|window\.scroll/.test(SRC), 'в коде есть навигация/прокрутка окна');
});

// ---------- запуск ----------
const want = process.argv.slice(2);
for (const t of tests.sort((a, b) => a.id.localeCompare(b.id))) {
  if (want.length && !want.includes(t.id)) continue;
  try {
    await t.fn();
    console.log(`${t.id} PASS  ${t.name}`);
    results.push({ id: t.id, ok: true });
  } catch (e) {
    console.log(`${t.id} FAIL  ${t.name}\n      ${e.message}`);
    results.push({ id: t.id, ok: false, msg: e.message });
  }
}
const bad = results.filter((r) => !r.ok);
console.log(`\nитого: ${results.length} тестов, провалено ${bad.length}`);
process.exitCode = bad.length ? 1 : 0;

