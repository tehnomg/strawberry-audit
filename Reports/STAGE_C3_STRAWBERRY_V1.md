# Этап C3: адаптер `strawberry.v1` — отчёт о реализации и приёмке

**Дата:** 21.11.2026, 20:30 (+05:00).
**Разрешение пользователя:** «Объём: исключительно C3» — реализовать адаптер `strawberry.v1`,
который импортирует экспорт StrawBerry из ACE в штатную структуру Strawberry, сохраняя
стабильный ID беседы, сообщения, связи между сообщениями и вложения. Использовать
существующие механизмы импортёра. Не создавать параллельную систему обработки чатов или вложений.
**Границы (не входят в C3):** диспетчер входов и универсальный `--plan` (C4); веб-интерфейс,
очередь, блокировки (D); логика дедупликации C1; ZIP-модуль C2 кроме необходимой интеграции;
массовый импорт и миграция рабочего архива; исправление R4; экспортёр ACE.
**Правило приёмки:** рабочий архив не использовался; всё проверялось на фикстурах и отдельных
песочницах.

Постановка, контракты и матрица тестов: `STAGE3_IMPORT_ARCHITECTURE.md` (раздел пакета
`strawberry.v1`), `STAGE2_TECH_SPEC.md` §2.1, `STAGE_C0_DECISIONS_AND_CONTRACTS.md` §2.3,
`STAGE_C_AUDIT_SPEC.md` (матрица T-S).

---

## 1. Что сделано

Один новый адаптер (`strawberry.v1`) плюс минимальная интеграция в существующий импортёр v2.
Ни одного нового прогонщика, ни одной новой записи в архив, ни одной новой обработки вложений:
адаптер использует `make_chat` / `make_message` / `make_attachment`
(`importer_v2\model.py`) и штатный стаджинг `importer_v2\attachments.py` (этот файл в C3
**не изменялся**: 272 строки, время изменения 21.11.2026 11:16 — этапы A/B) **[код]**.

1. **Распознавание.** Единственный маркер формата — `chat.json.format == "strawberry.v1"` →
   уверенность **0.97**. Структура export-v1.1 без маркера → **0.75** и статус `AMBIGUOUS`
   (не импорт молча). Наличие `profileVersion` / `profile: "strawberry"` само по себе форматом
   не является **[тест T-S-1, T-S-2, T-S-3]**.
2. **Идентификатор.** Порядок строго фиксирован: валидный `conversationId` → строгое извлечение
   UUID из `/c/` в `source.url` → иначе `AMBIGUOUS`. Случайный UUID, хэш содержимого и имя файла
   как резервный ID не используются. Имя файла архива — штатное `chatgpt-<uuid>.json`, поле
   `source` канонической записи — `chatgpt`, а не `strawberry.v1` **[код, тест T-S-1, T-S-4, T-S-5]**.
3. **Манифест и вложения.** `manifest.json` обязателен; `available` только после проверки
   реального размера и SHA256 по байтам файла пакета. Имена из манифеста недоверенные.
   Словарь причин отказа — общий с поясом LM Studio (`size_mismatch`, `sha_mismatch`,
   `not_found`), плюс пакетные причины **[код, тест T-S-6…T-S-10]**.
4. **Цепочка сообщений.** `nodeId` → `message_id`, `parentId` → `parent_id`, порядок активной
   цепочки сохраняется; пустое по тексту сообщение с вложением сохраняется;
   `leaf_policy = "source_active_chain"`, `nodes_total = nodes_active`,
   `nodes_outside_active = "unknown"`, `branch_points = 0`; альтернативные ветки не
   реконструируются **[код, тест T-S-11, T-S-12]**.
5. **Транспорт C2.** Пакет, пришедший внутри ZIP, доходит до адаптера без изменений; серая зона
   внутри архива ведёт себя так же, как в папке **[тест T-S-14]**.
6. **Дедупликация C1 не затронута.** Пакетный вход не участвует в группах LM Studio; LM-набор
   в одиночном прогоне и в прогоне рядом с пакетом даёт идентичные записи и счётчики
   **[тест T-S-15]**.

Универсальной диспетчеризации не появилось: добавлен только одноключевой метод серой оценки
`Adapter.gray()` (по умолчанию `0.0`) и функция `gray_claim()` для одного сообщения оператору.
У восьми существующих форматов серой зоны нет — их детект и импорт не изменились **[код, T-S-3]**.

---

## 2. Изменённые файлы и назначение правки

| Файл | Строк | Что изменилось |
| --- | --- | --- |
| `G:\Strawberry\importer_v2\adapters\strawberry_v1.py` | 497 | **Новый.** Адаптер пакета: детект и серая оценка, разбор `chat.json`, вывод ID, построение беседы и вложений, проверка `manifest.json`, безопасная адресация `.dat` |
| `G:\Strawberry\importer_v2\adapters\base.py` | 129 | Добавлен метод `Adapter.gray(payload, path) -> 0.0` с пояснением, зачем он нужен только пакету C3 |
| `G:\Strawberry\importer_v2\adapters\__init__.py` | 75 | Регистрация `StrawberryV1Adapter` **выше** `BrowserV1Adapter` (приоритет при равных правах на вход), алиасы `strawberry` / `strawberry.v1` / `strawberry.package`, функция `gray_claim()` |
| `G:\Strawberry\importer_v2\engine.py` | 1316 | Счётчик `packages` в `ImportStats`; два правила «не чат» для служебных файлов пакета; блок серой зоны (`AMBIGUOUS`) в `_run_file`; коды `ambiguous_id` / `ambiguous_format` → `AMBIGUOUS`; `_merge_pkg_stats()` и `_pkg_warnings()`; пакетные ключи в белом списке `_trim_report`; исключение каталога пакета из `ASSETS_GUARD` |
| `G:\Strawberry\importer_v2\report.py` | 203 | Ключ `packages` в сводке; int-гард `nodes_outside_active` (значение `"unknown"` больше не ломает отчёт); отдельный флаг `branches_unknown`; строка сводки по пакетам и строка про `AMBIGUOUS` |
| `G:\Strawberry\import2.py` | 234 | Абзац про пакет в справке; `strawberry` в подсказке `--source`; `packages` в строке `ИТОГ`; `AMBIGUOUS` в наборе счётчиков, дающих код возврата 1 |
| `G:\Strawberry\importer_v2\tests\test_strawberry_v1.py` | 1124 | **Новый.** 15 кейсов матрицы T-S, 113 проверок |
| `...\Workspace\StrawberryEdition\experiments\probe_stageC3_packages.py` | 116 | **Новый.** Проба «до/после» по 7 пакетным фикстурам с повторным прогоном (идемпотентность) |

Не изменялись (проверено по времени файла): `importer_v2\attachments.py` (272 стр., 11:16),
`importer_v2\model.py` (236 стр., 13.11), `importer_v2\graph.py`, `importer_v2\timeutil.py`,
`importer_v2\adapters\lmstudio.py` (728 стр., 17:34 — C1), `importer_v2\adapters\browser_v1.py`
(147 стр., 13.11), `importer_v2\adapters\chatgpt.py` (414 стр., 14.11),
`importer_v2\container.py` (346 стр., 18:44 — C2), `importer_v2\store.py` (225 стр., 17:15 — C1)
**[проба: инвентаризация файлов]**.

### 2.1 Как устроен адаптер (коротко)

* **Детект.** `detect()` — 0.97 при маркере; 0.75, если маркера нет, но есть пакетная
  провенанс-пара (`profile: "strawberry"` + `profileVersion` или `$schema` из strawBerry).
  `gray()` — 0.75 только при отсутствии маркера. `parse()` без маркера бросает
  `AdapterError("ambiguous_format")`, пустой пакет — `strawberry_empty`.
* **ID.** `conversationId` из `chat.json` (при его отсутствии — из `manifest.json`, с
  предупреждением), затем строгий `_URL_C_RE` = `https?://chatgpt\.com/(?:g/[^/?#]+/)?c/<uuid>`
  (свой regex, а не общий `base._URL_ID_RE`, чтобы не принять `/c/<что угодно>`), иначе
  `AdapterError("ambiguous_id")`. Разовые идентификаторы вида `share-`, `guest-`, `anon-`,
  `tmp-`, `chat-` отклоняются тем же путём (решение C0 §6, вариант Б) **[код]**.
* **Вложения.** `make_attachment(kind, "strawberry", source_id=<assetId>, …)`; байт передаётся
  через `_local_path`, дальше работает штатный стаджинг: он сам считает SHA256 и размер, ставит
  `status = "available"` и URL `/api/attachments/<chat_id>/<sha>.<ext>`, определяет тип по
  сигнатуре. Проверки адаптер выполняет **до** стадии: `not_found`, `not_a_regular_file`,
  `size_mismatch`, `sha_mismatch`, `sha_missing`, `manifest_missing`, `manifest_unreadable`,
  `manifest_entry_missing`, `manifest_name_unsafe`, `asset_id_unsafe`, `no_attachment_id`
  **[код]**.
* **Имена файлов вложений.** Техническое имя `attachments/<assetId>.dat` подменяется исходным
  именем из `attachments/conversation_asset_file_names.json` (в прогоне по фикстурам имена
  стали «отчёт.pdf» и «рис.png») **[проба]**.
* **Ветки.** `branches = {"leaf_policy": "source_active_chain", "roots": 1,
  "nodes_total": n, "nodes_active": n, "nodes_outside_active": "unknown", "branch_points": 0,
  "alt_leaves": 0, "visited": n, "declared_leaf": <export.activeLeaf>}` **[проба]**.

---

## 3. Новые тесты: результат

Модуль `importer_v2\tests\test_strawberry_v1.py` (15 кейсов, **113 проверок, 0 провалов,
0 пропусков**). Пуск: `python -m importer_v2.tests.test_strawberry_v1`; песочницы — только
`%TEMP%\stageC3_<кейс>_<случайное>`, рабочий архив не открывается.

| Кейс | Что проверяет | Итог |
| --- | --- | --- |
| T-S-1 | маркер → `strawberry.v1` 0.97; место в реестре выше BrowserV1; алиас `--source strawberry`; имя `chatgpt-<id>.json`; `source` остаётся `chatgpt`; служебные файлы помечены своим именем и причиной | PASS |
| T-S-2 | без маркера: `gray_claim` = 0.75, `AMBIGUOUS`, код 1, чатов и вложений ноль; BrowserV1 (0.9) пакет не перехватывает; явный `--source browser` разбирает по-старому; явный `--source strawberry` без маркера — тоже `AMBIGUOUS` | PASS |
| T-S-3 | `profileVersion` без маркера: обычный export-v1 идёт как шёл (`NEW`, имя по URL); уверенности LM Studio и Markdown не изменились; адаптер пакета на них отвечает 0.0 | PASS |
| T-S-4 | нет `conversationId` и нет UUID в `/c/` → `AMBIGUOUS`, код 1, файлов ноль; разовый ID `guest-…` → то же; UUID из `/c/` без `conversationId` → имя `chatgpt-<uuid>.json`, код 0; `AdapterError` с кодом `ambiguous_id` | PASS |
| T-S-5 | тот же ID ChatGPT: один файл `chatgpt-<uuid>.json`, действие `SKIP`/`UPDATE`, бэкап ровно при `UPDATE`, обратный порядок (сначала браузер, потом пакет) — тот же результат | PASS |
| T-S-6 | корректный манифест: оба вложения `available`, файлы названы реальным SHA256, размер из байтов, имена из манифеста имён, `packages.verified = 2`; без `manifest.json` — беседа импортирована, вложения `manifest_missing` и не `available` | PASS |
| T-S-7 | подменённые байты: `sha_mismatch`, не `available`, байты не скопированы, рядом проверенное вложение цело, причина в записи, в `parse_report` и в предупреждениях, код 0 | PASS |
| T-S-8 | нет `sha256` в манифеста и нечитаемый `sha256` → `sha_missing`, не `available`, переноса нет | PASS |
| T-S-9 | неверный `size` в манифеста → `size_mismatch`, `declared_size` сохранён, переноса нет | PASS |
| T-S-10 | четыре недоверенных имени (`../…`, `/…`, `C:\…`, `attachments/sub/…`) → `manifest_name_unsafe`, ни одно не `available`, байты не взяты, хотя файлы лежат в пакете; нет записи в манифеста → `manifest_entry_missing` | PASS |
| T-S-11 | пустой текст + вложение → сообщение сохранено, картинка `available`; пустое без вложений и служебная роль отброшены и посчитаны | PASS |
| T-S-12 | `nodeId`/`parentId` → `message_id`/`parent_id` по порядку экспорта; `leaf_policy = source_active_chain`, `nodes_outside_active = "unknown"`, `branch_points = 0`; сводка не падает (флаг `branches_unknown`, `by_source.chatgpt.nodes_outside_active = 0`); `activeLeaf` вне последнего сообщения → предупреждение | PASS |
| T-S-13 | повторный импорт: `SKIP`, `staged 0 / reused 2`, файлы чатов и вложений те же, побайтово то же содержимое записи, бэкапов ноль, ложных ошибок разбора ноль | PASS |
| T-S-14 | пакет в ZIP: контейнер принят, 6 записей распаковано, адаптер тот же, `container` у входа и `source_container*` у беседы, вложения `available`, временная область удалена (и при `AMBIGUOUS` тоже) | PASS |
| T-S-15 | LM Studio один и LM Studio вместе с пакетом: имена файлов и записи побайтово совпадают (кроме `imported_at`), счётчики `dup_groups = 1`, `dup_group_members = 2`, `dup_members = 1`, `DUP = 1` в обоих прогонах, коды возврата равны; пакет при этом импортирован штатно | PASS |

---

## 4. Полный регресс этапов A / B / C1 / C2

Один и тот же запуск, интерпретатор `C:\ProgramData\miniconda3\envs\strawberry\python.exe`,
`$env:PYTHONIOENCODING="utf-8"`, `python -m compileall -q importer_v2 import2.py` → exit 0.

| Модуль | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| `test_engine_robustness` (этап A) | 68 | 0 | 0 |
| `test_lmstudio_attachments` (этап B) | 104 | 0 | 0 |
| `test_deepseek` | 135 | 0 | 13 |
| `test_chatgpt_attachments` (этап B) | 99 | 0 | 0 |
| `test_lmstudio_merge` (этап C1) | 95 | 0 | 0 |
| `test_zip_transport` (этап C2) | 195 | 0 | 0 |
| **регресс вместе** | **696** | **0** | **13** |
| `test_strawberry_v1` (C3) | 113 | 0 | 0 |
| **всего за прогон** | **809** | **0** | **13** |

13 пропусков — это собственные пропуски кейса 12 `test_deepseek` («сплошная проверка реального
комплекта»), описанные в отчёте этапа A: модуль сам печатает `ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ
(пропущено: 13)`. Ни одна прежняя проверка не исчезла и не перестала проходить **[проба]**.

Отдельно про фикстуры C2: `FIXTURE_EXPECT` в `test_zip_transport.py` проверяет только
транспортный уровень (принятые записи, отказ архива, лимиты), поэтому новые действия по
беседам его не ломают; синтетический «пакет будущего формата» из T-Z-05 после C3 даёт
`AMBIGUOUS` вместо `undetected`, и проверки кейса сохранены, так как запись входа содержит
`error`, а адаптер — ровно `strawberry.v1` **[тест]**.

---

## 5. Приёмочные проверки

### 5.1 Сравнение «до / после» на 7 пакетных фикстурах

Проба `experiments\probe_stageC3_packages.py` (песочницы `%TEMP%\stageC3_before` — код до C3,
`%TEMP%\stageC3_final` — финальный код, повторный прогон с той же меткой).

| Фикстура | До C3 | После C3 |
| --- | --- | --- |
| `pkg_ok.zip` | `NEW` через `browser.export-v1` 0.9: **вложений 0**, ID из URL, предупреждение о потерях | rc=0, `NEW 1`, `not_a_chat 3`; `strawberry.v1` 0.97; `chatgpt-c0conv-0001.json`; вложения `records 2, staged 2, unique 2`, файлы `…\2383be5b….pdf` (2070 б) и `…\4c7fff5e….png` (49 б) |
| `pkg_no_format.zip` | молча импортировал BrowserV1 (`NEW 1`, вложения потеряны) | rc=1, `AMBIGUOUS 1`, чатов и вложений ноль, в отчёте входа — объяснение и подсказка `--source` |
| `pkg_bom.zip` | `read_errors 1` | rc=1, `read_errors 1` (без изменений: BOM вне контракта) |
| `pkg_sha_mismatch.zip` | `NEW` BrowserV1, вложений 0 | rc=0, `NEW 1`; PNG принят (`staged 1`), PDF отклонён (`missing 1`, `sha_mismatch`) |
| `pkg_size_mismatch.zip` | `NEW` BrowserV1, вложений 0 | rc=0, `NEW 1`; PNG принят, PDF отклонён (`size_mismatch`) |
| `pkg_missing_bytes.zip` | `NEW` BrowserV1, вложений 0 | rc=0, `NEW 1`, `missing 1`, `remote 1` (у PNG есть `sourceUrl` — remote, но не `available`) |
| `pkg_two_chats.zip` | два `chat.json` через BrowserV1, вложений 0 | rc=0, `NEW 2`, `chatgpt-c0conv-0001.json` и `chatgpt-c0conv-0002.json`, по 2 принятых вложения, предупреждение о несовпадении `conversationId` манифеста |

### 5.2 Повторный импорт

Второй прогон тех же архивов в ту же песочницу: **`SKIP` во всех случаях, где беседа была
импортирована** (`pkg_ok`: `SKIP 1`, `staged 0`, `reused 2`; `pkg_two_chats`: `SKIP 2`,
`reused 4`), файлы чатов и вложений не изменились, каталог `backup` пуст во всех семи
песочницах (`chats=1/4003б, attachments=2/2119б, backup=0б` у `pkg_ok`) **[проба]**.

### 5.3 Как разрешились вложения (архивная запись `pkg_ok`)

```
id chatgpt-c0conv-0001  source chatgpt  source_kind package  original_id c0conv-0001
model gpt-4o  time_confidence source  created_at 2026-01-10T12:00:00Z  updated_at 2026-01-10T12:00:20Z
branches {"leaf_policy":"source_active_chain","roots":1,"nodes_total":2,"nodes_active":2,
          "nodes_outside_active":"unknown","branch_points":0,"alt_leaves":0,"visited":2,
          "declared_leaf":"node-1"}
сообщение user      message_id node-0 parent_id null    время 2026-01-10T12:00:00Z
   вложение file   source_id file-A1  имя «отчёт.pdf»  status available  mime application/pdf
                  size 2070  sha256 2383be5b…5026  url /api/attachments/chatgpt-c0conv-0001/2383be5b…5026.pdf
                  size_note «в сообщении заявлен размер 2067, файл 2070»
сообщение assistant message_id node-1 parent_id node-0  время 2026-01-10T12:00:20Z  текст пустой
   вложение image source_id file-A2  имя «рис.png»     status available  mime image/png
                  size 49   sha256 4c7fff5e…41c2       url /api/attachments/chatgpt-c0conv-0001/4c7fff5e…41c2.png
parse_report {"adapter":"strawberry.v1","time":{"parsed":2,"missing":0,"units":["s"]},
              "attachments":{"records":2,"verified":2,"refused":0,"names_from_manifest":0,"reasons":{}},
              "package":{"dir":"…\\strawberry-import-37188-c823aadb\\1","manifest":true,
                         "manifest_files":2,"manifest_error":null},
              "dropped_messages":0,"skipped_roles":0}
```

Ни одного Base64-прохода, ни одного лишнего каталога: байты взяты из `.dat` пакета, файлы в
архиве названы SHA256 этих байтов **[проба]**.

### 5.4 Logic LM Studio не изменилась

Подтверждено тестом T-S-15 (записи и счётчики совпадают в одиночном и совместном прогоне) и
сохранением всех 95 проверок `test_lmstudio_merge.py` и 104 проверок
`test_lmstudio_attachments.py` **[тест]**.

### 5.5 Рабочий архив не тронут

Замер после всех прогонов C3 — ровно то же состояние, что после C2:
`chats` 2113 файлов / 197 546 466 б; `attachments` 1233 файла / 422 854 521 б / 332 папки;
`backup` 46 файлов / 4 350 710 б. Временных областей распаковки в `%TEMP%` после прогонов не
осталось **[проба]**.

---

## 6. Решения и отклонения от постановки

1. **`AMBIGUOUS` даёт код возврата 1.** В `STAGE_C0_DECISIONS_AND_CONTRACTS.md` §2.5 строка 130
   относит `AMBIGUOUS` к коду 1, а строки 136–137 говорят «служебные счётчики кода не портят».
   Для C3 принято решение в пользу **кода 1**, как прямо требует постановка C3 (§2.2 и §5):
   сомневающийся вход не должен выглядеть удачным **[код: `import2.py`, `exit_code`]**.
2. **Появился метод `gray()` + `gray_claim()`.** Это не диспетчер C4, а одна оценка «на кого вход
   похож, но не достаточно уверенно». Без неё 0.75 молча проигрывало 0.9 BrowserV1, то есть
   пакет всё равно перехватывался и импортировался без вложений — а это §2.1 прямо запрещает.
   У остальных восьми форматов `gray()` возвращает 0.0, их поведение не изменилось **[код, T-S-3]**.
3. **Служебные файлы пакета помечаются `not_a_chat` с явной причиной** (`manifest.json` —
   «манифест пакета strawberry.v1…», `*.dat.meta.json` — «метаданные вложения пакета…»), иначе
   они выглядели бы нераспознанными входами. Правило срабатывает только при соседнем `chat.json`,
   поэтому обычный `manifest.json` официального экспорта OpenAI так не помечается **[код, T-S-1]**.
4. **Каталог пакета исключён из проверки `ASSETS_GUARD`** (`Engine._is_strawberry_package`:
   `chat.json` + `manifest.json` + каталог `attachments/`, а также `attachments/` самого пакета).
   Без этой правки пакетная папка ложно требовала `--assets-dir` и прогон падал с кодом 3,
   хотя байты лежат внутри пакета. Это единственная правка предпроверки ассетов; для
   официального экспорта ChatGPT поведение прежнее **[код, проба: до правки pkg-папка давала
   `ASSETS_GUARD`, rc=3]**.
5. **`_asset_ref` намеренно не используется.** В `_stage_one` есть ветка «байт не передан, но есть
   `asset_ref` и резолвер», которая при `--assets-dir` могла бы перебить `_local_path` пакета
   чужим ChatGPT-резолвером и подставить другой файл. Дедупликация вложений в пределах беседы
   работает через `source_id` (= `attachmentId`) **[код]**.
6. **`nodes_outside_active = "unknown"` потребовал правки отчёта.** `summarize()` суммировал это
   поле как число, и строка ломала весь отчёт (`TypeError` → `FATAL-FILE`). Добавлен int-гард и
   отдельный флаг `branches_unknown`; агрегат `by_source.chatgpt.nodes_outside_active` остаётся
   числом **[код, T-S-12]**.
7. **Авторитет по размеру — манифест.** Заявка сообщения о размере сравнивается только для
   предупреждения (`size_note`), отказ по размеру даёт расхождение манифеста с реальными
   байтами. В фикстурах `pkg_ok` заявка сообщения (2067 и 45 б) расходится с файлом (2070 и 49 б) —
   вложение принято, расхождение видно в записи **[проба]**.
8. **BOM в `chat.json` не разворачивается.** Контракт — UTF-8 без BOM; вход с BOM остаётся
   `read_errors` (код 1). Правка вне C3 **[проба: pkg_bom]**.
9. **Пакет без `manifest.json` импортируется, но вложения не `available`** (`manifest_missing`):
   проверить байты нечем, а терять саму беседу нельзя. Контракт C3 §2.3 при этом не ослаблен:
   `available` без манифеста невозможен, контракт не «подкручен» под старые sidecar LM Studio
   **[тест T-S-6]**.
10. **Второй `chat.json` в пакете импортируется** с предупреждением о том, что `conversationId`
    манифеста ему не принадлежит (манифест один на пакет). Пакет по контракту — одна беседа,
    но молча выбросить вторую беседу хуже, чем предупредить **[тест, проба: pkg_two_chats]**.
    Это решение оспорено замечанием пользователя от 21.11.2026: случай противоречит контракту
    пакета C0, а предупреждения о несовпадении идентификатора недостаточно. Детальный разбор и
    предпочтительное поведение — §11; правки не было, решение не принято.
11. **Жёсткое правило имени из манифеста.** Принимается ровно `attachments/<assetId>.dat`
    (2 сегмента, без `..`, без ведущего `/` и `\`, без буквы диска). Если запись манифеста
    опасная, байты **не берутся**, даже когда файл `attachments/<assetId>.dat` реально лежит
    рядом: без корректной записи манифеста нет никакого разрешения открывать путь **[тест T-S-10]**.
12. **Разовые идентификаторы отклоняются** (`share-`, `guest-`, `anon-`, `tmp-`, `chat-`) →
    `AMBIGUOUS`. Это вариант Б решения C0 §6; строгий regex `/c/` в форке `chatgpt.js:22-31`
    — задача A-серии, не C **[код, T-S-4]**.
13. **`source_fields` адаптера не попадает в архивный файл** — так устроено у всех форматов
    (`_build_doc` эти поля не пишет). Нужные сведения о листе сохраняются в
    `branches.declared_leaf`, о пакете — в `parse_report.package` **[проба]**.
14. **Для пакета из ZIP `parse_report.package.dir` — путь во временной области**, которая потом
    удалена; идентичность входа держится на `container`, `source_container*`, `original_id` и
    `content_hash` (правило C2 сохранено) **[проба]**.

### Риски

* Явный `--source browser` над пакетом разбирает его как export-v1 и **теряет вложения молча**:
  rc=0, ноль предупреждений, теряются оба вложения и одна реплика, а идентификатор уходит в
  семейство `browser-…`. Это подтверждено замером и относится **и к пакету с маркером** тоже;
  подробнее и с числами — раздел 9. Снимается только отдельным решением (защита явного обхода)
  или диспетчером C4; разрешений на такую правку не выдавалось.
* `min_confidence` по умолчанию 0.4: порог серой зоны 0.75 выше порога, поэтому `AMBIGUOUS`
  виден всегда; при понижающих флагах детекта поведение не менялось.
* `nodes_outside_active = "unknown"` означает, что по пакету нельзя судить о полноте цепочки:
  альтернативные ветки StrawBerry в экспорте не представлены. Честно отмечено флагом
  `branches_unknown` **[код]**.

---

## 7. Открытые вопросы (переданы в C4 / D)

1. Основанием группы дедупликации пакетов должен стать `conversationId`; план C1 устроен так,
   что меняется только поле-основание (в C3 группы пакетов не строились).
2. Диспетчер входов и универсальный `--plan` (C4): спорные пары `DUP_SUSPECT` не получают второй
   файл архива; классификатор `classify_input` (PDF/MP3/docx → «не чат») не делался.
3. `--unpack-dir` / `--keep-unpacked` в окне импорта и сохранение распакованного пакета для
   повторной проверки — этап D.
4. Многотомные архивы — отказ; склейка входов работает только в пределах одного прогона.
5. Известные дефекты не правились: 9 `parse_errors` реального среза, 10 из 74 sidecar без
   `sha256Hex`, флик R4 (rc=4 при конкурентных писателях), пустые оболочки → `DUP` (C1),
   тождественно ложная ветка `engine.py:543`.
6. Случай `1787399266109` (имя файла ≠ идентификатор беседы) и пакетный путь для
   share/гостевых бесед (вариант Б: пакетный путь их отвергает → `AMBIGUOUS`) зафиксированы
   здесь как решение, а не как дефект.

---

## 8. Где что сохранено

* **Код:** `G:\Strawberry\importer_v2\adapters\strawberry_v1.py`,
  `G:\Strawberry\importer_v2\adapters\base.py`,
  `G:\Strawberry\importer_v2\adapters\__init__.py`,
  `G:\Strawberry\importer_v2\engine.py`,
  `G:\Strawberry\importer_v2\report.py`,
  `G:\Strawberry\import2.py`,
  `G:\Strawberry\importer_v2\tests\test_strawberry_v1.py`.
* **Проба «до/после»:** `C:\Users\User\Documents\Strata\Workspace\StrawberryEdition\experiments\probe_stageC3_packages.py`.
* **Проверка двух пунктов приёмки (раздел 9):**
  `…\experiments\verify_stageC3_source_guard.py`, лог `…\experiments\stageC3_source_guard_run.txt`,
  песочницы `%TEMP%\stageC3_srcguard\A_gray_auto|B_gray_forced_browser|C_marked_forced_browser|D_marked_auto|E_identity_after_forced|F_strict_flag|G_mixed_inputs`.
* **Защита явного выбора источника (раздел 10):** тот же проверочный скрипт, лог замера после
  правки `…\experiments\stageC3_source_guard_run_after_fix.txt`; лог модуля C3
  `…\experiments\stageC3_test_guard_run.txt`; лог полного регресса
  `…\experiments\stageC3_guard_regression.txt`. Метки изменённых файлов: `strawberry_v1.py`
  21:10, `import2.py` 21:11, `report.py` 21:11, `test_strawberry_v1.py` 21:15, `engine.py` 21:17
  (21.11.2026). Песочницы тестов защиты — `%TEMP%\stageC3_guard_*`; замер поведения до правки —
  `%TEMP%\srcguard_pre_<фикстура>_<источник>`.
* **Разбор `pkg_two_chats.zip` (раздел 11):** `…\experiments\analyze_stageC3_two_chats.py`,
  лог `…\experiments\stageC3_two_chats_analysis.txt`, песочницы `%TEMP%\stageC3_twochats\import_once`
  и `%TEMP%\stageC3_twochats\compare_ok`.
* **Фикстуры пакета:** `…\experiments\stageC_fixtures\zip_packages\` — 19 архивов
  (описание каждого — `…\stageC_fixtures\README.md`); для C3 используются 7:
  `pkg_ok`, `pkg_no_format`, `pkg_bom`, `pkg_sha_mismatch`, `pkg_size_mismatch`,
  `pkg_missing_bytes`, `pkg_two_chats`.
* **Песочницы замеров:** `%TEMP%\stageC3_before` (код до C3), `%TEMP%\stageC3_after`
  (промежуточный код), `%TEMP%\stageC3_final` (финальный код + повторный прогон);
  песочницы тестов — `%TEMP%\stageC3_<кейс>_*`. Песочницы этапов A/B/C1/C2 сохранены:
  `stageA_verify`, `stageB_sandbox`, `%TEMP%\stageC1_accept|synth|real`,
  `%TEMP%\stageC2_accept`, `stageC2_accept_folder`, `stageC2_synth*`.
* **Отчёты:** этот файл; прежние — `STAGE_A_RELIABILITY_REPORT.md`,
  `STAGE_B_IMPLEMENTATION_REPORT.md`, `STAGE_C1_LM_DEDUP.md`, `STAGE_C2_ZIP_TRANSPORT.md`.
* **Официальные документы (точечные дополнения после приёмки):**
  `G:\Strawberry\docs\DEVELOPMENT_STATUS.md` (п. 5 абзац про C3), `docs\ROADMAP.md` (п. 1.4),
  `docs\DECISIONS.md` (D-11), `docs\DATA_FORMATS.md` (новый раздел про `strawberry.v1`).

---

## 9. Проверка двух пунктов окончательной приёмки (21.11.2026 20:50, код не менялся)

Пользователь принял C3 предварительно и оставил два пункта на проверку: (1) не теряет ли
незаметно вложения явный `--source browser`; (2) не затронуло ли разрешение противоречия C0 по
коду возврата отдельный контракт `--strict-ambiguous` (код 5). Замер:
`experiments\verify_stageC3_source_guard.py` (лог `experiments\stageC3_source_guard_run.txt`),
входы — фикстуры `pkg_ok.zip` (с маркером) и `pkg_no_format.zip` (без маркера), песочницы
`%TEMP%\stageC3_srcguard\<кейс>`; рабочий архив в этих прогонах не читался и не писался.

### 9.1 Пункт 1: явный обход теряет вложения молча — и шире, чем значилось в рисках §6

| Кейс | Вход и запуск | rc | Файл чата | Реплик в записи | Записей вложений | Файлов в `attachments\` | Предупреждений |
|---|---|---|---|---|---|---|---|
| A | `pkg_no_format.zip` без `--source` | 1 | — | — | — | 0 | **1**: в сводке названа потеря вложений и идентификатора |
| B | `pkg_no_format.zip` + `--source browser` | 0 | `browser-c0conv-0001.json` | 1 из 2 | **0** | **0** | **0** |
| C | `pkg_ok.zip` (маркер есть) + `--source browser` | 0 | `browser-c0conv-0001.json` | 1 из 2 | **0** | **0** | **0** |
| D | `pkg_ok.zip` без `--source` (эталон) | 0 | `chatgpt-c0conv-0001.json` | 2 | 2, обе `available` | 2 | 0 |
| E | сначала B, затем D в тот же архив | 0 | **два файла**: `browser-c0conv-0001.json` и `chatgpt-c0conv-0001.json` | 1 + 2 | 0 + 2 | 2 | 0 |
| G | папка с двумя пакетами, без `--source` | 1 | `chatgpt-c0conv-0001.json` | 2 | 2 | 2 | 1 (серая зона по одному входу) |

Выводы по пункту 1:

1. **Автоматический путь защищён:** вход останавливается (`AMBIGUOUS 1`, rc=1), а предупреждение
   прямо говорит: «разобрать его сейчас готов только `browser.export-v1` — с потерей вложений и
   идентификатора. Импорт остановлен, нужен явный выбор оператора (`--source`)» **[замер A]**.
2. **Явный обход не предупреждает ни о чём** (замер B): rc=**0**, предупреждений **0**, при этом
   теряются оба вложения, **и одна реплика**: в пакете две реплики, а в архивную запись
   export-v1 попала одна — пустая по тексту реплика с картинкой адаптером export-v1 отбрасывается.
   То есть потери не частичные, а тихие **[замер]**.
3. **Риск шире, чем было записано в §6:** он касается **и пакета с маркером** (замер C). Явный
   `--source browser` отключает и маркер формата, и проверки `manifest.json`, и весь адаптер
   `strawberry.v1` — пакет с корректным маркером разбирается как export-v1 и теряет вложения так же
   молча **[замер]**.
4. **Обход не заменяет импорт, а добавляет вторую запись на ту же беседу** (замер E): после обхода
   в архиве лежит `browser-c0conv-0001.json` без вложений; последующий корректный импорт создаёт
   `chatgpt-c0conv-0001.json` со статусом `NEW`, а не склеивает её с неполной записью (разные
   `source`). Итог: в архиве остаётся копия беседы без вложений и без предупреждений **[замер]**.
5. Смешанный прогон (замер G) корректен: `AMBIGUOUS` на одном входе не мешает импорту пакета с
   маркером (`NEW 1`, 2 принятых вложения), rc=1 как и требует контракт **[замер]**.

Это подтверждает замечание пользователя: защита действует ровно до тех пор, пока оператор не
выбрал источник явно. Снятие дефекта — **отдельное решение, не C3**: по-видимому, пакет (с маркером
или в серой зоне) при явом `--source browser` должен отклоняться с причиной вида
`source_mismatch_package_needs_strawberry` (код 1), а разбор export-v1 — требовать отдельного
явного подтверждения потери вложений (например `--allow-source-mismatch`). Разрешения на эту
правки не выдавалось, код не менялся. Не проверялся и остаётся открытым тот же риск при
`--source chatgpt` над пакетом (ветка официального экспорта ChatGPT).

### 9.2 Пункт 2: контракт `--strict-ambiguous` (код 5) не затронут

| Что проверено | Факт |
|---|---|
| Флаг в CLI этапа C3 | `--strict-ambiguous` **не объявлен**: `import2.py: error: unrecognized arguments: --strict-ambiguous`, rc=**2**, ноль записей (замер F) |
| Коды, которые возвращает `exit_code()` | 0, 1, 3, 4 (2 — обрабатывает argparse). **Кода 5 в коде нет** |
| `AMBIGUOUS` в перечне счётчиков кода 1 | присутствует, наряду с `DUP_SUSPECT` (C1) и `ZIP_ERRORS` (C2) |
| Смешанный прогон (замер G) | обычный `AMBIGUOUS` даёт код 1 и не меняет исхода остальных входов прогона |
| Упоминания `--strict-ambiguous` в официальных документах | 3, все про C4: `docs\ROADMAP.md` (стр. 56), `docs\DEVELOPMENT_STATUS.md` (стр. 181), `docs\DECISIONS.md` (стр. 189) |
| Разрешение противоречия C0 §2.5 | зафиксировано в `docs\DECISIONS.md` (D-11, «Выполнено по этой записи (21.11.2026, 20:30)», п. 1) и в `docs\DATA_FORMATS.md` §14.6; туда же добавлена явная оговорка, что код 5 появляется **только** с `--strict-ambiguous` в C4 и в C3 не реализован |

Точная формулировка разрешения противоречия: в C0 §2.5 строка 130 относит `AMBIGUOUS` к коду 1, а
строки 136–137 называют служебные счётчики «не портящими код». Принято решение в пользу строки 130
и буквального требования постановки C3 (сомневающийся вход не должен выглядеть удачным). Код 5 —
это **другой** контракт: он включается только флагом `--strict-ambiguous`, флага в C3 нет, значит
никакого пересечения с правкой C3 нет **[код, замер]**.

### 9.3 Влияние на статус C3

Правок кода после приёмки не выполнялось: реализация C3 осталась ровно в том виде, в котором она
принята предварительно. Пункт 2 закрыт документально; пункт 1 оформлен как **отдельное решение по
защите явного обхода** (микро-правка в `engine.py`/`import2.py` + тест, без изменения контрактов
C0/C1/C2/C3) — разрешение выдано пользователем 21.11.2026 21:07 и выполнено, см. §10. Разрешений
на C4 не выдавалось.

---

## 10. Защита явного выбора источника (разрешение пользователя 21.11.2026 21:07, выполнено)

### 10.1 Что было разрешено и что именно изменено

Разрешение (смысловая формулировка пользователя): пакет с маркером `strawberry.v1` при явном
`--source browser` или `--source chatgpt` должен отклоняться; пакет в серой зоне без маркера —
тоже; причина `source_mismatch_package_needs_strawberry`; код возврата 1; никакой частичной
записи чата или вложений; источник автоматически не подменять; флаг `--allow-source-mismatch`
не добавлять; общую систему выбора адаптеров не менять; C4 не начинать. Дополнительно: для
`--source chatgpt` сначала воспроизвести поведение на фикстуре, а защиту строить на
распознавании пакета, а не на предположении, что две ветки ведут себя одинаково.

| Файл | Строк было → стало | Суть правки |
| --- | --- | --- |
| `importer_v2/adapters/strawberry_v1.py` | 497 → 524 | функция `package_shape(payload, path)` (строки 416–439) — признак пакета, независимый от выбранного адаптера: маркер `format`, структура профиля StrawBerry (`profile`/`profileVersion`/`$schema`), каталог пакета (`chat.json` + `manifest.json` + `attachments/`); константа `REASON_SOURCE_MISMATCH` |
| `importer_v2/engine.py` | 1316 → 1350 | в ветке явного `--source` (строки 941–975): если выбранный адаптер — не `strawberry.v1`, а `package_shape` непустой, вход отклоняется целиком; ключи входа `source_mismatch`, `error`, `package_shape`, `requested_source`, `adapter`, `confidence`; счётчик `SOURCE_MISMATCH`; предупреждение прогона; печать `[ИСТОЧНИК НЕ ПОДХОДИТ]` |
| `import2.py` | 234 → 241 | `SOURCE_MISMATCH` входит в набор счётчиков, дающих код возврата 1; абзац в `exit_code` |
| `importer_v2/report.py` | 203 → 209 | отдельная строка в человекочитаемой сводке (счётчики из `counts` универсальны) |
| `importer_v2/tests/test_strawberry_v1.py` | 1124 → 1292 | переписан T-S-2, добавлен T-S-16, обновлена шапка модуля |

Не тронуты: реестр адаптеров и `detect_adapter` (`adapters/__init__.py`), `attachments.py`,
`container.py`, логика LM Studio и дедупликации C1, учёт `manifest.json`/SHA256 в пакете,
автоматический выбор источника, контракт `--strict-ambiguous`. Флаг обхода не добавлен **[код]**.

### 10.2 Почему защита опирается на распознавание пакета: поведение до правки

Замер перед правкой (песочницы `%TEMP%\srcguard_pre_<фикстура>_<источник>`, 21.11.2026 20:55–21:05)
показал, что ветки ведут себя по-разному, и «раз обе ломаются — значит одинаково» было бы неверно:

| Вход | `--source browser` | `--source chatgpt` | `--source lmstudio` |
| --- | --- | --- | --- |
| `pkg_ok.zip` (с маркером) | rc=0, `NEW 1`, `not_a_chat 3`, вложений 0 файлов, файл `browser-c0conv-0001.json`, в записи 1 реплика из 2 — **тихая потеря** | rc=1, `parse_errors 1`, записей нет | rc=1, `parse_errors 1`, записей нет |
| `pkg_no_format.zip` (серая зона) | rc=0, `NEW 1`, вложений 0 — тихая потеря | rc=1, `parse_errors 1` | rc=1, `parse_errors 1` |

Значит: для `browser` защита предотвращает реальную потерю вложений и сообщений и второй файл
беседы (семейство `browser-...` вместо `chatgpt-...`); для `chatgpt` и `lmstudio` она заменяет
непрозрачный «ошибка формата» на различимую причину. Проверка идёт **до** разбора, по признаку
пакета, поэтому одинаково работает для всех девяти явных источников (все алиасы `--source`
разрешаются в 9 id адаптеров; кроме `strawberry`/`strawberry.v1`/`strawberry.package`) **[код, замер]**.

### 10.3 Замер после правки (тот же сценарий A–G)

Лог: `experiments\stageC3_source_guard_run_after_fix.txt`, скрипт
`experiments\verify_stageC3_source_guard.py`, песочницы `%TEMP%\stageC3_srcguard\<кейс>`.

| Кейс | Ожидание | Результат после правки |
| --- | --- | --- |
| A. `pkg_no_format.zip` без `--source` | `AMBIGUOUS`, rc 1 | `AMBIGUOUS 1`, rc=1, записей нет — без изменений |
| B. `pkg_no_format.zip` + `--source browser` | отказ | `SOURCE_MISMATCH 1`, rc=1, чатов 0, вложений 0, бэкапов 0; причина в отчёте входа и в предупреждении |
| C. `pkg_ok.zip` + `--source browser` | отказ | `SOURCE_MISMATCH 1`, rc=1, записей нет; признак пакета в отказе — маркер формата |
| D. `pkg_ok.zip` без `--source` | импорт как раньше | rc=0, `NEW 1`, пакеты `package_chats 1 / records 2 / verified 2`, файл `chatgpt-c0conv-0001.json`, 2 файла вложений — без изменений |
| E1→E2. отказ, затем честный импорт в тот же архив | одной записи достаточно | после E1 чатов 0; после E2 rc=0, `NEW 1`, чатов 1, второй записи нет |
| F. `pkg_no_format.zip --strict-ambiguous` | rc=2 (флаг относится к C4) | rc=2, `import2.py: error: unrecognized arguments` — без изменений |
| G. папка с двумя пакетами без `--source` | сбой одного входа не мешает другому | `NEW 1` + `AMBIGUOUS 1`, rc=1, 2 принятых вложения — без изменений |

Частичной записи нет ни в одном отказном кейсе: `chats` пуст, `attachments` пуст, `backup` пуст,
временных областей распаковки не осталось **[замер, тест]**.

### 10.4 Тесты и регресс

* T-S-2 переписан под новый контракт: раньше он проверял, что явный `--source browser` разбирает
  пакет по-старому; теперь — что он даёт `SOURCE_MISMATCH` и ни одной записи. Проверка
  `--source strawberry` без маркера → `AMBIGUOUS` осталась.
* Новый T-S-16 (28 проверок): пакет с маркером папкой при `--source browser`; пакет с маркером в
  ZIP при `--source chatgpt` (и отсутствие `parse_errors` — отказ различим); серая зона папкой при
  `--source browser` и при `--source lmstudio` (и отсутствие `AMBIGUOUS`); контроль `--source
  strawberry` и контроль без `--source` (импорт и 2 принятых вложения); смешанный каталог
  (пакет с маркером + пакет в серой зоне + обычный export-v1) при `--source browser` — `NEW 1` для
  выгрузки, `SOURCE_MISMATCH 2` для пакетов, rc=1, вложений и бэкапов от пакетов нет, у входа
  выгрузки ключа `source_mismatch` нет; тот же смешанный каталог без `--source` — `NEW 2`,
  `AMBIGUOUS 1`, `SOURCE_MISMATCH` нет (ложных срабатываний защиты нет); `--source strawberry`
  над export-v1 → `AMBIGUOUS`, а не тихий импорт; отсутствие временных областей **[тест]**.
* Модуль C3: 16 кейсов, 141 проверка, провалов 0 — `experiments\stageC3_test_guard_run.txt`.
* Полный регресс (`experiments\stageC3_guard_regression.txt`): `test_engine_robustness` 68,
  `test_lmstudio_attachments` 104, `test_deepseek` 135 (+13 SKIP), `test_chatgpt_attachments` 99,
  `test_lmstudio_merge` 95, `test_zip_transport` 195, `test_strawberry_v1` 141 →
  **837 PASS / 0 FAIL / 13 SKIP**.
* `python -m compileall -q importer_v2 import2.py` — без ошибок.
* Рабочий архив не тронут: `chats` 2113 файлов / 197 546 466 б, `attachments` 1233 файла /
  422 854 521 б / 332 подкаталога, `backup` 46 файлов / 4 350 710 б — те же числа, что и до
  начала C3 **[замер 21.11.2026 21:25]**.

### 10.5 Границы правки

Правка не меняет выбранный источник автоматически; флага «разрешить несоответствие» нет; диспетчер
входов и `--plan` не тронуты (это C4); `--strict-ambiguous` по-прежнему не реализован; автоопределение
и `--min-confidence` не изменены. Обратная сторона не является частью этой правки: явный
`--source strawberry` над не-пакетом даёт `AMBIGUOUS` (у адаптера нет маркера) — это поведение,
принятое в C3. Пакет с двумя чатами (§11) этой защитой не отклоняется: правка касалась только
несоответствия выбранного источника.

---

## 11. Разбор `pkg_two_chats.zip` (отдельное замечание пользователя; код не менялся)

Скрипт `experiments\analyze_stageC3_two_chats.py`, лог `experiments\stageC3_two_chats_analysis.txt`,
песочницы `%TEMP%\stageC3_twochats\import_once` и `...\compare_ok`. Фикстура: `chat.json`,
`chat2.json`, один `manifest.json`, `attachments/file-A1.dat` (2070 б, PDF),
`attachments/file-A2.dat` (49 б, PNG), `file-A1.dat.meta.json`, `conversation_asset_file_names.json`;
размер архива 2531 б.

### 11.1 Как второй чат связан с манифестом и вложениями

| Факт | Значение |
| --- | --- |
| `conversationId` в `chat.json` / `chat2.json` | `c0conv-0001` / `c0conv-0002` |
| `conversationId` единственного `manifest.json` | `c0conv-0001` (то есть только первая беседа) |
| `manifest.files[]` | 2 строки: `attachments/file-A1.dat`, `attachments/file-A2.dat` — один и тот же набор для обеих бесед |
| `attachmentId` в репликах | `file-A1` и `file-A2` в **обоих** файлах чатов, идентичных по содержимому |
| второй манифест или признак принадлежности второй беседы | отсутствуют |
| байты `.dat` | совпадают с манифестом (размер и SHA256), SHA256 в репликах нет; заявка реплики о размере (2067/45) расходится с манифестом (2070/49) — по решению C3 авторитетен манифест |

То есть второй чат получает вложения из чужого комплекта байт: в пакете нет ничего, что
доказывало бы принадлежность `file-A1`/`file-A2` беседе `c0conv-0002`. Проверка целостности при
этом честная — под угрозой не содержимое файла, а привязка файла беседе.

### 11.2 Что реально попадает в архив

| Показатель | `pkg_two_chats.zip` | `pkg_ok.zip` (корректный пакет той же беседы) |
| --- | --- | --- |
| код возврата | 0 | 0 |
| счётчики входов | `NEW 2`, `not_a_chat 3` | `NEW 1`, `not_a_chat 3` |
| счётчики пакетов | `package_chats 2 / records 4 / verified 4` | `package_chats 1 / records 2 / verified 2` |
| файлы чатов | `chatgpt-c0conv-0001.json`, `chatgpt-c0conv-0002.json` | один файл |
| файлы вложений | 4 файла, 4238 б, уникальных SHA256 — 2 | 2 файла, 2119 б |
| резервные копии | 0 | 0 |
| повторный прогон | `SKIP 2`, новых файлов 0 | `SKIP 1`, новых файлов 0 |

Байты дублируются: `2383be5b…5026.pdf` и `4c7fff5e…41c2.png` лежат в каталогах обеих бесед.
Счётчики пакетов завышены вдвое относительно контракта «один пакет — одна беседа».

### 11.3 Почему предупреждение нельзя считать достаточным

Предупреждение есть, но только в отчёте конкретной беседы
(`chats[].report.warnings`): «`manifest.json` описывает беседу «c0conv-0001», а не «c0conv-0002»:
в пакете больше одной беседы или манифест от другой беседы». При этом `summary.warnings` пуст,
отдельного счётчика нет, `refused 0`, код возврата 0. В обычной сводке прогона случай незаметен,
а повторный прогон закрепляет состояние (`SKIP 2`), и исправить его можно только вручную **[замер]**.

Позиция пользователя (от 21.11.2026): это противоречит контракту пакета C0; предупреждение о
несовпадении идентификатора не заменяет проверку целостности структуры; считать такой случай
штатным импортом нельзя. Подтверждаю: контракт C0 §3 («один пакет = одна беседа, один
`manifest.json`) в фикстуре нарушен, а импортёр этого нарушения не детектирует.

### 11.4 Предпочтительное поведение (решение не принято, правки не было)

Нарушение структуры пакета — отклонять **весь пакет целиком**, без частичного импорта: ни первой,
ни второй беседы, ни вложений, с отдельной причиной (условно `package_multiple_chats`) и своим
счётчиком, чтобы случай не маскировался под предупреждение; код возврата — как у остальных
отклонений входа (1). Молча импортировать одну беседу из двух тоже нельзя: это частичная запись,
от которой отказались ещё в решении C0. Реализация требует решения, как именно считать
«одним пакетом» вход-папку и вход-ZIP (признак: несколько файлов вида `chat.json` рядом с одним
`manifest.json`) — это отдельная правка и отдельное разрешение; в разрешённую защитную правку
этого подэтапа она сознательно не включена.

---

**Статус:** C3 реализован, протестирован, принят internally и предварительно принят пользователем.
Пункт 1 замечаний пользователя подтверждён замером и **выполнен**: защита явного `--source`
реализована, протестирована (T-S-16, 141 проверка в модуле C3, 837 PASS в регрессе), контракты
C0/C1/C2/C3 и код 5 не затронуты. Пункт 2 закрыт документально. Разбор `pkg_two_chats.zip`
выполнен (§11): случай противоречит контракту пакета, предпочтительное поведение — отказ от всего
пакета без частичного импорта; **решение по нему не принято, правки не было**. **C4 без отдельного
разрешения пользователя не начинался; C3 остаётся предварительно принятым до закрытия вопроса
о пакете с двумя чатами.**
