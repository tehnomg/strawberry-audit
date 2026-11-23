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
   redirect следует автоматически (247) → адрес下載ки определяется сервером.
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
