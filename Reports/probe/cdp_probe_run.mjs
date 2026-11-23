/**
 * StrawBerry Edition, зонд A-2 — ВСПОМОГАТЕЛЬНЫЙ запускатель через отладочный порт браузера.
 *
 * Основной и согласованный способ запуска зонда — ручной: авторизованная вкладка chatgpt.com
 * с открытым конкретным чатом → F12 → Console → вставить chatgpt_asset_probe_nocookie.js.
 * Этот файл нужен только если ручной запуск по какой-то причине неудобен.
 *
 * ПО УМОЛЧАНИЮ НЕ РАБОТАЕТ: без явного разрешения не подключается к браузеру, не выбирает
 * вкладку сам, не создаёт новых вкладок и не выполняет переходов. Ничего не копируется,
 * cookie не читаются, содержимое страницы (текст, название беседы) не извлекается.
 *
 * Разрешение задаётся явно: переменная окружения CDP_ALLOW=1.
 *
 * Использование:
 *   $env:CDP_ALLOW = "1"
 *   node cdp_probe_run.mjs --target=<id вкладки> --check
 *   node cdp_probe_run.mjs --target=<id вкладки> --probe=chatgpt_asset_probe_nocookie.js --out=отчёт.json
 *
 * id вкладки берётся из http://127.0.0.1:9222/json/list (поле id) и передаётся обязательно:
 * автоматического выбора «первой подходящей» вкладки нет.
 * Порт по умолчанию 9222; если у браузера другой порт — --port=NNNN.
 */

const ALLOW_ENV = 'CDP_ALLOW';
const API_HOST = 'chatgpt.com';

const argv = process.argv.slice(2);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const flag = (name) => argv.some((a) => a === `--${name}`);

function refuse(reason, extra) {
  console.log(`ОТКАЗ: ${reason}`);
  if (extra) console.log(extra);
  process.exitCode = 2;
}

function usage() {
  console.log(
    [
      'Справка: node cdp_probe_run.mjs --target=<id> [--check | --probe=<файл> --out=<файл>] [--port=NNNN]',
      `Обязательно разрешение ${ALLOW_ENV}=1 (по умолчанию запускатель выключен).`,
      'Что делает: подключается к уже открытой вкладке с указанным id и один раз вычисляет выражение.',
      'Чего не делает: не создаёт вкладок, не выполняет Page.navigate, не выбирает вкладку сам,',
      'не читает cookie, не копирует профиль, не выводит текст страницы и название беседы.',
    ].join('\n'),
  );
}

const targetId = opt('target');
const port = opt('port') || process.env.PROBE_PORT || '9222';
const probeFile = opt('probe');
const outFile = opt('out');
const doCheck = flag('check');

if (argv.includes('--help') || argv.includes('-h')) {
  usage();
} else if (process.env[ALLOW_ENV] !== '1') {
  refuse(
    `запускатель выключен (это ожидаемое состояние).`,
    `Чтобы включить, задайте ${ALLOW_ENV}=1 и передайте --target=<id вкладки>.`,
  );
} else if (!targetId) {
  refuse('не передан --target=<id вкладки>: автоматического выбора вкладки нет.');
} else if (!doCheck && !probeFile) {
  refuse('нужно указать --check или --probe=<файл> (--out=<файл> для отчёта).');
} else {
  await run();
}

async function run() {
  const base = `http://127.0.0.1:${port}`;
  const http = async (pathname) => {
    const r = await fetch(`${base}${pathname}`);
    return r.json();
  };

  // Только указанный вкладкой target. Никакого «найдёт первую страницу».
  let list = [];
  try {
    list = await http('/json/list');
  } catch (e) {
    refuse(`отладочный порт ${port} не отвечает: ${e.message}`, 'Это не ошибка зонда: браузер запущен без --remote-debugging-port.');
    return;
  }
  const target = list.find((t) => t.id === targetId);
  if (!target) {
    refuse(
      `вкладка с id ${targetId} не найдена на порту ${port}.`,
      `Доступные id страниц: ${list.filter((t) => t.type === 'page').map((t) => t.id).join(', ') || 'нет'}`,
    );
    return;
  }
  if (target.type !== 'page') {
    refuse(`target ${targetId} имеет тип ${target.type}, ожидается page.`);
    return;
  }

  // Адрес вкладки проверяется до всякого выполнения кода: только https и точный hostname.
  let pageUrl = '';
  try {
    const u = new URL(target.url);
    pageUrl = `${u.protocol}//${u.host}${u.pathname}`;
    if (u.protocol !== 'https:') {
      refuse(`адрес вкладки не https: ${pageUrl}`);
      return;
    }
    if (u.hostname !== API_HOST) {
      refuse(`адрес вкладки не ${API_HOST}: ${pageUrl}`);
      return;
    }
    if (/^\/(share|s)(\/|$)/.test(u.pathname)) {
      refuse(`вкладка открыта на share-странице, а не на своей беседе: ${pageUrl}`);
      return;
    }
    if (!target.webSocketDebuggerUrl) {
      refuse('у вкладки нет webSocketDebuggerUrl.');
      return;
    }
  } catch {
    refuse(`адрес вкладки не разбирается: ${String(target.url).slice(0, 120)}`);
    return;
  }
  console.log(`target: ${targetId}, адрес: ${pageUrl}`);

  const expression = probeFile ? (await import('node:fs')).readFileSync(probeFile, 'utf8') : CHECK_ONLY;
  const page = await connect(target.webSocketDebuggerUrl);
  let pid = 0;
  const pending = new Map();
  page.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p(msg);
    }
  };
  const send = (method, params) =>
    new Promise((res) => {
      const mid = ++pid;
      pending.set(mid, res);
      page.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });

  // Никаких Page.enable/Page.navigate/Target.*: вкладка остаётся в том состоянии, где её оставил человек.
  await send('Runtime.enable', {});
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: probeFile ? 900000 : 15000,
  });
  if (res.exceptionDetails) {
    console.log('ИСКЛЮЧЕНИЕ: ' + JSON.stringify(res.exceptionDetails).slice(0, 1200));
  }
  const value = res.result && res.result.value;
  if (value === undefined) {
    console.log('НЕТ ЗНАЧЕНИЯ: ' + JSON.stringify(res.result || {}).slice(0, 800));
  } else if (probeFile) {
    if (!outFile) {
      refuse('для --probe нужен --out=<файл отчёта>: отчёт остаётся локальным файлом.');
    } else {
      const fs = await import('node:fs');
      fs.writeFileSync(outFile, JSON.stringify(value, null, 2), 'utf8');
      console.log(`СОХРАНЁН ${outFile} (${fs.statSync(outFile).size} б)`);
    }
    // Краткая сводка: только локальные обозначения, статусы и счётчики.
    const chats = (value.chats || []).map((c) => ({
      chat: c.chatLabel,
      fetch: c.fetch?.status ?? null,
      auth: c.fetch?.auth ?? null,
      assets: (c.assets || []).length,
    }));
    console.log(
      JSON.stringify(
        {
          context: value.context ?? null,
          chats,
          extraAssets: (value.extraAssets || []).length,
          downloaded: value.downloaded ?? null,
          requests: value.requests?.total ?? null,
          cdnHostsSeen: value.cdnHostsSeen ?? null,
        },
        null,
        1,
      ),
    );
  } else {
    // Режим --check: только булевы признаки и счётчики, без текста страницы.
    console.log(JSON.stringify(value, null, 1));
  }
  page.close();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('не удалось подключиться к вкладке: ' + (e.message || '')));
  });
}

// diagnostics только чтение: ни текста страницы, ни названия беседы.
const CHECK_ONLY = `(function () {
  var boot = document.getElementById('client-bootstrap') || document.getElementById('__NEXT_DATA__');
  var hasToken = false;
  try {
    var j = boot ? JSON.parse(boot.textContent) : null;
    hasToken = Boolean(j && (j.session && j.session.accessToken || j.auth && j.auth.accessToken || j.accessToken));
  } catch (e) { hasToken = false; }
  return {
    url: location.protocol + '//' + location.host + location.pathname,
    https: location.protocol === 'https:',
    host: location.hostname,
    isSharePage: /^\\/(share|s)(\\/|$)/.test(location.pathname),
    hasComposer: Boolean(document.querySelector('#prompt-textarea') || document.querySelector('textarea[aria-label]')),
    hasBootstrapScript: Boolean(boot),
    hasAuthToken: hasToken,
    turnNodes: document.querySelectorAll('[data-message-id], [data-turn-id]').length,
  };
})()`;
