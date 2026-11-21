# Этап 1 — аудит исходников ACE и Strawberry

**Дата:** 20.11.2026, 22:05–22:35 (+05:00).
**Режим:** только чтение. В `G:\Strawberry` не изменено ни одного файла. Единственная запись — скачанный клон ACE в `Workspace\StrawberryEdition\ace-src` и документы этой папки.
**Что клонировано:** `https://github.com/Covai-Labs/ace` → `C:\Users\User\Documents\Strata\Workspace\StrawberryEdition\ace-src` (shallow clone, HEAD `cf19e7185ff9c0f11e0f0dbd58a74686f634eb16`, дата коммита 20.11.2026 15:05 +0530, версия **1.26.0**).

---

## 1. Краткий вывод (читать первым)

1. **Strawberry уже понимает формат ACE.** В проекте есть адаптер `importer_v2\adapters\browser_v1.py` (внутренний id `browser.export-v1`), который принимает одиночные браузерные сохранения вида `schemaVersion + source + messages` — ровно то, что выдаёт ACE в формате «JSON (schema v1)». По DeepSeek такой экспорт уже стоит в проде: 902 deepseek-чата, правило «дата чата = mtime файла выгрузки», id из URL (`/c/…`) — см. `G:\Strawberry\docs\DATA_FORMATS.md:240-261`.
2. **Но по ChatGPT текущий ACE даёт потерю вложений.** В export-v1 у сообщения есть только текст: картинок и файлов в структуре нет. Байты картинок ChatGPT ACE умеет скачивать, но в JSON-экспорт их не кладёт (base64 подставляется лишь в `.doc`/`.html`). Файлы (PDF/DOCX/XLSX и т. п.) в экспорте существуют только как имена.
3. **Ветки ChatGPT ACE не сохраняет.** `linearize()` выбирает одну активную цепочку и идёт по `parent`; соседние ветки отбрасываются. В Strawberry — та же модель: в архив попадает одна активная цепочка, а остальные узлы лишь посчитаны в `parse_report.branches`. То есть «ветвления» на этапе 4 надо проверять как *учтённую потерю*, а не как полноценный перенос.
3a. Отдельно: в UI Strawberry веток нет вообще, есть только «Branch from here» → новый чат (`web\history-module.js`, `parent_id`/`message_id` интерфейсом не читаются).
4. **Правильная точка входа импорта — CLI `import2.py` (importer_v2), а не кнопка Import в UI.** Кнопка ведёт на устаревший `import.py` v1, который любой export-v1 помечает `source="chatgpt"` и умеет лишь вытаскивать base64 из текста/массива `images` в файлы с 16-символьными именами. importer_v2 — дедупликация по sha256, проверка формата по сигнатуре байтов, отчёт, идемпотентность (`NEW/SKIP/UPDATE`), guard по ассетам.
5. **Реальные возможности ACE по оригиналам вложений (по коду, до экспериментов):**
   - загруженные пользователем картинки — **да**, качаются целиком (`/backend-api/files/download/<fileId>` → base64), но только при наличии токена (обычный чат; `/share/` — нет);
   - сгенерированные картинки — **потенциально да** (те же `image_asset_pointer`/`file-service://`), но ACE их в JSON не сохраняет;
   - не-картинки (PDF/DOCX/XLSX/коды) — **в текущем ACE нет ни одного скачивания байтов**, только имена из `metadata.attachments`;
   - CDN-ссылки (`images.openai.com`, `oaistatic`) — остаются как ссылки, их срок жизни не измерен.
6. **Форк возможен без риска для ACE:** формат — отдельный класс в `content/formatters/`, парсер ChatGPT не трогаем в первом приближении, сборка — `wxt build` → `.output/chrome-mv3`, есть=node-тесты на фикстурах DOM без браузера.

---

## 2. ACE: из чего состоит проект

**Версия и лицензия.** `package.json: version 1.26.0`, лиценза **AGPL-3.0-only** + `FOSS-EXCEPTION.md` (разрешение линковать с проектами под OSI-лицензиями; **правки в файлах ACE остаются под AGPL**). Для локального личного форка это не мешает, но закрыть форк в проприетарный продукт без коммерческой лицензии Covai нельзя.

**Каркас.** WXT 0.21.4, MV3, целевые браузеры chromium/firefox/edge. `wxt.config.ts`: permissions `activeTab, tabs, scripting, storage, contextMenus` (+`sidePanel`), optional `downloads, clipboardWrite`, host_permissions `<all_urls>`; web-accessible: `content/chatgpt_helper.js`, `content/claude_react_reader.js`, `content/lib/*`, `schemas/*`. `engines.node >= 26.0.0` — **на этой машине Node 24.16.0, npm 12.0.2** (сборку это может заблокировать, требует проверки на этапе 3).

**Слои:**
| Слой | Путь | Что там |
|---|---|---|
| парсеры платформ | `packages/decant-core/ai/*.js` + `data/platforms.json` | 21 платформа (chatgpt, claude, gemini, deepseek, qwen, grok, …); стратегия каждой — «DOM», «internal API», «DOM + API» |
| помощники в page-world | `packages/decant-core/ai/chatgpt_helper.js` | инжектится скриптом в страницу, делает запросы к внутреннему API от имени страницы |
| форматтеры экспорта | `content/formatters/` | `markdown, html, doc, text, image(png), json (export-v1), openwebui, continuation(base)` |
| точка экспорта | `entrypoints/content.js` (1135 стр.) | обработчик `EXPORT_CHAT`: парсер → опции (картинки/рассуждения/вложения) → форматтер → Blob → `<a download>` |
| UI | `entrypoints/popup`, `sidepanel`, `options`, `preview` | выбор формата (`openwebui` добавлен в 1.26.0), пакетный экспорт открытых вкладок (`zip`/`combined`) |
| перенос чатов | `content/transfer/` | 12 целей «Continue in …», инжект текста в чужую вкладку |
| пакетный экспорт | `content/utils/batch-exporter.js` | только **открытые вкладки** окна (zip или объединённый md), не вся история платформы |
| схема | `schemas/export-v1.schema.json` | `ChatExport`: `$schema, schemaVersion=1, exportedAt, source{platform,url,title}, messages[], metadata{}`; у сообщения `index, role, displayRole, content, timestamp?`; **`additionalProperties: false` и на чате, и на сообщении** |

**Важно про схему:** из-за `additionalProperties:false` любые новые поля (вложения, id узлов, ветки) формально требуют либо новой `schemaVersion`, либо отдельного формата. Это надо решить на этапе 2, а не «просто добавить поле».

---

## 3. Как устроен экспорт ChatGPT в ACE (разобрано по коду)

`packages/decant-core/ai/chatgpt.js` (1532 стр.), `parse()` — каскад из четырёх источников:

1. **SSR-дамп страницы** (`/share/...` или `__NEXT_DATA__`/embedded `mapping`) — метод `SSR`, картинок нет (`images = {}`).
2. **Внутренний API** — метод `API`, основной: токен берётся из `#client-bootstrap` (`JSON…session.accessToken`), id беседы из URL `/c/<uuid>`; запрос идёт **не из content-script, а из page-world**: инжектится `chat/chatgpt_helper.js`, content-script шлёт `postMessage({type:"fetch_conversation", convId, token, includeImages})`, помощник делает `fetch https://chatgpt.com/backend-api/conversation/<convId>` с `Authorization: Bearer <token>` и `oai-did` из cookie, отвечает тем же `postMessage`. Таймауты: 45 с без картинок, **60 с с картинками**, кэш ответа 20 с.
3. **DOM-сбор** с прокруткой (`chatgpt_scroll_collector.js`) — метод `DOM`, если API недоступен.
4. Разбор Deep Research через iframe `oaiusercontent.com` (эвристически).

**Две структуры ответа API** поддерживаются: старая `mapping` (дерево узлов) и новая `messages` (плоский массив) — `linearize()` и `linearizeMessagesArray()`.

**Ветки.** `resolveActiveLeafNode()` сначала ищет активный лист по DOM (`data-message-id`/`data-turn-id`), иначе идёт по `children` вглубь; затем `linearize()` поднимается по `parent` до корня. Соседние `children` не обходятся: **альтернативные ответы и целые ответвления теряются без следа** (ни счётчика, ни пометки — в отличие от importer_v2 у Strawberry, который хотя бы считает).

**Картинки (API-путь).** Помощник собирает все `content.parts[].content_type == "image_asset_pointer"` → `fileId = asset_pointer.split("://")[1]` (работает для `file-service://…` и `sediment://…`), затем для каждого: `GET /backend-api/files/download/<fileId>` → `download_url` → `fetch` → base64 data-URL. Возвращается словарём `images[fileId]`. Парсер вставляет `![Image](data:...)` в текст сообщения. Если загрузка не удалась — картинка просто исчезает (тихо).

**Не-картинки (API-путь).** `msg.metadata.attachments` → только имена: `**File:** name.pdf` в хвосте текста (`appendAttachments`). Байты не запрашиваются нигде.

**DOM-путь.** `extractAttachments()` ищет имена регулярками по `.tex/.txt/.md/.pdf/.doc` — замечание по коду: `[a-zA-Z0-9_-]` не содержит `x`, поэтому **`.docx` не матчится** (в typeMap он есть, но недостижим). `extractImages()` берёт `<img src>` из DOM: это либо `backend-api/files/...` (требуют авторизации), либо `blob:` (живут до перезагрузки), либо alt-URL из `images.openai.com`.

**Итог по вложениям ChatGPT в ACE:**

| Тип вложения | Есть ли байты в ACE? | Куда попадают |
|---|---|---|
| загруженная пользователем картинка | да (base64, API + токен) | markdown-картинка в тексте; в файлы превращается только у `.doc/.html` |
| сгенерированная картинка (`file-service://`) | потенциально да, фактически в JSON нет | `![Image](data:…)` только если API вернул ассет |
| картинка из веб-поиска (`image_group`) | нет | markdown-ссылка на `images.openai.com` (публичный хост) |
| PDF/DOCX/XLSX/код/текст-файл | нет | только имя в тексте |
| голосовой ввод | текст транскрипции | в текст |
| Deep Research | текст отчёта из `widget_state` | в текст |

**Опции экспорта** (`getExportOptions`, popup/options): `includeImages`, `includeThinking`, `includeAttachments`, `includeTimestamps`, шаблон имени `{platform} - {title} - {datetime}` (`content/utils/filename.js:5`). Для JSON/Markdown картинки **не** инлайнятся; инлайнинг (`content/utils/image-inliner.js`, `credentials:'include'`, таймаут 4 с) включается только для `doc`/`html`.

**Формат Open-WebUI (новое в 1.26.0)** — `content/formatters/openwebui.js`: делает из линейного списка дерево `history.messages{parentId, childrenIds}` с одной веткой, `timestamp` в unix-секундах, `models`, `meta.tags`. Он ближе всех к «настоящему» формату диалоговых архивов, но Strawberry такой формат **не** импортирует (у Strawberry свой, нормализованный).

---

## 4. Strawberry: как реально хранятся чаты и вложения

**Сервер.** FastAPI + uvicorn, `StrawBerry.bat` → `uvicorn history-server:app --host 127.0.0.1 --port 8088` (окружение conda `strawberry`). На момент аудита сервер **не запущен** ( listens только 127.0.0.1:8080 — LLM-бэкенд).

**Источник истины** — `G:\Strawberry\chats\*.json`: 2113 файла, ~188 МБ. Имя файла = `id`:
- нативные: `{epoch_ms}-{6 символов}` (`1792611709119-x92ip9.json`);
- импортированные: `{source}-{sanitize(original_id)}` (`chatgpt-<uuid>.json`, `deepseek-…`, `qwen-…`), при коллизии суффикс `_{md5[:6]}`; `id` — только `[A-Za-z0-9-_.]`, ≤200.

**Верхний уровень документа:** `id, title, source, source_kind ("single"|"package"), original_id, model, messages[], created_at, updated_at, imported_at, source_created_at, source_updated_at, time_confidence, source_message_count, source_content_hash(+_version=3), source_observed_hash(+_version), branches, parse_report, importer_version, source_file, source_file_sha256, source_meta`. Импортёр v1 пишет подмножество (без `branches/parse_report/importer_version`).

**Сообщение:** `role, text, time (ISO или epoch-мс), time_precision, message_id, parent_id, reasoning, tools[], images[], files[], model, edited` (`importer_v2\model.py:23-42`). Роли в архиве фактически только `user`/`assistant`. Внутри архива числовые метки всегда в **миллисекундах**, а выгрузках ChatGPT/Qwen — секунды (классическая ошибка ×1000).

**Сортировка ленты** (`history-server.py:380-414`): «по обсуждению» = `source_updated_at → created_at → imported_at`; «по импорту» = `updated_at → created_at → imported_at`; `mtime` файла не участвует.

**Вложения:** каталог `attachments\<chat_id>\<sha256>.<ext>`, ровно один уровень, имя = хэш содержимого. Фактическое измерение: 332 каталога, 1233 файла — **1076 файлов с полным sha256 (64 hex, это importer_v2), 156 с 16 hex (v1/серверное извлечение base64)**, плюс один аномальный 5-символьный. Привязка только через массивы `messages[].images[]` / `messages[].files[]`; полный объект: `kind, source, source_id, name, mime, size, status ("available"|"remote"|"missing"), url, source_url/source_ref, format_hint, sha256, width, height, declared_mime, extracted_text`. `url` появляется **только после** реального сохранения байтов; формат на диске определяется по сигнатуре байтов (заявление источника уходит в `declared_mime`).

**Отдача:** `GET /api/attachments/{chat_id}/{filename}` — строгая валидация сегментов, картинки из белого списка inline, прочее `Content-Disposition: attachment`.

**UI** (`web\app.js`): рисует `images[]`/`files[]` по `url`; если `url` нет — серый «чит» «файл не перенесён». Markdown-картинки из текста показываются и отдаются модели только для хостов из `IMAGE_CDN_HOSTS = {images.openai.com, files.deepseeksvc.com}` (строка 1155); лимиты 4 МБ и 4 картинки на сообщение — про отправку в модель, не про импорт. `_meta.json` — реестр тегов (2699, все `pending`), к чатам и вложениям отношения не имеет; карточки `index\*.json` строит `card-builder.py`, после импорта нужен его прогон, иначе чат не участвует в «умном» поиске.

---

## 5. Три существующих пути импорта и их состояние

| Путь | Что принимает | Особенности |
|---|---|---|
| **UI-кнопка Import** → `POST /api/import/upload` | `.jsonl`, `.md`, `.json` (deepseek legacy, chatgpt `conversations.json`, lmstudio, **export-v1**) | идёт по коду **v1** (`import.py`); export-v1 всегда получает `source="chatgpt"` (дефект маршрутизации); `write_chat` v1 + `_post_extract_images`: вытаскивает `data:image/...` из `images[].url` и из markdown-текста в `attachments\<id>\<16 hex>.<ext>`, в тексте оставляет markdown-ссылку |
| **CLI v1** `import.py`, `import-all.bat` | те же форматы | обход **без рекурсии**: `import-all.bat` по умолчанию на `G:\Strawberry\import` не импортирует **ничего** (там нет JSON-файлов верхнего уровня); в пакет попадают `.config.chat.json`/`.metadata.chat.json` → «Unknown format» |
| **CLI v2** `python import2.py …` (**рекомендуемый**) | 8 адаптеров: `qwen, chatgpt.package, deepseek.package, claude.package, browser.export-v1, lmstudio.json, llamacpp.jsonl, markdown` | детект по структуре (порог 0.4), `--source`, `--assets-dir`, `--tz-offset`, `--dry-run`, `--force`, `--report`, `--allow-missing-assets`; идемпотентен (повтор = SKIP); `stage_attachments` → `attachments\<id>\<full sha256>.<ext>`; guard: для официального пакета ChatGPT без `--assets-dir` импорт останавливается |
| **Прямая запись** `POST /api/chats/{chat_id}` | полный документ чата | сервер дополняет отсутствующие ключи из файла на диске, не даёт `null` затрать служебные поля, восстанавливает метаданные вложений по `url/sha256/source_id/source_ref` (иначе 409), извлекает base64 в `attachments\` |

**Ключевой факт по вложениям в import-v2:** байты берутся из `att["_payload"] | att["_data_uri"] | att["_local_path"] | att["_asset_ref"]`; если байтов нет, но есть `source_url` → `status="remote"` (никто ничего не докачивает); иначе `missing`. **`browser_v1` (адаптер формата ACE) вообще не создаёт вложений** — у export-v1 неоткуда их брать: `messages[].content` трактуется как plain-текст. Отсюда задокументированный факт по DeepSeek: 96 картинок из ACE-экспорта ушли в `status="remote"`, потому что «локальных байтов Ace не отдаёт» (`docs\DATA_FORMATS.md:255-257`). **Это и есть то место, где форк должен стать лучше.**

---

## 6. Стык форматов: что сохраняется, что теряется

| Данные ChatGPT | ACE сейчас | strawberry-архив умеет | verdict |
|---|---|---|---|
| текст, роли | да | `role/text` | без потерь |
| дата сообщения | `timestamp` (если включено) | `time` + `time_precision` + `time_confidence` | без потерь, но нужен `includeTimestamps` |
| модель | `metadata.Model` | `model` чата и сообщения | без потерь |
| рассуждения (`<think>`) | в тексте тегами | отдельное поле `reasoning` | **терется как поле** (нужно решение: оставлять в тексте или извлекать) |
| загруженные картинки | base64 в тексте | `images[]` с `url` | **деградация**: не становится вложением |
| сгенерированные картинки | только если API вернул ассет | `images[]` | риск тихой потери |
| файлы (PDF/DOCX/…) | только имя | `files[]` с `name/mime/size/url/text` | **потеря байтов** — главная цель форка |
| изображения из веба | markdown-ссылка на `images.openai.com` | остаётся ссылкой, хост в белом списке | ок, но срок жизни ссылки не измерен |
| ветвления | активная цепочка | активная цепочка + счётчики в `branches` | потеря альт-веток (общая граница) |
| id узлов (`message_id/parent_id`) | нет | есть в модели архива | форк может передавать — задел на будущее |
| картинки-обложки артефактов, canvas, Deep Research | частично текстом | — | принять как есть |

---

## 7. Границы и ограничения (то, что просили выяснить «до кода»)

1. **Оригиналы вложений.** Подтверждённые кодом возможности ACE: скачивание картинок через `backend-api/files/download` при наличии токена; отсутствие любого скачивания для не-картинок; отсутствие структурированных вложений в export-v1; отсутствие скачивания по `source_url` на стороне Strawberry. Не подтверждено кодом (нужен этап 4, реальные чаты): живёт ли `files/download` для PDF/DOCX/XLSX, есть ли `files/{id}/metadata`, доступны ли сгенерированные ассеты на `/share/`, живут ли позже CDN-ссылки.
2. **`/share/` и экспорт без токена:** картинок не будет вовсе (SSR-ветка отдаёт `images = {}`).
3. **Размер.** Base64 внутри JSON раздувает файл ~на 33%; Strawberry при импорте превращает data-URL в файлы и дедуплицирует по sha256 — дублей на диске не будет, но JSON может стать многмегабайтным. Отдельного лимита тела запроса в коде `/api/import/upload` нет (файл читается целиком в память).
4. **Имена и пути:** `chat_id` и имя вложения — только ASCII `[A-Za-z0-9-_.]`, без ведущей точки и `..`; подкаталогов в `attachments\<id>` нет; не-ASCII `original_id` превращается в `_`.
5. **Идемпотентность и «локальные правки»:** v2 считает хэш версии 3 (включает `time, message_id, parent_id`); чат, изменённый вручную, без `--force` будет пропущен, а не перезаписан. Разные `original_id` → разные файлы-дубли; один UUID на два разных чата → суффикс `_{md5[:6]}`.
6. **Даты:** правило воли пользователя — «дата чата = дата файла выгрузки (mtime)», с guard'ом на zip-метку 1980 года. Для форка это значит: **сохранять экспорт на диск с честным mtime** или передавать дату в `metadata.Date`/`exportedAt` (пояс восстанавливается по их паре).
7. **Сборка форка на этой машине:** Node 24.16.0 при `engines.node >= 26` — риск; npm-скрипты (`postinstall: wxt prepare`) могут потребовать Node 26. Требует проверки на этапе 3, заранее ставить Node 26 или скачивать переносимую версию.
8. **CSP ChatGPT:** инжект `<script src=chrome-extension://…/chat/chatgpt_helper.js>` работает в текущей ACE (значит, web-accessible ресурс проходит), но именно это место чаще всего ломается при изменениях площадки — правки в нём надо делать точечно.
9. **Лицензия:** AGPL-3.0-only + FOSS exception. Локальный форк с изменёнными файлами остаётся AGPL-совместимым; распространение закрытой версии — нет.

---

## 8. Что это значит для форка (набросок, решение — на этапе 2)

Три архитектурных варианта, по возрастанию цены:

- **A. Только новый форматтер + расширение данных парсера.** ACE пишет расширенный export-v1 (с блоком вложений: `name/mime/size/data_uri|base64`, id ассета, ширина/высота, и с `message_id/parent_id`), импорт — существующим `import2.py` + небольшая правка адаптера `browser_v1` в Strawberry, чтобы он строил `images[]/files[]` из этого блока. Плюс: ровно те же рельсы, что уже работают для 902 deepseek-чатов; ничего не изобретаем. Минус: нужен ручной шаг «положить файл → запустить импорт».
- **B. A + доставка в Strawberry прямо из расширения.** Фоновый сервис воркер ACE (`host_permissions: <all_urls>`) делает `POST http://127.0.0.1:8088/api/import/upload` (fetch из service worker не подчиняется CORS). Минус: нужен отдельный «безопасный» вход (в v1-пути дефекты маршрутизации) или `POST /api/chats/{id}` с уже собранным документом. Плюс: «сохранил чат в StrawBerry одной кнопкой».
- **C. Полный перенос графа ChatGPT** (все ветки) — требует одновременно изменений в `linearize()` ACE и в модель/UI Strawberry. Дорого, UI веток нет. Отложить.

Рекомендация к этапу 2: **A как база, B как отдельный переключатель после того, как A пройдёт этап 4.**

---

## 9. Открытые вопросы (решаются на этапе 2/4, не «надеждой на авось»)

1. Живёт ли `GET /backend-api/files/download/<id>` для не-картинок и для ассетов, удалённых из чата; есть ли `files/{id}/metadata` с именем/MIME/размером. → замер на 3-4 реальных чатах с PDF/DOCX/XLSX.
2. Судьба сгенерированных картинок: остаются ли `file-service://`-ассеты в ответе API, и работают ли `images.openai.com`/`oaistatic` ссылки через недели/месяцы. → замеры + решение «качаем всегда».
3. Формат расширения export-v1: `schemaVersion: 2` vs отдельный `strawberry` формат; кто валидирует схему (`schemas/export-v1.schema.json` с `additionalProperties:false`); как не сломать детект `browser.export-v1` (сейчас 0.9).
4. Рассуждения: оставлять `<think>` в тексте (как делает ACE для DeepSeek, и это уже разбирается адаптерами Strawberry) или передавать отдельным полем → `messages[].reasoning`.
5. Ветки: передавать ли `message_id/parent_id` уже сейчас, чтобы потом не переэкспортировать 2000+ чатов.
6. Node 26 и сборка: ставить ли отдельный переносимый Node 26 рядом с проектом.
7. Нужен ли запуск `card-builder.bat` как часть сценария импорта (сейчас карточки отстают).
8. Лимиты больших чатов: 3,4 МБ JSON — это текущий максимум в архиве; экспорт чата с 10 картинками по 2 МБ даст ~27 МБ base64 — проверить, что UI-загрузка/`import2.py` это переваривают, и решить, не передавать ли байты отдельными файлами.

---

## 10. Что сохранено и где

- `Workspace\StrawberryEdition\ace-src\` — клон ACE 1.26.0 (HEAD от 20.11.2026), 100% upstream, ничего не изменено.
- `Workspace\StrawberryEdition\STAGE1_AUDIT_ACE_Strawberry.md` — этот отчёт.
- `Workspace\StrawberryEdition\STAGE2_TECH_BRIEF.md` — предварительное техническое описание (контракт формата и точки правок), будет уточнено на этапе 2.
- `Workspace\skills\strawberry-ace-export\SKILL.md` — навык Strata по этой теме (создан, статус: этап 1, реализация не начиналась).
- `Workspace\skills\README.md` — добавлена строка нового навыка.
- `Workspace\Documentation\StrawberryEdition.md` — страница проекта в карте работ; `Workspace\Documentation\INDEX.md` — добавлены строки проекта.
- `G:\Strawberry` — не изменялся.

## 11. Что дальше (не начинать без решения)

Этап 2 — фиксация архитектуры: выбор варианта A/B, контракт `strawberry export-v1.1`, список файлов ACE и Strawberry, которые будут правиться, план проверок. Этап 3 — реализация. Этап 4 — замеры на реальных чатах (обычный, длинный, ветвления, картинки, таблицы, файлы).
