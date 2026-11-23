# Подготовка ChatGPT Asset Probe (A-2) к безопасному ручному запуску: аудит и правки

Дата: 23.11.2026 (+05:00). Правки только в двух файлах: `StrawberryEdition\probe\chatgpt_asset_probe_nocookie.js`
и `StrawberryEdition\probe\cdp_probe_run.mjs`. Зонд в живой вкладке Brave **не запускался**; браузер
с CDP в этой задаче не поднимался, профиль не копировался, cookie не читались, импорт не выполнялся.

Файлы в Workspace лежат в `StrawberryEdition\probe\`; папка `Reports\` существует (2 отчёта от
16–17.11), но копий этих файлов в ней нет — проверка поиска по всему Workspace: других копий нет
(кроме созданной мной архивной копии исходников).

---

## Этап 0. Исходное состояние (зафиксировано)

| Файл | Размер | mtime | SHA256 |
|---|---|---|---|
| `probe\chatgpt_asset_probe_nocookie.js` (рабочий, для вставки) | 24 848 б | 23.11 01:16 | `3ED2E04DB4EF2938DA9BCAFCE23B27B5FB478C588E06C84A2EB7355834864232` |
| `probe\cdp_probe_run.mjs` | 5 321 б | 23.11 01:17 | `E681BA14903C21064D9C24FCF4B646C19B87A1805FBD342F71F544A82B6A8116` |
| `probe\chatgpt_asset_probe.js` (исходный A-2, не правится) | 24 845 б | 21.11 00:39 | `DB14D9BFF45F0EF98937BFFAB1B9D058BB6DA84F979BC4B326AA9D78B83EF750` |

- Workspace **не является git-репозиторием** (`\.git` отсутствует) → фиксация состояния по SHA256,
  как и в предыдущих задачах этого проекта.
- Исходники сохранены для сравнения: `probe\archive_a2_original\` (3 файла, 55 014 б).
- `StrawberryEdition\ace-fork` и `StrawberryEdition\ace-src`: HEAD `cf19e71`, правок 0 — не затрагиваются.
- Инварианты рабочего архива совпали со срезом 22.11.2026: `chats` — 2114 файла / 197 845 972 б;
  `attachments` — 332 каталога / 1233 файла / 422 854 521 б. Импорт не запускался.

Разрешено к изменению: только два файла из таблицы выше. Дополнительно создаются тестовые
материалы этой задачи (`probe\probe_a2_tests.mjs`, `probe\probe_a2_diff.txt`, этот документ) —
они не относятся к коду проекта.

---

## Этап 1. Аудит потоков данных и сетевых запросов (код не менялся)

### 1.1. Путь токена

`document.getElementById('client-bootstrap') || getElementById('__NEXT_DATA__')` → `JSON.parse`
→ `session.accessToken` / `auth.accessToken` / `accessToken` (строки 83–94) → вставляется в
заголовок `Authorization: Bearer …` для всех запросов `api()` (103–109) → в отчёт попадают только
булевы `hasAuthToken` и `tokenSourceElementId` (279–280). Значение токена в отчёт, консоль и URL
не попадает. Источник токена существует только на SSR-странице конкретной беседы — это функциональное
требование к запуску, а не только вопрос отчётности.

Чтение cookie: `READ_DEVICE_COOKIE ? document.cookie.match(/oai-did=…/) : null` (95–97). В рабочей
копии флаг `false`, но **сам код чтения cookie остаётся в файле**, и значение попало бы в заголовок
`oai-device-id` (105), если флаг включить.

### 1.2. Таблица сетевых запросов текущего зонда

№ | Запрос | Как формируется | Метод | Заголовки | credentials | Redirect | Что возвращается
|---|---|---|---|---|---|---|---
| 1 | `https://chatgpt.com/backend-api/conversation/<convId>` (6–7 шт., включая беседу текущей вкладки 293–294) | константа хоста + `convId` из config без санитизации (298) | GET | `Accept`, `Authorization: Bearer`, (опц. `oai-device-id`) | **`include`** — браузер прикладывает cookie | следует автоматически (по умолчанию) | JSON всего дерева беседы; размер — десятки МБ на больших беседах, тело буферизуется целиком (`r.json()` 116)
| 2 | `https://chatgpt.com/backend-api/files/download/<refId>` (по одному на уникальный ассет, 231) | константа хоста + id ассета без санитизации | GET | те же | **`include`** | автоматически | JSON с полем `download_url` (подписная ссылка)
| 3 | подписной URL из `download_url` (247) | **полностью из ответа сервера**, проверка хоста/порта/протокола отсутствует | GET | нет | `omit` | **автоматически, без проверки** | полный массив байтов файла через `arrayBuffer()` (248) — память не ограничена
| 4 | `backend-api/files/<id>/metadata`, `backend-api/files`, `backend-api/conversations/<id>/files` (359–362) | константы + id | GET | те же | **`include`** | автоматически | JSON/статус
| 5 | повторная загрузка подписных URL (до 5 файлов, после паузы 90 с, 477–483) | тот же подписной URL | GET | нет | `omit` | автоматически | **полный файл заново**, без лимита размера и без учёта в `downloadedBytesTotal` (484)

Иные хосты, кроме `chatgpt.com` и хоста из ответа сервера, зонд не трогает — но хост из ответа
сервера **не проверяется**, вопреки утверждению в шапке файла («Других хостов зонд не трогает»).
Ни одного POST/PUT/PATCH/DELETE в коде нет; единственный контакт со страницей — временный `<a>`
для скачивания отчёта (505–509), в DOM он не вставляется.

### 1.3. Карта чувствительных данных в отчёте и консоли

Что уже безопасно: значение токена (только булев признак), значения параметров подписных ссылок
(сохраняются только host/path/имена параметров — 69–77), первые байты файлов (≤12 байт в hex, 67–68),
тексты реплик нигде не извлекаются (166–205, 307–323 — только структуры и ключи).

Что противоречит требованию минимизации:

Поле | Строки | Что попадает
|---|---|---
`chat.meta.title` | 212 | **название беседы**
`assets[].nameFromApi`, `refs[].name/file_name/filename` | 125, 225 | **имена файлов**
`dom.linksToFiles` | 425–428 | **сырые href** со страницы; для ссылок на файлы в них бывают параметры подписи доступа
`report.page` | 277 | полный адрес вкладки (uuid беседы)
`chat.convId`, `assets[].id`, `refs[].id`, `sampleWithAttachments[].refs[].id` | 297, 223, 131, 315–322 | реальные идентификаторы бесед и ассетов
`requests.byPath` | 57, 75 | нормализация `/[0-9a-f-]{8,}/` **не срабатывает** для сегментов вида `file_0000…` (сегмент начинается с `file_`) → id ассетов утекают в журнал маршрутов
`console.log(JSON.stringify(report))` | 502 | в консоль выводится весь отчёт, включая перечисленное выше
`chat.expectedFromArchive` | 229, 350 | всегда `null` (эталоны в зонде не подставляются) — пустое поле выдаётся за результат
`report.flags.READ_DEVICE_COOKIE` | 282 | след cookie-режима

### 1.4. Подтверждённые нарушения требований задачи

1. **Cookie передаются автоматически**: `credentials: 'include'` во всех API-запросах (109) — при
   `READ_DEVICE_COOKIE = false` cookie всё равно уходят на `chatgpt.com`.
2. **Код чтения cookie остаётся в файле** (95–97) и может отправить значение cookie в заголовке.
3. **Нет проверки адреса подписной ссылки**: протокол, hostname, порт, userinfo не проверяются;
   redirect следует автоматически (247) → адрес загрузки определяется сервером.
4. **Лимит объёма не действует во время загрузки**: declared-size из API (238–240) ≠ `Content-Length`;
   фактический размер проверяется только после полной загрузки через `arrayBuffer()` (248), память
   не ограничена; общий лимит 200 МиБ проверяется до запроса, но превышение не ограничивает саму
   загрузку (241–243).
5. **Повторная загрузка**: обязательная пауза 90 с (477) + до 5 полных повторных скачиваний без
   лимита объёма и без учёта в статистике (479–496).
6. **Нет контроля контекста запуска**: нет проверки `https:` и `chatgpt.com`, страница `/share/`
   только помечается в отчёте (98, 278), но запросы всё равно выполняются; на посторонней странице
   зонд уйдёт делать запросы и мерить не тот DOM.
7. **Данные отчёта**: названия бесед, имена файлов, сырые href, реальные идентификаторы, утечка id
   в журнал маршрутов (см. 1.3).
8. `SCROLL_TEST` (442–469) при включении меняет `root.scrollTop` (прокручивает страницу) —
   противоречит «страница не меняется»; по умолчанию выключен.
9. Идентификаторы в URL запросов не санитизируются (298, 231, 360–362): символы `/ ? # ..` внутри
   id способны изменить маршрут запроса.

### 1.5. CDP-запускатель (`cdp_probe_run.mjs`)

- `LOGIN_CHECK` собирает `bodySample` — первые 240 символов текста страницы, и печатает их в консоль
  (факт: при проверке 23.11 01:2x в вывод попали строки интерфейса ChatGPT).
- `(await http('/json/list')).find(t => t.type === 'page')` — подключение к **первой попавшейся**
  вкладке; при отсутствии вкладки — `Target.createTarget` создаёт новую; затем `Page.navigate`
  выполняет переход по переданному URL и `Runtime.evaluate` исполняет произвольный JS в этой вкладке.
  Проверки адреса вкладки нет.
- Никакой защиты от запуска против профиля пользователя: подключение к первому доступному
  порту отладки.

### 1.6. Что сохраняем как есть (сильные стороны текущего зонда)

Только GET; скачивание байтов идёт без авторизации и без cookie (`credentials: 'omit'`); форма
подписного URL сохраняется без значений параметров; первые байты — не более 12 в hex; тексты
реплик не извлекаются; статистика запросов по хостам и маршрутам; сравнение SHA256/размера с
заявленными значениями (259–261); `<a download>` для отчёта не вставляется в DOM и не вызывает
навигацию.

Проверки этапа 1 выполнены без изменения кода; оставшихся вопросов по аудиту нет — все нарушения
локализованы по строкам. Переход к этапу 2.

---

## Этап 2. Cookie и авторизация — выполнено

Изменения только в `chatgpt_asset_probe_nocookie.js`:

| Было | Стало |
|---|---|
| `const READ_DEVICE_COOKIE = false` (настройка) | настройки нет; cookie не читаются ни при каком режиме |
| `document.cookie.match(/oai-did=/)` (95–97) | удалено; `deviceId = null` с комментарием, что значение живёт в cookie |
| `headers['oai-device-id'] = deviceId` (105) | заголовок не отправляется; в `api()` остаются только `Accept` и `Authorization: Bearer` |
| `fetch(url, { method:'GET', credentials:'include', headers })` (113) | `credentials: 'omit'`; итого во всех четырёх `fetch` — `omit` |
| — | добавлена функция `authClass(r)`: сетевая ошибка → `NETWORK_ERROR`, 401/403 → `AUTH_REQUIRED`, иной не-2xx → `HTTP_ERROR`, иначе `OK`; обхода через cookie нет |
| `chat.fetch`, `filesDownloadEndpoint`, `endpointProbes` | рядом с фактическим HTTP-статусом добавлено поле `auth` из `authClass` |
| `hasDeviceId: Boolean(deviceId)` | `hasDeviceId: null` (cookie не читаем) + поле `cookiePolicy` с описанием политики |
| Шапка файла (гарантии) | переписана: cookie не читаются и не передаются; авторизация backend-api только Bearer-токеном из страницы; скачивание по подписной ссылке — без Authorization и без cookie; при отказе endpoint'а фиксируется `AUTH_REQUIRED` |

Проверка этапа (`probe_a2_tests.mjs`; Node, только стабы, сети и браузера нет):

- статический поиск по обоим файлам: `document.cookie`, `READ_DEVICE_COOKIE`, `credentials: 'include'`,
  отправляемого `oai-device-id`, `bodySample` — 0 совпадений; `node --check` зонда — синтаксис корректен;
- **тест 01 PASS** — нет cookie/`include`/негет-методов;
- **тест 02 PASS** — все запросы только GET; у всех API-запросов `credentials: 'omit'`, есть
  `Authorization`, cookie-заголовок не передаётся; у всех загрузок `credentials: 'omit'` и **нет**
  `Authorization`; значения токена нет ни в отчёте, ни в консоли; `hasAuthToken: true`,
  `hasDeviceId: null`; обращений к `document.cookie` 0 (геттер cookie в стабе бросает исключение);
- **тест 03 PASS** — ответ 401 на `backend-api/conversation` даёт `auth: "AUTH_REQUIRED"` при
  сохранённом статусе 401 (никакой попытки повторить запрос с cookie);
- **тест 04 PASS** — скачивание байтов идёт без Authorization и без cookie, hostname загрузки
  зафиксирован в отчёте;
- **тест 06 PASS** — у трёх дополнительных маршрутов есть поле `auth`, ответ 403 помечен `AUTH_REQUIRED`.

Границы этапа соблюдены: `redirect: 'manual'` намеренно не добавлялся (это этап 3), лимиты объёма
и состав отчёта на этом этапе не менялись.

Тестовая обвязка создана заново после того, как первая версия тестового файла пропала с диска
(фиксация этапа 0 при этом сохранилась): стабы `location`, `document` (геттер `cookie` бросает
исключение), очередь ответов `fetch` со счётчиками, `console`, `setTimeout`, `URL`, `Blob`.
Синтетика помечена маркерами утечки: `СекретноеНазваниеБеседы`, `СекретныйОтчёт2026.pdf`,
`TokS3cr3t-9f2a`, `PODPISESECRET123`, `ТЕКСТ_РЕПЛИКИ…`.

Снимок после этапа 2: `probe\archive_a2_stages\stage2_nocookie.js` — 26 462 б,
SHA256 `5F832900B5E42EDB…` (полный будет пересчитан на этапе 9).

Оставшиеся по этапу 2 вопросы: фактическая работа `backend-api` без cookie подтверждается только
живым прогоном (по текущему коду при 401/403 зонд честно вернёт `AUTH_REQUIRED`); автоматический
`redirect` пока не ограничен — этап 3.

---

## Этап 3. Контроль адресов и redirect — выполнено

Изменения в `chatgpt_asset_probe_nocookie.js`:

| Элемент | Значение |
|---|---|
| `API_HOST = 'chatgpt.com'` | единственный разрешённый хост `backend-api`; сравнение точное (`u.hostname !== API_HOST`), без подстрок |
| `API_ROUTES` | 5 явных шаблонов маршрута: `conversation/<id>`, `files/download/<id>`, `files/<id>/metadata`, `files`, `conversations/<id>/files`; посторонний путь даёт `route_not_allowed` |
| `API_PORT = '443'` | явный порт иной, чем 443, → `unexpected_port` |
| `CDN_HOSTS = []` | **пуст по умолчанию**: адрес загрузки неизвестен → файл не качается, hostname фиксируется в `cdnHostsSeen`, статус `UNTRUSTED_DOWNLOAD_HOST`. Пополняется только явным списком по фактическому замеру |
| `CDN_FOLLOW_REDIRECTS = false`, `MAX_REDIRECT_HOPS = 2` | redirect подписной ссылки по умолчанию не выполняется; при явном включении каждый переход проходит `targetIssues`, дальше 2 переходов — `redirect_hops_exceeded` |
| `targetIssues(u, purpose)` | `not_https` / `host_not_allowlisted` / `unexpected_port` / `userinfo_in_url`; вызывается **до** каждого запроса и в API, и в загрузке |
| `safeId()` | идентификатор подставляется в путь только как токен `^[A-Za-z0-9_-]{1,120}$`; иначе `UNSUPPORTED` + `reason: asset_id_unsafe`, запроса нет |
| `api()` | проверка адреса и маршрута до `fetch`; `redirect: 'manual'`; 3xx на API фиксируется как отказ (`redirectBlocked`), автоматически не обслуживается |
| `fetchDownload()` | единая точка скачивания: только GET, `credentials: 'omit'`, без Authorization, адрес проверяется, redirect вручную; статусы `UNTRUSTED_DOWNLOAD_HOST` / `HTTP_ERROR` / `NETWORK_ERROR` / `OK` с полем `reason` |
| `requests.blocked` | отдельный список отклонённых адресов (purpose, host, issues) — отказ виден в отчёте, а не молча |
| отчёт | добавлены `addressPolicy` (хост, маршруты, allowlist CDN, политика redirect) и `cdnHostsSeen` |

Проверка этапа (моки, сети нет):

- **тест 08 PASS** — семь подпроверок: неизвестный CDN-хост → `UNTRUSTED_DOWNLOAD_HOST` и **ноль**
  запросов к нему, hostname при этом зафиксирован; `http://` → `not_https`, запроса нет; порт 8443 →
  `unexpected_port`, запроса нет; `https://host@evil.example/...` → `userinfo_in_url`, запроса нет;
  redirect 302 по умолчанию → отказ `redirect_not_followed`, ни одного запроса на хост из `Location`,
  повторных обращений нет; redirect с явным разрешением на чужой хост → второй запрос не уходит;
  redirect с явным разрешением на разрешённый хост → загрузка состоялась, запросы только на два
  адресованных хоста, все с `redirect: 'manual'`; идентификатор вида `file_x/../other` →
  `asset_id_unsafe` и ни одного запроса с таким путём; статически в коде нет проверок хоста через
  `includes`/`startsWith`/`indexOf`;
- сопутствующие тесты 01–04, 06, 12 остаются PASS (в 02 и 04 путь загрузки проверяется с явно
  подставленным allowlist — подстановка констант сделана в тестовой обвязке и падает, если якорь
  не найден).

Замеченный на этапе побочный эффект: так как `CDN_HOSTS` пуст по умолчанию, **первый живой прогон
обычно не скачает ни одного файла** — он покажет `UNTRUSTED_DOWNLOAD_HOST` и реальный hostname CDN
в `cdnHostsSeen`. Это осознанное следствие требования «при неизвестном CDN-хосте не скачивать,
а фиксировать». Онлайн-проверка живости маршрутов `backend-api` без cookie по-прежнему требует
разрешения на запуск.

Снимок после этапа 3: `probe\archive_a2_stages\stage3_nocookie.js` — 33 767 б, 664 строки
(исходник до правок: 24 848 б, 512 строк).

---

## Этап 4. Реальные ограничения объёма — выполнено

Что изменено в `chatgpt_asset_probe_nocookie.js`:

| Элемент | Как сейчас |
|---|---|
| `readCapped(resp, room)` вместо `arrayBuffer()` | читает `resp.body.getReader()` по чанкам; `room = min(MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES − уже принятое)` |
| `content-length` | проверяется **до** чтения: если он больше `room` → `SKIPPED_LIMIT / content_length_over_limit`, поток не открывается; при отсутствии заголовка (`0`/нет) проверка идёт по фактическим байтам |
| превышение во время потока | `reader.cancel('over_limit')`, накопленное отбрасывается, статус `SKIPPED_LIMIT / stream_over_limit` с `receivedBytes`, `attemptedBytes`, `limitBytes` |
| нет `resp.body` | статус `UNSUPPORTED / stream_unavailable`; на неограниченный `arrayBuffer()` код не возвращается (единственный `arrayBuffer` в стабах тестов) |
| учёт | у прерванных, отклонённых и ошибочных загрузок `countedInTotals: false`, в `filesDownloaded`/`downloadedBytesTotal` не попадают |
| попытка загрузки | `downloadAttempts` считается по **попыткам**; лимит `MAX_TOTAL_FILES` проверяется и в основном цикле по чатам, и внутри `probeAsset`, и во второй фазе |
| последовательность | загрузки идут строго одна за другой; `downloadsMaxInFlight` фиксирует максимум одновременных (в отчёте `maxConcurrentDownloads`) |
| вторая (повторная) фаза | теперь тоже под лимитами: общий поток через `readCapped`, отдельный потолок `MAX_RECHECK_BYTES_TOTAL = 32 МиБ`, лимит количества попыток |
| отчёт | `report.downloaded` содержит `filesDownloaded`, `downloadedBytesTotal`, `downloadAttempts`, `maxConcurrentDownloads` и **фактические** значения четырёх лимитов; у каждого файла — `declaredSizeFromApi`, `declaredSizeFromContentLength`, `contentLengthMatchesActual`, `sizeBytes` (факт), `limitBytes`, `receivedBytes`, `reason` |

Лимиты сохранены прежними по значениям: 12 вложений на чат, 30 файлов за прогон, 40 МиБ на файл,
200 МиБ на прогон. Это значения зонда, а не продуктовые лимиты экспортёра; продуктовые лимиты будут
считаться по замерам.

Проверка этапа — тест **09 PASS**, семь подпроверок на моках:

1. `content-length` 999 КиБ при лимите 2000 б → `content_length_over_limit`, поток не открывался,
   в итоги не засчитано;
2. `content-length` отсутствует, тело 4000 б, чанки по 4 б → `stream_over_limit`, `receivedBytes ≤ 2000`,
   `reader.cancel` вызван (`cancels ≥ 1`), `getReader` вызван, в итоги не засчитано,
   `countedInTotals: false`;
3. общий лимит 1500 б при файле 900 б: ровно 1 успешная загрузка (900 б, `contentLengthMatchesActual: true`),
   остальные — `SKIPPED_LIMIT` с причиной по лимиту, итоги `filesDownloaded = 1`, `900 б`;
4. `MAX_TOTAL_FILES = 1` → к CDN ушёл ровно **1** запрос, остальные ассеты (включая вторую фазу)
   получили `file_count_limit`;
5. `maxConcurrentDownloads = 1` — последовательность подтверждена счётчиком;
6. в отчёте напечатаны фактические лимиты (2000 б на файл после подстановки, 209 715 200 б на прогон,
   12 на чат, 1 на прогон);
7. тело без `ReadableStream` → `UNSUPPORTED / stream_unavailable`, ничего не засчитано.

Побочное открытие этапа: ранее повторная фаза вообще не имела лимитов и портила статистику
`downloadAttempts` — теперь она под теми же ограничениями (полное отключение фазы — этап 5).

Снимок после этапа 4: `probe\archive_a2_stages\stage4_nocookie.js` — 39 471 б, 790 строк;
тестовая обвязка на этом этапе: `stage4_tests.mjs` (33 347 б).

---

## Этап 5. Устранение неограниченной повторной загрузки — выполнено

Что изменено в `chatgpt_asset_probe_nocookie.js`:

| Было | Стало |
|---|---|
| безусловная пауза `RECHECK_AFTER_MS = 90000` и повторная загрузка до 5 файлов целиком | константа удалена; фаза живости ссылки выключена по умолчанию (`LINK_LIFETIME_CHECK = false`) |
| повторная загрузка через `arrayBuffer()` без ограничений | `GET` с заголовком `Range: bytes=0-1023` + потоковое чтение не более 1025 байт |
| HEAD не использовался | HEAD не используется и сейчас: поддержка HEAD этим endpoint'ом не подтверждена, а задание разрешает HEAD только после подтверждения. Выбран ограниченный GET Range с контролем ответа |
| лимитов второй фазы не было | отдельный потолок `LINK_LIFETIME_MAX_BYTES_TOTAL = 16 МиБ`, `LINK_LIFETIME_MAX_ASSETS = 5`, объём учитывается в `linkBytesTotal` и попадает в отчёт |
| способ проверки не фиксировался | в отчёте `linkLifetimeCheck.method`, `rangeHonored` (по `206`/`content-range`), `receivedBytes`, `fullFileDownloaded`, `firstBytesUnchanged` |
| время ожидания жёсткое | `LINK_LIFETIME_DELAY_MS = 0` (сразу) и `LINK_LIFETIME_WAIT_USER` — ожидание явного сигнала `window.__se_probe_go = true`, то есть измерение по событию, а не обязательная пауза |

Отчёт в обычном прогоне: `linkLifetimeCheck = { enabled: false }`, повторных запросов байтов нет.

Зафиксированное ограничение включённого режима: заголовок `Range` не входит в список «простых»
CORS-заголовков, поэтому браузер перед таким GET может послать предварительный `OPTIONS`
(preflight). Это делает браузер, а не код зонда; в обычном прогоне (`LINK_LIFETIME_CHECK = false`)
никаких запросов, кроме GET, не возникает. Проверить фактическое поведение можно только живым прогоном.

Проверка этапа — тест **10 PASS**, четыре подпроверки:

1. обычный прогон: все URL загрузок уникальны (ни одного повторного запроса байтов),
   `linkLifetimeCheck.enabled = false`, результатов второй фазы нет, таймеров ≥ 10 с нет,
   в отчёте нет упоминаний 90-секундной паузы, заголовка `Range` не отправлялось;
2. включённый режим: ровно по одному Range-запросу на результат, `Range: bytes=0-1023`,
   ответ `206` + `content-range` зафиксирован как `rangeHonored: true`, прочитано ≤ 1024 байт,
   `fullFileDownloaded: false`, `arrayBuffer` не вызывался, суммарно ≤ 5 КиБ,
   сигнатура первых байтов ≤ 24 hex-символов и `firstBytesUnchanged: true`;
3. сервер игнорирует Range (`200`, `content-length: 20000`): `rangeHonored: false`,
   чтение не начинается (`SKIPPED_LIMIT`, `receivedBytes = 0`) — полный файл не скачивается;
4. Range проигнорирован и `content-length` отсутствует: поток обрывается на ≤ 1025 байт
   (`stream_over_limit`), `reader.cancel` вызван, объём второй фазы ≤ 5 КиБ.

Снимок после этапа 5 совмещён со снимком этапа 6 (см. ниже): `stage6_nocookie.js`, потому что
правки этапа 6 вносились в тот же блок отчёта и разделяющий снимок не сохранялся.

---

## Этап 6. Минимизация данных отчёта — выполнено

Что изменено в `chatgpt_asset_probe_nocookie.js`:

| Данные | Как стало |
|---|---|
| uuid беседы (`convId`) | `chatLabel` вида `chat_1`, `chat_2`; признак `currentTab` |
| идентификаторы узлов и сообщений (`nodeId`, `id`, `parentId`) | `nodeLabel` / `messageLabel` / `parentLabel` вида `message_1`; связь «сообщение → вложение» сохранена через `refs[].assetLabel` |
| идентификатор ассета (`id`) | `assetLabel` вида `asset_1`; реальные id живут только в памяти зонда (`refIdsSeen`) |
| `meta.title` | удалён, вместо него `titlePresent` (булево) |
| `nameFromApi` (имя файла) | `namePresentApi` (булево); `name`/`file_name`/`filename` из ответа API больше не сохраняются (`REF_FIELDS` их не содержит) |
| `signedUrl` (объект с путём) | `downloadTarget`: `host`, `path` с нормализованными сегментами (`<id>`), `pathSegments`, `queryParamNames` — без значений параметров |
| `dom.linksToFiles` (сырые href) | `dom.fileLinks`: количество, расширения, хосты |
| `report.page` (абсолютный адрес) | `pagePathTemplate` (`/c/<id>`) |
| `requests.byPath` | ключи нормализуются `templatePath()`: смысловым считается только сегмент без цифр, остальные → `<id>` |
| вывод в консоль | сначала одна краткая строка сводки (только счётчики и статусы), затем тот же минимизированный JSON; никаких отдельных дампов названий, имён или адресов |
| техническое сопоставление id | `DIAGNOSTIC_IDS = false` по умолчанию; при `true` в отчёт добавляется раздел `idAliases` (`chat_1 → реальный uuid`) |
| эталон из архива | `expectedFromArchive` сокращён до `sizeBytes` + `sha256Known`; сверка остаётся булевой (`shaEqualsArchive`, `sizeEqualsArchive`) |
| первые байты | `head(buf, 12)` — не более 12 байт (24 hex-символа) |

Проверка этапа — тест **07 PASS**, шесть подпроверок:

1. автопоиск запрещённого в отчёте и в выводе консоли: uuid бесед, `file_…`, название беседы,
   имя файла, значение подписи из query, абсолютные URL, текст реплики, href из DOM,
   запрещённые имена полей (`title`, `name`, `file_name`, `filename`, `href`, `url`, `convId`,
   `nodeId`, `signedUrl`, `bodySample` и др.) — ничего не найдено;
2. первые байты во всех записях ≤ 24 hex-символов;
3. локальные обозначения присутствуют: `chat_1`, `asset_1`, метки сообщений;
4. связи сохранены: каждый `assetLabel` из выборки сообщений встречается среди записей ассетов
   этого чата, метка родителя не совпадает с меткой сообщения;
5. маршруты в статистике запросов нормализованы (`/conversation/<id>`, `/files/download/<id>`);
   адрес загрузки содержит hostname, нормализованный путь и имена параметров без значений;
6. диагностический режим: по умолчанию `idAliases === null`; при явном включении
   `idAliases.chat.chat_1` и `idAliases.asset.asset_1` соответствуют идентификаторам из настроек,
   а в остальной части отчёта эти идентификаторы не встречаются.

Снимок после этапа 6: `probe\archive_a2_stages\stage6_nocookie.js` — 46 861 б, 888 строк;
тесты этого этапа: `stage6_tests.mjs`. SHA256 зонда на момент снимка:
`EE88181869BF233CCEE68BD8B92F52EFD3CA246AB6FDBB183A1E2493C45E8A88`.

---

## Этап 7. Контроль контекста запуска — выполнено

Что изменено в `chatgpt_asset_probe_nocookie.js`:

| Проверка | Где и как |
|---|---|
| `https:` | `location.protocol !== 'https:'` → `not_https` |
| точный хост | `location.hostname !== API_HOST` (`chatgpt.com`) → `host_not_allowlisted`; поддомен `www.chatgpt.com` и «хвост» `chatgpt.com.evil.example` не принимаются, совпадения по подстроке `openai` в коде нет |
| порт страницы | `location.port` разрешён только `443` → `unexpected_port` |
| share-страница | `^/(share\|s)(/\|$)` → `share_page`: публичная страница, своего чата с токеном там нет |
| признак авторизованного интерфейса | на странице должен быть SSR-токен (`#client-bootstrap` / `__NEXT_DATA__`); иначе `no_auth_token` |
| итог | `INVALID_CONTEXT`: зонд возвращает короткий отчёт и **не делает ни одного запроса**, cookie не читает, элементы страницы не создаёт |
| обычный прогон | в отчёте появился блок `context: { status: 'OK', issues: [] }` — подтверждение, что проверка пройдена до первого запроса |

Удалено: `SCROLL_TEST` (константа, весь блок прокрутки, поле `scrollTest` в отчёте). Прокрутка
меняла состояние страницы, а нужные данные (структура беседы и вложений) берутся из backend-api.
В шапке файла зафиксировано, что запуск — ручной: авторизованная вкладка `chatgpt.com` с открытым
конкретным чатом → Console → вставить файл целиком.

Проверка этапа — тест **05 PASS** (пять подпроверок) и **12 PASS**:

1. `http:` / чужой hostname / `/share/…` → 0 запросов, в отчёте `INVALID_CONTEXT`, cookie не читались,
   элементы не создавались;
2. `chatgpt.com.evil.example`, `www.chatgpt.com`, порт `:8443`, короткий путь `/s/…` → тот же отказ;
3. страница без токена → `INVALID_CONTEXT` с причиной `no_auth_token`, 0 запросов;
4. корректный контекст → `context.status = OK`, запросы есть;
5. статически: нет нестрогих сравнений hostname (`includes/startsWith/endsWith/indexOf`) и нет
   совпадения по подстроке `openai`; в коде нет присваиваний `location`, `location.assign/replace`
   и `window.scroll`, записей `scrollTop` при прогоне не происходит.

Снимок после этапа 7: `probe\archive_a2_stages\stage7_nocookie.js` — 48 000 б, 894 строки;
тесты: `stage7_tests.mjs`. SHA256 зонда: `DBC43116D4CB2EF24E93FC0E41C7F7CD6113F4A712CB528B45F62D90C87881FB`.

Текущий результат полного набора тестов: **11 тестов, провалено 0** (01–10, 12; тест 11 входит
в состав проверки этапа 8 и описан вместе с ней).

---

## Этап 8. Обезвреживание CDP-запускателя — выполнено

Что изменено в `cdp_probe_run.mjs` (файл переписан целиком, 139 → 223 строки):

| Было | Стало |
|---|---|
| запускался сразу | выключен по умолчанию: без `CDP_ALLOW=1` печатает «ОТКАЗ: запускатель выключен (это ожидаемое состояние)» и завершается с кодом 2, к порту не обращается |
| `argUrl` позиционными аргументами | явные флаги `--target=<id>`, `--check`, `--probe=<файл>`, `--out=<файл>`, `--port=NNNN`, `--help` |
| `(await http('/json/list')).find(t => t.type === 'page')` — первая попавшаяся вкладка | `list.find((t) => t.id === targetId)`: без переданного id работа не идёт; при неизвестном id печатается список доступных id и отказ |
| при отсутствии вкладки — `Target.createTarget` и ожидание 1,5 с | автосоздания вкладок нет: отказ |
| `Page.enable`, `Page.navigate`, ожидание `Page.loadEventFired` (до 30 с) | ни `Page.enable`, ни `Page.navigate`, ни ожидания загрузки: вкладка остаётся в том состоянии, где её оставил человек; выполняется только `Runtime.enable` + один `Runtime.evaluate` |
| в `LOGIN_CHECK` были `title` (название беседы) и `bodySample` (240 символов `innerText`) | diagnostics возвращает только булевы признаки и счётчики: `https`, `host`, `isSharePage`, `hasComposer`, `hasBootstrapScript`, `hasAuthToken`, `turnNodes`; текста страницы в выводе нет |
| адрес не проверялся | до выполнения кода: target обязан иметь тип `page`, адрес — `https:`, hostname ровно `chatgpt.com`, не share-страница; иначе отказ |
| сводка отчёта печатала `id`, `ok`, `messageCount` (полей такого уже нет) | сводка печатает `chatLabel`, статусы `fetch/auth`, количества, `downloaded`, `requests.total`, `cdnHostsSeen` |
| порт по умолчанию 9223 | 9222 (порт по умолчанию у Chrome/Brave с `--remote-debugging-port`), переопределяется `--port` или `PROBE_PORT` |

Поведение проверено запуском без браузера (обращений к порту в этих ветках нет):

```
node cdp_probe_run.mjs --target=abc --check        → ОТКАЗ: запускатель выключен … (exit=2)
CDP_ALLOW=1 node cdp_probe_run.mjs --check         → ОТКАЗ: не передан --target=<id> … (exit=2)
```

Проверка этапа — тест **11 PASS**, шесть подпроверок (аудит кода без комментариев, строк справки
и самих выражений для страницы):

1. есть явный выключатель `CDP_ALLOW` и отказ с ненулевым кодом возврата;
2. target сопоставляется только с переданным id; нет автовыбора страницы, нет `Target.createTarget`,
   `Target.attach`, `Target.activateTarget`, нет `Page.navigate` и присваиваний `location`,
   нет `Page.enable`/ожидания загрузки;
3. в коде нет `bodySample`, `innerText`, `document.title`; нет `document.cookie`,
   `Network.getCookies`, `Network.setCookie`; в блоке diagnostics нет текста страницы,
   но есть все булевы признаки;
4. адрес вкладки проверяется строго: `https:`, `API_HOST = 'chatgpt.com'` равенством, share-вкладка отвергается;
5. сводка отчёта не печатает `c.id`, `c.title`, `c.name`, `convId`; использует `chatLabel`;
6. код обращения к отладочному порту находится после веток отказа.

Снимок после этапа 8: `probe\archive_a2_stages\stage8_cdp.mjs` — 9 805 б, 223 строки,
SHA256 `EFEC96164BF38B8A71630613BCFC7A0A72F478F5CCE624A4A7D51E1F2D289E41`;
тесты: `stage8_tests.mjs`. Зонд на этом этапе не менялся (последний снимок — этап 7).

---

## Этап 9. Комплексные тесты и аудит — выполнено

### 9.1 Прогон всех проверок

```
node probe_a2_tests.mjs
01 PASS  статические гарантии: нет cookie, include, нигет-методов
02 PASS  запросы: только GET, credentials omit, Bearer только на API
03 PASS  401 на беседу -> AUTH_REQUIRED, без обхода через cookie
04 PASS  скачивание байтов: без Authorization и без cookie, адрес в allowlist
05 PASS  контекст: чужой hostname / http / share -> отказ до запросов
06 PASS  дополнительные маршруты: статус авторизации зафиксирован
07 PASS  минимизация отчёта: нет названий, имён, url, id, текстов
08 PASS  allowlist адресов, порты, userinfo, redirect, небезопасные id
09 PASS  потоковые лимиты объёма
10 PASS  повторная загрузка выключена по умолчанию
11 PASS  CDP-запускатель: выключен по умолчанию, без автовыбора, навигации и текста страницы
12 PASS  зонд не меняет DOM и не прокручивает

итого: 12 тестов, провалено 0
```

Каждая проверка закрыта конкретным требованием задания; соответствие такое (левая колонка —
что именно доказывается, а не только название теста):

| № | Требование задания | Чем доказано |
|---|---|---|
| 01 | cookie не читаются и не передаются, `credentials:'include'` нет, методов кроме GET нет | статический аудит исходника + геттер `document.cookie` в стабе бросает `COOKIE_READ_FORBIDDEN` |
| 02 | все обращения — GET; `credentials:'omit'`; Bearer только на `chatgpt.com/backend-api` | перехват всех `fetch` в стабе: метод, `credentials`, имена заголовков, хост |
| 03 | отказ endpoint'а фиксируется как `AUTH_REQUIRED` с фактическим статусом, без самодеятельности с cookie | мок `401` на беседу: в отчёте `fetch.status=401`, `auth=AUTH_REQUIRED`, запросов с cookie нет |
| 04 | скачивание по подписной ссылке без `Authorization` и без cookie | перехват запроса на CDN: ни `Authorization`, ни `Cookie` |
| 05 | контроль контекста до первого запроса (`INVALID_CONTEXT`) | `http:`, чужой hostname, `chatgpt.com.evil.example`, `www.chatgpt.com`, порт `:8443`, `/share/…`, `/s/…`, страница без токена → 0 запросов; в корректном контексте `context.status = OK` |
| 06 | дополнительные маршруты API: существует ли endpoint и пущен ли он без авторизации | моки `files/<id>/metadata`, `files`, `conversations/<id>/files` → `status` + `auth` |
| 07 | минимизация отчёта и вывода | автопоиск запрещённого (uuid, `file_…`, название беседы, имя файла, значение подписи, абсолютные URL, href, текст реплики, запрещённые имена полей) + метки `chat_1`/`message_1`/`asset_1` и сохранение связей + нормализация маршрутов + `DIAGNOSTIC_IDS` |
| 08 | allowlist хостов и маршрутов, запрет `includes("openai")`, manual redirect | `UNTRUSTED_DOWNLOAD_HOST` при пустом allowlist, `not_https`, `unexpected_port`, `userinfo_in_url`, отказ по redirect, отказ `asset_id_unsafe`, нормализованный `byPath` |
| 09 | реальные лимиты и потоковое чтение | `content_length_over_limit` до чтения, `stream_over_limit` с `reader.cancel`, общий лимит по последовательности, лимит числа файлов по попыткам, `maxConcurrentDownloads = 1`, `UNSUPPORTED` без потока |
| 10 | нет неограниченной повторной загрузки | обычный прогон: все URL загрузок уникальны, `linkLifetimeCheck.enabled = false`, нет таймеров ≥ 10 с; включённый режим: ограниченный GET Range (≤ 1024 б, `206`/`content-range`), при игнорировании Range полный ответ не читается |
| 11 | CDP-запускатель обезврежен | аудит кода (без комментариев и строк справки): `CDP_ALLOW`, отказ с кодом 2, только `--target` по id, нет `Target.createTarget`/`Page.navigate`/`Page.enable`, нет `bodySample`/`innerText`/`document.title`, нет cookie, строгая проверка адреса вкладки; плюс фактические запуски без браузера (два отказа, exit=2) |
| 12 | страница не меняется | счётчик записей `scrollTop` = 0, нет `location`-присваиваний и `window.scroll`; единственный `createElement` — временная `<a>` для отчёта |

Тесты работают только на стабах: network-обращений нет, реальный ChatGPT не опрашивался,
профиль браузера не читался и не копировался. Проверка «нет сети» обеспечена тем, что в тестовой
обвязке подменены `fetch`, `WebSocket` не используется, а стаб `fetch` возвращает заготовки.

### 9.2 Сопоставление пунктов задания с участками кода

| Пункт задания | Участок кода (`chatgpt_asset_probe_nocookie.js`) |
|---|---|
| §2 cookie и авторизация | шапка-словарь статусов; `deviceId = null` и комментарий о cookie; `credentials: 'omit'` во всех четырёх `fetch`; `authClass()`; поля `auth` в `chat.fetch`, `filesDownloadEndpoint`, `endpointProbes`; `cookiePolicy` в отчёте |
| §3 адреса и redirect | `API_HOST`/`API_PORT`/`API_ROUTES`/`CDN_HOSTS`/`CDN_FOLLOW_REDIRECTS`/`MAX_REDIRECT_HOPS`; `targetIssues()`; `safeId()`; `redirect: 'manual'` в `api()` и `fetchDownload()`; `requests.blocked`; `addressPolicy` и `cdnHostsSeen` в отчёте |
| §4 лимиты загрузки | `MAX_FILES_PER_CHAT`/`MAX_TOTAL_FILES`/`MAX_BYTES_PER_FILE`/`MAX_TOTAL_BYTES`; `readCapped()`; счётчики `downloadAttempts`/`downloadsInFlight`/`downloadsMaxInFlight`; пред-проверки `api_declared_over_file_limit`, `total_limit_before_start`, `file_count_limit`; `report.downloaded` с фактическими лимитами |
| §5 повторная проверка | `LINK_LIFETIME_CHECK = false` и группа `LINK_LIFETIME_*`; фаза живости с `GET Range` и `readCapped`; `rangeHonored`/`contentRange`/`fullFileDownloaded`; `abort()`/`LINK_LIFETIME_WAIT_USER` вместо жёсткой паузы |
| §6 минимизация отчёта | `templatePath()`, `labelOf()`, `REF_FIELDS`/`NAME_FIELDS`, `downloadTarget` (`urlShape`), `titlePresent`, `namePresentApi`, `dom.fileLinks`, `pagePathTemplate`, нормализация `requests.byPath`, `idAliases` при `DIAGNOSTIC_IDS`, `head(buf, 12)` |
| §7 вспомогательный запускатель | `cdp_probe_run.mjs`: `CDP_ALLOW`, `--target`, `refuse()`, `usage()` |
| §8 контроль контекста | блок `contextIssues` + `abortReport`/`abort` до первого `fetch`; `context` в отчёте; отсутствие `SCROLL_TEST` |
| §9 словарь статусов | закомментированный словарь в шапке; `authClass`; статусы в `fetchDownload`, `readCapped`, `probeAsset`, `abortReport` |

### 9.3 Полные diff-ы

* `probe\archive_a2_stages\diff_nocookie_full.diff` — 51 730 б: `+529 / −130` строк против
  `archive_a2_original\chatgpt_asset_probe_nocookie.js` (24 848 б → 50 053 б, 512 → 911 строк);
* `probe\archive_a2_stages\diff_cdp_full.diff` — 15 567 б: `+185 / −101` строк против
  `archive_a2_original\cdp_probe_run.mjs` (5 321 б → 9 805 б, 139 → 223 строки).

### 9.4 Что осталось неизменным (проверено после всех правок)

| Объект | Проверка | Результат |
|---|---|---|
| рабочий архив чатов | `G:\Strawberry\chats` | 2 114 файла, 197 845 972 б — совпадает с этапом 0 |
| вложения архива | `G:\Strawberry\attachments` | 332 каталога, 1 233 файла, 422 854 521 б — совпадает с этапом 0 |
| импортёр | `import2.py` | SHA256 `3C449F337D57B8CD…`; `importer_v2` — 89 файлов, не менялся |
| форк ACE | `StrawberryEdition\ace-fork` | HEAD `cf19e7185ff9c0f11e0f0dbd58a74686f634eb16`, `git status --porcelain` пуст |
| upstream ACE | `StrawberryEdition\ace-src` | HEAD `cf19e71…`, рабочее дерево чисто |
| исходный зонд A-2 | `probe\chatgpt_asset_probe.js` | SHA256 `DB14D9BFF45F0EF9…`, 24 845 б — как на этапе 0 |
| эталонная таблица | `probe\archive_reference.json` | 37 400 б, SHA256 `4F936515A2A1B34A…` |
| копия исходника зонда | `probe\archive_a2_original\chatgpt_asset_probe_nocookie.js` | SHA256 `3ED2E04DB4EF2938…` — совпадает с этапом 0 |
| копия исходника запускателя | `probe\archive_a2_original\cdp_probe_run.mjs` | SHA256 `E681BA14903C2106…` — совпадает с этапом 0 |
| профиль браузера, cookies | не читались и не копировались; браузер с CDP не запускался | подтверждено тестами 01/11/12 и отсутствием таких операций в коде |
| импорт не выполнялся | ни одного вызова `import2.py` в рамках задачи | — |
| зонд на рабочем архиве не запускался | живой прогон в Brave не делался | — |

Список файлов, изменённых с начала работы (вне `ace-fork`/`ace-src`): только
`StrawberryEdition\PROBE_A2_AUDIT_AND_FIX.md` и каталог `StrawberryEdition\probe`
(два рабочих файла, тестовая обвязка, архивные копии, снимки этапов, diff-ы).

### 9.5 Итоговые SHA256 исправленных файлов

| Файл | Размер | SHA256 |
|---|---|---|
| `probe\chatgpt_asset_probe_nocookie.js` | 50 053 б, 911 строк | `2320F93F3B663A5F11BC9B193A238A7BB0F19D29CDABAAC4E3286D53B0744225` |
| `probe\cdp_probe_run.mjs` | 9 805 б, 223 строки | `EFEC96164BF38B8A71630613BCFC7A0A72F478F5CCE624A4A7D51E1F2D289E41` |
| `probe\probe_a2_tests.mjs` (тестовая обвязка) | 51 597 б | — |

Хэши зонда пересчитаны после финальной правки этапа 9 — в шапке файла приведён словарь статусов
и исправлены утверждения, которые перестали соответствовать коду (было: «CDN-хост, который сам
ChatGPT вернул в download_url»; стало: CDN скачивается только если он явно перечислен в
`CDN_HOSTS`, при пустом списке — `UNTRUSTED_DOWNLOAD_HOST` и hostname в `cdnHostsSeen`;
упоминание `hasDeviceId` убрано, device id не читается; добавлены пункты про лимиты объёма,
отсутствие повторной загрузки и отсутствие прокрутки). Поведения эта правка не меняет:
тесты 01–12 после неё — 12 PASS, 0 FAIL. Снимок этапа 9:
`probe\archive_a2_stages\stage9_nocookie.js`, `stage9_tests.mjs`.

---

## Этап 10. Остановка и передача результата

Зонд приведён в состояние, пригодное для контролируемого ручного запуска в Brave:
авторизованная вкладка `chatgpt.com` с открытым конкретным чатом → Console → вставить
`chatgpt_asset_probe_nocookie.js` целиком. Живой прогон на этом этапе не выполнялся.

### Что осталось неограниченным и что не подтверждено

1. **`CDN_HOSTS = []` по умолчанию.** Первый живой прогон, скорее всего, ничего не скачает:
   он зафиксирует `UNTRUSTED_DOWNLOAD_HOST` и реальный hostname в `cdnHostsSeen`. Это
   сознательный выбор: allowlist пополняется списком после фактического замера. Нужен второй
   прогон с заполненным списком, чтобы получить байты, sha256 и сравнение с архивом.
2. **Работа `backend-api` без cookie не подтверждена.** Это покажет только живой прогон.
   При 401/403 зонд честно вернёт `AUTH_REQUIRED` и не пойдёт читать cookie.
   Запрос на чтение не-секретного cookie `oai-did` не выполнялся и не требуется до фактического отказа.
3. **Поддержка `Range` endpoint'ом CDN не подтверждена** (режим `LINK_LIFETIME_CHECK` выключен).
   Зонд распознаёт игнорирование Range по `200` вместо `206` и не читает полный ответ.
   При включении режима браузер может послать предварительный `OPTIONS` (CORS-preflight) —
   это делает браузер, а не код зонда; в обычном прогоне таких запросов нет.
4. **HEAD не использовался** — поддержка HEAD этим endpoint'ом не проверялась, а задание
   разрешает HEAD только после подтверждения.
5. **Значения лимитов (12 вложений на чат, 30 файлов за прогон, 40 МиБ на файл, 200 МиБ на прогон)**
   — значения зонда для безопасного замера, а не продуктовые лимиты ChatGPT. Продуктовые лимиты
   нужно измерять по живым ответам (`/backend-api/files`, `conversations/<id>/files`, размеры).
6. **Полнота находки вложений не гарантирована.** Зонд ищет ссылки в `content.parts`
   (`asset_pointer`, `image_asset_pointer`, `type`) и в `metadata` (`attachments`,
   `attachment_ids`, `content_references`). Если в реальном чате вложение описано иначе,
   зонд его не найдёт; перекос видно по `attachmentRefsTotal` против `uniqueAssetRefs` и по
   `metadataKeys`/`apiObjectKeys` в отчёте.
7. **Сигнатура первых 12 байт — не криптографическая проверка идентичности файла.** Полную
   идентичность даёт только `sha256` всей скачанной последовательности байт; при прерывании
   потока hash не вычисляется.
8. **Вопрос подгрузки истории оставлен открытым.** После удаления `SCROLL_TEST` DOM-обследование
   не прокручивает страницу, поэтому в длинной беседе оно описывает только видимую часть.
   На данные зонда это не влияет: структура беседы и вложений берётся из backend-api.
9. **`DIAGNOSTIC_IDS = true` печатает реальные идентификаторы** в `idAliases`. Такой отчёт нельзя
   пересылать как есть; по умолчанию режим выключен.
10. **Отчёт остаётся локальным файлом** (`se_probe_<время>.json` в «Загрузках»). Зонд ничего никуда
    не отправляет, кроме самих GET-запросов к `chatgpt.com` и разрешённому CDN.

### Чего сделано не было (границы задачи)

* зонд не запускался в Brave и не запускался на рабочем архиве;
* импорт не выполнялся;
* браузер с CDP не запускался, профиль Brave не копировался, cookie не читались;
* `chatgpt_asset_probe.js` (исходная копия A-2), импортёр, ACE fork/upstream, frontend/backend
  StrawBerry, рабочий архив и эталонные SHA256 не изменялись (подтверждено в разделе 9.4).

### Следующий шаг по задаче A-2

Отдельное разрешение на живой прогон в авторизованной вкладке Brave. Порядок, который
предусматривает зонд: прогон №1 с пустым `CDN_HOSTS` (структура, статусы, `cdnHostsSeen`),
затем прогон №2 со списком хостов из `cdnHostsSeen` (байты, sha256, сравнение с
`archive_reference.json`), при необходимости — включить `LINK_LIFETIME_CHECK` для проверки
живости подписных ссылок.

---

## Раунд 2. Корректирующие правки по замечаниям ревью (этапы 11–17)

Решение владельца после второй проверки: «A-2 пока не принят», переход к Live-тесту не разрешён.
Требовалось точечно исправить семь пунктов, не переписывая архитектуру. Каждый пункт — отдельный
патч, со снимком в `archive_a2_stages` и регрессионным тестом; живых запусков не было.

### Этап 11. Учёт частично полученных байтов и общий лимит прогона

Дефект: `MAX_TOTAL_BYTES` сверялся только с `downloadedBytesTotal`. Загрузка, оборванная на
середине (лимит на файл, обрыв потока, ошибка чтения), сеть израсходовала, но лимит прогона не
расходовала — суммарно из сети могло прийти больше потолка.

* `chatgpt_asset_probe_nocookie.js:225` — счётчик `bytesReadFromNetwork`, который растёт в
  `readCapped` на каждый полученный чанк **до** проверки лимита (чанк, на котором лимит превышен,
  тоже учтён);
* `:663` — остаток на загрузку: `min(MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES - bytesReadFromNetwork)`;
* `:667` — отказ до начала чтения фиксируется как `SKIPPED_LIMIT / total_limit_before_start` с
  полями `limitBytes`, `bytesReadFromNetwork`, `downloadedBytesTotal`;
* `:1006` — в отчёте две разные величины: `bytesReadFromNetwork` (именно он ограничивает прогон) и
  `downloadedBytesTotal` (принятые байты); в консоли печатаются обе.

Тест 13 (`probe_a2_tests.mjs:714`): оборванная загрузка расходует бюджет; после исчерпания бюджета
новых запросов к CDN нет; отбраковка по `content-length` не тратит ни байта файла; пара счётчиков
присутствует в отчёте.

### Этап 12. Корректность SHA256 при несовпадении Content-Length

Дефект: буфер предвыделялся по `content-length`, а хэш считался по всему буферу. Если сервер отдал
тело короче заявленного, хвост буфера — нули, и `sha256` в отчёте описывал не те байты, которые
легли бы в архив.

* `:437` — после чтения буфер урезается до фактических байт: `if (bytes && got !== bytes.length)
  bytes = bytes.subarray(0, got)`;
* `readCapped` возвращает `bufferBytes`, в запись успешной загрузки добавлено `hashOverBytes`
  (`:712`) — сколько байт реально участвовали в хэше; при коротком теле это меньше
  `content-length`, несоответствие по-прежнему видно в `contentLengthMatchesActual`.

Тест 14 (`:744`): тело короче заявленного (900 против 1200) — `hashOverBytes === 900`, `sha256`
совпадает с `node:crypto` по фактическим байтам и **не** совпадает с хэшем предвыделенного буфера;
тело длиннее заявленного (900 против 500) — хэш тоже по фактическим байтам.

### Этап 13. Отмена тел ответов при раннем отказе

Дефект: при отказе (redirect не разыменовывается, не-JSON ответ, HTTP-ошибка, отбраковка по
`content-length`) тело ответа оставалось неотработанным и дочитывалось браузером — то есть
расходовало сеть и память после того, как результат уже не нужен.

* `:256` — хелпер `discardBody(resp)`: сначала `body.cancel()`, при отсутствии метода —
  `getReader().cancel()`, исключения гасятся (поток мог быть уже закрыт);
* вызовы: `:331` (3xx на API), `:344` (исчерпан бюджет JSON), `:359` (не-JSON тело), `:383`
  (отбраковка по `content-length`), `:498` (3xx подписной ссылки), `:521` (HTTP-ошибка загрузки);
* в `catch` потока: `reader.cancel('read_failed')` (`:401`) и `reader.cancel('over_limit')` (`:415`).

Тест 15 (`:771`): счётчик `cancels` в стабах подтверждает закрытие в четырёх ситуациях (не-JSON,
3xx, 404, отбраковка по `content-length` — причём чтение не начиналось), плюс статическая проверка,
что в коде не меньше пяти мест закрытия тел.

### Этап 14. Токены из нормализованных путей отчёта

Дефект: старое правило `PLAIN_SEGMENT` считало сегмент «смысловым» по форме (буквы), поэтому
подписной сегмент вида `abcDEF` оставался в пути как есть, и путь отчёта частично раскрывал
подписную ссылку.

* `:121` — явный список литеральных слов `PATH_WORDS` (только служебные сегменты маршрутов),
  `:122` — `templatePath`: любой другой сегмент заменяется на `<id>`;
* `PLAIN_SEGMENT` удалён (тест 16 проверяет, что правило не вернулось);
* `:746` — сам список попадает в отчёт (`pathWordsAllowlist`), чтобы нормализацию можно было
  проверить, не глядя в код.

Тест 16 (`:812`): подписной сегмент фикстуры (`sigonlytoken`) не встречается в отчёте; путь
загрузки — `/<id>/<id>/<id>/<id>/<id>` при пяти сегментах; путь страницы — `/c/<id>`; маршруты API
остались читаемыми (`GET /backend-api/conversation/...` и т. п.).

### Этап 15. Реальные UUID в диагностике CDP-запускателя

Дефект: `cdp_probe_run.mjs` печатал адрес вкладки целиком (`location.pathname`), то есть реальный
uuid беседы, а диагностика `CHECK_ONLY` возвращала сырой `pathname`. В самом файле uuid не было —
расхождение проявлялось только в выводе в рантайме.

* `cdp_probe_run.mjs:54–55` — те же правила нормализации: `PATH_WORDS` + `pathShape(pathname)`;
* `:116` — `pageUrl = протокол + host + pathShape(pathname)`; он же в `:137` (`target: … адрес: …`)
  и в сообщениях отказа (`:118`, `:122`, `:126`);
* `:225–226` — в `CHECK_ONLY` вместо сырого пути: `origin` (протокол + хост) и `pathTemplate`
  (сегменты не из списка свёрнуты в `<id>`).

Тест 17 (`:829`): `PATH_WORDS`/`pathShape` извлекаются из файла регуляркой и вызываются как есть;
поведение `CHECK_ONLY` прогоняется в стабе — в выводе нет ни одного uuid-паттерна, `origin` и
`pathTemplate` корректны (отдельно проверен share-случай).

### Этап 16. Размер JSON-ответа и таймауты ожидания ответа

Согласовано с владельцем («лимит + таймаут»). Дефект: `r.json()` читал ответ целиком без
ограничения, а запросы могли висеть неограниченно.

* `:84–86` — `MAX_JSON_BYTES = 4 MiB`, `API_HEAD_TIMEOUT_MS = 30 с`, `DOWNLOAD_HEAD_TIMEOUT_MS = 120 с`;
* `:270–301` — `fetchHead`: `AbortController` + `setTimeout`, таймер снимается после получения
  заголовков, то есть **тело большого файла таймером не обрывается** (его ограничивает лимит байт);
  при срабатывании таймера ошибка помечается `seHeadTimeout`;
* `:341–347` — JSON читается тем же `readCapped`, а предел для него —
  `min(MAX_JSON_BYTES, MAX_TOTAL_BYTES - bytesReadFromNetwork)`; исход разбора фиксируется в
  `chat.fetch.jsonRead` (`status`, `reason`, `receivedBytes`, `declaredSize`, `limitBytes`);
* `:364`, `:491` — сетевые отказы различаются: `request_timeout` / `download_timeout` вместо
  безликого `NETWORK_ERROR`;
* `:745` — в отчёт попадает `abortControllerSupported`: если браузер без `AbortController`,
  таймаутов нет, и это видно по отчёту.

Побочный дефект, найденный уже в ходе этапа (фиксирую честно): когда JSON перешёл на потоковое
чтение, выяснилось, что **лимит прогона мог превышаться самими JSON-ответами** — в тесте 9.3 сеть
дала 9649 б при потолке 6000. Причина: бюджет прогона применялся только к загрузкам файлов.
Исправлено тем же этапом: JSON читается в остаток бюджета (`:341`), при нулевом остатке поток
закрывается и фиксируется `total_limit_before_start`; объём JSON виден в отчёте отдельно
(`apiBytesRead`, `:1007`).

### Этап 17. Регрессионные тесты на исправленные случаи

Тесты 13–18 (`probe_a2_tests.mjs:714`, `:744`, `:771`, `:812`, `:829`, `:861`) — ровно на пункты
ревью 1–5 и 7. Обвязка доработана так, чтобы тесты видели то же, что видит браузер: тела ответов
отдаются потоково (`streamBody`, `:74`), у JSON-ответов появляется `content-length`, в записях о
запросах есть признак `hasSignal` (`:169`).

Три теста (09, 10, 13) после этапа 16 пришлось **переписать под новую семантику**, а не чинить код:
их ожидания опирались на то, что лимит прогона касается только файлов, а длительные таймеры — это
только паузы. Теперь проверяются инварианты: суммарный объём сети не превышает потолок; объём JSON
не больше потолка и виден отдельно; после исчерпания бюджета новых обращений к CDN нет; «длительный
таймер» допустим только равный значению таймаута, вынесенному из самого кода, а жёстких пауз в коде
нет.

Итог прогона: **18 тестов, провалено 0** (`node probe_a2_tests.mjs`). Сеть не используется,
реального ChatGPT тесты не трогают.

### Соответствие пунктам ревью

| Пункт ревью | Где исправлено | Регрессия |
|---|---|---|
| 1. Частично полученные байты и общий лимит | зонд `:225`, `:663`, `:667`, `:1006` | тест 13 |
| 2. SHA256 при несовпадении Content-Length | зонд `:437`, `:712` | тест 14 |
| 3. Отмена тел при раннем отказе | зонд `:256`, `:331`, `:344`, `:359`, `:383`, `:401`, `:415`, `:498`, `:521` | тест 15 |
| 4. Токены в нормализованных путях | зонд `:121`, `:122`, `:746` | тест 16 |
| 5. Реальные UUID в CDP-диагностике | `cdp_probe_run.mjs:54`, `:55`, `:116`, `:137`, `:225`, `:226` | тест 17 |
| 6. Личные данные в публичных файлах и истории Git | принято владельцем («репозиторий временно приватен, там почищу») — я не проверял и не трогал | — |
| 7. Регрессионные тесты именно на эти случаи | `probe_a2_tests.mjs:714–889` | тесты 13–18 |

По пункту 6 зафиксировано здесь для полноты: в артефактах задачи есть 6 реальных uuid бесед в
блоке `CHATS` зонда (унаследованы из исходника A-2, правками не добавлены), в этом документе их
нет; литералов JWT/Bearer ни в одном артефакте нет; `html_export_real.html` создан до A-2 и
содержит реальный текст беседы.

### Итоговые SHA256 после корректирующего этапа

| Файл | Байт | Строк | SHA256 |
|---|---|---|---|
| `probe\chatgpt_asset_probe_nocookie.js` | 60 785 | 1 039 | `C50BEB54DC021F49A626B3B93C3A6B19C74911A02268F97F5B902E1826EA5CF4` |
| `probe\cdp_probe_run.mjs` | 10 690 | 235 | `3EF6F426A1DB34709DC280B1F3A6F60A6C85962C5D2BD2BAECBEBF3B5E722084` |
| `probe\probe_a2_tests.mjs` | 73 298 | 916 | `A073F93D6D343BAD962F1B820AFDBD8B119D8A6E184CCE999DF57E8BC2DFF3EF` |

Полные diff-и (исходник A-2 → текущее состояние, пересозданы после этапа 16):

* `probe\archive_a2_stages\diff_nocookie_full.diff` — 63 246 б, SHA256
  `C91B92B752912C8B39F69D2316C4964FE8A13AE42FC6235A76F9319FC69CE90A`, 668 вставок / 141 удаление;
* `probe\archive_a2_stages\diff_cdp_full.diff` — 16 180 б, SHA256
  `D9AA862C3E42CEB60FB3B8C6E44B4CBFC7ED50000ACC0478F8BA3054F9C71BDD`, 197 вставок / 101 удаление.

Снимки этапов в `probe\archive_a2_stages\`: `stage11_nocookie.js`, `stage11_tests.mjs`,
`stage13_nocookie.js`, `stage13_tests.mjs`, `stage14_nocookie.js`, `stage15_cdp.mjs`,
`stage15_tests.mjs`, `stage16_nocookie.js`, `stage16_cdp.mjs`, `stage16_tests.mjs` (плюс прежние
`stage2…stage9`). Отдельного снимка этапа 12 нет: его правки вошли в `stage13_nocookie.js`;
снимков этапов 5 и 10 нет — изменения этапа 5 видны в `stage6`, этап 10 был документом.

### Неизменность окружения (перепроверено после этапа 16)

* `G:\Strawberry\chats` — 2 114 файла, 197 845 972 б (совпадает с этапом 0);
* `G:\Strawberry\attachments` — 332 каталога, 1 233 файла, 422 854 521 б;
* `ace-fork` и `ace-src` — HEAD `cf19e7185ff9c0f11e0f0dbd58a74686f634eb16`, `git status --porcelain` пуст;
* `G:\Strawberry\import2.py` — `3C449F337D57B8CD7230BC123B0CB8CAC0D0D3BA913ED852339383617A424A0E`,
  `G:\Strawberry\importer_v2` — 89 файлов;
* эталонные копии A-2 в `probe\archive_a2_original\` не менялись; `chatgpt_asset_probe.js` —
  24 845 б, не тронут.

### Что остаётся ручным (важное ограничение)

1. **Сверка с `archive_reference.json` остаётся ручной.** Эталонные `sha256`/`size` в зонд не
   встраивались (решение владельца), поэтому поля `shaEqualsArchive` и `sizeEqualsArchive` в отчёте
   всегда `null`: человек сверяет хэш и размер из отчёта с таблицей эталона сам, автоматического
   вердикта «совпало/не совпало» зонд не выдаёт.
2. Живого прогона не было: зонд ни разу не обращался к настоящему ChatGPT, браузер с CDP не
   запускался, cookie не читались, профиль Brave не копировался, импорт не выполнялся.
3. Поведение `CDN_HOSTS = []` по умолчанию: прогон №1 обычно не скачивает файлы, а фиксирует
   `UNTRUSTED_DOWNLOAD_HOST` и hostname в `cdnHostsSeen`; allowlist пополняется только явным
   списком после замера.
4. `LINK_LIFETIME_CHECK` в прогонах №1 и №2 держится выключенным; при включении возможен
   CORS-preflight `OPTIONS` на подписную ссылку.

### Следующий шаг раунда 2

Повторная независимая проверка diff-ов владельцем. Живой прогон в авторизованной вкладке Brave —
только после неё и по отдельному разрешению: прогон №1 с пустым `CDN_HOSTS`, затем прогон №2 со
списком хостов из `cdnHostsSeen`.

## Приёмка. Независимая проверка корректирующего этапа 11–17 (23.11.2026, код не менялся)

Проверка выполнялась без запуска Brave, без обращений к настоящему ChatGPT и CDN, без чтения cookie
и без копирования профиля. Код `chatgpt_asset_probe_nocookie.js`, `cdp_probe_run.mjs` и
`probe_a2_tests.mjs` в ходе приёмки не правился: их хэши ниже совпадают с хэшами, сданными в конце
этапа 17. Измерительная обвязка — отдельный новый файл `probe\probe_a2_acceptance_audit.mjs`
(он код зонда не меняет, только наблюдает).

### Пакет приёмки: размеры и SHA256

| Файл | Размер | SHA256 |
| --- | --- | --- |
| `probe\chatgpt_asset_probe_nocookie.js` (рабочий, 1039 строк) | 60 785 б | `C50BEB54DC021F49A626B3B93C3A6B19C74911A02268F97F5B902E1826EA5CF4` |
| `probe\cdp_probe_run.mjs` (рабочий, 235 строк) | 10 690 б | `3EF6F426A1DB34709DC280B1F3A6F60A6C85962C5D2BD2BAECBEBF3B5E722084` |
| `probe\probe_a2_tests.mjs` (регрессия, 916 строк) | 73 298 б | `A073F93D6D343BAD962F1B820AFDBD8B119D8A6E184CCE999DF57E8BC2DFF3EF` |
| `probe\archive_a2_stages\diff_nocookie_full.diff` (668 вставок / 141 удаление) | 62 485 б | `44F320BD52DF79FFBBD398ED25064D50C4171DDF7F5B15387886EB4DBD6E93AA` |
| `probe\archive_a2_stages\diff_cdp_full.diff` (197 вставок / 101 удаление) | 16 073 б | `915D888CF7C200F8ADB8C680EC33009DFEAA4433E033DF32754C0B4444EBF10B` |
| `probe\probe_a2_acceptance_audit.mjs` (приёмочные измерения, новое) | 42 455 б | `47E88421F88CA3A4369AC306088BB5D3981EA4C225EB3DA9BB05CC15D7C10885` |
| `probe\probe_a2_acceptance_audit_log.txt` (лог прогона измерений, новое) | 23 973 б | `4E8D64D4D4B6EED8C6DA6A8F693A0FEB75F9EA91098CCEC9DD8CBDD66CD27B45` |
| эталон `probe\archive_a2_original\chatgpt_asset_probe_nocookie.js` | 24 848 б | `3ED2E04DB4EF2938DA9BCAFCE23B27B5FB478C588E06C84A2EB7355834864232` |
| эталон `probe\archive_a2_original\cdp_probe_run.mjs` | 5 321 б | `E681BA14903C21064D9C24FCF4B646C19B87A1805FBD342F71F544A82B6A8116` |

Diff-ы перегенерированы от эталонов к текущим файлам и проверены на обратимость:
`git apply -R --check` для обоих файлов завершилось с кодом 0, то есть diff точно соответствует
переданным версиям. Команды воспроизведения:

```
Set-Location "C:\Users\User\Documents\Strata\Workspace\StrawberryEdition\probe"
node --check chatgpt_asset_probe_nocookie.js
node probe_a2_tests.mjs                  # 18 тестов, провалено 0
node probe_a2_acceptance_audit.mjs       # приёмочные измерения, код зонда не меняет
```

### Пункт ревью → участок кода → проверка

| Пункт ревью (раунд 2) | Участник кода | Чем проверено |
| --- | --- | --- |
| 1. Учитывать частично полученные байты; общий лимит на весь прогон | `:225–226` счётчики `bytesReadFromNetwork` / `apiBytesRead`; `:341–347` бюджет на JSON; `:412–415` байты засчитываются до проверки лимита и `reader.cancel('over_limit')`; `:663–667` остаток бюджета перед загрузкой; `:1006–1007` оба счётчика в отчёте | тест 13 (13.1–13.3); аудит B1–B5 |
| 2. SHA256 по фактическим байтам при несовпадении Content-Length | `:382–395` заявленный размер и предварительный отказ; `:424–441` обрезка буфера до фактических байт, поля `bufferBytes` и `contentLengthMatchesActual`; `:712` `hashOverBytes` в записи | тест 14 (14.1–14.3); аудит C1–C4 (хэш сверяется с `node:crypto`) |
| 3. Отменять тела ответов при раннем отказе | `:256–266` `discardBody` (6 мест вызова: `:331`, `:344`, `:359`, `:383`, `:498`, `:521`); `:401` `reader.cancel('read_failed')`; `:415` `reader.cancel('over_limit')` | тест 15; аудит D1–D7 (состояние и число отмен каждого потока) |
| 4. Исключить токены из нормализованных путей | `:121–122` `PATH_WORDS` + `templatePath` (литеральные сегменты из явного списка); `:160–172` `urlShape` — только `host`, форма пути, число сегментов, имена параметров query | тест 16; аудит E5 (в выводе нет значений query, uuid и идентификаторов ассетов) |
| 5. Реальные UUID в диагностике CDP-запускателя | `cdp_probe_run.mjs:54–55` `PATH_WORDS` и `pathShape`; `:116` адрес вкладки как `protocol//host + форма пути`; `:137` вывод цели; `:225–226` `origin` + `pathTemplate` в `CHECK_ONLY` | тест 17; аудит E7–E10 (в том числе прогон `CHECK_ONLY` на стабе DOM) |
| 6. Личные данные в публичных файлах и истории Git | принято владельцем («репозиторий временно приватен, там почищу»); в зонде 6 реальных uuid бесед в блоке `CHATS` (`:197–202` исходной раскладки) | аудит E1–E4, E6: в отчёте и консоли uuid, идентификаторов ассетов, значений подписи и токена нет; в `cdp_probe_run.mjs` реальных идентификаторов нет (E7) |
| 7. Регрессионные тесты именно на эти случаи | `probe_a2_tests.mjs:714` (тест 13), `:744` (14), `:771` (15), `:812` (16), `:829` (17), `:861` (18) | `node probe_a2_tests.mjs`: 18 тестов, провалено 0 |
| Таймауты ожидания и размер JSON-ответа (следствие замечания 1) | `:84–86` `MAX_JSON_BYTES`, `API_HEAD_TIMEOUT_MS`, `DOWNLOAD_HEAD_TIMEOUT_MS`; `:270–304` `fetchHead` с `AbortController` и таймером; `:364` классификация `request_timeout` | тест 18; аудит A1–A7 |

### Пункт 4 приёмки: таймауты по четырём сценариям

Измерения сделаны с уменьшенными таймерами (250 мс вместо 30 000 / 120 000 мс) и настоящими
таймерами Node; время в колонке «измерено» — реальное время прогона фикстуры. Числа байт
детерминированы и совпадают с логом `probe\probe_a2_acceptance_audit_log.txt`; миллисекунды между
прогонами лог-файла плавают на единицы-десятки, это шум обвязки, а не зонда.

| Сценарий | Что действует | Чем гарантировано завершение | Измерено |
| --- | --- | --- | --- |
| Зависание до заголовков (JSON API) | `API_HEAD_TIMEOUT_MS` = 30 000 мс, `AbortController` в `fetchHead` (`:270–304`) | `fetch` отвергается по `abort`, ошибка классифицируется как `request_timeout` (`:364`), `auth = NETWORK_ERROR`, беседа помечена без вложений | A1: прогон завершился за 785 мс при таймере 250 мс; `reason=request_timeout`, `timeout=true` |
| Зависание до заголовков (загрузка CDN) | `DOWNLOAD_HEAD_TIMEOUT_MS` = 120 000 мс, тот же механизм | ответ не получен → `NETWORK_ERROR` / `download_timeout` (`:492`), тело не читается | A2: 1041 мс при таймере 250 мс; все загрузки `download_timeout`; в бюджете только байты JSON (2007 б) |
| Медленное поступление тела | таймер ожидания заголовков снят `clearTimeout` сразу после ответа (`:270–304`) | завершение обеспечивает лимит байт: `room = min(MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES − bytesReadFromNetwork)` (`:663`) и цикл `readCapped` с остановкой на `over_limit` | A4: 12 чанков по 100 б с паузами, прогон 1522 мс, тело принято целиком (1200 б), поток закрыт сам |
| Сетевой отказ посередине чтения | reject потока чтения | `catch` в `readCapped` (`:401`) закрывает поток `reader.cancel('read_failed')` и возвращает `NETWORK_ERROR` / `stream_read_failed` с числом полученных байт | A5 (CDN): 4 мс, `stream_read_failed`, 800 б засчитаны в бюджет, поток отменён; A6 (JSON): 3 мс, прогон продолжился, вложений из неразобранного JSON нет |
| Дополнительно: зависание ПОСЛЕ заголовков | таймера нет (единственный таймер снят после заголовков) | только лимит байт; простоя он не ограничивает | A3 (CDN) и A7 (API): за 1500 мс прогон не завершился, поток остался открыт → находка F-2 |

### Пункт 5 приёмки: общий сетевой бюджет

| Проверка | Измеренное значение |
| --- | --- |
| JSON API и загрузки CDN считаются одним счётчиком | сеть 5607 б = JSON 2007 б + загрузки 3600 б (B1); оба счётчика печатаются в отчёте |
| Частично прочитанные тела расходуют бюджет | A5: сеть 5207 б при принятых 0 б; B2: сеть 3626 б при принятых 0 б; A6: 64 б обрезанного JSON |
| Фактически прочитанные байты не превышают лимит с точностью до одного чанка | B2: потолок 3307 б, сеть 3626 б (превышение 319 б при чанке 400 б); B3: 2907 б при потолке 3007 б; B4: 2907 б при потолке 2907 б; B5: 519 б при потолке 600 б. Принятые (`downloadedBytesTotal`) не превышают потолок ни в одном сценарии |
| После исчерпания бюджета новых запросов к CDN нет | B5: подписных ссылок 0, обращений к CDN 0; B2: обращений 2 при 2 полученных подписных ссылках; B4: обращений 4 = число допущенных загрузок |
| После исчерпания бюджета запросы к API | продолжаются: B5 — 8 обращений к `backend-api`, из них 2 с отброшенным телом (0 б в бюджет); при остатке меньше заявленного `content-length` обращение к CDN тоже уходит и тело сразу закрывается (B3: 3 таких отбраковки) → находка F-1 |

### Пункты 6–9 приёмки

1. SHA256 (пункт 6). C1 тело короче заявленного (900 против 1200), C2 длиннее (900 против 500),
   C3 заголовок `content-length` отсутствует: во всех трёх случаях `sha256` совпал с эталоном
   `node:crypto` по фактически принятым байтам, `hashOverBytes == sizeBytes == 900`, а
   `contentLengthMatchesActual = false` в C1 и C2. C4 загрузка, прерванная на лимите: `sha256` в
   записи отсутствует вовсе, есть только `receivedBytes` (2000) и `attemptedBytes` (2400) —
   неполный хэш неотличим от полного.
2. Отмена потоков (пункт 7). D1 не-JSON ответ API, D2 redirect подписной ссылки, D3 HTTP 404 на
   CDN, D4 отбраковка по `content-length`, D5 превышение лимита при чтении, D6 обрыв потока при
   чтении: во всех случаях каждый поток закрыт (состояние `cancelled`, число отмен ≥ 1),
   незакрытых потоков нет; статически в коде 6 мест `discardBody` и 2 места `reader.cancel`.
3. Утечки (пункт 8). E1–E4: в отчёте и в выводе консоли нет uuid бесед, идентификаторов ассетов,
   значений параметров подписи (`sig`, `exp`) и значения токена. E5: подписной адрес представлен
   как `cdn.test.invalid/<id>/<id>` со списком имён параметров `[exp, sig]` — значений нет.
   E6: реальные идентификаторы появляются только при `DIAGNOSTIC_IDS = true` (по умолчанию `false`).
   E7–E10: в `cdp_probe_run.mjs` нет реальных uuid, адрес вкладки печатается как
   `/c/<id>`, `/share/<id>`, путь загрузки как `/<id>/<id>/<id>`; вывод `CHECK_ONLY` даёт
   `origin: https://chatgpt.com` и `pathTemplate: /c/<id>` без токена.
4. `archive_reference.json` (пункт 9). Упоминаний вне комментариев в зонде нет (2 упоминания, оба
   в комментариях `:59` и `:840`); оба вызова `probeAsset` идут с эталоном `null` (`:826`, `:838`),
   поэтому `expectedFromArchive = null`, а `shaEqualsArchive` и `sizeEqualsArchive` всегда `null`.
   В CDP-запускателе ссылок нет. Ограничение зафиксировано в разделе «Что остаётся ручным».

### Изменения тестов 09, 10 и 13 (пункт 3 приёмки)

| Тест | Старое ожидание | Новое ожидание | Почему новое соответствует контракту |
| --- | --- | --- | --- |
| 09 «потоковые лимиты объёма» | точное число успешных загрузок (`ok.length === 1`) и точный объём учтённых байт; JSON считался бесплатным | инварианты: `bytesReadFromNetwork ≤ бюджет прогона`, `ok.length × 900 ≤ бюджет на файлы`, кратность размеров фикстуры, наличие хотя бы одного отказа по лимиту; фикстура JSON выдаётся потоковым телом | после этапа 16 байты JSON входят в общий бюджет, поэтому число загрузок зависит от того, сколько JSON было прочитано, и перестало быть стабильной константой; контракт же состоит в том, что прогон не может превысить бюджет и что превышение фиксируется как отказ, а не в конкретном количестве файлов |
| 10 «повторная загрузка выключена» | таймеры везде одинаковые `30000,30000,120000,…`; нулевой учёт там, где чтение не начиналось | таймер загрузки 120 000 мс именно на обращении к CDN, API-обращения с таймером 30 000 мс; учёт байт сравнивается с `apiBytesRead`, а не с нулём | ответ CDN и ответ API теперь ждутся по разным таймерам, а JSON тоже тратит бюджет: проверять «все таймеры одинаковы» и «там 0 байт» дальше нельзя, проверяется назначение таймера и корректность учётной записи |
| 13 «учёт байтов из сети и общий лимит» | остановка прогона обязана проявиться отказом загрузки (`stream_over_limit` / `total_limit_before_start`) | остановкой считается либо отказ загрузки, либо обрезка/отбрасывание JSON беседы по бюджету (`jsonRead.reason` содержит `limit`) | при общем бюджете первым кончается очередь на чтение JSON поздних бесед: они вообще не дают записей вложений, и отказ виден только на уровне ответа API; инвариант «прогон остановлен по лимиту» выполняется в обеих формах |

### Находки приёмки (код не менялся, ждут отдельного задания)

1. **F-2 (и F-2b).** Таймер действует только на ожидание заголовков и снимается сразу после ответа;
   для чтения тела отдельного таймера простоя нет. Если сервер отдал заголовки и замолчал, прогон
   висит неограниченно: A3 (CDN) и A7 (JSON API) за 1500 мс не завершились, поток остался открыт.
   Лимит байт от этого не спасает, потому что байты не приходят. Воспроизведение:
   `node probe_a2_acceptance_audit.mjs`, сценарии A3 и A7.
2. **F-1.** Сетевой бюджет ограничивает байты, а не число обращений: при обнулённом бюджете
   обращения к `backend-api` всё равно отсылаются (тело закрывается, 0 б в бюджет — B5: 8 обращений,
   2 с отброшенным телом), а при остатке меньше заявленного `content-length` отсылается и обращение
   к CDN с последующей отбраковкой без чтения (B3: 3 случая). Байтовый лимит при этом соблюдается.
3. **M-1 (мелочь наблюдения).** Для точечного вызова `files/download` в записи ассета остаётся
   только `filesDownloadEndpoint.status = "SKIPPED_LIMIT"` без `reason`: причину (бюджет прогона)
   видно лишь в `fetch.jsonRead.reason` на уровне беседы.

### Риски, остающиеся после приёмки

1. R-1 (следствие F-2): живой прогон может зависнуть на зависшем соединении; лечится закрытием
   вкладки — отчёт к этому моменту ещё не сформирован, записи в архив нет.
2. R-2 (следствие F-1): после исчерпания бюджета остаются лишние обращения к API; для живого
   прогона это означает, что «лимит прогона» защищает объём, но не количество запросов.
3. R-3: `CDN_HOSTS = []` по умолчанию — прогон №1 почти ничего не скачивает, только фиксирует
   `UNTRUSTED_DOWNLOAD_HOST` и хосты в `cdnHostsSeen`.
4. R-4: живой прогон не выполнялся ни разу; реальные лимиты и поведение ChatGPT (429, фактические
   таймауты, форма подписных ссылок) не измерены.
5. R-5: значения `ms` в отчёте зависят от `performance.now()`; в тестовой обвязке они
   синтетические, поэтому в логе приёмки цифры `ms` не показательны (реальное время прогона
   фикстуры печатается отдельно).
6. R-6: личные данные в публичных файлах и истории Git — на владельце; зонд содержит 6 реальных
   uuid бесед в блоке `CHATS`, в отчёт и консоль они не попадают (E1–E4).
7. R-7: сверка с `archive_reference.json` ручная; автоматического вердикта зонд не выдаёт.

### Вердикт приёмки

- Семь пунктов ревью раунда 2 закрыты и подтверждены кодом и тестами; 18 из 18 регрессионных
  тестов зелёные; приёмочных проверок выполнено 86, пройдено 84, провалены 2 — обе от одной
  причины (F-2).
- Пункты задания на приёмку 1, 2, 3, 6, 7, 8, 9, 10: **PASS**.
- Пункт 4: **PASS с оговоркой** — три из четырёх запрошенных сценария завершаются гарантированно,
  для зависшего тела после заголовков гарантии нет (F-2/F-2b, описаны с воспроизведением).
- Пункт 5: **PASS с оговоркой** — байтовый бюджет соблюдается во всех сценариях (с точностью до
  одного чанка при обрыве чтения), но «новые сетевые запросы не выполняются» верно только для
  загрузок CDN; обращения к API после исчерпания бюджета остаются (F-1).
- Итог: **PASS** — пакет пригоден для контролируемого ручного прогона в Brave при условии, что
  оператор учитывает R-1 и R-2. Код в ходе приёмки не менялся; правки по F-1, F-2 и M-1 — только
  по отдельному заданию (предлагаемый этап A-2a: таймер простоя на чтение тела, пред-проверка
  бюджета перед обращением к `backend-api`, подпись причины отбраковки в записи ассета).
