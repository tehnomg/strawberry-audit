// Шаг 0 — проверка установки собранного форка: читаем манифест каждого расширенного
// service worker через DevTools Protocol (подключение к временному профилю Edge).
const PORT = process.argv[2] || '9223';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const sw = list.filter((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
console.log(`service workers: ${sw.length}`);

for (const t of sw) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const idOf = (m, method, params) =>
    new Promise((res) => {
      ws.addEventListener('message', function h(ev) {
        const d = JSON.parse(ev.data);
        if (d.id === m.id) {
          ws.removeEventListener('message', h);
          res(d);
        }
      });
      ws.send(JSON.stringify({ id: m.id, method, params }));
    });
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
  });
  await idOf({ id: 1 }, 'Runtime.enable');
  const r = await idOf({ id: 2 }, 'Runtime.evaluate', {
    expression:
      "JSON.stringify({id: chrome.runtime.id, name: chrome.runtime.getManifest().name, i18n: (self.chrome?.i18n? chrome.i18n.getMessage('extensionName') : null), version: chrome.runtime.getManifest().version, cmds: Object.keys(chrome.runtime.getManifest().commands||{}), wars: (chrome.runtime.getManifest().web_accessible_resources||[]).flatMap(x=>x.resources)})",
    awaitPromise: false,
  });
  console.log(t.url);
  console.log('  ' + (r.result?.value ?? JSON.stringify(r.error ?? r.result)));
  ws.close();
}

const pages = list.filter((t) => t.type === 'page');
console.log(`pages: ${pages.map((p) => p.url).join(' | ')}`);
