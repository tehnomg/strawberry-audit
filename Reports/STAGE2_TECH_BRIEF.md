# StrawBerry Edition — предварительное техническое описание (черновик этапа 2)

> **ЗАМЕНЁН.** Окончательная спецификация: `STAGE2_TECH_SPEC.md` (20.11.2026, 23:05). Здесь этот документ оставлен только как история решения.
> Из черновика **не действуют**: доставка base64 вложений внутри JSON (выбран ZIP с файлами), варианты D2/D3/D4 (прямая отправка на сервер отложена), идея «схема export-v1 с расширением» (выбран отдельный формат `strawberry export-v1.1` и отдельная схема).

**Статус:** черновик, составлен по итогам этапа 1 (20.11.2026). Ничего из этого не реализовано.

## 1. Что сохраняем от ACE без изменений

- Каркас WXT/MV3, сборку `npm run build` → `.output/chrome-mv3`, структуру `entrypoints/`, popup/sidepanel/options/preview.
- Все парсеры платформ как есть (в т. ч. `packages/decant-core/ai/chatgpt.js` в первом приближении) — оригинальный ACE не правится, форк живёт отдельной копией.
- Существующие форматтеры (markdown/html/doc/png/openwebui/…) — они остаются, просто добавляется новый.
- Экспорт-схему `schemas/export-v1.schema.json` как базу (обратно совместимый consumer у Strawberry уже есть).
- Пакетный экспорт «открытых вкладок» (`content/utils/batch-exporter.js`) — полезен для массовой выгрузки чатов ChatGPT пачкой.

## 2. Что меняем (кандидат, на утверждение)

| № | Файл/место в ACE | Правка | Зачем |
|---|---|---|---|
| A1 | `content/formatters/strawberry.js` (**новый**) | форматтер `strawberry`: export-v1 + блок вложений + id узлов | основной результат этапа 3 |
| A2 | `content/formatters/json.js` или новый класс-наследник | не мутировать общий JSON-формат, чтобы не менять поведение ACE | разделение веток |
| A3 | `packages/decant-core/ai/chatgpt.js` | не трогая линейный вывод, дополнительно отдавать `conversation.nodes[]` (`node_id`, `parent_id`, `children`, `is_active`) и `message.attachments[]` (сырые `metadata.attachments`, `image_asset_pointer` с `asset_pointer`, `content_references`) | данные для вложений и задела по веткам |
| A4 | `packages/decant-core/ai/chatgpt_helper.js` | расширить сбор ассетов: не только `image_asset_pointer`, но и `metadata.attachments[].id`; скачивать **все** типы файлов (не только `image/*`) через `backend-api/files/download/<id>`; отдавать `{bytes(base64), mime, name, size}`; отличать «нет доступа» от «нет файла» | главное ограничение текущего ACE |
| A5 | `entrypoints/content.js` | регистрация форматтера в словаре `formatters`, пункт меню, отдельный флаг `downloadFiles` | UI |
| A6 | `entrypoints/popup`, `options`, `sidepanel` | пункт «StrawBerry JSON», настройка адреса StrawBerry (для варианта B) | UI |
| A7 | `_locales` + `wxt.config.ts` | имя `AI Chat Exporter — StrawBerry Edition`, отдельный id/иконки, чтобы форк не конфликтовал с установленным ACE | обязательное условие «оригинальный ACE не затрагивается» |
| A8 | `schemas/` | `export-v1` остаётся; для новой надстройки — `strawberry-export-v1.schema.json` (`additionalProperties:false` в текущей схеме не даёт просто добавить поля) | валидность |
| A9 | `tests/` | новый тест по образцу `tests/chatgpt-parser.test.mjs` (linkedom + фикстуры DOM/JSON, без браузера) | проверка без ручной работы |

| № | Место в Strawberry | Правка | Зачем |
|---|---|---|---|
| S1 | `importer_v2\adapters\browser_v1.py` | читать `attachments`/`nodes` из расширенного payload: строить `images[]`/`files[]` (`_data_uri`/`_payload`), проставлять `message_id`/`parent_id`, считать `branches` честно | без этого вложения из экспорта так и останутся текстом |
| S2 | `importer_v2\adapters\__init__.py` | детект расширенного формата (свой `detect`,Score > 0.9 у `browser.export-v1`) | маршрутизация |
| S3 | (опция) `history-server.py` | `POST /api/import/upload` → перевести на importer_v2 и перестать писать `source="chatgpt"` для браузерных сохранений | этап 3+/4 |
| S4 | (опция) `web\app.js` | расширение `IMAGE_CDN_HOSTS`, если решим оставлять CDN-ссылки | только при отказе от скачивания |

**Не меняем** в рамках ChatGPT-прохода: схему `chats\*.json`, формат `attachments\`, хэш-версии, UI-ленту.

## 3. Контракт экспорта (предложение `strawberry export-v1.1`)

```jsonc
{
  "$schema": "./schemas/strawberry-export-v1.schema.json",
  "schemaVersion": 1,
  "profile": "strawberry",              // новый признак: адаптер Strawberry отличает его от обычного ACE-сохранения
  "exportedAt": "2026-11-20T18:00:00Z",
  "source": { "platform": "ChatGPT", "url": "https://chatgpt.com/c/<uuid>", "title": "…" },
  "metadata": { "Source": "ChatGPT", "Date": "20.11.2026, 18:00:00", "Link": "…", "Method": "API", "Model": "gpt-5" },
  "nodes": [                            // ЗАДЕЛ (решение на этапе 2): честный граф, а не только активная цепочка
    { "id": "<turn uuid>", "parent": "<turn uuid|null>", "children": ["…"], "active": true }
  ],
  "messages": [
    {
      "index": 0,
      "role": "user",
      "displayRole": "User",
      "content": "текст markdown; ![Image](data:image/png;base64,…)",
      "timestamp": "2026-04-21T05:28:22Z",   // includeTimestamps обязателен для StrawBerry
      "nodeId": "<turn uuid>",               // → messages[].message_id
      "parentId": "<turn uuid>",             // → messages[].parent_id
      "attachments": [
        { "kind": "image", "assetRef": "file-service://file-GMhW…", "name": "photo.webp",
          "mime": "image/webp", "size": 535604, "width": 1024, "height": 1024,
          "data": "data:image/webp;base64,…",          // байты (главное отличие от ACE)
          "status": "available" },
        { "kind": "file", "assetRef": "sediment://file_1a2b…", "name": "otchet.pdf",
          "mime": "application/pdf", "size": 240117, "data": "data:application/pdf;base64,…",
          "status": "available" },
        { "kind": "file", "name": "scan.pdf", "mime": "application/pdf", "size": 12000,
          "sourceUrl": "https://…", "status": "remote",   // байтов достать не удалось — честно помечаем
          "failReason": "files/download returned 403" }
      ]
    }
  ]
}
```

Правила контракта:
1. Текстовая часть остаётся совместимой с export-v1: обычный ACE-адаптер Strawberry (`browser.export-v1`) обязан по-прежнему читать такой файл (пусть и без вложений).
2. Байты — только base64 data-URL, никаких временных CDN-ссылок «на авось»: `status: "available"` означает, что байты реально в файле.
3. Не удалось скачать — пишем `status: "remote"`/`"missing"` + `failReason`; молча терять нельзя (ровно тот принцип, который в StrawBerry уже реализован через `parse_report` и статусы вложений).
4. Имена файлов на диске считает Strawberry (sha256 + сигнатура байтов), экспортёр передаёт только исходное имя и заявленный MIME.
5. Даты: обязательны `exportedAt` + `metadata.Date` (Strawberry восстанавливает пояс по их паре) и `timestamp` каждого сообщения.
6. `id` чата Strawberry берёт из `source.url` (`/c/<uuid>`); при отсутствии URL — свой детерминированный хэш.

## 4. Варианты доставки (решение — этап 2)

| Вариант | Как | Плюсы | Минусы |
|---|---|---|---|
| **D1. Файл + CLI** (база) | расширение скачивает `…json` в папку, импорт: `python import2.py <файл> --source browser` | нулевой риск для сервера; идемпотентность, отчёт, guard'ы importer_v2; тот же путь, что уже дал 902 deepseek-чата | ручной шаг |
| D2. Файл + UI-кнопка Import | тот же файл через `/api/import/upload` | привычно | идёт по v1: `source="chatgpt"`, нет `branches`, вложения только как base64 → файлы с 16-символьными именами |
| D3. Push из расширения | фоновый fetch `POST http://127.0.0.1:8088/api/import/upload` (service-worker fetch не ограничен CORS) | «одна кнопка», без ручной папки | нужен серверный вход, не ломающий v1; ответ сервера надо показывать |
| D4. Push готового документа | `POST /api/chats/{chatgpt-<uuid>}` c уже собранной структурой архива | полный контроль экспортера | экспортёр начинает дублировать логику Strawberry (хэши, `branches`, вложения) — риск разъезда |

Предложение: **D1 на этапе 3**, D3 — отдельным переключателем после успешного этапа 4.

## 5. Тестовая стратегия

- ACE-сторона: юнит-тесты в `tests/` на фикстурах (`tests/fixtures/`, linkedom, `node --test`) — разбор расширенного payload, скачивание не-картинок, сохранение id узлов, неизменность обычного JSON-экспорта.
- Strawberry-сторона: тест по образцу `importer_v2\tests\test_chatgpt_attachments.py` (тот же каркас Runner, без pytest): расширенный export → `images[]/files[]`, дедуп по sha256, статусы `available/remote/missing`, `--dry-run` не пишет файлы, повторный импорт = SKIP.
- Реальные чаты (этап 4): обычный чат; длинный (≥200 сообщений); чат с ветвлениями; чат с загруженными картинками; с сгенерированными картинками; с PDF/DOCX/XLSX; с таблицами и формулами. Проверка: количество сообщений = активная цепочка в ChatGPT, вложения открываются по `/api/attachments/...`, `status: missing` только там, где скачивание действительно невозможно, даты сортируются «по обсуждению».

## 6. Разбиение этапа 3 (после утверждения плана)

1. Клон ACE в рабочую папку уже есть (`StrawberryEdition\ace-src`); создать рабочую копию форка + переименование расширения (A7), собрать `chrome-mv3` (проверка Node 26).
2. A3+A4 — сбор полных данных и байтов в ChatGPT-ветке (с фолбэком «не скачали — честно помечено»).
3. A1+A8 — форматтер и схема `strawberry export-v1.1`.
4. A5+A6 — пункт UI и флаги.
5. S1+S2 — адаптер/расширение адаптера в StrawBerry (правки только в `importer_v2`, v1-путь не трогаем).
6. Тесты обеих сторон, dry-run импорт на реальном чате.

## 7. Что фиксируем как границы (не «починим потом»)

- Ветки: в архив StrawBerry попадает одна активная цепочка; альт-ветки — только счётчики. Полноценный перенос веток = отдельный проект (UI веток нет).
- Временные CDN-ссылки без скачивания = `remote`, показываются только для хостов из белого списка фронтенда.
- Формат и имена вложений на диске определяет StrawBerry (sha256 + сигнатура), экспортёр не диктует имена.
- Идемпотентность: повторный экспорт одного и того же чата не должен плодить дубли — при изменённом вручную чате нужен явный `--force`.
