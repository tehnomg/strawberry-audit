# StrawBerry Edition — окончательная техническая спецификация (этап 2)

**Дата:** 20.11.2026, 23:05 (+05:00). **Статус:** утверждается пользователем; до согласования исходники ACE и StrawBerry не изменяются, этап 3 не начинается.
**Основание:** `STAGE1_AUDIT_ACE_Strawberry.md` (аудит) + решения пользователя от 20.11 (доставка — ZIP, формат — отдельный Strawberry v1.1 с сохранением `message_id`/`parent_id`, рассуждения — маркерами в тексте, прямой POST на сервер не делаем).
Этот документ заменяет черновик `STAGE2_TECH_BRIEF.md` (в нём разделы про base64-вложение в JSON и про push-вариант D3 больше не действуют).

---

## 1. Окончательная архитектура

```
ChatGPT (вкладка браузера)
   │  1. GET backend-api/conversation/<convId>            (уже умеет ACE)
   │  2. GET backend-api/files/download/<assetId>         (уже умеет ACE, только картинки)
   │     → download_url → GET байты                      (fork: для всех типов вложений)
   ▼
ФОРК расширения  = ACE 1.26.0 + новый форматтер «StrawBerry ZIP»
   │  собирает: активная цепочка + nodeId/parentId + записи вложений + байты
   │  упаковывает в ZIP (JSZip 3.10.2 — уже в зависимостях ACE)
   ▼
Один файл  chatgpt-<uuid> - <title> - <date>.zip
   │     chat.json                       ← Strawberry export-v1.1 (readable и как export-v1)
   │     attachments/<assetId>.dat       ← реальные байты оригиналов
   │     attachments/conversation_asset_file_names.json   ← имя оригинала для каждого файла
   ▼
Существующий импортёр StrawBerry:  python import2.py <файл.zip> [--dry-run] [--force]
   │     (минимальная правка: поддержка .zip + автоматический --assets-dir из пакета;
   │      новый адаптер strawberry.v1; байты находит уже готовый asset_resolver)
   ▼
G:\Strawberry\chats\chatgpt-<uuid>.json  +  G:\Strawberry\attachments\chatgpt-<uuid>\<sha256>.<ext>
```

Принципы, которые не нарушаем:
- **вложение считается сохранённым только если байты легли в `attachments\`** и у записи появился `url` вида `/api/attachments/<chat_id>/<sha256>.<ext>` и `status:"available"`. URL или base64 в тексте сообщения сохранением не считается;
- недоступное ресурс не теряется молча: запись остаётся со `status:"remote"|"missing"` и `failReason`;
- формат оригинального ACE (`content/formatters/json.js`, `schemas/export-v1.schema.json`) не меняется: StrawBerry-профиль — отдельный форматтер и отдельная схема;
- все ветки (кроме активной цепочки) в объём этапа 3 **не входят**.

---

## 2. Контракт: структура ZIP и JSON

### 2.1 Структура архива (обязательная)

```
chat.json                                       ← всегда ровно один JSON верхнего уровня
attachments/file-A1b2C3d4E5.dat                 ← байты, имя = идентификатор ассета (ASCII)
attachments/file-A1b2C3d4E5.dat.meta.json       ← факультативно, не читается импортёром
attachments/conversation_asset_file_names.json  ← {"file-A1b2C3d4E5.dat": "фото_.jpeg"}
manifest.json                                   ← машиночитаемая сводка: format, conversationId, files[] с name/size/sha256 каждого файла байтов
```

> **Решение C0, 21.11.2026:** `manifest.json` обязателен и обязан нести `format`, `conversationId` и
> по каждому файлу байтов `name`, `size`, `sha256` — импортёр сверяет хэш и размер перед тем, как
> пометить вложение `available`. Подробно: `STAGE_C0_DECISIONS_AND_CONTRACTS.md` §2.3.

Правила размещения и имён вложений:

| Правило | Значение | Почему |
|---|---|---|
| Имя файла в пакете | `<assetId>.dat` (буквы, цифры, `-`, `_`, ≤120 символов) | ключ резолвера — идентификатор ассета; не-ASCII и пробелы в именах внутри zip — источник ошибок кодировки |
| Имя оригинала | только в манифесте `conversation_asset_file_names.json` (`"<имя в пакете>" → "оригинал.pdf"`) | ровно тот формат, который уже читает `importer_v2\adapters\chatgpt.py:384-414` (имя-ключ берётся без `.dat`) |
| Имя чата в JSON | `source.url` → `id_from_url` → `chatgpt-<uuid>.json` | уже так работает приём export-v1; два источника дают один и тот же файл архива |
| Имя файла выгрузки | `chatgpt-<uuid> - <title> - <YYYY-MM-DD>.zip` | mtime файла = дата выгрузки (действующее правило проекта), UUID в имени защищает от склейки разных чатов |
| Кодировка | UTF-8 в JSON и в именах zip; в JSON без BOM | `load_payload` читает `encoding="utf-8"` |
| Пакет = один чат | несколько чатов в одном zip запрещены (см. раздел 6.2, «zip-slip» и multi-entry) | проще и дешевле в проверке |

### 2.2 JSON: `strawberry export-v1.1`

Наследует export-v1 дословно и добавляет строго известные поля; остаётся `additionalProperties:false` в своей схеме.

```jsonc
{
  "$schema": "./schemas/strawberry-export-v1_1.schema.json",
  "schemaVersion": 1,
  "profile": "strawberry",                 // поле происхождения; в детекте формата не участвует (решение C0)
  "profileVersion": "1.1",
  "format": "strawberry.v1",               // ЕДИНСТВЕННЫЙ маркер формата; уверенность детекта 0.97 (решение C0, 21.11.2026)
  "conversationId": "<uuid беседы>",       // обязательный стабильный идентификатор; для /share/ и гостевых бесед — null
  "exportedAt": "2026-11-20T18:00:00Z",
  "source": { "platform": "ChatGPT", "url": "https://chatgpt.com/c/<uuid>", "title": "…" },
  "metadata": { "Source": "ChatGPT", "Date": "20.11.2026, 23:00:00", "Link": "…",
                "Model": "gpt-5", "Method": "API" },
  "export": {
    "extension": "ai-chat-exporter-strawberry", "extensionVersion": "1.26.0-se.1",
    "method": "API", "activeLeaf": "<node uuid>",
    "stats": { "assetsFound": 7, "assetsDownloaded": 5, "assetsFailed": 2,
               "bytesTotal": 8388608, "skippedByLimit": 0 }
  },
  "messages": [
    {
      "index": 0, "role": "user", "displayRole": "User",
      "content": "текст markdown, рассуждения в <think>…</think>",
      "timestamp": "2026-04-21T05:28:22Z",   // includeTimestamps обязателен
      "timestampMs": 1776749302000,          // сырой epoch из API, без двойного нормализования
      "nodeId": "<turn uuid>",               // → messages[].message_id
      "parentId": "<turn uuid|null>",        // → messages[].parent_id
      "attachments": [
        { "attachmentId": "file-A1b2C3d4E5", "kind": "image",
          "name": "фото_.jpeg", "mime": "image/jpeg", "size": 535604,
          "status": "available", "origin": "upload" },
        { "attachmentId": "file-9Zx8", "kind": "file", "name": "otchet.pdf",
          "mime": "application/pdf", "size": 240117, "status": "available", "origin": "upload" },
        { "attachmentId": null, "kind": "image", "name": "images.openai.com/…",
          "status": "remote", "sourceUrl": "https://images.openai.com/…",
          "origin": "generated", "failReason": "no_asset_id_in_response" }
      ]
    }
  ]
}
```

Соглашения:
- `content` остаётся совместимым с обычным ACE: картинки, которые удалось скачать, по-прежнему отображаются в тексте как `![Image](data:…)`; но **это не признак сохранения** — признаком сохранения является записанный файл + запись в `attachments[]` со `status:"available"`.
- Рассуждения — маркерами в тексте: `<think>…</think>` (как в текущем ACE). Поле `reasoning` в JSON нет, адаптер StrawBerry не заполняет `messages[].reasoning` на этом этапе. Отдельный флаг `includeThinking` работает как в ACE.
- `attachmentId` = идентификатор ассета (`fileId` из `asset_pointer`/`metadata.attachments[].id`). Это единственный ключ связи «сообщение ↔ файл в пакете»: `importer_v2\attachments.py:142-143` дедуплицирует именно по `_asset_ref`/`source_id`.
- `kind`: `image`/`file` → в архиве попадёт в `messages[].images[]`/`files[]`.
- `origin`: `upload` (загрузил пользователь), `generated` (сгенерировано моделью), `web` (из веб-поиска). Нужен для честной статистики, на судьбу байтов не влияет.
- `timestamp` обязателен: при его отсутствии импортёр проставляет время сохранения и помечает `time_confidence:"coarse"` (`browser_v1.py:121-126`).
- Совместимость: этот же файл читается и текущим адаптером `browser.export-v1` (текст+даты), но **без вложений** — поэтому StrawBerry-адаптер регистрируется отдельно и обязан иметь уверенность детекта выше 0.9 (у `browser.export-v1` — ровно 0.9, выбор по максимуму, `adapters\__init__.py:42-52`).

---

## 3. Алгоритм получения оригиналов (изображений и документов)

### 3.1 Сбор кандидатов (в активной цепочке)

| Источник в ответе API | Что извлекаем | Статус по умолчанию |
|---|---|---|
| `content.parts[].content_type == "image_asset_pointer"` → `asset_pointer` (`file-service://…`, `sediment://…`) | `attachmentId = asset_pointer.split("://")[1]`, `kind:"image"`, `origin:"generated"|"upload"` | есть id → качаем |
| `msg.metadata.attachments[]` (новое представление ответа) | `attachmentId = id`, `name`, `mime`, `size`, `kind:"file"` | есть id → качаем |
| `msg.metadata.content_references[]` c `type:"image_group"` | публичные URL `images.openai.com`/`oaistatic` | `status:"remote"` + `sourceUrl`, скачивание **не обещаем** |
| ни id, ни URL | — | `status:"missing"`, `failReason:"no_asset_id_in_response"` |

Дедупликация кандидатов по `attachmentId` до скачивания; порядок обхода — активная цепочка от `current_node`/DOM-активного листа (текущая логика `linearize()`, `chatgpt.js:478-524`).

### 3.2 Скачивание

1. `GET https://chatgpt.com/backend-api/files/download/<attachmentId>` с `Authorization: Bearer <token>` (+ `oai-device-id` из cookie `oai-did`) → JSON `{download_url}`.
2. сразу (в том же запросе) `GET <download_url>` → байты. Подписанные URL не сохраняем и не пересылаем в JSON: они короткоживущие.
3. байты уходят в форматтер как `Uint8Array`/`Blob` → в ZIP как `<attachmentId>.dat`. **Base64 нужен только для переноса через границу страницы** (см. 3.3), в ZIP он не попадает.
4. Параллельность — не более 3 одновременных загрузок, таймаут одной загрузки 30 с, один повтор. Общий лимит времени ответа помощника — настраиваемый (сейчас в ACE жёстко 45 с / 60 с, `chatgpt.js:71`).
5. Лимиты объёма (значения по умолчанию, обязательны к замеру на этапе 3 и пересмотру по замерам): один файл ≤ 32 МБ, все вложения чата ≤ 100 МБ. Превышение — `status:"skipped_by_limit"`, `failReason:"size_limit"`. **Решение C0, 21.11.2026:** это лимиты стороны форка и веб-загрузки; на локальную распаковку ZIP в `import2.py` (этап C2) они не переносятся — там свои: ≤20 000 записей, ≤4 ГиБ распакованных, ≤512 МБ на одну запись (`STAGE_C0_DECISIONS_AND_CONTRACTS.md` §2.4).

### 3.3 Через границу «страница ↔ расширение»

Текущий обмен — один `window.postMessage` со всем разговором и всеми base64-картинками (`chatgpt.js:33-98`, `chatgpt_helper.js:155-158`). Для десятков мегабайт это риск. В форке:
- новый тип запроса `strawberry_fetch` (старый `fetch_conversation` и старый ответ не меняются — форк не отвечает на запросы оригинального ACE и наоборот);
- ответ разбивается на части: `{requestId, seq, last, payload}` c шагом ~1 МБ и сборкой на стороне контента;
- ключ кэша `lastFetch` (`chatgpt.js:1282-1307`) обязан включать флаг «нужны файлы», иначе режим «с файлами» и режим «без файлов» вернут друг другу не тот результат.

### 3.4 Недоступные ресурсы: честные статусы и причины

| Причина | `status` | `failReason` |
|---|---|---|
| нет токена (`/share/`, выход из аккаунта) | `missing` | `no_auth_token` |
| `files/download` вернул не 2xx | `missing` | `files_download_http_<status>` |
| в ответе нет `download_url` | `missing` | `no_download_url` |
| скачивание по `download_url` не удалось | `missing` | `bytes_http_<status>` |
| у записи нет идентификатора ассета | `remote`/`missing` | `no_asset_id_in_response` |
| превышен лимит объёма | `missing` | `size_limit` |
| только публичная CDN-ссылка | `remote` | `cdn_link_only` |

Запрещено: выдавать `available` без файла в пакете; терять запись; писать `remote` там, где байты реально лежат в пакете.

### 3.5 Что НЕ обещается до замеров (этап 4 подтвердит или опровергнет)

- что `files/download` вообще работает для не-изображений (PDF/DOCX/XLSX) — по коду подтверждено только для картинок;
- что ассеты сгенерированных картинок доступны спустя время и на `/share/`;
- что ссылки `images.openai.com` живы сколько-нибудь долго;
- фактические пределы postMessage/JSZip/памяти на больших чатах.

Поэтому первый же шаг этапа 3 (см. раздел 7, шаг 1а) — **замер, а не написание кода**: если `files/download` для документа не работает, контракт остаётся тем же, но документы честно уходят в `missing`/`remote` и это фиксируется как ограничение платформы, а не как «не доделали».

---

## 4. Изменения в ACE (форк) — точный список

Ничего не меняется в репозитории upstream: правки применяются к рабочей копии форка `StrawberryEdition\ace-fork\` (создаётся на этапе 3 копией из `ace-src`).

| № | Файл | Правка | Комментарий |
|---|---|---|---|
| A1 | `content/formatters/strawberry.js` (**новый**) | класс `StrawberryFormatter`: `buildDocument(conversation, options)` → объект §2.2; `format()` → `Blob` ZIP (JSZip, DEFLATE level 6, UTF-8 имена), entries `chat.json`, `attachments/<id>.dat`, манифест, `manifest.json`; `getFileExtension() = "zip"`, `getMimeType() = "application/zip"` | контракт `ExportFormatter` позволяет Blob: `entrypoints/content.js:641-649` уже ветвится на `instanceof Blob` |
| A2 | `packages/decant-core/ai/chatgpt_helper.js` + новый `chatgpt_helper_se.js` | новый тип запроса и ответ частями; сбор всех идентификаторов ассетов (не только `image_asset_pointer`); скачивание без фильтра по типу контента; отдача `{assetId, base64, mime, size, failReason}` | **обязательно** использовать свой `event.data.source` (`strawberry-exporter-ext`) и свой `id` инжектируемого скрипта: если оригинальный ACE и форк стоят в одном браузере, текущий фильтр `source !== "chatgpt-exporter-ext"` (`chatgpt_helper.js:59`) и глобальный флаг `window.__chatgptHelperInjected` приведут к двойным ответам и к тому, что форк получит старого помощника |
| A3 | `packages/decant-core/ai/chatgpt.js` | опции `parse({ wantFiles, includeAttachments })`; в `linearize()`/`linearizeMessagesArray()` (строки 463-472, 528+) передавать `nodeId = node.id`, `parentId = node.parent`, `timestampMs = msg.create_time`; добавлять `message.attachments[]`; в `formatApiResult()` (1169-1245) сохранять `nodeId/parentId/attachments/timestampMs`, не трогая существующие поля | старые форматы не должны увидеть новых полей в `content`; это проверяется существующими тестами ACE |
| A4 | `entrypoints/content.js` | регистрация `strawberry: new StrawberryFormatter()` в словаре `formatters` (строка 217); передача `wantFiles` в `parse()`; для `strawberry` не применять `stripImages`/`applyAttachmentOption` (иначе заметки «[Attached: …]» подменят записи о вложениях) | |
| A5 | `entrypoints/popup/index.html:75`, `entrypoints/options/index.html:177`, `entrypoints/background.js:59-92`, `_locales/*/messages.json` | пункт «StrawBerry ZIP (.zip)» в выбор формата + пункт контекстного меню `strawberry: 'Download StrawBerry ZIP'`; копирование и Preview для zip недоступны | образец — подключение `openwebui` в 1.26.0 |
| A6 | `schemas/strawberry-export-v1_1.schema.json` (**новый**) | схема §2.2, `additionalProperties:false` | `schemas/*` уже в `web_accessible_resources` (`wxt.config.ts`), добавления не требуют |
| A7 | `content/utils/filename.js` | имя `chatgpt-<uuid> - <title> - <date>` (UUID из `source.url`), extension `zip` | защита от склейки чатов и от коллизий имён |
| A8 | форк-идентичность: `package.json` (`name: ai-chat-exporter-strawberry`, `version: 1.26.0-se.1`), `wxt.config.ts` (имя, иконки), `README`/`FORK_NOTES.md` | расширение не должно конфликтовать с установленным ACE; лицензии AGPL-3.0-only + FOSS exception сохраняются, список правок — в `FORK_NOTES.md` | |
| A9 | `tests/strawberry-formatter.test.mjs`, `tests/strawberry-wiring.test.mjs`, `tests/chatgpt-se-parser.test.mjs` (**новые**) | форматтер (состав entries, манифест, отсутствие base64 в JSON), wiring (по образцу `tests/openwebui-wiring.test.mjs`: content.js/popup/options/background), парсер (nodeId/parentId/attachments на фикстуре API-ответа) | запуск: `node --test tests/*.test.mjs` — без браузера |

## 5. Изменения в StrawBerry — минимальные

Правки только в `importer_v2\` (путь v1: `import.py`, кнопка Import в UI, `import-all.bat` — не трогаем).

| № | Файл | Правка | Комментарий |
|---|---|---|---|
| S1 | `importer_v2\adapters\strawberry_v1.py` (**новый**) | адаптер `strawberry.v1`: `detect()` = **0.97** при `chat.json.format == "strawberry.v1"`; структура пакета export-v1.1 без маркера → **0.75** (серая зона: вход уходит в `AMBIGUOUS`, молча не импортируется); `profile`/`profileVersion` в расчёте уверенности не участвуют, новый адаптер ставится перед `BrowserV1Adapter` с его ровно 0.9 (решение C0, 21.11.2026); `original_id` = `conversationId`, при его отсутствии — строгое извлечение `/c/` из `source.url` (`id_from_url`), случайный UUID не подставляется; сообщения → `make_message(..., message_id=m["nodeId"], parent_id=m["parentId"])`; `attachments[]` → `make_attachment(kind, "chatgpt", source_id=attachmentId, asset_ref=attachmentId, name, mime, size, status=…)`; отсутствие текста + наличие вложений → сообщение не выбрасывается; `branches` честно: `leaf_policy:"source_active_chain"`, `nodes_total = nodes_active`, `nodes_outside_active:"unknown"`, `branch_points:0` + предупреждение в `parse_report`, что альтернативные ветки источником не передаются | `make_message` принимает строковые `message_id/parent_id` (`model.py:23-42`), и они попадают в архив (`model.py:154-157`) |
| S2 | `importer_v2\adapters\__init__.py` | регистрация адаптера + алиасы `"strawberry"`/`"strawberry.zip"` для `--source` | выбор по максимуму уверенности (`__init__.py:42-52`) |
| S3 | `import2.py`, `engine.py:23,179-207,30-48` | поддержка `.zip`: `SUPPORTED_SUFFIXES += (".zip",)`; в `_run_file` для zip — проверка сигнатуры `PK\x03\x04`, распаковка во временный каталог с защитой (отказ при `..`, абсолютных путях, символических ссылках, при более чем одном `*.json` верхнего уровня и при вложенности `attachments/` глубже одного уровня), затем обработка распакованного каталога существующим обходом `rglob` | сам JSON читается тем же `load_payload`, ничего не переписываем |
| S4 | `engine.py:108-116,140-177` | если в распакованном пакете есть каталог `attachments/`, автоматически считать его `assets_dir` (если пользователь явно не указал `--assets-dir`); в `_chatgpt_asset_dirs` признак пакета — наличие `manifest.json` или каталога `attachments/` рядом с JSON, чтобы guard «без ассетов импорт нельзя» работал и для zip | байты находит **уже готовый** `adapters\chatgpt.py:384-414 asset_resolver()` + `attachments.py:185-189, 216-260 stage_attachments()`: `<id>.dat` → sha256 → `attachments\chatgpt-<uuid>\<sha256>.<ext>`, формат по сигнатуре байтов (`_SIGNATURES`), дедуп по sha256, `url` и `status:"available"` проставляет импортёр |
| S5 | `importer_v2\tests\test_strawberry_v1.py` + фикстуры (**новые**) | по образцу существующих тестов (`importer_v2\tests\test_chatgpt_attachments.py`, каркас Runner без pytest) | см. критерии в §7 шаг 4 |

Команды импорта (после этапа 3):

```
python import2.py "G:\Strawberry\import\<файл>.zip" --dry-run --report G:\Strawberry\import\report.json
python import2.py "G:\Strawberry\import\<файл>.zip" --tz-offset +05:00 --report G:\Strawberry\import\report.json
# после импорта, штатно по проекту:
card-builder.bat
```

`--force` — только если чат уже был импортирован раньше (например тем же export-v1) и его нужно перезаписать; перезапись идёт с бэкапом (`store.backup_chat`).

---

## 6. Проверки и инварианты (как понимает успех обе стороны)

### 6.1 Инварианты формата
- `chat.json` проходит свою схему; проходит и как export-v1 (без вложений) — тест на «двойное чтение»;
- каждый `attachments[].attachmentId` ≠ null имеет файл `attachments/<attachmentId>.dat`, и наоборот; файлы без записи в JSON запрещены;
- в JSON нет строк `data:` длиннее порога предупреждения (иначе экспортёр молча раздувает файл) — проверка в тесте формата;
- `attachmentId` регистросохраняется везде (ключ манифеста = `"<attachmentId>.dat"`).

### 6.2 Инварианты распаковки
- zip без сигнатуры `PK\x03\x04` → понятная ошибка в отчёте, не «Expecting value»;
- путь внутри zip не выходит за пределы пакета; `attachments/` не глубже одного уровня; ровно один JSON чата;
- битый/пустой zip, отсутствующий манифест, отсутствующий файл вложений → импортируется чат, вложения получают `missing` с причиной, импорт не падает.

### 6.3 Инварианты архива StrawBerry (что проверяем после импорта)
- файл `chats\chatgpt-<uuid>.json`: `source:"chatgpt"`, `importer_version:"2.0.0"`, `source_file` — имя JSON из пакета, `source_file_sha256` — его хэш;
- у сообщений есть `message_id` и `parent_id` (цепочка согласована: `parent_id` предыдущего == `message_id` следующего), `images[]/files[]` с `sha256`, `size`, `url`, `status:"available"`;
- файлы реально лежат в `attachments\chatgpt-<uuid>\` с sha256-именами, их `sha256` совпадает с хэшем оригинала (сверка с контрольной суммой исходного файла в ChatGPT — ручная выборка на этапе 4);
- сервер отдаёт их по `GET /api/attachments/chatgpt-<uuid>/<sha256>.<ext>`;
- повторный запуск той же команды → действие `SKIP` (или `DATE_UPDATE`), новых файлов и дублей нет;
- `--dry-run` не создаёт ни файла чата, ни файла вложения, но показывает корректный счётчик перенесённых вложений (engine уже резолвит байты в dry-run, `engine.py:300-320`).

Про действиях импортёра: `NEW / SKIP / DATE_UPDATE / UPDATE / MIGRATE / SKIP_LOCAL / CONFLICT / ID_MISMATCH` (`store.py:121`). Важное следствие: `content_hash` не включает `message_id/parent_id`, а `observed_hash` включает (`model.py:188-222`), поэтому повторный экспорт того же чата с добавленными id узлов даёт `DATE_UPDATE`, а не новый чат и не `UPDATE`-конфликт.

---

## 7. Последовательность реализации (этап 3) с критериями каждой части

Каждая часть — отдельная проверяемая остановка. Ни одна не начинается без приёмки предыдущей.

**Шаг 0 — сборка без изменений.** Копия `ace-src` → `ace-fork`, переименование расширения (A8), установка зависимостей, `npm run build`, загрузка `.output/chrome-mv3` рядом с установленным ACE.
*Приёмка:* расширение собирается и ставится, оригинальный ACE продолжает работать как раньше (экспорт Markdown/JSON). Если Node 24.16 не подходит (в `package.json` `engines.node >= 26`) — ставится переносимый Node 26 рядом с проектом, и это фиксируется как требование сборки.

**Шаг 1а — замер возможностей (кода почти нет).** На реальном чате с PDF/DOCX/XLSX и сгенерированной картинкой вручную (через DevTools или минимальную правку помощника) проверяются: живость `backend-api/files/download/<id>` для не-изображений, наличие `id` в `metadata.attachments[]` в текущем формате ответа, наличие `files/{id}/metadata`, доступность ассетов сгенерированных картинок.
*Приёмка:* протокол замеров с кодами ответов; решение, какие типы вложений объявляем поддерживаемыми, какие — `missing/remote`. Без этого шага нельзя объяв поддержку документов.

**Шаг 1 — помощник: все ассеты, частями.** A2.
*Приёмка:* в консоли страницы получены байты картинки **и** документа (размер = `size` из API, MIME = заявленному); ответы частями собираются без потерь; при отсутствии токена — `no_auth_token`, при 404 — `files_download_http_404`; форк не отвечает на запросы оригинального ACE и наоборот.

**Шаг 2 — парсер: данные, а не файлы.** A3.
*Приёмка:* в юнит-тестах на фикстурах API (формат `mapping` и формат `messages`) у сообщений есть `nodeId/parentId/timestampMs/attachments[]`; существующие тесты ACE (`node --test tests/*.test.mjs`) проходят без правок ожиданий — значит обычные форматы не изменились.

**Шаг 3 — форматтер и ZIP.** A1, A6, A7.
*Приёмка:* скачанный zip содержит ровно `chat.json`, `attachments/<id>.dat`, манифест, `manifest.json`; `expand-archive`/`tar -tf` показывает UTF-8 имена; в JSON нет base64; `stats` в JSON соответствуют числу файлов в пакете; `manifest.json` содержит все `failReason`.

**Шаг 4 — StrawBerry: адаптер.** S1, S2, S5 (пока на вручную собранном пакете).
*Приёмка:* `python import2.py пакет\chat.json --assets-dir пакет\attachments --dry-run` даёт `NEW`, N вложений «будет перенесено»; реальный прогон создаёт `chats\chatgpt-<uuid>.json` и файлы в `attachments\` с sha256-именами; повтор = `SKIP`; тесты `importer_v2\tests` проходят целиком, включая существующие.

**Шаг 5 — StrawBerry: поддержка zip.** S3, S4.
*Приёмка:* `python import2.py <пакет>.zip --dry-run` работает без `--assets-dir` и показывает те же счётчики, что шаг 4; битый zip и zip без `attachments/` дают понятные строки отчёта и статусы `missing` с причиной; существующие вызовы (`.json`, `.jsonl`, `.md`, каталоги) ведут себя как раньше (регрессионный тест).

**Шаг 6 — сквозная проверка на реальных чатах** (фактически вход в этап 4).
*Приёмка:* чат с картинками и документами → все записи `available`, вложения открываются в UI и по `GET /api/attachments/…`; чат только с CDN-ссылками → `remote` + предупреждение; чат с ветвлениями → в архиве активная цепочка, `parse_report` содержит предупреждение про альт-ветки; `card-builder.bat` после импорта; даты и сортировка «по обсуждению» корректны.

---

## 8. Риски, ограничения браузера, зависимости и требования сборки

**Неподтвержденные возможности площадки (главный риск).**
1. `backend-api/files/download/<id>` для не-изображений — не подтверждено (решается шагом 1а).
2. Формат ответа API: в `mapping` идентификаторы картинок есть, в `messages`-формате идентификаторы документов берутся из `metadata.attachments[]` — нужно подтвердить на живом чате.
3. Подписные `download_url` короткоживущие — используем сразу, в JSON не кладём.
4. Ассеты сгенерированных картинок и `/share/` — отдельно, ничего не обещаем.

**Ограничения браузера и расширения.**
- Обмен «страница ↔ расширение» идёт только через `postMessage`: большие чаты требуют разбиения на части (A2) и замера; ориентировочный лимит одного файла вложения 32 МБ задаётся как ограничение кода, а не как возможность браузера.
- Память: в текущем ACE base64 картинок живёт в памяти контент-скрипта; плюс JSZip хранит содержимое до генерации Blob. Нужны лимиты из §3.2 и замер на максимальном реальном чате.
- Скачивание: в форке используется штатный путь `entrypoints/content.js:651-692` (`<a download>` + object URL) — он не требует правок; `chrome.downloads.download` (`content/utils/batch-exporter.js:246-251`) остаётся запасным, `downloads` — факультативная permission, включать её отдельно не нужно.
- Двойная установка ACE и форка: конфликт глобалов помощника и одинаковый `source` сообщений (см. A2) — обязательная правка, иначе «непонятные» двойные ответы; плюс разные id расширения, имя и иконки (A8).
- Таймауты помощника жёсткие (45/60 с) — при десятках ассетов не хватит; делаем настраиваемыми и измеряем.
- Права: текущий набор (`activeTab, tabs, scripting, storage, contextMenus, sidePanel`, host `<all_urls>`) достаточен; новых правок в манифесте не требуется.

**Зависимости.**
- JSZip 3.10.2 уже в `dependencies` ACE (используется в `content/utils/batch-exporter.js`) — новых библиотек в расширение не добавляем.
- StrawBerry: только стандартная библиотека Python (`zipfile`); новых зависимостей нет; conda-окружение `strawberry` не меняется.
- Тесты ACE: `node --test` + `linkedom` (уже есть), Playwright-тесты не трогаем.

**Требования к сборке.**
- Node: `package.json` требует `>=26.0.0`, на машине 24.16.0 / npm 12.0.2 — проверка на шаге 0, при неудаче переносимый Node 26 в папке проекта; `postinstall: wxt prepare` должен отработать.
- Сборка: `npm install` → `npm run build` (WXT 0.21.4) → `.output/chrome-mv3`; для Firefox `npm run build:firefox`. Загрузка распакованного расширения — через `chrome://extensions` (отдельный от ACE id).
- Версионирование форка: `1.26.0-se.1`, в `manifest.json` отдельное имя; `FORK_NOTES.md` со списком изменённых файлов (требование AGPL + FOSS exception для последующего распространения).
- Проверка качества: `npm run lint`, `npm run test:ext`, `node --test tests/*.test.mjs`; на стороне StrawBerry — существующие тесты `importer_v2\tests` + новые.

## 9. Что сохранено на этом этапе (этап 2)

- `StrawberryEdition\STAGE2_TECH_SPEC.md` — этот документ (окончательная спецификация);
- `StrawberryEdition\STAGE2_TECH_BRIEF.md` — помечен как заменённый;
- `skills\strawberry-ace-export\SKILL.md` — дополнен проверяемыми фактами об импорте zip, резолвере ассетов, реестре адаптеров, действиях импортёра и точках правок;
- `Documentation\StrawberryEdition.md`, `Documentation\INDEX.md` — обновлён статус и ссылки;
- изменения в `G:\Strawberry` и в `ace-src`: **0** (проверено списком файлов).
