// StrawBerry Edition, этап 3, шаг 1 — запускатель зонда через отладочный порт браузера.
// Режимы:
//   node cdp_probe_run.mjs check <url>            — только состояние страницы (залогинен ли чат, где токен)
//   node cdp_probe_run.mjs probe <url> <file.js> <out.json> — вставить зонд и сохранить отчёт
// Секреты не пишутся: зонд сам сохраняет только булевы признаки токена/устройства.
const PORT = process.env.PROBE_PORT || '9223';
const mode = process.argv[2];
const argUrl = process.argv[3];
const probeFile = process.argv[4];
const outFile = process.argv[5];
import fs from 'node:fs';

const LOGIN_CHECK = `(function () {
  var t = document.title || '';
  var body = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240);
  return {
    url: location.href,
    title: t.slice(0, 120),
    hasComposer: !!(document.querySelector('#prompt-textarea') || document.querySelector('textarea[aria-label]')),
    clientBootstrap: !!document.getElementById('client-bootstrap'),
    nextData: !!document.getElementById('__NEXT_DATA__'),
    turnNodes: document.querySelectorAll('[data-message-id], [data-turn-id]').length,
    sidebarConversations: document.querySelectorAll('ol li a[href*="/c/"]').length,
    signInVisible: /sign in|log in|войти|регистр/i.test(body),
    bodySample: body
  };
})()`;

async function http(pathname, method) {
  const r = await fetch(`http://127.0.0.1:${PORT}${pathname}`, { method: method || 'GET' });
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
  });
}

async function main() {
  const ver = await http('/json/version');
  const browser = await connect(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  browser.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p(msg);
    }
  };
  const bsend = (method, params) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      browser.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });

  let target = (await http('/json/list')).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!target) {
    await bsend('Target.createTarget', { url: argUrl || 'about:blank' });
    await new Promise((r) => setTimeout(r, 1500));
    target = (await http('/json/list')).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }
  if (!target) throw new Error('no page target');
  browser.close();

  const page = await connect(target.webSocketDebuggerUrl);
  const events = [];
  const ppending = new Map();
  let pid = 0;
  page.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && ppending.has(msg.id)) {
      const p = ppending.get(msg.id);
      ppending.delete(msg.id);
      p(msg);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  const send = (method, params) =>
    new Promise((res) => {
      const mid = ++pid;
      ppending.set(mid, res);
      page.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });

  await send('Page.enable', {});
  await send('Runtime.enable', {});
  if (argUrl) {
    events.length = 0;
    await send('Page.navigate', { url: argUrl });
    const t0 = Date.now();
    while (!events.some((e) => e.method === 'Page.loadEventFired') && Date.now() - t0 < 30000) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  // Дать SPA дорисовать интерфейс (только чтение).
  await new Promise((r) => setTimeout(r, 4000));

  const expression = mode === 'probe' ? fs.readFileSync(probeFile, 'utf8') : LOGIN_CHECK;
  const res = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true, timeout: mode === 'probe' ? 900000 : 30000 }
  );
  if (res.exceptionDetails) {
    console.log('EXCEPTION: ' + JSON.stringify(res.exceptionDetails).slice(0, 1200));
  }
  const value = res.result && res.result.value;
  if (value === undefined) {
    console.log('NO VALUE: ' + JSON.stringify(res.result || {}).slice(0, 800));
  } else if (mode === 'probe') {
    fs.writeFileSync(outFile, JSON.stringify(value, null, 2), 'utf8');
    console.log('SAVED ' + outFile + ' (' + fs.statSync(outFile).size + ' bytes)');
    const chats = (value.chats || []).map((c) => ({
      id: c.id,
      ok: c.ok,
      status: c.status,
      messages: c.messageCount,
      nodes: c.nodeCount,
      current_node: c.currentNode,
      assets: (c.assets || []).length,
      withBytes: (c.assets || []).filter((a) => a.bytes).length,
    }));
    console.log(JSON.stringify({ chats, extra: (value.extraAssets || []).length, downloaded: value.downloaded, requests: value.requests }, null, 1));
  } else {
    console.log(JSON.stringify(value, null, 1));
  }
  page.close();
}

main().catch((e) => {
  console.log('FAIL: ' + e.message);
  process.exit(1);
});
