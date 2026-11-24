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

// ---------- инфраструктура тестовой среды (этап 1 задачи A-2a) ----------
// Блок нужен, чтобы будущие проверки таймаутов и отмены потоков были конечными и
// наблюдаемыми: время идёт по виртуальным часам, поведение потоков и отмен задаёт тест,
// а необработанное отклонение промиса считается ошибкой всего набора, а не деталью фона.

export function abortErrorStable(text = 'операция прервана') {
  const e = new Error(text);
  e.name = 'AbortError';
  return e;
}

export function describeReason(r) {
  if (r instanceof Error) return `${r.name}: ${r.message}`;
  if (typeof r === 'string') return r;
  try { return JSON.stringify(r); } catch { return String(r); }
}

// Виртуальные часы. Колбэк вызывается только когда тест сам передвигает время, поэтому
// висящая операция остаётся висящей, а не «успешной» из-за внешнего сторожевого таймера.
// registered — те же задержки, что и раньше писал env.timers; live()/liveTimers() показывают,
// сколько таймеров ещё не сработали и не сняты.
export function makeClock() {
  const armed = [];
  const registered = [];
  const firedLog = [];
  let nextId = 1;
  let nowMs = 0;
  const setTimeoutStable = (cb, ms = 0) => {
    const delay = Math.max(0, Number(ms) || 0);
    registered.push(delay);
    const t = { id: nextId++, delay, dueAt: nowMs + delay, cb, cleared: false };
    armed.push(t);
    return t.id;
  };
  const clearTimeoutStable = (id) => {
    const t = armed.find((x) => x.id === id && !x.cleared);
    if (!t) return false;
    t.cleared = true;
    return true;
  };
  function advanceTo(targetMs) {
    const target = Math.max(nowMs, Number(targetMs) || 0);
    let fired = 0;
    for (;;) {
      const next = armed.filter((t) => !t.cleared && t.dueAt <= target).sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
      if (!next) break;
      next.cleared = true;
      nowMs = Math.max(nowMs, next.dueAt);
      fired += 1;
      firedLog.push({ delay: next.delay, atMs: nowMs });
      next.cb();
    }
    nowMs = Math.max(nowMs, target);
    return fired;
  }
  return {
    registered,
    firedLog,
    now: () => nowMs,
    setTimeout: setTimeoutStable,
    clearTimeout: clearTimeoutStable,
    live: () => armed.filter((t) => !t.cleared).length,
    liveTimers: () => armed.filter((t) => !t.cleared).map((t) => ({ id: t.id, delay: t.delay, dueAt: t.dueAt })),
    clearedCount: () => armed.filter((t) => t.cleared).length,
    advanceTo,
    advanceBy: (ms) => advanceTo(nowMs + Math.max(0, Number(ms) || 0)),
  };
}

export const drainMicrotasks = async (turns = 30) => { for (let i = 0; i < turns; i++) await Promise.resolve(); };
export const nextMacrotasks = (n = 3) => new Promise((resolve) => {
  const tick = typeof setImmediate === 'function' ? setImmediate : (f) => f();
  let left = Math.max(1, n);
  const step = () => { left -= 1; if (left <= 0) resolve(); else tick(step); };
  tick(step);
});

// Ждём промис только по виртуальным часам: передвигаем часы шагами и разгребаем очередь
// обещаний, пока операция не завершится или пока виртуальный лимит не исчерпается.
// state: 'ok' | 'rejected' | 'pending'. pending — это находка («операция висит»), а не успех.
export async function settleWithin(promise, clock, limitMs = 60000, stepMs = 500) {
  let outcome = { state: 'pending' };
  Promise.resolve(promise).then(
    (value) => { if (outcome.state === 'pending') outcome = { state: 'ok', value }; },
    (error) => { if (outcome.state === 'pending') outcome = { state: 'rejected', error }; },
  );
  let spent = 0;
  while (outcome.state === 'pending' && spent < limitMs) {
    await drainMicrotasks(30);
    if (outcome.state !== 'pending') break;
    clock.advanceBy(stepMs);
    spent += stepMs;
  }
  await drainMicrotasks(30);
  return { ...outcome, spentMs: spent, liveTimers: clock.live() };
}

// Управляемый AbortController: видно, сколько контроллеров создано, сколько раз вызван
// abort(), с какой причиной, сколько слушателей навешано и сколько ещё живых. Повторный
// abort() счётчик отмен не удваивает. Живые слушатели — это индикатор утечки фикстуры.
export function makeAbortHub(getNow = () => 0) {
  const hub = { created: 0, aborts: [], signals: 0, listenersAdded: 0, listenersRemoved: 0, signalList: [] };
  class AbortSignalStable {
    constructor() {
      this.aborted = false;
      this.reason = undefined;
      this.onabort = null;
      this._listeners = [];
      hub.signals += 1;
      hub.signalList.push(this);
    }
    addEventListener(type, cb) {
      if (type !== 'abort' || typeof cb !== 'function') return;
      this._listeners.push(cb);
      hub.listenersAdded += 1;
    }
    removeEventListener(type, cb) {
      if (type !== 'abort') return;
      const i = this._listeners.indexOf(cb);
      if (i < 0) return;
      this._listeners.splice(i, 1);
      hub.listenersRemoved += 1;
    }
    throwIfAborted() {
      if (!this.aborted) return;
      if (this.reason instanceof Error) throw this.reason;
      throw abortErrorStable(describeReason(this.reason ?? 'сигнал снят'));
    }
    toString() { return '[object AbortSignal]'; }
  }
  class AbortControllerStable {
    constructor() { hub.created += 1; this.signal = new AbortSignalStable(); }
    abort(reason) {
      const sig = this.signal;
      if (sig.aborted) return;
      const r = reason === undefined ? abortErrorStable('abort без причины') : reason;
      sig.aborted = true;
      sig.reason = r;
      hub.aborts.push({ atMs: getNow(), reasonText: describeReason(r), signal: sig, listeners: sig._listeners.length });
      if (typeof sig.onabort === 'function') {
        try { sig.onabort({ type: 'abort', target: sig }); } catch { /* слушатель не ломает отмену */ }
      }
      for (const cb of sig._listeners.slice()) {
        try { cb({ type: 'abort', target: sig }); } catch { /* слушатель не ломает отмену */ }
      }
    }
  }
  hub.liveListeners = () => hub.signalList.reduce((n, s) => n + s._listeners.length, 0);
  return { hub, AbortController: AbortControllerStable, AbortSignal: AbortSignalStable };
}

// Поток-фикстура с режимами, которых обычный поток из байт не даёт:
//   stallAfter  — после N отданных чанков следующий read() навсегда висит;
//   failAfter   — после N отданных чанков read() отклоняется (обрыв соединения);
//   delayChunks — задержка мс виртуального времени между чанками (медленный канал);
//   cancelMode  — 'immediate' | 'delayed' | 'never' | 'syncThrow' — как ведёт себя cancel().
// Семантика отмены разделена, как у настоящего ReadableStream:
//   снятие AbortSignal -> висящее и следующее чтение отклоняются с AbortError;
//   reader.cancel()    -> поток закрывается: висящее и следующие чтения дают done: true,
//                         данных после отмены не выдаётся никогда;
//   закрытие потока (closed) не зависит от того, завершился ли промис underlying cancel():
//   cancel() закрывает поток сразу, а его промис отвечает только за исход отмены.
// Задержанный чанк не считается выданным: delivered растёт только в момент фактической
// выдачи; при отмене задержанный чанк снимается с часов и не выдаётся.
// stats собирает наблюдаемую картину: reads, delivered, cancels, stalledReads,
// readRejectsAbort, pendingReadsClosed, readsAfterCancel, delayedChunksScheduled/
// Delivered/Dropped, cancelSettled, cancelThrows, closedState, signalListenersDetached.
export function makeStream(bytes, opts = {}, stats = {}) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const total = view.byteLength;
  const chunkSize = opts.chunkSize ?? 256;
  const cancelMode = opts.cancelMode ?? 'immediate';
  const cancelDelayMs = opts.cancelDelayMs ?? 1000;
  const clock = opts.clock ?? null;
  const failWith = typeof opts.failWith === 'function' ? opts.failWith : () => new Error('fixture_stream_break');
  const bump = (key, by = 1) => { stats[key] = (stats[key] ?? 0) + by; };
  let pos = 0;
  let chunksGiven = 0;
  let cancelled = false;
  let pendingRead = null;      // зависший read()
  let pendingChunk = null;     // задержанный чанк: запланирован, но ещё не выдан
  let signal = opts.signal ?? null;
  let signalListener = null;   // прикреплённый слушатель abort, чтобы снять его
  let closedResolve = null;
  let closedReject = null;
  let closedSettled = false;
  const closed = new Promise((resolve, reject) => { closedResolve = resolve; closedReject = reject; });
  closed.catch(() => {});      // отклонение закрытия не рождает необработанного отклонения

  const closeStream = (state) => {
    if (closedSettled) return;
    closedSettled = true;
    stats.closedState = state;
    bump('closedResolved');
    if (state === 'errored' && closedReject) closedReject(new Error('поток закрыт выбросом cancel()'));
    else if (closedResolve) closedResolve();
  };
  const detachSignal = () => {
    if (!signal || !signalListener) return false;
    if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', signalListener);
    signalListener = null;
    bump('signalListenersDetached');
    return true;
  };
  // Отмена через сигнал: чтение отклоняется ошибкой AbortError.
  const abortPendingRead = (reasonText) => {
    if (!pendingRead) return false;
    const p = pendingRead;
    pendingRead = null;
    p.reject(abortErrorStable(reasonText));
    bump('readRejectsAbort');
    return true;
  };
  // Обычный cancel(): поток закрывается, ожидающее чтение завершается как done без данных.
  const finishPendingReadAsDone = () => {
    if (!pendingRead) return false;
    const p = pendingRead;
    pendingRead = null;
    p.resolve({ done: true, value: undefined });
    bump('pendingReadsClosed');
    return true;
  };
  const dropPendingChunk = (why, reasonText = '') => {
    if (!pendingChunk) return false;
    const pc = pendingChunk;
    pendingChunk = null;
    if (clock && pc.timerId !== null) clock.clearTimeout(pc.timerId);
    bump('delayedChunksDropped');
    stats.droppedChunkBytes = (stats.droppedChunkBytes ?? 0) + (pc.to - pc.from);
    stats.droppedChunkWhy = why;
    if (why === 'signal_abort') {
      bump('readRejectsAbort');
      pc.reject(abortErrorStable(reasonText || 'поток прерван сигналом во время задержки чанка'));
    } else {
      bump('doneReads');
      pc.resolve({ done: true, value: undefined });
    }
    return true;
  };
  const onAbort = () => {
    if (!signal || !signal.aborted) return;
    bump('abortSeen');
    dropPendingChunk('signal_abort', `поток прерван сигналом: ${describeReason(signal.reason)}`);
    abortPendingRead(`поток прерван сигналом: ${describeReason(signal.reason)}`);
    detachSignal();
  };
  const attachSignal = (sig) => {
    if (!sig) return;
    if (signalListener) detachSignal();
    signal = sig;
    bump('signalsAttached');
    if (typeof sig.addEventListener !== 'function') return;
    sig.addEventListener('abort', onAbort);
    signalListener = onAbort;
    if (sig.aborted) onAbort();
  };
  if (signal) attachSignal(signal);

  function deliver(from, to, viaDelay, resolve, reject) {
    if (cancelled) {
      bump('readsAfterCancel');
      bump('doneReads');
      if (viaDelay) bump('delayedChunksDropped');
      resolve({ done: true, value: undefined });
      return;
    }
    if (signal && signal.aborted) {
      bump('readRejectsAbort');
      if (viaDelay) bump('delayedChunksDropped');
      reject(abortErrorStable(`поток прерван сигналом: ${describeReason(signal.reason)}`));
      return;
    }
    const value = view.slice(from, to);
    pos = to;
    chunksGiven += 1;
    bump('reads');
    bump('delivered', value.byteLength);
    if (viaDelay) bump('delayedChunksDelivered');
    resolve({ done: false, value });
  }

  function readChunk() {
    if (pendingChunk) bump('concurrentReads');
    if (signal && signal.aborted) {
      bump('readRejectsAbort');
      return Promise.reject(abortErrorStable(`поток прерван сигналом: ${describeReason(signal.reason)}`));
    }
    if (cancelled) {
      bump('readsAfterCancel');
      bump('doneReads');
      return Promise.resolve({ done: true, value: undefined });
    }
    if (opts.stallAfter !== null && opts.stallAfter !== undefined && chunksGiven >= opts.stallAfter) {
      bump('stalledReads');
      return new Promise((resolve, reject) => {
        pendingRead = { resolve, reject };
        if (signal && signal.aborted) onAbort();
      });
    }
    if (opts.failAfter !== null && opts.failAfter !== undefined && chunksGiven >= opts.failAfter) {
      bump('failReads');
      return Promise.reject(failWith());
    }
    if (pos >= total) {
      bump('doneReads');
      closeStream('closed');
      detachSignal();
      return Promise.resolve({ done: true, value: undefined });
    }
    const from = pos;
    const to = Math.min(pos + chunkSize, total);
    const delay = Array.isArray(opts.delayChunks) ? (opts.delayChunks[chunksGiven] ?? 0) : (opts.delayChunks ?? 0);
    if (delay && !clock) throw new Error('delayChunks требует виртуальные часы clock в makeStream');
    if (!delay) return new Promise((resolve, reject) => deliver(from, to, false, resolve, reject));
    bump('delayedChunksScheduled');
    return new Promise((resolve, reject) => {
      const pc = { from, to, timerId: null, resolve, reject };
      pendingChunk = pc;
      pc.timerId = clock.setTimeout(() => {
        if (pendingChunk !== pc) return;   // чанк уже отменён: часы сняты, данные не выдаются
        pendingChunk = null;
        deliver(from, to, true, resolve, reject);
      }, delay);
    });
  }

  function doCancel(reason) {
    bump('cancels');
    stats.cancelReason = reason;
    stats.cancelMode = cancelMode;
    stats.chunksGivenAtCancel = chunksGiven;
    dropPendingChunk('cancel');
    finishPendingReadAsDone();
    cancelled = true;
    closeStream(cancelMode === 'syncThrow' ? 'errored' : 'cancelled');
    detachSignal();
    if (cancelMode === 'syncThrow') {
      bump('cancelThrows');
      throw new Error('fixture_cancel_sync_throw');
    }
    if (cancelMode === 'never') {
      bump('cancelStarted');
      return new Promise(() => {});
    }
    if (cancelMode === 'delayed') {
      if (!clock) throw new Error('cancelMode delayed требует виртуальные часы clock в makeStream');
      bump('cancelStarted');
      return new Promise((resolve) => {
        clock.setTimeout(() => { bump('cancelSettled'); resolve(); }, cancelDelayMs);
      });
    }
    bump('cancelSettled');
    return Promise.resolve();
  }

  const reader = { read: readChunk, cancel: (reason) => doCancel(reason), closed, releaseLock() { bump('releaseLocks'); } };
  const body = {
    getReader() { bump('getReaderCalls'); return reader; },
    cancel: (reason) => doCancel(reason),
    closed,
    __attachSignal: attachSignal,
    __detachSignal: detachSignal,
    __stats: stats,
  };
  return body;
}


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

function bytesFixture({ body = new TextEncoder().encode('GIF89a\x01\x02\x03\x04\x05MOREBYTES').buffer, contentLength, chunkSize = 4, extraHeaders = {} } = {}, stats = {}, streamOpts = {}) {
  const total = body.byteLength;
  const headers = { 'content-type': 'image/gif', ...extraHeaders };
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  else headers['content-length'] = String(total);
  return {
    ok: true, status: 200, url: '', type: 'basic',
    headers: mkHeaders(headers),
    body: streamOpts.stream ?? streamBody(body, stats, chunkSize, streamOpts),
    async arrayBuffer() { stats.arrayBufferCalls = (stats.arrayBufferCalls ?? 0) + 1; return body.slice(0); },
  };
}

function mkHeaders(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (k) => (m.has(String(k).toLowerCase()) ? m.get(String(k).toLowerCase()) : null), entries: () => m.entries(), forEach: (f) => m.forEach(f) };
}

// Поток из готовых байт: так же, как тело ответа браузера, с учётом прочитанного и отмен.
// По умолчанию поведение прежнее; через streamOpts включаются режимы makeStream.
function streamBody(bytes, stats = {}, chunkSize = 256, streamOpts = {}) {
  return makeStream(bytes, { chunkSize, ...streamOpts }, stats);
}

function jsonResponse(data, { status = 200, headers = { 'content-type': 'application/json' }, stream = null, streamOpts = {} } = {}, stats = {}) {
  const text = JSON.stringify(data);
  const bytes = new TextEncoder().encode(text);
  return {
    ok: status >= 200 && status < 300, status, url: '', type: 'basic',
    headers: mkHeaders({ 'content-length': String(bytes.byteLength), ...headers }),
    json: async () => data,
    text: async () => text,
    arrayBuffer: async () => bytes.buffer,
    body: stream ?? streamBody(bytes, stats, 256, streamOpts),
  };
}

// ---------- стаб среды браузера ----------
export function makeEnv({ location, routes = {}, domExtra = {}, page = {} } = {}) {
  const calls = [];
  const clock = makeClock();
  const timers = clock.registered;
  const abort = makeAbortHub(() => clock.now());
  const hangings = [];
  const streamsSeen = [];
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

  // Маршрут ответа: только выбор фикстуры по адресу. Журнал запроса и учёт сигнала ведёт
  // fetchStub — так слушатель abort можно снять, когда запрос завершится.
  const routeCall = async (url, opts = {}) => {
    const u = new URL(String(url), loc.origin);
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

  // Зависающий ответ: маршрут возвращает { __hangUntilAbort: true, resolveAfterMs?: N }.
  // Такой fetch не завершается, пока тест не передвинет виртуальные часы (тогда срабатывает
  // таймер зонда и снимает signal) либо пока resolveAfterMs не наступит по тем же часам.
  // Обычному ответу сигнал запроса навешивается на поток, чтобы отмена зонда была видна потоку.
  const withAbort = (pending, opts, url) => pending.then((res) => {
    if (res && res.__hangUntilAbort === true) {
      const rec = { url: String(url), hang: true, hasSignal: Boolean(opts.signal), aborted: false, resolvedAt: null };
      hangings.push(rec);
      return new Promise((resolve, reject) => {
        let settled = false;
        let detach = null;
        const finish = (kind, payload) => {
          if (settled) return;
          settled = true;
          rec.aborted = kind === 'abort';
          rec.resolvedAt = clock.now();
          if (detach) { detach(); detach = null; }
          if (kind === 'abort') reject(payload);
          else resolve(payload);
        };
        if (opts.signal) {
          if (opts.signal.aborted) return finish('abort', abortErrorStable(`сигнал уже снят: ${describeReason(opts.signal.reason)}`));
          if (typeof opts.signal.addEventListener === 'function') {
            const onAbort = () => finish('abort', abortErrorStable(`fetch прерван сигналом: ${describeReason(opts.signal.reason)}`));
            opts.signal.addEventListener('abort', onAbort);
            detach = () => {
              if (typeof opts.signal.removeEventListener === 'function') opts.signal.removeEventListener('abort', onAbort);
            };
          }
        }
        if (typeof res.resolveAfterMs === 'number' && res.resolveAfterMs >= 0 && clock) {
          clock.setTimeout(() => {
            const clean = { ...res };
            delete clean.__hangUntilAbort;
            delete clean.resolveAfterMs;
            finish('resolve', clean);
          }, res.resolveAfterMs);
        }
      });
    }
    if (res && opts.signal && res.body && typeof res.body.__attachSignal === 'function') {
      res.body.__attachSignal(opts.signal);
      streamsSeen.push({ url: String(url), stats: res.body.__stats ?? null });
    }
    return res;
  });
  // Точка входа fetch: журнал запроса, учёт снятого сигнала и обязательное снятие слушателя
  // abort, когда запрос заверчился (ответ получен или запрос отклонён).
  const fetchStub = (url, opts = {}) => {
    const u = new URL(String(url), loc.origin);
    const rec = {
      url: String(url), host: u.host, path: u.pathname, method: opts.method ?? 'GET',
      credentials: opts.credentials ?? 'same-origin', redirect: opts.redirect ?? 'follow',
      headerNames: Object.keys(opts.headers ?? {}), hasAuth: Boolean(opts.headers?.Authorization),
      hasCookieHeader: Object.keys(opts.headers ?? {}).some((h) => h.toLowerCase() === 'cookie'),
      hasSignal: Boolean(opts.signal),
      range: opts.headers?.Range ?? null,
    };
    calls.push(rec);
    let detachSignal = null;
    if (opts.signal) {
      const mark = () => { rec.signalAbortedAt = clock.now(); };
      if (opts.signal.aborted) mark();
      else if (typeof opts.signal.addEventListener === 'function') {
        opts.signal.addEventListener('abort', mark);
        detachSignal = () => {
          if (typeof opts.signal.removeEventListener === 'function') opts.signal.removeEventListener('abort', mark);
        };
      }
    }
    const release = () => { if (detachSignal) { detachSignal(); detachSignal = null; rec.signalListenerRemoved = true; } };
    return withAbort(routeCall(url, opts), opts, url).then(
      (v) => { release(); return v; },
      (e) => { release(); throw e; },
    );
  };

  class URLStable extends URL { static createObjectURL() { return 'blob:local/report'; } static revokeObjectURL() {} }
  const consoleStable = { log: (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')), warn: (...a) => logs.push('warn ' + a.join(' ')), error: (...a) => logs.push('error ' + a.join(' ')), info: () => {} };

  return {
    location: loc, document: doc, fetch: fetchStub, console: consoleStable, calls, timers, logs, domTouch, byteStats,
    performance: { now: () => Number(process.hrtime.bigint() % 1000000n) },
    // Таймеры зонда живут на виртуальных часах: срабатывают только когда тест сам двигает время.
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    clock, abort, AbortController: abort.AbortController, AbortSignal: abort.AbortSignal,
    hangings, streamsSeen,
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
  jsonLimit: (n) => ['const MAX_JSON_BYTES = 4 * 1024 * 1024;', `const MAX_JSON_BYTES = ${n};`],
};

export async function runProbe(env, patches = []) {
  const names = ['location', 'document', 'fetch', 'console', 'performance', 'setTimeout', 'clearTimeout', 'AbortController', 'URL', 'Blob', 'crypto'];
  let src = SRC;
  for (const [from, to] of patches) {
    if (!src.includes(from)) fail(`в исходнике нет якоря «${from}»: тестовая подстановка не применена`);
    src = src.replace(from, to);
  }
  const body = src.trimEnd().replace(/;\s*$/, '');
  const fn = new Function(...names, `"use strict"; return (${body});`);
  return await fn(env.location, env.document, env.fetch, env.console, env.performance, env.setTimeout, env.clearTimeout, env.AbortController, env.URL, env.Blob, env.crypto);
}

// ---------- мини-фреймворк ----------
const tests = [];
export const test = (id, name, fn, kind = /^I\d/.test(id) ? 'infra' : 'probe') => tests.push({ id, name, fn, kind });
const results = [];

// ---------- детектор необработанных отклонений промисов ----------
// Необработанное отклонение — это находка, а не фон: набор с таким отклонением незелёный.
// Запись привязывается к идущему тесту, чтобы провал был адресным.
let currentTestId = null;
const unhandledRejections = [];
let rejectionWindow = null;
process.on('unhandledRejection', (reason) => {
  const entry = {
    test: currentTestId ?? '(вне теста)',
    text: describeReason(reason),
    stack: reason && typeof reason.stack === 'string' ? reason.stack.split('\n').slice(0, 3).join(' | ') : '',
  };
  if (rejectionWindow) rejectionWindow.push(entry);
  else unhandledRejections.push(entry);
});
export const rejectionList = unhandledRejections;
// Окно наблюдения нужно для собственного теста детектора: намеренное отклонение не должно
// загрязнять общий счётчик набора.
export function openRejectionWindow() { rejectionWindow = []; return rejectionWindow; }
export function closeRejectionWindow() { const w = rejectionWindow; rejectionWindow = null; return w ?? []; }
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
export { streamBody };

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

  // 9.3 Общий лимит прогона не обходится ни успешными, ни неудачными загрузками; он же
  // ограничивает и чтение JSON-ответов. Проверяем инварианты, а не точное число загрузок:
  // суммарный объём сети не превышает потолок, принятые байты кратны фактическим размерам,
  // а само исчерпание бюджета видно в отчёте.
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: bigBody(900), contentLength: 900 }, {}) } });
  const measured = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const apiBytes = measured.downloaded.apiBytesRead;
  expect(apiBytes > 0, 'объём API-ответов не измерен');
  const runLimit = apiBytes + 1500;
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: bigBody(900), contentLength: 900 }, {}) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL), PATCH.totalLimit(runLimit)]);
  assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  const ok = assets.filter((a) => a.bytes.status === 'OK');
  const skipped = assets.filter((a) => a.bytes.status === 'SKIPPED_LIMIT');
  expect(rep.downloaded.apiBytesRead <= apiBytes, `объём API-ответов вырос: ${rep.downloaded.apiBytesRead} против ${apiBytes}`);
  expect(ok.length >= 1, `ни одной успешной загрузки при потолке ${runLimit}: ${JSON.stringify(assets.map((a) => a.bytes.reason))}`);
  expect(ok.every((a) => a.bytes.sizeBytes === 900), `размеры успешных: ${ok.map((a) => a.bytes.sizeBytes).join(',')}`);
  expect(ok.every((a) => a.bytes.contentLengthMatchesActual === true), 'размер из content-length не сверен с фактическим');
  expect(rep.downloaded.downloadedBytesTotal === ok.length * 900, `принято байт: ${rep.downloaded.downloadedBytesTotal}`);
  expect(rep.downloaded.bytesReadFromNetwork <= runLimit, `лимит сети превышен: ${rep.downloaded.bytesReadFromNetwork} > ${runLimit}`);
  expect(ok.length * 900 <= runLimit, `принятые байты превышают лимит прогона: ${ok.length * 900}`);
  expect(skipped.length > 0 && skipped.every((a) => /limit/.test(String(a.bytes.reason))), 'нет отказа по общему лимиту');
  expect(rep.downloaded.apiBytesRead + ok.length * 900 <= rep.downloaded.bytesReadFromNetwork, `счётчики не сходятся: ${JSON.stringify(rep.downloaded)}`);
  expect(rep.chats.some((c) => /limit/.test(String(c.fetch.jsonRead?.reason ?? ''))) || skipped.some((a) => a.bytes.reason === 'total_limit_before_start'), 'исчерпание общего бюджета сети не видно в отчёте');

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
  // Длительные таймеры допустимы только как таймауты ожидания ответа: они прерывают запрос,
  // а не создают паузу. Значения берутся из самого зонда, чтобы тест не разъехался с кодом.
  const apiTimeout = Number((SRC.match(/const API_HEAD_TIMEOUT_MS = (\d+)/) || [])[1]);
  const dlTimeout = Number((SRC.match(/const DOWNLOAD_HEAD_TIMEOUT_MS = (\d+)/) || [])[1]);
  expect(apiTimeout > 0 && dlTimeout > 0, 'в зонде не заданы таймауты ожидания ответа (этап 16)');
  const bigTimers = env.timers.filter((t) => t >= 10000 && t !== apiTimeout && t !== dlTimeout);
  expect(bigTimers.length === 0, `пауза ${bigTimers.join(',')} мс в обычном режиме`);
  const litTimers = [...SRC.matchAll(/setTimeout\([^)]*,\s*(\d+)\s*\)/g)].map((m) => Number(m[2])).filter((n) => n >= 10000);
  expect(litTimers.length === 0, `в коде жёсткая пауза ${litTimers.join(',')} мс`);
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

// Аудит CDP-запускателя: комментарии, строки справки и сами выражения для страницы не участвуют —
// проверяется только исполняемый код.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CDP_CODE = stripComments(CDP_SRC);
const CDP_BARE = CDP_CODE
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

test('11', 'CDP-запускатель: выключен по умолчанию, без автовыбора, навигации и текста страницы (этап 8)', async () => {
  // 11.1 явный выключатель
  expect(/CDP_ALLOW/.test(CDP_CODE), 'нет явного разрешения на запуск');
  expect(/process\.env\[ALLOW_ENV\]\s*!==\s*'1'/.test(CDP_CODE), 'проверка разрешения отсутствует');
  expect(/exitCode\s*=\s*2/.test(CDP_CODE), 'отказ не приводит к ненулевому коду возврата');

  // 11.2 нет автовыбора вкладки и автосоздания вкладок
  expect(/t\.id === targetId/.test(CDP_CODE), 'target не сопоставляется с переданным id');
  expect(!/\.find\(\s*\(t\)\s*=>\s*t\.type === 'page'/.test(CDP_CODE), 'есть автовыбор первой страницы');
  expect(!/Target\.createTarget|Target\.attach|Target\.activateTarget/.test(CDP_BARE), 'запускатель создаёт или переключает вкладки');
  expect(!/Page\.navigate|location\s*=\s*|location\.assign|location\.replace/.test(CDP_BARE), 'запускатель выполняет переходы');
  expect(!/Page\.enable|Page\.loadEventFired/.test(CDP_BARE), 'запускатель включает Page-домен и ждёт загрузки');

  // 11.3 нет извлечения содержимого страницы
  expect(!/bodySample|innerText|document\.title/.test(CDP_BARE), 'код читает текст или заголовок страницы');
  expect(!/document\.cookie|Network\.getCookies|Network\.setCookie/.test(CDP_BARE), 'запускатель трогает cookie');
  // в самой диагностике тоже только булевы признаки и счётчики
  const checkExpr = (CDP_SRC.match(/const CHECK_ONLY = `([\s\S]*?)`;/) || [])[1] ?? '';
  expect(checkExpr.length > 0, 'не найден блок диагностики');
  expect(!/innerText|document\.title|bodySample/.test(checkExpr), 'диагностика выводит текст страницы');
  for (const key of ['hasAuthToken', 'hasComposer', 'isSharePage', 'turnNodes']) {
    expect(checkExpr.includes(key), `диагностика не возвращает ${key}`);
  }

  // 11.4 адрес вкладки проверяется до выполнения кода
  expect(/u\.protocol !== 'https:'/.test(CDP_CODE), 'нет проверки https для адрес вкладки');
  expect(/u\.hostname !== API_HOST/.test(CDP_CODE), 'нет строгой проверки hostname вкладки');
  expect(/const API_HOST = 'chatgpt\.com'/.test(CDP_CODE), 'эталонный hostname не задан явно');
  expect(/share\|s/.test(CDP_CODE), 'share-вкладка не отвергается');

  // 11.5 сводка отчёта в консоли не печатает личных данных: только обозначения и счётчики
  expect(!/c\.id\b|c\.title|c\.name|convId/.test(CDP_CODE), 'в сводке печатаются реальные идентификаторы или названия');
  expect(/chatLabel/.test(CDP_CODE), 'в сводке нет локальных обозначений чатов');

  // 11.6 запускатель по умолчанию не трогает сеть: код обращения к порту идёт только после всех отказов
  const idxRefuse = CDP_CODE.indexOf("process.exitCode = 2");
  const idxFetch = CDP_CODE.indexOf("await http('/json/list')");
  expect(idxRefuse >= 0 && idxFetch > idxRefuse, 'обращение к порту возможно до проверки отказа');
});

test('13', 'учёт байтов из сети и общий лимит прогона (этап 11)', async () => {
  // 13.1 Загрузка, оборванная по лимиту, всё равно израсходовала общий лимит прогона.
  const st = {};
  let env = makeEnv({ routes: { bytes: () => bytesFixture({ body: bigBody(4000), contentLength: 0, chunkSize: 400 }, st) } });
  let rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL), PATCH.totalLimit(1500)]);
  let assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  const cut = assets.filter((a) => a.bytes.reason === 'stream_over_limit');
  const stopped = assets.filter((a) => a.bytes.reason === 'total_limit_before_start');
  expect(cut.length >= 1, `нет оборванной загрузки: ${assets.map((a) => a.bytes.reason).join(', ')}`);
  // Исчерпание общего бюджета видно либо по отказу скачивания, либо по обрезанному JSON-ответу:
  // с этапа 16 лимит сети ограничивает и ответы API, поэтому поздние беседы могут и не дойти до файлов.
  const jsonStopped = rep.chats.filter((c) => /limit/.test(String(c.fetch.jsonRead?.reason ?? '')));
  expect(stopped.length + jsonStopped.length >= 1, `общий лимит не остановил прогон: ${assets.map((a) => a.bytes.reason).join(', ')} / json: ${rep.chats.map((c) => c.fetch.jsonRead?.reason ?? 'нет').join(', ')}`);
  expect(rep.downloaded.bytesReadFromNetwork >= 1500, `получено из сети ${rep.downloaded.bytesReadFromNetwork} б, ожидалось не меньше лимита 1500`);
  expect(rep.downloaded.bytesReadFromNetwork > rep.downloaded.downloadedBytesTotal, 'общий лимит считается только по принятым байтам');
  expect(rep.downloaded.downloadedBytesTotal === 0, `принятые байты: ${rep.downloaded.downloadedBytesTotal}`);
  expect(dlCalls(env).length === cut.length, `запросов к CDN: ${dlCalls(env).length}, оборванных загрузок ${cut.length}: после исчерпания лимита запросов быть не должно`);
  expect(stopped.every((a) => a.bytes.countedInTotals !== true), 'остановка по лимиту помечена засчитанной');

  // 13.2 Отбраковка по content-length до чтения: по сети ничего не шло из файла, счётчик не растёт.
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: bigBody(5000), contentLength: 999 * 1024 }, {}) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const assets2 = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  expect(assets2.length > 0 && assets2.every((a) => (a.bytes.receivedBytes ?? 0) === 0), 'при отбраковке по content-length из сети пришли байты файла');
  expect(rep.downloaded.bytesReadFromNetwork === rep.downloaded.apiBytesRead, `счётчик сети ${rep.downloaded.bytesReadFromNetwork} не равен объёму API ${rep.downloaded.apiBytesRead}: засчитаны байты файлов`);

  // 13.3 В отчёте разведены «получено из сети» и «принято»: оба счётчика видны
  expect('bytesReadFromNetwork' in rep.downloaded && 'downloadedBytesTotal' in rep.downloaded, `в отчёте нет пары счётчиков: ${JSON.stringify(rep.downloaded)}`);
});

test('14', 'корректность sha256 при несовпадении content-length (этап 12)', async () => {
  const { createHash } = await import('node:crypto');
  const shaHex = (u8) => createHash('sha256').update(u8).digest('hex');
  const body = new Uint8Array(900).fill(65);

  // 14.1 Тело короче заявленного content-length: хэш по фактическим байтам, без нулевого хвоста
  let env = makeEnv({ routes: { bytes: () => bytesFixture({ body: body.buffer, contentLength: 1200, chunkSize: 100 }, {}) } });
  let rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  let ok = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes?.status === 'OK');
  expect(ok.length >= 1, `нет успешных загрузок: ${JSON.stringify(rep.chats.flatMap((c) => c.assets).map((a) => a.bytes))}`);
  const b = ok[0].bytes;
  expect(b.sizeBytes === 900, `размер: ${b.sizeBytes}`);
  expect(b.hashOverBytes === 900, `хэш посчитан по ${b.hashOverBytes} б, ожидалось 900`);
  expect(b.contentLengthMatchesActual === false, 'несоответствие content-length не зафиксировано');
  expect(b.sha256 === shaHex(body), `sha256 не соответствует фактическим байтам: ${b.sha256}`);
  expect(b.sha256 !== shaHex(new Uint8Array(1200).fill(65)), 'sha256 посчитан по предвыделенному буферу — старый дефект вернулся');
  expect(b.firstBytesHex === '41'.repeat(12), `первые байты: ${b.firstBytesHex}`);

  // 14.2 Тело длиннее заявленного content-length: тоже хэш по фактическим байтам
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: body.buffer, contentLength: 500, chunkSize: 100 }, {}) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  ok = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes?.status === 'OK');
  expect(ok.length >= 1, 'нет успешных загрузок при длинном теле');
  expect(ok[0].bytes.sha256 === shaHex(body), `sha256 при длинном теле: ${ok[0].bytes.sha256}`);
  expect(ok[0].bytes.sizeBytes === 900 && ok[0].bytes.hashOverBytes === 900, `байты: ${JSON.stringify(ok[0].bytes)}`);
});

test('15', 'тела ответов отменяются при раннем отказе (этап 13)', async () => {
  const sites = (SRC.match(/await discardBody\(/g) ?? []).length;
  expect(sites >= 5, `мест закрытия тел ответов в коде: ${sites}, ожидалось не меньше 5`);

  // 15.1 API отдал не-JSON: тело не читается целиком, а закрывается
  let cancels = 0;
  const htmlResp = (status, headers) => ({
    ok: status >= 200 && status < 300, status, url: '', type: 'basic',
    headers: mkHeaders({ 'content-type': 'text/html', 'content-length': '4000', ...headers }),
    json: async () => ({}), text: async () => '<html>секретный html</html>',
    body: { cancel: async () => { cancels += 1; } },
  });
  let env = makeEnv({ routes: { conversation: () => htmlResp(200) } });
  let rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  expect(cancels >= 1, 'тело не-JSON ответа API не закрыто');
  expect(JSON.stringify(rep).includes('text/html'), 'contentType ответа не зафиксирован в отчёте');

  // 15.2 Redirect подписной ссылки: тело 3xx закрывается до любого разбора
  cancels = 0;
  env = makeEnv({ routes: { bytes: () => ({ ok: false, status: 302, url: '', type: 'basic', headers: mkHeaders({ location: 'https://cdn2.test.invalid/x' }), body: { cancel: async () => { cancels += 1; } } }) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  let assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  expect(assets.some((a) => a.bytes.reason === 'redirect_not_followed'), `redirect не зафиксирован: ${JSON.stringify(assets[0]?.bytes)}`);
  expect(cancels >= assets.filter((a) => a.bytes.reason === 'redirect_not_followed').length, 'тело 3xx-ответа не закрыто');

  // 15.3 CDN отдал HTTP-ошибку: используется только статус, тело закрыто
  cancels = 0;
  env = makeEnv({ routes: { bytes: () => ({ ok: false, status: 404, url: '', type: 'basic', headers: mkHeaders({ 'content-type': 'text/html', 'content-length': '2000' }), body: { cancel: async () => { cancels += 1; } } }) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  assets = rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []).filter((a) => a.bytes);
  expect(assets.length > 0 && assets.every((a) => a.bytes.status === 'HTTP_ERROR' && a.bytes.httpStatus === 404), `статусы: ${assets.map((a) => a.bytes.status + '/' + a.bytes.httpStatus).join(', ')}`);
  expect(cancels >= 1, 'тело HTTP-ошибки не закрыто');

  // 15.4 Отбраковка по content-length: поток закрывается, не начав читаться
  const st = {};
  env = makeEnv({ routes: { bytes: () => bytesFixture({ body: bigBody(5000), contentLength: 999 * 1024 }, st) } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  expect(st.cancels >= 1, `поток не закрыт при отбраковке по content-length, cancels ${st.cancels ?? 0}`);
  expect(!st.reads, 'тело читалось после отбраковки по content-length');
});

test('16', 'нормализация путей: только литеральные сегменты из явного списка (этап 14)', async () => {
  expect(!/PLAIN_SEGMENT/.test(SRC), 'в коде осталось старое правило «буквы = смысловой сегмент»');
  const TOKEN_SEG = 'sigonlytoken';
  const env = makeEnv({ routes: { download: () => jsonResponse({ download_url: `https://cdn.test.invalid/${TOKEN_SEG}/qq/9f8e/dl/file_0000000000000000000000000000aa?sig=${SECRET_SIG}&exp=1790000000` }) } });
  const rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const dump = JSON.stringify(rep);
  expect(!dump.includes(TOKEN_SEG), `буквенный подписной сегмент утёк в отчёт: ${TOKEN_SEG}`);
  const dt = rep.chats.flatMap((c) => c.assets).find((a) => a.downloadTarget)?.downloadTarget;
  expect(dt, 'нет описания адреса загрузки');
  expect(dt.path === '/<id>/<id>/<id>/<id>/<id>', `путь загрузки: ${dt.path}`);
  expect(dt.pathSegments === 5, `число сегментов: ${dt.pathSegments}`);
  expect(rep.pagePathTemplate === '/c/<id>', `путь страницы: ${rep.pagePathTemplate}`);
  const apiPaths = Object.keys(rep.requests.byPath).filter((p) => p.includes('backend-api'));
  expect(apiPaths.length > 0 && apiPaths.every((p) => /^GET \/backend-api\/(conversation|files|conversations)/.test(p)), `маршруты API: ${apiPaths.join(' | ')}`);
  expect(Array.isArray(rep.pathWordsAllowlist) && rep.pathWordsAllowlist.includes('conversation'), 'список литеральных слов не выведен в отчёт');
});

test('17', 'CDP-запускатель: адрес в выводе без реальных идентификаторов (этап 15)', async () => {
  expect(/pathShape\(u\.pathname\)/.test(CDP_CODE), 'адрес вкладки печатается без нормализации пути');
  const m = CDP_SRC.match(/const PATH_WORDS = new Set\(\[[\s\S]*?\]\);[\s\S]*?const pathShape = \(pathname\) =>[\s\S]*?\.join\('\/'\);/);
  expect(m, 'нормализация пути в запускателе не извлекается для проверки');
  const shape = new Function(`${m[0]}; return pathShape;`)();
  const uuid = '6aaa1f50-0e78-83eb-8c01-9153effd07ea';
  expect(shape(`/c/${uuid}`) === '/c/<id>', `форма пути страницы: ${shape(`/c/${uuid}`)}`);
  expect(shape(`/share/${uuid}`) === '/share/<id>', `форма share-пути: ${shape(`/share/${uuid}`)}`);
  expect(shape('/oabqzsigntoken/qq/9f8e') === '/<id>/<id>/<id>', `форма подписного пути: ${shape('/oabqzsigntoken/qq/9f8e')}`);
  expect(!CHAT_UUID_RE.test(shape(`/c/${uuid}`)), 'в форме адреса остался реальный uuid');

  const checkRaw = (CDP_SRC.match(/const CHECK_ONLY = `([\s\S]*?)`;/) || [])[1] ?? '';
  expect(checkRaw, 'CHECK_ONLY не найден');
  expect(/pathTemplate/.test(checkRaw), 'в диагностике нет нормализованной формы пути');
  const checkExpr = checkRaw.replace(/\\\\/g, '\\'); // снятие экранирования шаблонной строки исходника
  const stubDoc = {
    getElementById: () => ({ textContent: JSON.stringify({ session: { accessToken: 'TOKEN_NOT_SHOWN' } }) }),
    querySelector: () => null,
    querySelectorAll: () => [1, 2, 3],
  };
  const diag = (pathname) =>
    new Function('document', 'location', `return (${checkExpr})`)(stubDoc, { protocol: 'https:', host: 'chatgpt.com', hostname: 'chatgpt.com', pathname });
  const d1 = diag(`/c/${uuid}`);
  expect(!CHAT_UUID_RE.test(JSON.stringify(d1)), `в выводе диагностики есть реальный идентификатор: ${JSON.stringify(d1)}`);
  expect(d1.pathTemplate === '/c/<id>', `pathTemplate: ${d1.pathTemplate}`);
  expect(d1.origin === 'https://chatgpt.com', `origin: ${d1.origin}`);
  expect(d1.hasAuthToken === true && d1.turnNodes === 3, `признаки: ${JSON.stringify(d1)}`);
  const d2 = diag(`/share/${uuid}`);
  expect(d2.isSharePage === true && d2.pathTemplate === '/share/<id>', `share: ${JSON.stringify(d2)}`);
  expect(!CHAT_UUID_RE.test(JSON.stringify(d2)), `в share-выводе есть реальный идентификатор: ${JSON.stringify(d2)}`);
});

test('18', 'размер JSON-ответа и таймауты ожидания ответа (этап 16)', async () => {
  // 18.1 JSON ответа крупнее предела: тело читается частично, JSON не парсится, прогон продолжается
  let env = makeEnv();
  let rep = await runProbe(env, [PATCH.jsonLimit(300)]);
  expect(rep.aborted !== true, 'прогон прервался из-за большого JSON');
  expect(rep.chats.length > 1, `чатов в отчёте: ${rep.chats.length}`);
  const fr = rep.chats[0].fetch;
  expect(fr.jsonRead && fr.jsonRead.status === 'SKIPPED_LIMIT', `чтение JSON не зафиксировано: ${JSON.stringify(fr.jsonRead)}`);
  expect(fr.jsonRead.limitBytes === 300, `предел в отчёте: ${fr.jsonRead.limitBytes}`);
  expect((rep.chats[0].assets ?? []).length === 0, 'неразобранный JSON дал вложения');
  expect(rep.chats.every((c) => (c.fetch.jsonRead?.receivedBytes ?? 0) <= 300), `предел 300 б превышен у отдельных ответов: ${rep.chats.map((c) => c.fetch.jsonRead?.receivedBytes).join(',')}`);
  expect(rep.downloaded.apiBytesRead <= 300 * rep.chats.length, `объём API-ответов ${rep.downloaded.apiBytesRead} не ограничен пределом на ответ`);
  expect(rep.chats.some((c) => c.fetch.jsonRead?.status === 'SKIPPED_LIMIT'), 'ни один ответ не отбракован по размеру');
  expect(!/ТЕКСТ_РЕПЛИКИ/.test(JSON.stringify(rep)), 'в отчёт попал текст из неразобранного JSON');

  // 18.2 Таймаут ожидания ответа классифицируется как NETWORK_ERROR с причиной, а не как молчаливый отказ
  const timeoutThrow = () => {
    const e = new Error('The operation was aborted due to timeout');
    e.seHeadTimeout = true;
    throw e;
  };
  env = makeEnv({ routes: { conversation: timeoutThrow } });
  rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  expect(rep.chats.length > 1, 'прогон не дошёл до остальных чатов');
  const f2 = rep.chats[0].fetch;
  expect(f2.status === null && f2.timeout === true, `таймаут не зафиксирован: ${JSON.stringify(f2)}`);
  expect(f2.reason === 'request_timeout', `причина таймаута: ${f2.reason}`);
  expect(f2.auth === 'NETWORK_ERROR', `классификация авторизации: ${f2.auth}`);
  expect(env.calls.length > 0 && env.calls.every((c) => c.hasSignal), 'запрос ушёл без AbortSignal');
  expect(rep.aborted === true || (rep.chats ?? []).every((c) => (c.assets ?? []).length === 0), 'после таймаута остались необъяснённые вложения');

  // 18.3 Статические гарантии: сырой r.json() не используется, пределы и таймауты заданы явно
  expect(!/await r\.json\(\)/.test(SRC), 'ответ по-прежнему читается через r.json() целиком');
  expect(/MAX_JSON_BYTES/.test(SRC), 'предел размера JSON не задан');
  expect(/new AbortController\(\)/.test(SRC), 'прерывание запроса не реализовано');
  expect(rep.flags.MAX_JSON_BYTES > 0 && rep.flags.API_HEAD_TIMEOUT_MS > 0 && rep.flags.DOWNLOAD_HEAD_TIMEOUT_MS > 0, `флаги лимитов: ${JSON.stringify(rep.flags)}`);
  expect(rep.abortControllerSupported === true, 'поддержка AbortController не зафиксирована в отчёте');
});

// ---------- собственные проверки инфраструктуры (этап 1 задачи A-2a) ----------
// Эти тесты проверяют саму тестовую среду, а не логику зонда: зонд в них участвует только
// как потребитель среды (виртуальные часы, отмена, потоки), чтобы инфраструктура не была
// проверена сама в себе.

test('I1', 'инфраструктура: виртуальные часы и наблюдаемое число таймеров', async () => {
  const clock = makeClock();
  const hits = [];
  const idA = clock.setTimeout(() => hits.push(['A', clock.now()]), 100);
  const idC = clock.setTimeout(() => hits.push(['C', clock.now()]), 50);
  const idB = clock.setTimeout(() => hits.push(['B', clock.now()]), 250);
  expect(clock.registered.join(',') === '100,50,250', `регистрации задержек: ${clock.registered.join(',')}`);
  expect(clock.live() === 3, `активных таймеров ${clock.live()}, ожидалось 3`);
  expect(hits.length === 0, 'таймер сработал до передвижения часов');
  clock.advanceBy(120);
  expect(hits.map((h) => h[0]).join('') === 'CA', `порядок срабатываний: ${hits.map((h) => h[0]).join('')}`);
  expect(hits.map((h) => h[1]).join(',') === '50,100', `моменты срабатываний: ${hits.map((h) => h[1]).join(',')}`);
  expect(clock.live() === 1, `активных таймеров после шага ${clock.live()}, ожидался 1`);
  expect(clock.clearTimeout(idA) === false, 'сработавший таймер считается снятым повторно');
  expect(clock.clearTimeout(idB) === true, 'ещё не сработавший таймер не снят');
  expect(clock.live() === 0, `активных таймеров после снятия ${clock.live()}, ожидалось 0`);
  clock.advanceBy(1000);
  expect(hits.length === 2, `лишние срабатывания после снятия: ${hits.map((h) => h[0]).join('')}`);
  expect(clock.now() === 1120, `виртуальное время ${clock.now()}, ожидалось 1120`);
  clock.advanceTo(500);
  expect(clock.now() === 1120, 'часы откатились назад');
  expect(clock.clearedCount() === 3, `снятых и сработавших ${clock.clearedCount()}, ожидалось 3`);

  // I1.2 Прогон зонда на виртуальных часах: длительные таймеры регистрируются и снимаются,
  // в конце прогона не осталось ни одного живого длительного таймера.
  const env = makeEnv({ routes: { bytes: () => bytesFixture({}, {}) } });
  await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  const apiTimeout = Number((SRC.match(/const API_HEAD_TIMEOUT_MS = (\d+)/) || [])[1]);
  const dlTimeout = Number((SRC.match(/const DOWNLOAD_HEAD_TIMEOUT_MS = (\d+)/) || [])[1]);
  expect(apiTimeout > 0 && dlTimeout > 0, 'в зонде не найдены значения таймаутов ожидания');
  expect(env.timers.includes(apiTimeout), `таймер ожидания ответа API не регистрировался виртуальными часами: ${env.timers.join(',')}`);
  expect(env.timers.includes(dlTimeout), `таймер ожидания ответа CDN не регистрировался виртуальными часами: ${env.timers.join(',')}`);
  expect(env.clock.liveTimers().every((t) => t.delay < 10000), `после прогона остались живые длительные таймеры: ${JSON.stringify(env.clock.liveTimers())}`);
  expect(env.clock.clearedCount() >= env.timers.filter((t) => t >= 10000).length, `снятых таймеров ${env.clock.clearedCount()}, зарегистрированных длительных ${env.timers.filter((t) => t >= 10000).length}`);
  expect(env.abort.hub.created >= 1, 'зонд не создавал контроллеров отмены через подставной AbortController');
  expect(env.abort.hub.aborts.length === 0, `в обычном прогоне были отмены: ${JSON.stringify(env.abort.hub.aborts.map((a) => a.reasonText))}`);
});

test('I2', 'инфраструктура: управляемый AbortController, счётчик отмен и зависающий fetch', async () => {
  // I2.1 Сам контроллер: счётчики, причина, однократность отмены, вызов слушателей
  const hub = makeAbortHub(() => 7);
  const ctrl = new hub.AbortController();
  let seen = 0;
  ctrl.signal.addEventListener('abort', () => { seen += 1; });
  expect(hub.hub.created === 1 && hub.hub.aborts.length === 0, `счётчики: создано ${hub.hub.created}, отмен ${hub.hub.aborts.length}`);
  expect(ctrl.signal.aborted === false, 'сигнал изначально снят');
  ctrl.abort('head_timeout');
  ctrl.abort('повторная отмена');
  expect(ctrl.signal.aborted === true, 'signal.aborted не установлен после abort()');
  expect(hub.hub.aborts.length === 1, `записей об отмене ${hub.hub.aborts.length}, ожидалась 1: повторный abort не удваивает счётчик`);
  expect(hub.hub.aborts[0].reasonText === 'head_timeout' && hub.hub.aborts[0].atMs === 7, `запись об отмене: ${JSON.stringify(hub.hub.aborts[0].reasonText)} @ ${hub.hub.aborts[0].atMs}`);
  expect(hub.hub.aborts[0].listeners === 1, `слушателей в записи: ${hub.hub.aborts[0].listeners}`);
  expect(seen === 1, `слушателей вызвано ${seen}, ожидался 1`);
  let thrown = null;
  try { ctrl.signal.throwIfAborted(); } catch (e) { thrown = e; }
  expect(thrown !== null, 'throwIfAborted не бросает ошибку на снятом сигнале');

  // I2.2 Зависающий fetch: сам не завершается, отклоняется по снятию сигнала, учтён в env.hangings
  const env = makeEnv({ routes: { conversation: () => ({ __hangUntilAbort: true }) } });
  const ctrl2 = new env.AbortController();
  const hanging = env.fetch('https://chatgpt.com/backend-api/conversation/conv_uuid_0', { signal: ctrl2.signal });
  let out = await settleWithin(hanging, env.clock, 5000, 1000);
  expect(out.state === 'pending', `зависающий fetch завершился сам: ${out.state}`);
  expect(env.hangings.length === 1 && env.hangings[0].aborted === false, `учёт зависаний: ${JSON.stringify(env.hangings)}`);
  const abortAt = env.clock.now();
  ctrl2.abort('тест снял запрос');
  out = await settleWithin(hanging, env.clock, 1000, 500);
  expect(out.state === 'rejected', `после отмены fetch не отклонился: ${out.state}`);
  expect(out.error && out.error.name === 'AbortError', `тип ошибки отмены: ${describeReason(out.error)}`);
  expect(env.hangings[0].aborted === true && env.hangings[0].resolvedAt === abortAt, `отмена зависающего ответа не учтена: ${JSON.stringify(env.hangings[0])}`);

  // I2.3 Виртуальные часы сами вызывают таймер зонда: зависший ответ получает request_timeout,
  // прогон при этом завершается за конечное виртуальное время.
  const env2 = makeEnv({ routes: { conversation: () => ({ __hangUntilAbort: true }), download: () => ({ __hangUntilAbort: true }), metadata: () => ({ __hangUntilAbort: true }) } });
  const res = await settleWithin(runProbe(env2, [PATCH.cdn(['cdn.test.invalid']), PATCH.chats, PATCH.extra]), env2.clock, 900000, 1000);
  expect(res.state === 'ok', `прогон с зависающими ответами не завершился за ${res.spentMs} мс виртуального времени`);
  const f = res.value.chats[0].fetch;
  expect(f.timeout === true && f.reason === 'request_timeout', `классификация зависшего ответа: ${JSON.stringify(f)}`);
  expect(env2.abort.hub.aborts.length >= 1, 'зонд не вызвал abort() по истечении таймера ожидания');
  expect(env2.abort.hub.aborts[0].reasonText === 'head_timeout', `причина отмены: ${env2.abort.hub.aborts[0].reasonText}`);
  expect(env2.clock.liveTimers().every((t) => t.delay < 10000), `после зависшего прогона остались живые длительные таймеры: ${JSON.stringify(env2.clock.liveTimers())}`);
  expect(env2.calls.length > 0 && env2.calls.every((c) => c.hasSignal), 'часть запросов ушла без AbortSignal');
  expect(env2.calls.some((c) => Number.isFinite(c.signalAbortedAt)), 'снятие сигнала не отмечено в журнале запросов');
});

test('I3', 'инфраструктура: зависающий и обрывающийся поток, задержка чанков', async () => {
  const clock = makeClock();
  const bytes = new Uint8Array(1000).fill(65);

  // I3.1 stallAfter: после N чанков read() висит, его отклоняет снятие сигнала
  const st1 = {};
  const hub = makeAbortHub(() => clock.now());
  const ctrl = new hub.AbortController();
  const s1 = makeStream(bytes, { chunkSize: 100, stallAfter: 2, clock, signal: ctrl.signal }, st1);
  const r1 = s1.getReader();
  for (let i = 0; i < 2; i++) {
    const x = await r1.read();
    expect(x.done === false, `чанк ${i} не отдан`);
  }
  const stalled = r1.read();
  expect(st1.stalledReads === 1, `зависших read(): ${st1.stalledReads ?? 0}, ожидалось 1`);
  let out = await settleWithin(stalled, clock, 5000, 1000);
  expect(out.state === 'pending', 'зависший read() завершился сам');
  ctrl.abort('idle_timeout');
  out = await settleWithin(stalled, clock, 1000, 500);
  expect(out.state === 'rejected' && out.error.name === 'AbortError', `зависший read() не отклонён по сигналу: ${describeReason(out.error)}`);
  expect(st1.delivered === 200, `отдано байт до зависания: ${st1.delivered}`);
  out = await settleWithin(r1.read(), clock, 1000, 500);
  expect(out.state === 'rejected', 'после снятия сигнала read() снова завис, а не отклонился');

  // I3.2 failAfter: read() отклоняется, обрыв виден в счётчиках
  const st2 = {};
  const s2 = makeStream(bytes, { chunkSize: 250, failAfter: 2, clock }, st2);
  const r2 = s2.getReader();
  await r2.read();
  await r2.read();
  let out2 = await settleWithin(r2.read(), clock, 1000, 500);
  expect(out2.state === 'rejected' && /fixture_stream_break/.test(describeReason(out2.error)), `обрыв потока: ${describeReason(out2.error)}`);
  expect(st2.reads === 2 && st2.delivered === 500 && st2.failReads === 1, `статистика обрыва: ${JSON.stringify(st2)}`);

  // I3.3 delayChunks: чанки идут по виртуальному времени и дождиваются передвижением часов
  const st3 = {};
  const s3 = makeStream(bytes, { chunkSize: 500, delayChunks: 700, clock }, st3);
  const r3 = s3.getReader();
  const slow = r3.read();
  let out3 = await settleWithin(slow, clock, 300, 100);
  expect(out3.state === 'pending', 'медленный чанк пришёл раньше виртуальной задержки');
  out3 = await settleWithin(slow, clock, 2000, 100);
  expect(out3.state === 'ok' && out3.value.value.byteLength === 500, `медленный чанк не пришёл: ${out3.state}`);
  expect(clock.registered.includes(700), 'задержка чанка не прошла через виртуальные часы');

  // I3.4 Обычный поток из байт ведёт себя как прежде: те же счётчики и полный ответ
  const st4 = {};
  const plain = streamBody(new Uint8Array(700).fill(66), st4, 200);
  const pr = plain.getReader();
  let reads = 0;
  for (;;) {
    const x = await pr.read();
    if (x.done) break;
    reads += 1;
    expect(reads < 10, 'обычный поток не завершается');
  }
  expect(st4.reads === 4 && st4.delivered === 700 && st4.doneReads === 1, `обычный поток: ${JSON.stringify(st4)}`);
  expect(reads === 4, `прочитано чанков ${reads}, ожидалось 4`);

  // I3.5 Отложенный чанк отменяется через cancel(): данные не выдаются, delivered не растёт,
  // таймер снимается с часов, чтение завершается как done.
  const st5 = {};
  const clock5 = makeClock();
  const s5 = makeStream(bytes, { chunkSize: 1000, delayChunks: 500, clock: clock5 }, st5);
  const r5 = s5.getReader();
  const planned = r5.read();
  expect(st5.delayedChunksScheduled === 1 && st5.delivered === undefined, `запланированный чанк учтён как выданный: ${JSON.stringify(st5)}`);
  let out5 = await settleWithin(planned, clock5, 300, 100);
  expect(out5.state === 'pending', 'отложенный чанк выдан раньше виртуальной задержки');
  s5.cancel('cancel_во_время_задержки');
  out5 = await settleWithin(planned, clock5, 5000, 1000);
  expect(out5.state === 'ok' && out5.value.done === true && out5.value.value === undefined, `cancel() не закрыл отложенный чанк: ${out5.state}`);
  expect(st5.delayedChunksDropped === 1 && st5.delayedChunksDelivered === undefined, `учёт отменённого чанка: ${JSON.stringify(st5)}`);
  expect(st5.droppedChunkBytes === 1000 && st5.droppedChunkWhy === 'cancel', `байты отменённого чанка: ${st5.droppedChunkBytes} (${st5.droppedChunkWhy})`);
  expect(st5.delivered === undefined, `delivered вырос после отмены: ${st5.delivered}`);
  expect(clock5.live() === 0, `после отмены на часах остался таймер чанка: ${JSON.stringify(clock5.liveTimers())}`);

  // I3.6 Снятие сигнала во время задержки: чанк не выдаётся, чтение отклоняется AbortError
  const st6 = {};
  const clock6 = makeClock();
  const hub6 = makeAbortHub(() => clock6.now());
  const ctrl6 = new hub6.AbortController();
  const s6 = makeStream(bytes, { chunkSize: 1000, delayChunks: 500, clock: clock6, signal: ctrl6.signal }, st6);
  const r6 = s6.getReader();
  const planned6 = r6.read();
  expect(st6.delivered === undefined, 'delivered вырос до фактической выдачи чанка');
  ctrl6.abort('body_idle_timeout');
  const out6 = await settleWithin(planned6, clock6, 5000, 1000);
  expect(out6.state === 'rejected' && out6.error.name === 'AbortError', `отложенный чанк не отклонён по сигналу: ${out6.state}`);
  expect(st6.delivered === undefined && st6.delayedChunksDropped === 1 && st6.readRejectsAbort === 1, `учёт чанка, отменённого по сигналу: ${JSON.stringify(st6)}`);
  expect(st6.droppedChunkBytes === 1000 && st6.droppedChunkWhy === 'signal_abort', `байты отменённого чанка: ${st6.droppedChunkBytes} (${st6.droppedChunkWhy})`);
  expect(clock6.live() === 0, `после отмены сигнала на часах остался таймер чанка: ${JSON.stringify(clock6.liveTimers())}`);
});

test('I4', 'инфраструктура: четыре режима cancel() и отсутствие необработанных отклонений', async () => {
  const clock = makeClock();
  const bytes = new Uint8Array(400).fill(67);

  // I4.1 Немедленное завершение
  const a = {};
  const sa = makeStream(bytes, { chunkSize: 100, clock }, a);
  let out = await settleWithin(sa.cancel('immediate'), clock, 1000, 500);
  expect(out.state === 'ok' && a.cancels === 1 && a.cancelSettled === 1, `немедленная отмена: ${JSON.stringify(a)}`);

  // I4.2 Задержка: cancel() не завершается, пока тест не передвинул часы
  const b = {};
  const sb = makeStream(bytes, { chunkSize: 100, clock, cancelMode: 'delayed', cancelDelayMs: 400 }, b);
  const delayed = sb.cancel('delayed_cancel');
  out = await settleWithin(delayed, clock, 200, 100);
  expect(out.state === 'pending', 'отложенная отмена завершилась раньше виртуальной задержки');
  out = await settleWithin(delayed, clock, 2000, 100);
  expect(out.state === 'ok' && b.cancelSettled === 1, `отложенная отмена не завершилась: ${JSON.stringify(b)}`);

  // I4.3 Отмена никогда не завершается: тест получает pending, а не вечное ожидание
  const c = {};
  const sc = makeStream(bytes, { chunkSize: 100, clock, cancelMode: 'never' }, c);
  const never = sc.cancel('never_cancel');
  out = await settleWithin(never, clock, 3000, 1000);
  expect(out.state === 'pending', 'cancel() в режиме never завершился');
  expect(c.cancelStarted === 1 && !c.cancelSettled, `учёт незавершаемой отмены: ${JSON.stringify(c)}`);
  void never;

  // I4.4 Синхронный выброс: cancel() бросает сразу, прогон не зависает
  const d = {};
  const sd = makeStream(bytes, { chunkSize: 100, clock, cancelMode: 'syncThrow' }, d);
  let threw = null;
  try { sd.cancel('sync_throw'); } catch (e) { threw = e; }
  expect(threw !== null && /fixture_cancel_sync_throw/.test(threw.message), `синхронный выброс cancel(): ${describeReason(threw)}`);
  expect(d.cancelThrows === 1, `счётчик выбросов cancel(): ${d.cancelThrows ?? 0}`);

  // I4.5 Обычный cancel() закрывает поток, а не отклоняет чтение: зависшее read() завершается
  // done без данных, последующие чтения тоже done без данных, AbortError не появляется.
  const e2 = {};
  const se = makeStream(bytes, { chunkSize: 100, clock, stallAfter: 0, cancelMode: 'never' }, e2);
  const re = se.getReader();
  const hangRead = re.read();
  const hangWatch = settleWithin(hangRead, clock, 10000, 1000);
  const cs = se.cancel('discardBody');
  out = await settleWithin(hangRead, clock, 2000, 1000);
  expect(out.state === 'ok' && out.value.done === true && out.value.value === undefined, `cancel() не завершил зависшее чтение как done: ${out.state}`);
  expect(e2.pendingReadsClosed === 1 && e2.readRejectsAbort === undefined, `семантика cancel() смешана с отменой сигнала: ${JSON.stringify(e2)}`);
  const watch = await hangWatch;
  expect(watch.state === 'ok', `наблюдатель зависшего read(): ${watch.state}`);

  // I4.6 Чтение после cancel() не отдаёт данных: отменённый поток не может «догнать» чанки
  const e3 = {};
  const sc2 = makeStream(bytes, { chunkSize: 100, clock }, e3);
  const re3 = sc2.getReader();
  const first = await re3.read();
  expect(first.done === false && first.value.byteLength === 100, `первое чтение: ${JSON.stringify(first.done)}`);
  sc2.cancel('over_limit');
  expect(e3.delivered === 100, `delivered после отмены: ${e3.delivered}`);
  let after = await re3.read();
  expect(after.done === true && after.value === undefined, `чтение после cancel() вернуло данные: ${after.done}`);
  after = await sc2.getReader().read();
  expect(after.done === true && after.value === undefined, 'второй читатель отменённого потока получил данные');
  expect(e3.delivered === 100 && e3.readsAfterCancel === 2, `учёт чтений после отмены: ${JSON.stringify(e3)}`);
  void cs;
  expect(rejectionList.length === 0, `после тестов отмены есть необработанные отклонения: ${rejectionList.map((r) => `${r.test}: ${r.text}`).join('; ')}`);
});

test('I5', 'инфраструктура: детектор необработанных отклонений ловит их и не даёт ложных срабатываний', async () => {
  expect(rejectionList.length === 0, `до проверки уже есть необработанные отклонения: ${rejectionList.map((r) => `${r.test}: ${r.text}`).join('; ')}`);
  const handled = Promise.reject(new Error('fixture_handled'));
  handled.catch(() => {});
  const window = openRejectionWindow();
  Promise.reject(abortErrorStable('fixture_unhandled_marker'));
  await nextMacrotasks(4);
  const caught = closeRejectionWindow();
  expect(caught.length === 1 && /fixture_unhandled_marker/.test(caught[0].text), `окно перехватило ${caught.length} записей: ${caught.map((r) => r.text).join('; ')}`);
  expect(caught[0].test === 'I5', `запись не привязана к тесту: ${caught[0].test}`);
  await nextMacrotasks(2);
  expect(rejectionList.length === 0, `вне окна перехвачено: ${rejectionList.map((r) => `${r.test}: ${r.text}`).join('; ')}`);
});

test('I6', 'инфраструктура: слушатели AbortSignal снимаются по завершении операции', async () => {
  // I6.1 Полный прогон зонда: слушатели навешивались, и к концу прогона не осталось ни одного
  const env = makeEnv({ routes: { bytes: () => bytesFixture({}, {}) } });
  await runProbe(env, [PATCH.cdn(['cdn.test.invalid'])]);
  expect(env.abort.hub.listenersAdded > 0, 'слушатели abort вообще не навешивались');
  expect(env.abort.hub.listenersRemoved === env.abort.hub.listenersAdded, `снято ${env.abort.hub.listenersRemoved} слушателей из ${env.abort.hub.listenersAdded}`);
  expect(env.abort.hub.liveListeners() === 0, `живых слушателей abort после прогона: ${env.abort.hub.liveListeners()}`);

  // I6.2 Зависающий запрос: во время зависания слушатель ровно один, после завершения снят
  const env2 = makeEnv({ routes: { conversation: () => ({ __hangUntilAbort: true }) } });
  const ctrl = new env2.AbortController();
  const hanging = env2.fetch('https://chatgpt.com/backend-api/conversation/conv_uuid_0', { signal: ctrl.signal });
  let out = await settleWithin(hanging, env2.clock, 2000, 1000);
  expect(out.state === 'pending', `зависающий запрос завершился сам: ${out.state}`);
  // во время зависания висят ровно два слушателя: учёт журнала запроса и ожидание отмены
  expect(env2.abort.hub.liveListeners() === 2, `во время зависания живых слушателей ${env2.abort.hub.liveListeners()}, ожидалось 2`);
  ctrl.abort('operator_stop');
  out = await settleWithin(hanging, env2.clock, 1000, 500);
  expect(out.state === 'rejected', `запрос не отклонён по отмене: ${out.state}`);
  expect(env2.abort.hub.liveListeners() === 0, `после завершения отменённого запроса живых слушателей ${env2.abort.hub.liveListeners()}`);

  // I6.3 Поток закрывается дочитыванием: слушатель снят
  const clock = makeClock();
  const bytes = new Uint8Array(300).fill(69);
  const ab = makeAbortHub(() => clock.now());
  const hub = ab.hub;
  const c1 = new ab.AbortController();
  const s1 = makeStream(bytes, { chunkSize: 300, clock, signal: c1.signal }, {});
  const r1 = s1.getReader();
  expect(hub.liveListeners() === 1, `слушателей потока ${hub.liveListeners()}, ожидался 1`);
  await r1.read();
  const end1 = await r1.read();
  expect(end1.done === true, 'поток не дочитан до конца');
  expect(hub.liveListeners() === 0, `слушатель не снят после дочитывания потока: ${hub.liveListeners()}`);

  // I6.4 cancel() потока снимает слушатель (путь discardBody и отбраковки по лимиту)
  const st4 = {};
  const c4 = new ab.AbortController();
  const s4 = makeStream(bytes, { chunkSize: 100, clock, signal: c4.signal }, st4);
  s4.getReader();
  s4.cancel('discard_body');
  expect(st4.signalListenersDetached === 1 && hub.liveListeners() === 0, `cancel() не снял слушатель: ${JSON.stringify(st4)}, живых ${hub.liveListeners()}`);

  // I6.5 Отмена сигнала при зависшем чтении: слушатель снят, чтение отклонено
  const st5 = {};
  const c5 = new ab.AbortController();
  const s5 = makeStream(bytes, { chunkSize: 100, clock, signal: c5.signal, stallAfter: 1 }, st5);
  const r5 = s5.getReader();
  await r5.read();
  const stalled = r5.read();
  expect(hub.liveListeners() === 1, `до отмены живых слушателей ${hub.liveListeners()}`);
  c5.abort('body_idle_timeout');
  const out5 = await settleWithin(stalled, clock, 1000, 500);
  expect(out5.state === 'rejected' && out5.error.name === 'AbortError', `зависшее чтение не отклонено: ${out5.state}`);
  expect(st5.signalListenersDetached === 1 && hub.liveListeners() === 0, `отмена сигнала не сняла слушатель: ${JSON.stringify(st5)}, живых ${hub.liveListeners()}`);
});

test('I7', 'инфраструктура: closed отражает закрытие потока, а не завершение промиса отмены', async () => {
  const clock = makeClock();
  const bytes = new Uint8Array(400).fill(70);

  // I7.1 cancelMode never: поток закрыт сразу, промис cancel() не завершается никогда
  const a = {};
  const sa = makeStream(bytes, { chunkSize: 100, clock, cancelMode: 'never' }, a);
  const cancelPromise = sa.cancel('never_cancel');
  let out = await settleWithin(sa.closed, clock, 3000, 1000);
  expect(out.state === 'ok', `closed не закрылся при инициированной отмене: ${out.state}`);
  expect(a.closedState === 'cancelled' && a.closedResolved === 1, `состояние закрытия: ${JSON.stringify(a)}`);
  out = await settleWithin(cancelPromise, clock, 5000, 1000);
  expect(out.state === 'pending', 'промис cancel() в режиме never завершился');
  void cancelPromise;

  // I7.2 cancelMode delayed: closed не ждёт завершения underlying cancel()
  const b = {};
  const sb = makeStream(bytes, { chunkSize: 100, clock, cancelMode: 'delayed', cancelDelayMs: 400 }, b);
  const cb = sb.getReader().cancel('delayed_cancel');
  out = await settleWithin(sb.closed, clock, 200, 100);
  expect(out.state === 'ok' && b.cancelSettled === undefined, `closed дождался underlying cancel(): ${JSON.stringify(b)}`);
  out = await settleWithin(cb, clock, 2000, 100);
  expect(out.state === 'ok' && b.cancelSettled === 1, `отложенная отмена не завершилась: ${JSON.stringify(b)}`);

  // I7.3 Обычное чтение до конца: closed закрывается только после done
  const c = {};
  const sc = makeStream(bytes, { chunkSize: 400, clock }, c);
  const rc = sc.getReader();
  await rc.read();
  out = await settleWithin(rc.closed, clock, 200, 100);
  expect(out.state === 'pending', 'closed закрылся раньше конца потока');
  const last = await rc.read();
  expect(last.done === true, 'поток не завершился');
  out = await settleWithin(rc.closed, clock, 200, 100);
  expect(out.state === 'ok' && c.closedState === 'closed', `closed после полного чтения: ${JSON.stringify(c)}`);

  // I7.4 syncThrow: поток закрыт с ошибкой, необработанного отклонения не возникает
  const d = {};
  const sd = makeStream(bytes, { chunkSize: 100, clock, cancelMode: 'syncThrow' }, d);
  const rd = sd.getReader();
  let threw = null;
  try { rd.cancel('sync_throw'); } catch (e) { threw = e; }
  expect(threw !== null && /fixture_cancel_sync_throw/.test(threw.message), `синхронный выброс cancel(): ${describeReason(threw)}`);
  out = await settleWithin(sd.closed, clock, 1000, 500);
  expect(out.state === 'rejected', `closed при выбросе cancel() не отклонён: ${out.state}`);
  expect(d.closedState === 'errored' && d.cancelThrows === 1, `состояние закрытия: ${JSON.stringify(d)}`);
  await nextMacrotasks(2);
  expect(rejectionList.length === 0, `отклонение closed породило необработанное отклонение: ${rejectionList.map((r) => `${r.test}: ${r.text}`).join('; ')}`);
});

// ---------- запуск ----------
const want = process.argv.slice(2);
for (const t of tests.sort((a, b) => a.id.localeCompare(b.id))) {
  if (want.length && !want.includes(t.id)) continue;
  currentTestId = t.id;
  try {
    await t.fn();
    await drainMicrotasks(50);
    console.log(`${t.id} PASS  ${t.name}`);
    results.push({ id: t.id, kind: t.kind, ok: true });
  } catch (e) {
    console.log(`${t.id} FAIL  ${t.name}\n      ${e.message}`);
    results.push({ id: t.id, kind: t.kind, ok: false, msg: e.message });
  }
}
currentTestId = null;
await drainMicrotasks(30);
await nextMacrotasks(2);
const bad = results.filter((r) => !r.ok);
const core = results.filter((r) => r.kind !== 'infra');
const infra = results.filter((r) => r.kind === 'infra');
const leaked = unhandledRejections.filter((r) => !/fixture_unhandled_marker/.test(r.text));
if (leaked.length) {
  console.log(`\nнеобработанные отклонения промисов (${leaked.length}):`);
  for (const r of leaked) console.log(`      ${r.test}: ${r.text}\n        ${r.stack}`);
}
console.log(`\nитого: ${results.length} тестов (основных ${core.length}, инфраструктурных ${infra.length}), провалено ${bad.length}, необработанных отклонений ${leaked.length}`);
process.exitCode = bad.length || leaked.length ? 1 : 0;

