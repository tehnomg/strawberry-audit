/**
 * Приёмочный аудит корректирующего этапа A-2 (пункты 4–9 задания на приёмку).
 * Измерительный скрипт: код зонда и CDP-запускателя НЕ меняет, только наблюдает.
 * Стабы локальные: реальной сети, ChatGPT и профиля браузера нет.
 * Запуск: node probe_a2_acceptance_audit.mjs
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  SRC, CDP_SRC, makeEnv, runProbe, PATCH, scanLeaks, jsonResponse, mkHeaders,
  SECRET_SIG, SECRET_TOKEN, CHAT_UUID_RE, ASSET_ID_RE, results,
} from './probe_a2_tests.mjs';

const realSetTimeout = globalThis.setTimeout;
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
const shaHex = (u8) => createHash('sha256').update(u8).digest('hex');
const FL = 2000; // лимит на файл в фикстурах (как в основных тестах)
const UUID = '6aaa1f50-0e78-83eb-8c01-9153effd07ea';

const findings = [];
let fails = 0;
const say = (s) => console.log(s);
const check = (ok, claim, detail) => {
  say(`   ${ok ? 'OK      дефекта нет: ' : 'НАЙДЕНО  '} ${claim}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails += 1;
};
const note = (what, detail) => say(`   ЗАМЕТКА   ${what}${detail ? ` — ${detail}` : ''}`);

// ---------- потоки с режимами: обычный / зависание после первого чанка / обрыв / задержка ----------
const mkStream = (bytes, { mode = 'normal', chunkSize = 256, delayMs = 0, failAfter = 0 } = {}, watch = []) => {
  const total = bytes.byteLength;
  const st = { mode, state: 'open', reads: 0, delivered: 0, cancels: 0, cancelReason: null };
  if (watch) watch.push(st);
  const cancel = async (reason) => { st.cancels += 1; st.cancelReason = reason; st.state = 'cancelled'; };
  return {
    getReader() {
      let pos = 0;
      return {
        async read() {
          if (st.state === 'cancelled') throw new Error('stream cancelled');
          if (pos >= total) { st.state = 'finished'; return { done: true, value: undefined }; }
          st.reads += 1;
          if (mode === 'stall_after_first' && pos > 0) return new Promise(() => {}); // обещание никогда не исполняется
          if (failAfter && st.reads > failAfter) throw new Error('network failure mid-body');
          if (delayMs) await sleep(delayMs);
          if (st.state === 'cancelled') throw new Error('stream cancelled');
          const end = Math.min(pos + chunkSize, total);
          const value = bytes.slice(pos, end);
          pos = end;
          st.delivered += value.byteLength;
          return { done: false, value };
        },
        cancel,
        closed: Promise.resolve(),
      };
    },
    cancel,
  };
};

// Зависание до заголовков: fetch не завершается, но реагирует на AbortSignal (как браузер).
const hangUntilAbort = (signal) =>
  new Promise((_res, rej) => {
    const onAbort = () => rej(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
  });

const convJson = (id) => {
  const tag = (/(\d+)$/.exec(id) || [])[1] ?? '0'; // свой id ассета у каждой беседы, чтобы записи не схлопывались
  return {
    id, title: 'ПриёмочнаяФикстура', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
    mapping: {
      n1: { message: {
        id: 'n1', parent_id: null, author: { role: 'user' }, children: [],
        content: { kind: 'message', parts: [{ content_type: 'text', text: 'ТЕКСТ_РЕПЛИКИ' }] },
        metadata: { attachments: [{ id: `file_0000000000000000000000000000${tag}aa`, name: 'Приёмка.pdf', mime_type: 'application/pdf', size: 900 }] },
      } },
    },
    completion_codes: {},
  };
};

const TIMEOUT_PATCHES = [
  ['const API_HEAD_TIMEOUT_MS = 30000;', 'const API_HEAD_TIMEOUT_MS = 250;'],
  ['const DOWNLOAD_HEAD_TIMEOUT_MS = 120000;', 'const DOWNLOAD_HEAD_TIMEOUT_MS = 250;'],
];

// Окружение с НАСТОЯЩИМИ таймерами (в основном тестовом стабе таймер вызывается сразу).
function auditEnv({ routes = {}, stream = { size: 900 } } = {}) {
  const env = makeEnv({});
  env.routes = routes;
  env.stream = stream;
  env.watch = [];
  env.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    env.calls.push({ url: String(url), host: u.host, path: u.pathname, method: opts.method ?? 'GET', hasSignal: Boolean(opts.signal) });
    const r = env.routes;
    if (u.host !== 'chatgpt.com') {
      if (r.bytes === 'hang') return hangUntilAbort(opts.signal);
      if (typeof r.bytes === 'function') return r.bytes(u, env);
      const bytes = new Uint8Array(env.stream.size ?? 900).fill(65);
      const headers = { 'content-type': 'application/octet-stream' };
      if (env.stream.contentLength !== null) headers['content-length'] = String(env.stream.contentLength ?? bytes.byteLength);
      return {
        ok: true, status: 200, type: 'basic', url: '',
        headers: mkHeaders(headers),
        body: mkStream(bytes, env.stream, env.watch),
      };
    }
    if (u.pathname.startsWith('/backend-api/conversation/')) {
      if (r.conversation === 'hang') return hangUntilAbort(opts.signal);
      if (typeof r.conversation === 'function') return r.conversation(u, env);
      return jsonResponse(convJson(u.pathname.split('/').pop()));
    }
    if (u.pathname.startsWith('/backend-api/files/download/')) {
      if (typeof r.download === 'function') return r.download(u, env);
      return jsonResponse({ download_url: `https://cdn.test.invalid/dl/${u.pathname.split('/').pop()}?sig=${SECRET_SIG}&exp=1790000000` });
    }
    if (u.pathname.startsWith('/backend-api/files/')) return jsonResponse({ ok: true });
    if (u.pathname === '/backend-api/files') return jsonResponse([]);
    if (u.pathname.startsWith('/backend-api/conversations/')) return jsonResponse({ files: [] });
    return jsonResponse({});
  };
  env.setTimeout = (cb, ms) => realSetTimeout(cb, ms);
  return env;
}

const allAssets = (rep) => rep.chats.flatMap((c) => c.assets).concat(rep.extraAssets ?? []);
const timedRun = async (env, patches) => {
  const t0 = Date.now();
  const rep = await runProbe(env, [PATCH.chats, PATCH.extra, ...patches]);
  return { ms: Date.now() - t0, rep };
};
const race = async (p, ms) => {
  let t;
  return Promise.race([p.then((v) => ({ done: true, v })), new Promise((r) => { t = realSetTimeout(() => r({ done: false }), ms); })])
    .finally(() => globalThis.clearTimeout(t));
};

// ================= A. Таймауты =================
say('\n=== A. Таймауты и гарантированность завершения (пункт 4) ===');

// A1 зависание до заголовков: API
{
  const env = auditEnv({ routes: { conversation: 'hang' } });
  const { ms, rep } = await timedRun(env, TIMEOUT_PATCHES);
  const f = rep.chats[0].fetch;
  say(`A1 API: ответ не начинается. прогон завершился за ${ms} мс; reason=${f.reason}, timeout=${f.timeout}, auth=${f.auth}`);
  check(ms >= 250 && ms < 1500, 'A1 ожидание заголовков API прервано таймером', `прошло ${ms} мс при таймауте 250 мс`);
  check(f.reason === 'request_timeout' && f.timeout === true, 'A1 отказ классифицирован как request_timeout', JSON.stringify(f));
  check(f.auth === 'NETWORK_ERROR', 'A1 не ушёл в AUTH_REQUIRED', `auth=${f.auth}`);
  check((rep.chats[0].assets ?? []).length === 0, 'A1 после отказа беседы вложений нет');
  check(env.calls.every((c) => c.hasSignal), 'A1 запрос ушёл без AbortSignal — прервать было нельзя');
}

// A2 зависание до заголовков: CDN
{
  const env = auditEnv({ routes: { bytes: 'hang' } });
  const { ms, rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), ...TIMEOUT_PATCHES]);
  const assets = allAssets(rep).filter((a) => a.bytes);
  say(`A2 CDN: заголовки не приходят. прогон завершился за ${ms} мс; статусы: ${assets.map((a) => `${a.bytes.status}/${a.bytes.reason}`).join(', ')}`);
  check(ms >= 250 && ms < 2000, 'A2 ожидание заголовков загрузки прервано таймером', `прошло ${ms} мс при таймауте 250 мс`);
  check(assets.length > 0 && assets.every((a) => a.bytes.reason === 'download_timeout'), 'A2 отказ классифицирован как download_timeout');
  check(rep.downloaded.bytesReadFromNetwork === rep.downloaded.apiBytesRead, 'A2 в бюджет попали байты тела', `сеть ${rep.downloaded.bytesReadFromNetwork}, API ${rep.downloaded.apiBytesRead}`);
}

// A3 зависание ПОСЛЕ получения заголовков: сервер отдал заголовки и замолчал в теле
{
  const env = auditEnv({ routes: {}, stream: { size: 5000, chunkSize: 500, mode: 'stall_after_first' } });
  const res = await race(runProbe(env, [PATCH.chats, PATCH.extra, PATCH.cdn(['cdn.test.invalid']), ...TIMEOUT_PATCHES]), 1500);
  if (!res.done) {
    say(`A3 CDN: заголовки есть, тело молчит. прогон НЕ завершился за 1500 мс; состояния потоков: ${env.watch.map((s) => s.state).join(', ')}`);
    findings.push('F-2. Зависание после получения заголовков: таймер действует только на ожидание заголовков и снимается сразу после них, ' +
      'чтение тела ограничено лимитом байт, но не простоем. Если сервер перестал отдавать байты, прогон висит неограниченно. ' +
      'Воспроизведение: node probe_a2_acceptance_audit.mjs, сценарий A3 (поток отдаёт один чанк и зависает).');
    check(false, 'A3 завершение операции при зависшем теле гарантировано таймером', 'свободного таймаута на чтение нет — прогон завис');
  } else {
    say(`A3 CDN: заголовки есть, тело молчит. прогон завершился: ${JSON.stringify(allAssets(res.rep).map((a) => a.bytes?.reason))}`);
    check(true, 'A3 завершение операции при зависшем теле гарантировано');
  }
}

// A4 медленное поступление тела
{
  const env = auditEnv({ routes: {}, stream: { size: 1200, chunkSize: 100, delayMs: 30 } });
  const { ms, rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), ...TIMEOUT_PATCHES, PATCH.fileLimit(FL)]);
  const ok = allAssets(rep).filter((a) => a.bytes?.status === 'OK');
  say(`A4 CDN: 12 чанков по 100 б с задержкой 30 мс. прогон завершился за ${ms} мс; успешных загрузок ${ok.length}, размер ${ok[0]?.bytes.sizeBytes} б, sha256 ${ok[0]?.bytes.sha256?.slice(0, 12)}…`);
  check(ms >= 360, 'A4 медленное тело не оборвано таймаутом (он снимается после заголовков)', `прошло ${ms} мс`);
  check(ok.length > 0 && ok.every((a) => a.bytes.sizeBytes === 1200), 'A4 тело принято целиком', `размеры: ${ok.map((a) => a.bytes.sizeBytes).join(',')}`);
  check(env.watch.every((s) => s.state !== 'open'), 'A4 остались незакрытые потоки', env.watch.map((s) => s.state).join(','));
}

// A5 сетевой отказ посередине чтения
{
  const env = auditEnv({ routes: {}, stream: { size: 2000, chunkSize: 400, failAfter: 2 } });
  const { ms, rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), ...TIMEOUT_PATCHES, PATCH.fileLimit(FL)]);
  const assets = allAssets(rep).filter((a) => a.bytes);
  say(`A5 CDN: обрыв потока после 2 чанков. прогон завершился за ${ms} мс; статусы: ${assets.map((a) => `${a.bytes.status}/${a.bytes.reason}/принято ${a.bytes.receivedBytes ?? 0}`).join(', ')}`);
  check(assets.length > 0 && assets.every((a) => a.bytes.status === 'NETWORK_ERROR' && a.bytes.reason === 'stream_read_failed'), 'A5 обрыв не зафиксирован как stream_read_failed');
  check(rep.downloaded.bytesReadFromNetwork >= 800, 'A5 частично полученные байты не учтены в бюджете', `сеть ${rep.downloaded.bytesReadFromNetwork}`);
  check(env.watch.every((s) => s.cancels >= 1), 'A5 поток не закрыт после обрыва', env.watch.map((s) => `cancels=${s.cancels}`).join(','));
  check(rep.downloaded.downloadedBytesTotal === 0, 'A5 оборванная загрузка попала в принятые байты');
}

// A6 сетевой отказ посередине чтения JSON-ответа API
{
  const env = auditEnv({ routes: { conversation: (u) => {
    const bytes = new TextEncoder().encode(JSON.stringify(convJson(u.pathname.split('/').pop())));
    return { ok: true, status: 200, type: 'basic', url: '', headers: mkHeaders({ 'content-type': 'application/json', 'content-length': String(bytes.byteLength) }), body: mkStream(bytes, { chunkSize: 64, failAfter: 1 }, env.watch) };
  } } });
  const { ms, rep } = await timedRun(env, TIMEOUT_PATCHES);
  const jr = rep.chats[0].fetch.jsonRead;
  say(`A6 API: поток JSON оборван после 1 чанка. прогон завершился за ${ms} мс; jsonRead=${JSON.stringify(jr)}`);
  check(jr && jr.status === 'NETWORK_ERROR' && jr.reason === 'stream_read_failed', 'A6 обрыв чтения JSON не зафиксирован');
  check((rep.chats[0].assets ?? []).length === 0, 'A6 неразобранный JSON дал вложения');
  check(rep.chats.length >= 2, 'A6 прогон оборвался на первом чате', `чатов ${rep.chats.length}`);
  check(env.watch.every((s) => s.state !== 'open'), 'A6 после обрыва поток JSON остался открыт', env.watch.map((s) => s.state).join(','));
  check(rep.aborted !== true && rep.context?.status === 'OK', 'A6 прогон не завершился корректно');
}

// A7 зависание тела JSON-ответа API (после заголовков)
{
  const env = auditEnv({ routes: { conversation: (u) => {
    const bytes = new TextEncoder().encode(JSON.stringify(convJson(u.pathname.split('/').pop())));
    return { ok: true, status: 200, type: 'basic', url: '', headers: mkHeaders({ 'content-type': 'application/json', 'content-length': String(bytes.byteLength) }), body: mkStream(bytes, { chunkSize: 64, mode: 'stall_after_first' }, env.watch) };
  } } });
  const res = await race(runProbe(env, [PATCH.chats, PATCH.extra, ...TIMEOUT_PATCHES]), 1500);
  say(`A7 API: заголовки есть, тело JSON молчит. прогон ${res.done ? 'завершился' : 'НЕ завершился'} за 1500 мс`);
  if (!res.done) {
    findings.push('F-2b. То же зависание после заголовков воспроизводится на JSON-ответах API (сценарий A7): прогон висит, ' +
      'таймер ожидания заголовков к этому моменту уже снят.');
    check(false, 'A7 завершение прогона при зависшем теле JSON гарантировано таймером');
  } else {
    check(true, 'A7 завершение прогона при зависшем теле JSON гарантировано');
  }
}

// ================= B. Общий бюджет сети =================
say('\n=== B. Общий бюджет сети: API JSON и загрузки (пункт 5) ===');

// B1 совместный учёт и раздельный вывод счётчиков
{
  const env = auditEnv({ routes: {}, stream: { size: 900 } });
  const { rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const d = rep.downloaded;
  say(`B1 счётчики: сеть ${d.bytesReadFromNetwork} б, из них JSON ${d.apiBytesRead} б, принято файлов ${d.downloadedBytesTotal} б`);
  check(d.bytesReadFromNetwork >= d.apiBytesRead + d.downloadedBytesTotal, 'B1 байты JSON и загрузок не считаются совместно');
  check(typeof d.apiBytesRead === 'number' && typeof d.bytesReadFromNetwork === 'number' && typeof d.downloadedBytesTotal === 'number', 'B1 счётчики не выведены в отчёт');
}

// B2 частично прочитанные тела расходуют бюджет; превышение — не больше одного чанка
{
  let env = auditEnv({ routes: {}, stream: { size: 5000, chunkSize: 400, contentLength: null } });
  const base = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(1000)]);
  const apiBytes = base.rep.downloaded.apiBytesRead;
  const totalLimit = apiBytes + 1300;
  env = auditEnv({ routes: {}, stream: { size: 5000, chunkSize: 400, contentLength: null } });
  const { rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(1000), PATCH.totalLimit(totalLimit)]);
  const d = rep.downloaded;
  const dl = env.calls.filter((c) => c.host !== 'chatgpt.com');
  const assets = allAssets(rep).filter((a) => a.bytes);
  say(`B2 лимит файла 1000 б, общий лимит ${totalLimit} б (JSON ${apiBytes} б), чанок 400 б: сеть ${d.bytesReadFromNetwork} б, принято ${d.downloadedBytesTotal} б; причины: ${assets.map((a) => a.bytes.reason).join(', ')}`);
  check(assets.some((a) => a.bytes.reason === 'stream_over_limit'), 'B2 оборванная по лимиту загрузка не зафиксирована');
  check(d.bytesReadFromNetwork > d.downloadedBytesTotal, 'B2 частично полученные байты не расходовали бюджет');
  check(d.bytesReadFromNetwork <= totalLimit + 400, 'B2 превышение общего лимита больше одного чанка', `сеть ${d.bytesReadFromNetwork}, лимит ${totalLimit}, чанок 400`);
  check(d.downloadedBytesTotal <= totalLimit, 'B2 принятые байты превысили общий лимит');
  const skippedEndpoints = allAssets(rep).filter((a) => a.filesDownloadEndpoint?.status === 'SKIPPED_LIMIT');
  say(`B2 отказов по бюджету на уровне ассета: ${assets.filter((a) => a.bytes.reason === 'total_limit_before_start').length}, на уровне вызова files/download: ${skippedEndpoints.length}`);
  note('B2 в этой фикстуре общий бюджет кончился ровно после последней подписной ссылки: отказ до обращения здесь не нужен; ' +
    'он показан в сценарии B5 (обнулённый бюджет) и в тесте 13 основного набора',
    `причины по ассетам: ${assets.map((a) => a.bytes.reason).join(', ') || 'нет'}`);
  check(dl.length === allAssets(rep).filter((a) => a.signedUrlPresent).length, 'B2 число запросов к CDN не равно числу полученных подписных ссылок', `запросов ${dl.length}, подписных ссылок ${allAssets(rep).filter((a) => a.signedUrlPresent).length}`);
  check(assets.filter((a) => a.bytes.reason === 'total_limit_before_start').every((a) => (a.bytes.receivedBytes ?? 0) === 0), 'B2 отбраковка до чтения получила байты');
}

// B3 остаток бюджета меньше заявленного content-length: запрос к CDN всё равно уходит, тело отбрасывается
{
  let env = auditEnv({ routes: {}, stream: { size: 900, contentLength: 900 } });
  const base = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const limit = base.rep.downloaded.apiBytesRead + 1000;
  env = auditEnv({ routes: {}, stream: { size: 900, contentLength: 900 } });
  const { rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL), PATCH.totalLimit(limit)]);
  const d = rep.downloaded;
  const dl = env.calls.filter((c) => c.host !== 'chatgpt.com');
  const api = env.calls.filter((c) => c.host === 'chatgpt.com');
  const byReason = {};
  for (const a of allAssets(rep).filter((x) => x.bytes)) byReason[a.bytes.reason ?? a.bytes.status] = (byReason[a.bytes.reason ?? a.bytes.status] ?? 0) + 1;
  say(`B3 потолок ${limit} б: сеть ${d.bytesReadFromNetwork} б, принято файлов ${d.downloadedBytesTotal} б, запросов к CDN ${dl.length}, запросов к API ${api.length}; причины: ${JSON.stringify(byReason)}`);
  check(d.bytesReadFromNetwork <= limit, 'B3 фактический объём сети превысил потолок', `сеть ${d.bytesReadFromNetwork}, потолок ${limit}`);
  check(d.downloadedBytesTotal <= limit, 'B3 принятые байты загрузок превысили потолок');
  const apiBytes = rep.chats.reduce((s, c) => s + (c.fetch.jsonRead?.receivedBytes ?? 0), 0);
  const apiCut = rep.chats.filter((c) => /limit/.test(String(c.fetch.jsonRead?.reason ?? '')));
  say(`B3 JSON: принято ${apiBytes} б; ответов отброшено/обрезано по бюджету ${apiCut.length} из ${rep.chats.length}`);
  check(apiBytes <= limit, 'B3 объём JSON превысил потолок');
  if (apiCut.length > 0 || (byReason.content_length_over_limit ?? 0) > 0) {
    note('B3 бюджет соблюдается по байтам; лишние обращения после исчерпания бюджета остаются',
      `запросов к API ${api.length}, ответов с отброшенным телом ${apiCut.length}, отбраковок по content-length ${byReason.content_length_over_limit ?? 0}`);
  }
}

// B5 бюджет обнулён полностью: запросы к API всё равно отсылаются, но их тела не читаются
{
  const env = auditEnv({ routes: {}, stream: { size: 900, contentLength: 900 } });
  const { rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL), PATCH.totalLimit(600)]);
  const d = rep.downloaded;
  const api = env.calls.filter((c) => c.host === 'chatgpt.com');
  const dl = env.calls.filter((c) => c.host !== 'chatgpt.com');
  const cut = rep.chats.filter((c) => /limit/.test(String(c.fetch.jsonRead?.reason ?? '')));
  const zeroRead = rep.chats.filter((c) => (c.fetch.jsonRead?.receivedBytes ?? 0) === 0 && c.fetch.jsonRead);
  say(`B5 потолок 600 б: запросов к API ${api.length}, запросов к CDN ${dl.length}, сеть ${d.bytesReadFromNetwork} б; JSON обрезано по бюджету ${cut.length} из ${rep.chats.length}, из них прочитано 0 б: ${zeroRead.length}`);
  check(d.bytesReadFromNetwork <= 600 + 64, 'B5 объём сети превысил потолок больше чем на один чанок', `сеть ${d.bytesReadFromNetwork}`);
  check(cut.length > 0, 'B5 при обнулённом бюджете JSON-ответы не помечены обрезанными');
  const signedLinks = allAssets(rep).filter((a) => a.signedUrlPresent).length;
  check(dl.length === signedLinks, 'B5 запросы к CDN всё равно ушли без подписной ссылки', `запросов к CDN ${dl.length}, подписных ссылок ${signedLinks}`);
  const noReason = allAssets(rep).filter((a) => a.filesDownloadEndpoint?.status === 'SKIPPED_LIMIT' && a.filesDownloadEndpoint.reason === undefined);
  if (noReason.length) note('B5 причина отброски точечного JSON-ответа в отчёте не подписана: у вызова files/download есть только status SKIPPED_LIMIT без reason (причина видна лишь на уровне беседы в fetch.jsonRead.reason)', `записей ${noReason.length}`);
  if (api.length > 0 && cut.length > 0) {
    findings.push('F-1. Сетевой бюджет ограничивает байты, а не число запросов. При обнулённом бюджете обращения к backend-api ' +
      'продолжают отсылаться (тело закрывается, 0 б в бюджет); при остатке меньше заявленного content-length запрос к CDN тоже ' +
      'отсылается и тело сразу закрывается. Байтовый лимит соблюдается, лишние обращения остаются. Воспроизведение: ' +
      `node probe_a2_acceptance_audit.mjs, сценарий B5 (запросов к API ${api.length}, ответов с отброшенным телом ${zeroRead.length}) ` +
      'и сценарий B3 (обращений к CDN с отброшенным телом больше одного).');
  }
}

// B4 остаток бюджета обнулился: запросов к CDN больше нет (pre-flight до обращения)
{
  let env = auditEnv({ routes: {}, stream: { size: 900, contentLength: 900 } });
  const base = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const limit = base.rep.downloaded.apiBytesRead + 900; // ровно на одну загрузку
  env = auditEnv({ routes: {}, stream: { size: 900, contentLength: 900 } });
  const { rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL), PATCH.totalLimit(limit)]);
  const d = rep.downloaded;
  const dl = env.calls.filter((c) => c.host !== 'chatgpt.com');
  const stopped = allAssets(rep).filter((a) => a.bytes?.reason === 'total_limit_before_start');
  const cutByLen = allAssets(rep).filter((a) => a.bytes?.reason === 'content_length_over_limit');
  say(`B4 потолок ${limit} б: сеть ${d.bytesReadFromNetwork} б, принято ${d.downloadedBytesTotal} б, запросов к CDN ${dl.length}, отказов до обращения ${stopped.length}, отказов после заголовков ${cutByLen.length}`);
  check(d.bytesReadFromNetwork <= limit, 'B4 объём сети превысил потолок', `сеть ${d.bytesReadFromNetwork}, потолок ${limit}`);
  note('B4 в этой фикстуре остаток бюджета опустился ниже content-length, но не до нуля: сработала отбраковка после заголовков, ' +
    'а не отказ до обращения. Отказ до обращения (total_limit_before_start) показан в сценарии B2 и в тесте 13 основного набора',
    `отказов до обращения ${stopped.length}, после заголовков ${cutByLen.length}`);
  const attempted = allAssets(rep).filter((a) => a.bytes && a.bytes.reason !== 'total_limit_before_start' && a.bytes.reason !== 'api_declared_over_file_limit' && a.bytes.reason !== 'file_count_limit').length;
  check(dl.length === attempted, 'B4 число запросов к CDN не совпадает с числом допущенных загрузок', `запросов ${dl.length}, допущено ${attempted}`);
}

// ================= C. SHA256 по фактическим байтам =================
say('\n=== C. SHA256 на фактически полученных байтах (пункт 6) ===');
for (const c of [
  { name: 'C1 тело короче content-length (900 против 1200)', size: 900, contentLength: 1200 },
  { name: 'C2 тело длиннее content-length (900 против 500)', size: 900, contentLength: 500 },
  { name: 'C3 content-length отсутствует', size: 900, contentLength: null },
]) {
  const env = auditEnv({ routes: {}, stream: { size: c.size, chunkSize: 100, contentLength: c.contentLength } });
  const { rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const ok = allAssets(rep).filter((a) => a.bytes?.status === 'OK');
  const b = ok[0]?.bytes;
  const expected = shaHex(new Uint8Array(c.size).fill(65));
  say(`${c.name}: загрузок ${ok.length}, размер ${b?.sizeBytes} б, хэш по ${b?.hashOverBytes} б, contentLengthMatchesActual=${b?.contentLengthMatchesActual}`);
  check(b && b.sha256 === expected, `${c.name}: sha256 не совпадает с эталоном node:crypto по фактическим байтам`, `хэш ${(b?.sha256 ?? '').slice(0, 16)}…`);
  check(b && b.hashOverBytes === b.sizeBytes, `${c.name}: хэш посчитан не ровно по принятым байтам`, `hashOverBytes=${b?.hashOverBytes}, sizeBytes=${b?.sizeBytes}`);
}
{
  const env = auditEnv({ routes: {}, stream: { size: 5000, chunkSize: 400, contentLength: 1500 } });
  const { rep } = await timedRun(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const cut = allAssets(rep).filter((a) => a.bytes?.reason === 'stream_over_limit');
  say(`C4 прерванная загрузка: записей ${cut.length}, sha256 ${cut[0]?.bytes.sha256 === undefined ? 'не публикуется' : cut[0].bytes.sha256}, принято ${cut[0]?.bytes.receivedBytes} б, попытка ${cut[0]?.bytes.attemptedBytes} б`);
  check(cut.length > 0 && cut.every((a) => a.bytes.sha256 === undefined), 'C4 у прерванной загрузки опубликован sha256 — неполный хэш неотличим от полного');
  check(cut.length > 0 && cut.every((a) => (a.bytes.receivedBytes ?? 0) > 0 && (a.bytes.attemptedBytes ?? 0) >= (a.bytes.receivedBytes ?? 0)), 'C4 объём принятых байт и попытки не зафиксированы');
}

// ================= D. Отмена потоков и освобождение ресурсов =================
say('\n=== D. Отмена потоков при раннем отказе (пункт 7) ===');
for (const s of [
  { name: 'D1 не-JSON ответ API', patches: [], setup: (env) => { env.routes.conversation = () => ({ ok: true, status: 200, type: 'basic', url: '', headers: mkHeaders({ 'content-type': 'text/html', 'content-length': '4000' }), body: mkStream(new Uint8Array(4000), { chunkSize: 1000 }, env.watch) }); } },
  { name: 'D2 redirect подписной ссылки', patches: [PATCH.cdn(['cdn.test.invalid'])], setup: (env) => { env.routes.bytes = () => ({ ok: false, status: 302, type: 'basic', url: '', headers: mkHeaders({ location: 'https://cdn2.test.invalid/x' }), body: mkStream(new Uint8Array(100), {}, env.watch) }); } },
  { name: 'D3 HTTP-ошибка CDN (404)', patches: [PATCH.cdn(['cdn.test.invalid'])], setup: (env) => { env.routes.bytes = () => ({ ok: false, status: 404, type: 'basic', url: '', headers: mkHeaders({ 'content-type': 'text/html', 'content-length': '2000' }), body: mkStream(new Uint8Array(2000), {}, env.watch) }); } },
  { name: 'D4 отбраковка по content-length', patches: [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)], setup: (env) => { env.stream = { size: 5000, contentLength: 999 * 1024 }; } },
  { name: 'D5 превышение лимита при чтении', patches: [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(1000)], setup: (env) => { env.stream = { size: 5000, chunkSize: 400, contentLength: null }; } },
  { name: 'D6 обрыв потока при чтении', patches: [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)], setup: (env) => { env.stream = { size: 2000, chunkSize: 400, failAfter: 2 }; } },
]) {
  const env = auditEnv({ routes: {}, stream: { size: 900 } });
  s.setup(env);
  const { rep } = await timedRun(env, [...s.patches, ...TIMEOUT_PATCHES]);
  const st = env.watch.map((x) => `${x.state}/${x.cancels}`).join(', ');
  const open = env.watch.filter((x) => x.state === 'open').length;
  say(`${s.name}: потоков ${env.watch.length}, состояния/отмены: ${st || 'потоков не было'}`);
  check(open === 0, `${s.name}: остались потоки в состоянии «открыт», ресурс не освобождён`, st);
  check(allAssets(rep).every((a) => a.bytes === undefined || typeof a.bytes.status === 'string'), `${s.name}: отказ зафиксирован без статуса`);
}
{
  const discardSites = (SRC.match(/await discardBody\(/g) ?? []).length;
  const cancelSites = (SRC.match(/reader\.cancel\(/g) ?? []).length;
  say(`D7 статически: закрытие тел discardBody — ${discardSites} мест, reader.cancel — ${cancelSites} мест`);
  check(discardSites >= 6 && cancelSites >= 2, 'D7 мест освобождения потоков меньше ожидаемого', `discardBody ${discardSites}, reader.cancel ${cancelSites}`);
}

// ================= E. Утечки =================
say('\n=== E. Утечки uuid, подписных ссылок и токенов (пункт 8) ===');
{
  const env = auditEnv({ routes: {}, stream: { size: 900, contentLength: 900 } });
  const rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]); // CHATS без подмены: в настройке реальные uuid
  const dump = JSON.stringify(rep);
  let msg = '';
  try { scanLeaks(rep, 'отчёт'); } catch (e) { msg = e.message; }
  check(!msg, 'E1 в отчёте найдены запрещённые значения', msg);
  msg = '';
  try { scanLeaks(env.logs, 'консоль'); } catch (e) { msg = e.message; }
  check(!msg, 'E2 в выводе консоли найдены запрещённые значения', msg);
  check(!CHAT_UUID_RE.test(dump), 'E3 в отчёте есть uuid беседы');
  check(!ASSET_ID_RE.test(dump), 'E3b в отчёте есть идентификатор ассета');
  check(!dump.includes(SECRET_SIG), 'E4 в отчёте есть значение подписи из query');
  check(!dump.includes(SECRET_TOKEN), 'E4b в отчёте есть значение токена');
  const targets = allAssets(rep).filter((a) => a.downloadTarget && !a.downloadTarget.unparseable);
  say(`E5 подписные адреса: ${targets.map((t) => `${t.downloadTarget.host}${t.downloadTarget.path}?[${t.downloadTarget.queryParamNames.join(',')}]`).join(' | ')}`);
  check(targets.length > 0 && targets.every((t) => t.downloadTarget.path.includes('<id>')), 'E5 путь подписной ссылки не нормализован', targets.map((t) => t.downloadTarget.path).join(' | '));
  check(targets.every((t) => t.downloadTarget.queryParamNames.includes('sig') && t.downloadTarget.queryParamNames.includes('exp')), 'E5 имена параметров подписи не зафиксированы');
  check(targets.every((t) => !CHAT_UUID_RE.test(t.downloadTarget.path)), 'E5 в нормализованном пути остался uuid');

  const env2 = auditEnv({ routes: {}, stream: { size: 900, contentLength: 900 } });
  const rep2 = await runProbe(env2, [PATCH.cdn(['cdn.test.invalid']), PATCH.diagIds]);
  const aliasDump = JSON.stringify(rep2.idAliases ?? {});
  const diagOn = CHAT_UUID_RE.test(aliasDump) || ASSET_ID_RE.test(aliasDump);
  say(`E6 DIAGNOSTIC_IDS=true: idAliases содержит реальные идентификаторы: ${diagOn} (диагностический режим, по умолчанию выключен)`);
  check(!CHAT_UUID_RE.test(JSON.stringify({ ...rep, idAliases: undefined })), 'E6 в обычном отчёте появились реальные идентификаторы');

  check(!CHAT_UUID_RE.test(CDP_SRC), 'E7 в исходнике CDP-запускателя есть реальный uuid');
  check(/pathShape\(u\.pathname\)/.test(CDP_SRC), 'E8 адрес вкладки в CDP печатается без нормализации');
  const printedRaw = (CDP_SRC.match(/console\.log\([^)]*location\.pathname/g) ?? []).length;
  const refuseRaw = (CDP_SRC.match(/refuse\([^)]*location\.pathname/g) ?? []).length;
  check(printedRaw === 0 && refuseRaw === 0, 'E8 в вывод CDP попадает сырой location.pathname', `console.log ${printedRaw}, refuse ${refuseRaw}`);
  const mw = CDP_SRC.match(/const PATH_WORDS = new Set\(\[[\s\S]*?\]\);[\s\S]*?const pathShape = \(pathname\) =>[\s\S]*?\.join\('\/'\);/);
  if (!mw) check(false, 'E9 нормализация пути в CDP не извлекается для проверки');
  else {
    const shape = new Function(`"use strict"; ${mw[0]}; return pathShape;`)();
    check(shape(`/c/${UUID}`) === '/c/<id>', 'E9 форма адреса беседы в CDP неверна', shape(`/c/${UUID}`));
    check(shape(`/share/${UUID}`) === '/share/<id>', 'E9 форма share-адреса в CDP неверна', shape(`/share/${UUID}`));
    check(shape('/oabqzsigntoken/qq/9f8e') === '/<id>/<id>/<id>', 'E9 форма подписного пути в CDP неверна', shape('/oabqzsigntoken/qq/9f8e'));
  }
  const checkRaw = (CDP_SRC.match(/const CHECK_ONLY = `([\s\S]*?)`;/) || [])[1] ?? '';
  if (!checkRaw) check(false, 'E10 блок диагностики CHECK_ONLY в CDP не найден');
  else {
    const expr = checkRaw.replace(/\\\\/g, '\\');
    const stubDoc = {
      getElementById: () => ({ textContent: JSON.stringify({ session: { accessToken: 'TOKEN_NOT_SHOWN' } }) }),
      querySelector: () => null,
      querySelectorAll: () => [1, 2, 3],
    };
    const diag = (pathname) => new Function('document', 'location', `return (${expr})`)(stubDoc, { protocol: 'https:', host: 'chatgpt.com', hostname: 'chatgpt.com', pathname });
    const d1 = diag(`/c/${UUID}`);
    say(`E10 CHECK_ONLY: ${JSON.stringify(d1)}`);
    check(!CHAT_UUID_RE.test(JSON.stringify(d1)), 'E10 в выводе CHECK_ONLY есть uuid');
    check(d1.pathTemplate === '/c/<id>' && d1.origin === 'https://chatgpt.com', 'E10 CHECK_ONLY не даёт нормализованный адрес', JSON.stringify(d1));
    const d2 = diag(`/share/${UUID}`);
    check(!CHAT_UUID_RE.test(JSON.stringify(d2)) && d2.pathTemplate === '/share/<id>', 'E10 share-вывод CHECK_ONLY не нормализован', JSON.stringify(d2));
    check(!JSON.stringify(d1).includes('TOKEN_NOT_SHOWN'), 'E10 CHECK_ONLY раскрывает значение токена');
  }
}

// ================= F. эталонный справочник архива =================
say('\n=== F. archive_reference.json (пункт 9) ===');
{
  const refLines = SRC.split('\n').filter((l) => l.includes('archive_reference'));
  const refInCode = refLines.filter((l) => l.indexOf('archive_reference') < l.indexOf('//'));
  say(`F1 упоминаний archive_reference в зонде: ${refLines.length}, из них вне комментариев: ${refInCode.length}${refInCode.length ? ` — ${refInCode.join(' | ')}` : ''}`);
  check(refInCode.length === 0, 'F1 зонд использует archive_reference.json не только в комментариях');
  const calls = SRC.match(/probeAsset\([^)]*\)/g) ?? [];
  const withNull = calls.filter((c) => /,\s*null\s*\)$/.test(c)).length;
  say(`F2 вызовов probeAsset: ${calls.length}, с эталоном null: ${withNull}`);
  check(calls.length > 0 && calls.length === withNull, 'F2 есть вызов probeAsset с реальным эталоном — сверка стала автоматической', calls.join(' | '));
  check(!/archive_reference/.test(CDP_SRC), 'F3 CDP-запускатель ссылается на archive_reference.json');
  const env = auditEnv({ routes: {}, stream: { size: 900, contentLength: 900 } });
  const rep = await runProbe(env, [PATCH.cdn(['cdn.test.invalid']), PATCH.fileLimit(FL)]);
  const ok = allAssets(rep).filter((a) => a.bytes?.status === 'OK');
  say(`F4 записей с успешной загрузкой: ${ok.length}; shaEqualsArchive: ${[...new Set(ok.map((a) => String(a.bytes.shaEqualsArchive)))].join('/')}, sizeEqualsArchive: ${[...new Set(ok.map((a) => String(a.bytes.sizeEqualsArchive)))].join('/')}`);
  check(ok.length > 0 && ok.every((a) => a.bytes.shaEqualsArchive === null && a.bytes.sizeEqualsArchive === null), 'F4 автоматическая сверка с архивом всё-таки появилась');
  check(ok.length > 0 && ok.every((a) => a.expectedFromArchive === null), 'F4b поле expectedFromArchive не осталось пустым', ok.map((a) => JSON.stringify(a.expectedFromArchive)).join(','));
  const doc = await readFile(new URL('../PROBE_A2_AUDIT_AND_FIX.md', import.meta.url), 'utf8');
  check(/Сверка с `archive_reference\.json` остаётся ручной/.test(doc), 'F5 ограничение про ручную сверку не описано в документе');
  check(env.calls.every((c) => c.hasSignal), 'F6 запросы идут без AbortSignal — завершение не гарантировано');
}

// ================= итог =================
say('\n=== ИТОГ ===');
const badTests = results.filter((r) => !r.ok);
say(`регрессия (probe_a2_tests.mjs, прогоняется при импорте): тестов ${results.length}, провалено ${badTests.length}`);
say(`приёмочных проверок провалено: ${fails}`);
if (findings.length) {
  say('отклонения (код не менялся, ждут отдельного задания):');
  for (const f of findings) say(`  - ${f}`);
} else {
  say('отклонений не найдено');
}
process.exitCode = fails ? 1 : 0;
