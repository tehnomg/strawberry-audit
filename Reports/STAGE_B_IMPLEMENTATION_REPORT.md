# Этап B — реализация: вложения и легаси-формат LM Studio. Отчёт

Дата: 21.11.2026, 13:35 (Asia/Yekaterinburg).
**Статус (21.11.2026, 14:22): этап B завершён и принят пользователем предварительно** по
результатам этого отчёта. Дополнительных исправлений, правки ретраев под тест R4 и перехода
к этапам C и D не выполнялось; следующая работа — только аудит этапа C без реализации.
Границы: реализация в объёме плана `STAGE_B_LMSTUDIO_PLAN.md` с учётом восьми решений
пользователя. Расширения объёма и архитектуры не потребовалось. К этапам C и D не переходил.
Рабочие `chats\`, `attachments\`, `backup\` для экспериментов не использовались: все прогоны —
во временных песочницах.

## 1. Что изменено в коде (фактически)

Объём правок по файлам (строки на 21.11.2026; базовые снимки 14.11.2026 лежат в
`experiments\stageA_baseline\` — это состояние **до этапа A**, поэтому для `import2.py`,
`engine.py` и `report.py` рост показан от него; снимка состояния «после этапа A» нет):

| Файл | 14.11 (до этапа A) | сейчас | comment |
|---|---|---|---|
| `import2.py` | 111 | 179 | этап A: +коды завершения, `ИТОГ`, `--report`; этап B: пояса вместо дефолта, блок `lmstudio` |
| `importer_v2\engine.py` | 476 | 761 | этап A: изоляция ошибок, tmp, `updated_eff`; этап B: пояса, классификация легаси, `stats.lmstudio`, правило модели |
| `importer_v2\report.py` | 133 | 151 | этап B: блок `lmstudio` в сводке и в тексте |
| `importer_v2\adapters\lmstudio.py` | — | 676 | 291 строка до этапа B → 676: пояса, проверки имени/размера/хэша, sidecar'ы, легаси-разбор |
| `importer_v2\adapters\base.py` | — | 123 | +поле `lmstudio_files_dirs` |
| `importer_v2\tests\test_lmstudio_attachments.py` | — | 887 | новый тест, 104 проверки (T-B1…T-B24) |

**`G:\Strawberry\importer_v2\adapters\lmstudio.py`** (291 → 676 строк)

- Добавлены константы форматов: `SIDE_SUFFIX = ".metadata.json"`, `USER_FILES_SUBDIR =
  "user-files"`, `IDENT_NAME_RE = r"^\d{10,14} - (.+)$"`, `LEGACY_SUFFIX = ".chat.json"`,
  `LEGACY_META_SUFFIX = ".metadata.chat.json"`, `LEGACY_CFG_SUFFIX = ".config.chat.json"` и
  причины исхода поиска: `exact`, `sidecar_preview`, `size_mismatch`, `sha_mismatch`,
  `name_case_only`, `not_found`, `identifier_not_a_file_name`, `no_user_files_root`.
- `safe_user_files_name()` — отбраковка идентификаторов, которые могут увести за каталог:
  `/`, `\`, `os.sep`/`os.altsep`, `.`, `..`, ведущая точка, drive-буква `x:`, `\x00`, переводы строк.
- `resolve_user_file(identifier, dirs, want_size=…, note=…)` — единая процедура поиска байтов
  по поясам. Правила: имя обязано совпасть с идентификатором **посимвольно** (сверка по реальному
  списку каталога — `_listing()`; в Windows `exists()`/`open()` не различают регистр и молча
  подсовывают «похожий» файл); размер обязан совпасть с заявленным в записи беседы или в sidecar;
  если в sidecar есть `sha256Hex`, сверяется хэш **фактических байтов**. Пояс с непроверенным
  файлом не считается удачей — переход к следующему поясу, а подробности расхождения
  (`declared_size`/`found_size`, `declared_sha`/`found_sha`) уходят в `resolve_errors` отчёта.
  Если байт-файла нет, но есть осиротевший sidecar с `preview.data`, берутся байты превью
  (в выгрузке `preview.data` = полные байты картинки, отношение 1,000).
- `read_sidecar()` / `sidecar_name()` / `name_from_identifier()` / `_preview_of()` — работа с
  `<идентификатор>.metadata.json` (`type`, `sizeBytes`, `originalName`, `fileIdentifier`,
  `preview.data`, `sha256Hex`) и восстановление исходного имени вложения.
- Легаси-выгрузка: `_legacy_shape()` (верхний уровень ровно `{messages}`, сообщения `{role,
  content}` без `versions`), `_legacy_model()` (модель из `lastUsedModel.title`, затем
  `currentPreset.name`), `_count_attachment_records()`. `detect()` даёт 0,9 (современный
  `.conversation.json`) и 0,8 (легаси) — раньше легаси не распознавался вовсе.
- `_one_legacy()` — импорт легаси-беседы: `id` и заголовок из `<id>.metadata.chat.json`,
  `time_confidence = "none"` (меток времени в легаси нет), пометка `legacy_format`, счётчик
  `legacy_imported`.
- `_one()` — запись модели с источником (`model_source`: `senderInfo.senderName` /
  `lastUsedModel.identifier` / `preset` / заглушка + предупреждение), поддержка **обеих** реальных
  форм записей вложения (`fileIdentifier` и `identifier` + `name`, плюс старая `id`), счётчики
  `record_form_*`, счётчик `alt_version_attachments` (вложения невыбранных версий ответа),
  блок `rep["attachments"]` с разбивкой `resolved / exact / size_mismatch / sha_mismatch /
  name_case_only / not_found / no_user_files_root / identifier_not_a_file_name / sidecar_preview /
  names_restored`. Отсутствующие вложения получают `status = "missing"` и видимое поле
  `resolve_error`, а не «молчаливую доступность».

**`G:\Strawberry\importer_v2\engine.py`**

- `is_lm_legacy_candidate()` и константы суффиксов легаси — классификация файлов **до** чтения.
- `ImportEngine.lmstudio_roots(inputs)` — четыре пояса: `explicit` (явный флаг), `portable`
  (`user-files` внутри выбранной папки), `neighbor` (соседняя `user-files`), `local`
  (`Path.home()\.lmstudio\user-files`, переопределяется переменной `LMSTUDIO_FILES_DIR`; путь не
  зашит с именем пользователя). Переносимая папка важнее соседней и локальной.
- `_lm_covered_ids()` — парсинг всех `*.conversation.json` ради `createdAt` (только если в входе
  есть легаси-кандидат); `_lm_file_class()` — разметка: чат / sidecar с причиной /
  `legacy_covered` («легаси-копия беседы, уже представленной современным `.conversation.json`»).
- `_collect_inputs` + `_run_file_guarded(..., covered)`: покрытые семейства помечаются `LEGACY_DUP`,
  служебные файлы LM — `not_a_chat`; ни то ни другое **не влияет на код возврата**.
- `_merge_lm_stats()` и `_lm_warnings()`: сводка LM Studio в статистику прогона и три формулировки
  предупреждений (выдаются только если в чате реально были вложения).
- Правило понижения модели в `_import_chat()`: если в архиве уже известна модель, а новая копия
  приносит заглушку источника, заглушка **не записывается**, модель сохраняется, в отчёт беседы
  уходит `model_kept`.
- `_trim_report()` дополнен ключами `model_source`, `alt_version_attachments`, `legacy_format`,
  `legacy_sidecar` (иначе они вырезались из файла чата).

**`G:\Strawberry\import2.py`**

- Убран дефолт «локальная папка LM Studio»: `--lmstudio-files-dir` — только явный верхний пояс,
  остальные пояса определяются сами (в help описан порядок).
- В строку `ИТОГ` добавлен блок `"lmstudio"` (пояса с флагом `exists`, счётчики записей, форм,
  исходов поиска, `legacy_covered`, `sidecars_skipped`); в докстринге `exit_code` зафиксировано,
  что `not_a_chat` и `LEGACY_DUP` кода не портят.

**`G:\Strawberry\importer_v2\report.py`**

- `summarize()` добавляет блок `lmstudio`; `summary_text()` печатает пояса (с `exists`), счётчики
  записей/исходов/легаси и до 5 деталей `resolve_errors`.

**`G:\Strawberry\importer_v2\adapters\base.py`** — в `Context` добавлено
`lmstudio_files_dirs: tuple = ()`; одиночное поле `lmstudio_files_dir` помечено устаревшим.

**`G:\Strawberry\importer_v2\tests\test_engine_robustness.py`** — тестовой обёртке `BoomEngine`
добавлен параметр `covered=None` (подпись `_run_file` изменилась).

## 2. Тесты

Новый файл **`G:\Strawberry\importer_v2\tests\test_lmstudio_attachments.py`** — 104 проверки,
0 провалов. Матрица T-B1…T-B24:

| № | Что проверяется | Итог |
|---|---|---|
| T-B1 | байты по явному `--lmstudio-files-dir` | PASS |
| T-B2 | соседняя `user-files` без флага (переносимый пакет) | PASS |
| T-B3 | `user-files` внутри выбранной папки экспорта | PASS |
| T-B4 | приоритет переносимой папки над соседней и локальной (по байтам) | PASS |
| T-B5 | явный флаг важнее переносимой папки | PASS |
| T-B6 | локальная папка через `LMSTUDIO_FILES_DIR` | PASS |
| T-B7 | имя совпало, размер нет → `missing` + `size_mismatch` + детали в отчёте | PASS |
| T-B8 | размер совпал, SHA256 из sidecar нет → `sha_mismatch` | PASS |
| T-B9 | файл отличается только регистром → `name_case_only`, байты не приняты | PASS |
| T-B10 | в первом поясе размер неверен, во втором верный → взят второй, отказ виден в отчёте | PASS |
| T-B11 | `../evil.pdf`, `sub/dir/x.pdf`, `..\evil2.pdf`, `C:\...` → за пояс не выходим | PASS |
| T-B12 | восстановление имён: `originalName` из sidecar, иначе из идентификатора | PASS |
| T-B13 | обе формы записей в одном чате (`fileIdentifier`, `identifier` + `name`) | PASS |
| T-B14 | байт-файла нет, `preview.data` есть → байты из превью, `source_bytes` | PASS |
| T-B15 | вложения невыбранных версий: посчитаны в отчёте, в архив не идут | PASS |
| T-B16 | легаси: покрытое семейство → `LEGACY_DUP` с причиной, непокрытое → импорт один раз, rc 0 | PASS |
| T-B17 | легаси: `id`, заголовок и модель из `metadata.chat.json`, `time_confidence = none` | PASS |
| T-B18 | `user-files` в обходе: не-чаты не портят код возврата, предупреждения нет | PASS |
| T-B19 | правило «не понижать известную модель до заглушки» + обратный порядок прогонов | PASS |
| T-B20 | повторный прогон идемпотентен: SKIP, reused, 0 бэкапов, имена сохранены | PASS |
| T-B21 | нет `user-files` → предупреждение и `missing`, чаты импортируются; без вложений предупреждения нет | PASS |
| T-B22 | блок `lmstudio` в `ИТОГ` и в JSON-отчёте, локальный пояс из переменной окружения | PASS |
| T-B23 | реальный срез `G:\Strawberry\import` (см. раздел 3) | PASS |
| T-B24 | регресс теста надёжности этапа A | PASS |

Регресс (запуск из `G:\Strawberry`): `test_engine_robustness` — 68 проверок, шесть прогонов подряд,
все 0 провалов; `test_deepseek` — 135 проверок, 0 провалов; `test_chatgpt_attachments` — 99
проверок, 0 провалов. Всего в тестах этапа B и регрессе: 406 проверок, 0 провалов.

Замечание честно: в одном прогоне `test_engine_robustness` (до правок счётчиков) упал тест
параллельных записей R4 — один из четырёх одновременных процессов получил код 4 (`WRITE_ERRORS`).
Шесть прогонов после правок чистые; путь записи (`store.atomic_write`, tmp-имена, ретраи) на этапе
B не менялся, так что это гонка четырёх конкурентных писателей под Windows, а не регресс этапа B.
Отдельной задачи не открывал; при повторении — сказать, поправлю ретраи `os.replace`.

Финальный контрольный прогон всех четырёх наборов (21.11.2026, 13:40, после всех правок):
`test_lmstudio_attachments` 104 / 0, `test_engine_robustness` 68 / 0, `test_deepseek` 135 / 0,
`test_chatgpt_attachments` 99 / 0 — коды возврата 0, проваленных проверок нет.

## 3. Замеры: до и после

Все прогоны — в песочницах (`%TEMP%\stageB_final`, `%TEMP%\stageB_meas`); рабочий архив не тронут.

**Реальный вход `G:\Strawberry\import` (1 000+ файлов: 543 LM-беседы, 318 легаси-файлов,
74 вложения + 74 sidecar, Markdown, `user-files`), песочница `%TEMP%\stageB_final`:**

| Показатель | Прогон 1 | Прогон 2 (повтор) |
|---|---|---|
| Код возврата | 1 (из-за 11 пустых/не-бесед) | 1 |
| NEW / UPDATE / SKIP | 328 / 104 / 104 | 0 / **0** / **536** |
| `LEGACY_DUP` / `not_a_chat` | 105 / 286 | 105 / 286 |
| `parse_errors` | 11 | 11 |
| Вложения: записей / перенесено / reused / missing | 58 / 57 / 1 / **0** | 58 / 0 / 58 / **0** |
| `lmstudio`: `exact` / `resolved` / `names_restored` | 58 / 58 / 57 | 58 / 58 / 57 |
| `lmstudio`: `record_form_fileIdentifier` / `identifier` | 57 / 1 | 57 / 1 |
| `lmstudio`: `legacy_covered` / `sidecars_skipped` | 105 / 286 | 105 / 286 |
| Пояса | `portable = G:\Strawberry\import\user-files` (есть), `neighbor = G:\Strawberry\user-files` (нет), `local = C:\Users\User\.lmstudio\user-files` (есть) | те же |
| Бэкапов создано | 104 | **0** (всего 104) |
| Файлов чатов / вложений в песочнице | 328 / 57 | 328 / 57 |
| Время | 3 с | 2 с |

**Сравнение с замерами аудита (старый код, `experiments\stageB_scenarios_report.txt`):**

| Сценарий | До этапа B | После этапа B |
|---|---|---|
| Экспорт + `user-files` рядом, без флага | `records 11, staged 0, missing 11` — вложения терялись | T-B2: вложения перенесены без флага |
| `user-files` внутри папки экспорта | `records 11, staged 0, missing 11` | T-B3: перенесены (пояс `portable`) |
| Только локальная папка LM Studio | без флага `staged 0`; помогал только явный флаг | T-B6: работает пояс `local`, имя пользователя не зашито |
| Приоритет нескольких копий `user-files` | не определялся | T-B4/T-B5: переносимая > соседняя > локальная, флаг важнее всех |
| Имена вложений в архиве | `name = None`, `name = 'doc.txt'` при `status = missing` | `names_restored` = 57 из 58 записей |
| Проверки подлинности | их не было (файл принимался по существованию) | размер + SHA256 по фактическим байтам; отказ виден в `resolve_error` и `resolve_errors` |
| Повторный прогон трёх копий одного экспорта (30 бесед) | `UPDATE 60, SKIP 30`; бэкапов 30 → 90 → 150 | T-B19/T-B20: `SKIP`, 0 бэкапов; на реальном срезе 536 SKIP вместо 208 UPDATE и 208 бэкапов |
| Файлы старого формата (12 файлов) | `rc = 1, undetected 12` — формат не распознавался | распознаются: покрытые семейства → `LEGACY_DUP` + `not_a_chat`, rc не портится |

UPDATE на **первом** прогоне остался (104) — это легитимное «повышение» модели с заглушки на
настоящую; исчезают повторные UPDATE и лишние бэкапы. Полная склейка дублей по `createdAt` — этап C.

## 4. Оставшиеся дефекты и границы

1. **11 `parse_errors`** — не дефект этапа B: 7 пустых `*.conversation.json`, 1 пустая легаси-беседа
   (`1777470656790.chat.json`, буквально `{"messages": []}`, 20 байт) и 3 Markdown-файла без
   сообщений. Они и раньше давали код 1; поведение оставил как есть (пустой источник — ошибка входа).
2. **`lmstudio`-заглушка как значение модели** — по замерам этапа C (21.11, `experiments\stageC_dup_report.txt`,
    раздел 4) утверждение о 130 чатах с заглушкой **не подтвердилось**: из 130 файлов `chats\lmstudio-*.json`
    значение модели `"lmstudio"` не встречается ни у одного (модели настоящие, например
    `gemma-4-12b-it-aeon…`), `time_confidence: coarse` у 127, поля нет у 3, `parse_report.model_source`
    нет ни у одной записи (архив писался кодом до этапа B), ключа `model_kept` в файлах нет (он живёт
    в отчётах прогонов). Миграция существующих записей **не требуется**. Замер показал также, что
    `original_id` ни одного из 130 архивных чатов не совпадает с `createdAt` из выгрузки
    `G:\Strawberry\import\conversations`: беседы этой выгрузки в рабочем архиве ещё не импортировались,
    поэтому первый импорт создаст 333 записи и конфликтов `original_id` с архивом не будет.
3. **10 из 74 экспортных sidecar без `sha256Hex`** — проверяется только размер; хэш по байтам
   считается и сохраняется в архиве, но сверять с источником не с чем.
4. **Вложения ответов ассистента и их показ в UI**, `inline`-раздача видео/аудио, служебные поля
   вложений — открытые вопросы прошлых этапов, решения не принято.
5. **Гонка четырёх одновременных писателей (R4)** наблюдалась один раз (см. раздел 2).
6. Легаси-беседа `1777470656790` не импортирована, потому что она пуста; причина в отчёте
   (`LM Studio легаси: в файле нет сообщений`). В архиве её id нет — дубликата не возникло.
7. Общий прогон по рабочему архиву **не запускался** (запрет до этапа C).

## 5. Рабочий архив не изменён

Замер после всех работ: `chats` — 2 113 файла, `attachments` — 332 папки / 1 233 файла,
`backup` — 46 файлов, `*.tmp` — 0, битых JSON — 0. Последние записи: `chats` —
20.11.2026 00:16:24, `attachments` — 15.11.2026 12:50:08, `backup` — 19.11.2026 23:46:12, то есть
ни один файл архива сегодня не менялся. Повторный замер после финальных прогонов тестов и
измерений (21.11.2026 13:40): те же числа и **ноль файлов, изменённых сегодня** ни в `chats`,
ни в `attachments`, ни в `backup`.

## 6. Где что лежит

- Код: `G:\Strawberry\import2.py`, `G:\Strawberry\importer_v2\{engine.py, report.py,
  adapters\base.py, adapters\lmstudio.py}`; тесты: `G:\Strawberry\importer_v2\tests\`
  (`test_lmstudio_attachments.py` — новый, `test_engine_robustness.py` — поправка подписи).
- Документация StrawBerry: `G:\Strawberry\docs\DATA_FORMATS.md` — новый раздел 12 (форматы LM
  Studio, `user-files`, sidecar'ы, легаси, правила поиска) и правки разделов 6 и 8;
  `G:\Strawberry\docs\DEVELOPMENT_STATUS.md` — пункт 8 раздела 5 про `import2.py`/`importer_v2`.
- Этот отчёт, аудит и техплан этапа: `Workspace\StrawberryEdition\STAGE_B_LMSTUDIO_AUDIT.md`,
  `STAGE_B_LMSTUDIO_PLAN.md`, `STAGE_B_IMPLEMENTATION_REPORT.md`.
- Песочницы: `%TEMP%\stageB_final\` (реальный вход, прогоны 1–2, отчёты `rep1.json`, `rep2.json`),
  `%TEMP%\stageB_meas\` (срезы), `Workspace\StrawberryEdition\experiments\stageB_sandbox\`
  (187,3 МБ, копия выгрузки для сканов), `experiments\stageA_verify\` (569,9 МБ — сохранена).
- Скрипты и отчёты аудита: `experiments\run_stageB_*.py`, `stageB_{scan,probe,scenarios,scenarios2}_report.txt`.

## 7. Что дальше (не начато)

Этап C — склейка дублей LM-экспорта по `createdAt` (`DUP` объявлен в `store.py:122` и не
используется) и связанные с ним вопросы порядка чатов; этап D — остальное по списку. Оба требуют
отдельного разрешения. Общий прогон по рабочему архиву до этапа C по-прежнему не делался.
