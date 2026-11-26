# Исследование: промпты для пяти image-генераторов WanGP (Krea 2, MOSS Image, Qwen Image 2.1, MiniMax H3 Image, Fibo 2)

Дата: 2026-11-27. Режим: только исследование и документы, ничего не внедрялось.
Все пути ниже — только чтение; изменены только файлы этого workspace (`SP4Strawberry\`).

Условные метки достоверности:
- **[офиц]** — официальная документация/карточка/код разработчика модели;
- **[код-WanGP]** — официальные исходники и доки WanGP (копия дерева `wangp_research\WanGP-994642c87b…`, локальная установка `D:\WanGP-v2010`);
- **[стенд]** — подтверждено локальными прогонами на этом стенде (объём выборок см. §7);
- **[не подтв]** — не подтверждено, предположение или пробел.

---

## 1. Аудит имеющихся материалов

### 1.1 Что уже есть и пригодено как основа

| Материал | Содержание | Статус |
|---|---|---|
| `Krea2_PromptEnhancer\Krea2_Knowledge.md` | трассировка Krea 2 в WanGP, официальные данные Krea 2 (§10), лимит промпта, механизм Edit | **[офиц]+[код-WanGP]**, но визуальный этап эксперимента не сделан |
| `Krea2_PromptEnhancer\sources\` | официальные копии: `krea2_prompting.md`, `krea2_expansion.txt` (системный промпт оф. expander'а), `README.md`, `encoder.py`, `sampling.py`, HF-карточки Raw/Turbo, `SOURCES.md` | **[офиц]** |
| `Krea2_PromptEnhancer\instructions\` | 5 готовых текстов инструкций энхансера (T/T1/TI0/TI1 + community addendum), с указанием слота, режима и `max_tokens` | **[стенд]**, текстовые метрики; кадры не сняты |
| `Qwen21PromptSkills\REPORT.md` + `sources\` | официальные `system_prompt_t2i.txt` (10 045 Б), `system_prompt_edit.txt` (18 344 Б), `pe_core.py`, README Qwen-Image-2.1 (44 582 Б); извлечённые правила; два готовых текста инструкций в §5 | **[офиц]+[стенд]** (1 прогон на конфигурацию) |
| `WanGP_FineTune_Normalization\QWEN_TI_REPORT.md` | 12 прогонов Qwen 2.1 Turbo в режиме TI | **[стенд]** |
| `MossH3_PromptSkills\sources\` | официальные `MOSS-Image_README.md`, `MOSS-Image_USERGUIDE.md` (ключевой документ), карточки OpenMOSS Base/SFT, официальный `skills/moss-image-prompt-enhancer/SKILL.md`; официальные MiniMax `H3-Image-PE_*` (README, t2i system/task prompts, request params); `P-H3-Image_README.md` (PrunaAI) | **[офиц]** |
| `MossH3_PromptSkills\REPORT.md`, `MossH3_Knowledge.md`, `instructions\` (18 файлов), `tables\` | слепые дуэли «чистый текст / сток / официальная школа / skills-школа», метрика эха, финальные рекомендации | **[стенд]**, n=6–8 заданий, 1 сид на ячейку |
| `ModelInventory\AgeGrid4060_2026-11-20\LORA_RECIPE_MATRIX.md` + `STAGE*_VERDICT.md` | дословные рабочие формулировки промптов (кадрирование, возраст телом, порядок блоков), правила про CFG/негатив/разрешения | **[стенд]**, прикладная серия (не книжные иллюстрации) |
| `wangp_research\` | копия дерева WanGP + официальные доки `docs_MODELS.md`, `docs_SETTINGS.md`, `docs_CHANGELOG.md` | **[код-WanGP]** |
| `Wan2GP\…\models\{moss_image,fibo2,qwen21,minimax_h3,krea2}\` | тексты подсказок UI (`prompt_infos`, `deepy_infos`) и встроенные инструкции энхансера (`prompts.py`, `enhancer.py`, `prompt_enhancer.py`) | **[код-WanGP]** |

Вывод аудита: по четырём моделям есть официальные первоисточники (локальные копии) и локальные прогоны; **готовых текстов-адаптеров под текстовый агент (типа Strawberry) нет ни для одной модели** — существовавшие тексты это системные промпты для LLM-энхансера WanGP, а не инструкции для составителя промптов в чате. Дублировать их целиком в итоговый блок не нужно: они работают только внутри WanGP.

### 1.2 Чего в материалах нет

- **Fibo 2: ни одного локального прогона, кадра, инструкции, матрицы.** Только код WanGP, апстрим-текст релиза 20.10 и карточка Bria (получена в этом исследовании). **[не подтв]** эмпирически.
- Krea 2: визуальный этап верификации инструкций не сделан; измерение влияния обрезки хвоста 512 токенов на кадр — только расчёт из кода.
- Qwen: `T` на turbo не мерился; `T1`/`TI1` не мерились; сравнения с официальным PE-чекпойнтом нет.
- H3: официальный MiniMax PE (`expanded_caption` + `aspect_ratio`) локально не прогонялся; параметры сэмплирования в разных файлах расходятся (8 / 20 / 28 шагов) — см. §5.
- MOSS: рабочий edit-путь не найден (провал замены надписей во всех условиях).
- Нигде нет серии с `prompt_enhancer_randomize_seed: false` → абсолютные баллы разных прогонов несопоставимы, значимы только парные разности внутри одного прогона **[стенд]**.
- Папка `Happ-tuning\` пуста; в `Documentation\INDEX.md` (23.11) не отражены работы 20–22.11.

### 1.3 Противоречия и устаревшее (зафиксировано, не переносить в выводы как факт)

1. `MossH3_PromptSkills\REPORT.md:92` и `Documentation\MossH3_PromptSkills.md:61` указывают размер `M_D2_layout_narrow.txt` = 4510 Б, на диске 6348 Б (4510 — тело между маркерами). **[стенд]**
2. MOSS: победителя между инструкциями C2 и D2 нет (дуэль 65:64 = шум) — «лучшая инструкция MOSS» не установлена.
3. H3: шаги/CFG в материалах расходятся: 8 шагов и «CFG не использовать» (родной P-H3-Image), 20 шагов CFG 1.0 shift 12 (архетипы `minimax_h3_*`), 28 шагов CFG 3.0 (`LORA_RECIPE_MATRIX:27`). Это разные модели/сборки, единой истины нет.
4. У архетипов `minimax_h3_fl2va_pruned` / `ref2va_pruned` режим `T` молча выключается, работают только `T1`/`TI1`; у `minimax_p_h3_image` наоборот — только `T`/`TI` **[код-WanGP]**. Любая автоматика должна читать `capabilities`, а не догадываться.
5. Из сайдкара WanGP поле `prompt_enhancer` вырезано (`wgp.py:9364`) — по файлу нельзя определить, какой профиль применил текст **[код-WanGP]**.
6. Измерения Krea 2 и Qwen делались при `prompt_enhancer_randomize_seed: true` → невоспроизводимы.

---

## 2. Krea 2

### 2.1 Идентичность **[офиц]**
- Издатель: **Krea.ai, Inc.** (HF-организация `krea`). Два открытых чекпойнта: **Krea 2 Raw** (база, без дистилляции) и **Krea 2 Turbo** (8-шаговый дистиллят). HF `createdAt` 2026-06-18; лицензия **Krea 2 Community License v.1 от 22.06.2026** (gated «auto»: форма + согласие; коммерческое использование бесплатно при выручке < $1M/год; производные обязаны начинаться с «Krea 2 …»).
- Архитектура: single-stream MMDiT, обучен с нуля (не FLUX-производный); `features 6144`, `layers 28`, `patch 2`, `channels 16`; текстовый энкодер **Qwen3-VL-4B-Instruct**; VAE — Qwen-Image VAE (f8, 16 каналов). ~12.8B параметров DiT+VAE.
- Официальная формула линейки: **«TRAIN on Raw and RUN on Turbo»**.
- Репаки WanGP: `DeepBeepMeep/krea-2` (`Krea2Raw_bf16`, `Krea2Turbo_bf16`, quanto int8) — совпадение с рабочим именем WanGP подтверждено.
- **Edit-весов у Krea нет.** «Krea 2 Edit / Identity Edit» в WanGP = Turbo или Raw + community full-rank LoRA (автор conradlocke / Lars Bouaraba), переложенный DeepBeepMeep **[код-WanGP]**: `krea2_identity_edit_v1_2`, `krea2_general_edit_v2`, `krea2_identity_edit_v2`.

Источники: https://raw.githubusercontent.com/krea-ai/krea-2/main/README.md · docs/prompting.md · docs/expansion.txt · docs/safety.md · inference.py · encoder.py · sampling.py · autoencoder.py · https://huggingface.co/krea/Krea-2-Raw · /krea/Krea-2-Turbo · https://www.krea.ai/krea-2-licensing · https://huggingface.co/DeepBeepMeep/krea-2 · https://huggingface.co/conradlocke/krea2-identity-edit/raw/main/README.md

### 2.2 Формат промпта **[офиц]**
- «We recommend users to use natural language prompts to generate images. **Long detailed prompts yield best results**, but the model is capable of generating high quality images with minimal prompt engineering. **For text rendering, we recommend putting quotes around the words to be rendered**» (`docs/prompting.md`).
- Официальные примеры — либо плотный абзац прозы, либо цепочка коротких attribute-фраз через запятую (`3D rendered matte black designer toy figure, …, studio lighting, solid vibrant blue background, high contrast minimal composition`). JSON-схем и обязательных полей нет.
- Жёсткий лимит: **512 токенов** (`max_length: 512` в `encoder.py`, WanGP воспроизводит 1:1, `truncation=True`) → доступно ≈ 507 токенов, **обрезается хвост** **[офиц+код-WanGP]**. Практический потолок подписи — порядка 300–450 слов, важное в начале **[стенд]**.
- Синтаксис Stable Diffusion (`(word:1.2)`, `{tok}`, `[]`, `<lora:…>`) **никем не документирован**: промпт уходит как литерал в чат-шаблон Qwen3-VL. Не использовать.
- Официальный expander `docs/expansion.txt` (его правила переносимы): сохранять исходных субъектов и связи, не добавлять объектов; один связный абзац, без маркировки/JSON; план стиля держать внутри рассуждения; точный текст в кавычках; если запрос уже подробный — lightly polish, не раздувать; уважать указанный носителе medium (photo/illustration/painting).

### 2.3 Композиция, свет, стиль **[офиц, из официальных примеров]**
- Ракурс/кадр отдельной фразой: `high-angle wide perspective emphasizes the vast negative space`, `tightly framed medium shot`, `An extreme low-angle close-up captures…`.
- Свет через направление и качество, а не ярлык: `Soft, directional studio lighting highlights her facial features…`, `Harsh, direct lighting highlights intricate skin pores`, `golden hour sunlight hitting rocky orange terrain`.
- Материалы конкретными существительными: `smooth vinyl texture`, `grainy paper texture`, `visible brushstrokes`, `meticulous stippling and cross-hatching`.
- Фон задавать явно, часто `solid … background`. Стиль/носитель — либо первым словом (`vintage analog collage…`, `1990s vintage anime style cel animation`), либо коротким хвостом (`…, halftone texture`, `…, black and white photography`).

### 2.4 Персонаж и преемственность
- Официального механизма переноса внешности в открытых весах **нет**: только seed (`--seed`, в пачке `seed + i`) и словесное описание **[офиц]**. WanGP отмечает сильную сторону: «draw on strong world knowledge… Name the person or landmark, then describe the scene, lighting, and style» (`docs/OVERVIEW.md:17`) **[код-WanGP]**.
- Практический путь для лица — community Identity Edit LoRA (1–2 референса). Правила карточки автора **[сообщество]**: «Say how much of the person is visible»; «Describe the outfit concretely, and what should be gone»; «Describe light by where it lands: "a magenta sign paints the left half of her face pink" beats "neon lighting"»; «Identity Edit V2 is not a general editor… tends to ignore removals, recolors and camera changes»; два LoRA сразу на 1.0 → «pure noise», вместе ~0.6; генерировать ≤2 MP.

### 2.5 Правка и референсы **[код-WanGP]**
- `krea2_*_edit`: **не более двух** референсов («Krea 2 Edit supports at most two Reference Images.», `krea2_handler.py:233`); режим `KI` (первый — главная сцена/субъект) или `I` (все ссылки — люди/объекты вписываются в холст); порядок нумерации = порядок загрузки, включая Control Image первым.
- Формулировка (официальный текст WanGP): короткая прямая инструкция + явный список того, что не менять: `Change the car to matte black; keep its shape, camera angle, lighting and surroundings.`; композиция из двух: `Place the person from image 2 at the table in image 1; preserve their face and clothing, and match the scene lighting.`
- При референсах лимит 512 токенов снимается (`padding="longest"`), но растёт цена по числу/размеру референсов **[код-WanGP]**.

### 2.6 Текст в кадре, негатив, дефекты
- Текст: кавычки обязательны **[офиц]**; отдельного «text-режима» нет. Отказы количественно не измерены **[не подтв]**.
- **Turbo при CFG 0 негатив не читается** (в официальном коде uncond-ветка только `if cfg:`, `sampling.py:113`; в WanGP негатив кодируется лишь при `guidance > 0 or NAG_scale > 1.0`). Подтверждено прогонами: «при CFG 0 негатив не работает и сид не держит позу» **[офиц+код-WanGP+стенд]**. В WanGP выход — NAG (`NAG_scale` 1.0–1.5).
- Дефолты WanGP: Turbo 8 шагов / CFG 0 / бюджет 2048×2048; Raw 52 / CFG 3.5; Raw-Edit 20 / CFG 2; разрешение кратно 16 **[код-WanGP]**.
- Цензурная «сдержанность» вшита в веса (`docs/safety.md`), в WanGP есть разблокирующие LoRA-пресеты **[офиц+код-WanGP]**.
- **[стенд]**: 1080×1920 у Krea 2 даёт чёрные полосы — брать 1024×1536; в крупном открытом плане детская анатомия не держится (для книжных иллюстраций не критично).
- **[стенд, текстовая метрика, без кадров]**: на правке любой энхансер хуже короткой команды пользователя (A 0,00 < C 1,00 < B 2,00 < D 2,67 по метрике отклонения); в t2i преимущества усиления не установлено.

---

## 3. MOSS Image

### 3.1 Идентичность **[офиц]**
- **MOSS-Image**, издатель **OpenMOSS** (Fudan/MOSI.AI): `OpenMOSS-Team/MOSS-Image-Base` и `MOSS-Image-SFT` (HF, анонс 2026-10-16), репо `github.com/OpenMOSS/MOSS-Image`, техрепорт arXiv:2610.23374. Архитектура: **5B single-stream DiT** (42 слоя, dim 3072), текстовый энкодер Qwen3.5-9B (vision-tower вырезан), VAE от FLUX.2. Лицензия **Apache-2.0** (коммерческое использование разрешено).
- Совпадение с рабочим именем WanGP подтверждено: профили «Moss Image 5B Base/SFT» → `DeepBeepMeep/Moss/…moss_image_base_bf16.safetensors`, `moss_image_sft_bf16.safetensors`; провенанс-ревизии зафиксированы в `source_revisions.json`.
- **Официальной edit-модели у OpenMOSS нет** (reference-based generation заявлена как будущая работа). WanGP-профиль «Moss Image 5B Edit SFT» = SFT + адаптер `chinoll/Moss-Image-Edit`, «Edit HQ v4» ≈ `akhaliq/MOSS-Image-Edit-HQ armV4` **[код-WanGP; происхождение репака — предположение по размеру файла, [не подтв]]**.

Источники: https://raw.githubusercontent.com/OpenMOSS/MOSS-Image/main/USERGUIDE.md · README.md · skills/moss-image-prompt-enhancer/SKILL.md · https://huggingface.co/OpenMOSS-Team/MOSS-Image-SFT/raw/main/README.md · https://arxiv.org/abs/2610.23374 · https://huggingface.co/DeepBeepMeep/Moss/raw/main/README.md · https://huggingface.co/chinoll/Moss-Image-Edit

### 3.2 Формат промпта **[офиц]**
- Три формата официально: «MOSS-Image-Base supports multiple input formats, including **natural language, tag sequences, and JSON layouts**».
- Язык: «We recommend English, which has the most training data. Chinese and other languages are also supported».
- Лимит: **до 4096 токенов** (README; в WanGP `truncation=True, max_length=4096`).
- Порядок тегов: **Quality → Score → Meta → Year → Character → Series → Artist → General** (пример `best quality, highres, hatsune miku, vocaloid, @foo bar, 1girl, blue hair`).
- Негатив работает; официальный набор: `nsfw, worst quality, bad anatomy, watermark, jpeg artifact`. Дефолт в профилях WanGP — пустой негатив.
- Синтаксис весов/скобок SD официально не упоминается **[не подтв → не использовать]**.
- Официальные правила составления caption (из `skills/moss-image-prompt-enhancer/SKILL.md`): «Describe visible choices: subject and action, relevant appearance, setting, camera/framing, medium, lighting, materials, palette and mood… **Avoid redundant quality tags, unrequested style changes, arbitrary word budgets and invisible process notes**»; для дизайнерских макетов — «compose the information and imagery together… **Write the intended copy rather than placeholders** such as "headline here"».

### 3.3 Layout-JSON (экспериментальный) **[офиц+код-WanGP]**
Корневые поля: `summary{meta[], canvas:"single", caption}`, `items[{label:"text"|"object", caption, text, bbox:[y_min,x_min,y_max,x_max]}]`, `bbox_coord_space:"abs_centralized"`, `bbox_format:"yxyx"`. Координаты — целые пиксели **от центра канваса**, X вправо, Y вниз: канвас 1024×1024 → ±512. «The model should never calculate these values itself»; координаты должны соответствовать выбранному размеру вывода.
Практика стенда **[стенд]**: bbox-JSON приходит лишь в 33–50 % усиленных кадров; сдвиги объектов при «широких» layout-инструкциях; рабочий режим — узкий триггер (только при ≥4 размещаемых элементах или ≥3 надписях). «Полагаться на T1 как на гарантированный контроль композиции нельзя».

### 3.4 Режимы, правка, референсы
- **[код-WanGP]** флаги энхансера: t2i `['T','T1']` (T = «A Detailed Image Caption», T1 = «An Image Layout with Bounding Boxes»), edit `['T','TI']`; для layout-профиля обязателен `text_prompt_enhancer_max_tokens1: 4096`, иначе молчаливый отказ «Did Not Finish (max_tokens)». Плейсхолдеры `{{width}}/{{height}}/{{half_width}}/{{half_height}}/{{aspect_ratio}}` подставляют выбранный канвас — после смены разрешения layout нужно перезановить.
- Правка: **1–4 упорядоченных референса** (`pipeline.py:66-68`), пиксельных масок нет. Формулировки (официальные тексты WanGP): `Change the background to a sunny beach. Preserve the person, clothing and pose.`; `Keep the person and pose from image 1, dress them in the jacket from image 2, and use the room from image 3 as the background.`; `Replace the sign text with "WELCOME" and preserve its lettering style.` «image 1, image 2» — **обычные слова, не спец-токены**.
- Честное ограничение WanGP: «Reference editing can change surrounding details; it does not lock pixels or provide a mask workflow», «Multi-reference edits may alter composition or unrequested details».
- **[стенд]**: MOSS edit weakest place — замену надписи не выполнил ни в одном из 4 условий (`REPAIRS` вместо `SHOES`), менял композицию при «не изменять ничего вокруг»; узкое место — сам адаптер, а не текст инструкции. Для HQ v4: лучше одно референсное изображение, ограниченная правка, при слабом эффекте CFG 3.5–4.

### 3.5 Текст в кадре, разрешение, сэмплирование
- Сильная сторона: техрепорт — «bilingual long-form text rendering and precise layout control», «average text coverage of **96.3 %**» на LLTB (лучший результат среди открытых) **[офиц]**.
- Задание: строка дословно в кавычках; переносы управлять явно — «To improve text accuracy or control line breaks precisely, insert `\n` or actual line breaks directly into the prompt» **[офиц]**.
- Разрешение: «recommend outputs with **1M, 1.5M, or 2M** total pixels», экстраполяция 0.25M→4M; кратно 16; шаги **≥50**; CFG 3.0 (диапазон 3.0–6.0; «3.0 достаточно для длинных промптов, для коротких повышать»), shift 5.0, Euler; SLG «uncond skip» слой 22 **[офиц]**. WanGP повторяет дефолты 1024×1024 / 50 / 3 / shift 5 **[код-WanGP]**.
- Документированный дефект SFT: «often draws faint, evenly spaced vertical color stripes across smooth areas» (полосы; сильнее на 1536–2048 px) **[сообщество: MATLOWAI/MOSS-Image-SFT-DeBand]**.
- Дистилляции по шагам в официальном релизе нет; скорость не зависит от длины промпта (100–114 с и при 43, и при 195 словах) **[стенд]**.
- Порядок блоков значим: рабочий порядок — тело/кожа → ребёнок+место одним описанием → поза → анатомия → атмосфера → фразой о кадре последней; перефраз дословной формулировки кадрирования ломает кадр **[стенд, узкая прикладная серия]**.

---

## 4. Qwen Image 2.1

### 4.1 Идентичность **[офиц]**
- **Qwen-Image-2.1**, издатель **Qwen (Alibaba)**, репо `github.com/QwenLM/Qwen-Image-2.1`, веса `Qwen/Qwen-Image-2.1`, `Qwen/Qwen-Image-2.1-Turbo`, PE-чекпойнты `Qwen-Image-2.1-PE-T2I`, `-PE-I2I`. Лицензия — **Qwen Research License** (некоммерческая).
- Архитектура: трансформер **7B**, 32 слоя, single-stream с block-causal attention; VAE — 64-канальный **RGBA** autoencoder (16× сжатие), нативная прозрачность; нативное 2K.
- Turbo: те же 7B, **8 шагов**, встроенный график сэмплирования, CFG 1 (дефолт); «Setting `num_inference_steps` alone does not override Turbo's saved schedule».
- WanGP: `qwen_image_21_7B` (+ turbo, viggle swap, 20B-линейка 2512 / edit-plus) — сопоставление подтверждено URL весов `DeepBeepMeep/Qwen_image_2`.

Источники: https://github.com/QwenLM/Qwen-Image-2.1 (README, `prompt_rewrite/prompts/system_prompt_t2i.txt`, `system_prompt_edit.txt`, `pe_core.py`) · https://qwen.ai/blog?id=qwen-image-2.1 · https://huggingface.co/Qwen/Qwen-Image-2.1 · локальные копии `Qwen21PromptSkills\sources\`

### 4.2 Формат промпта **[офиц]**
Официальная инструкция энхансера t2i (правила, подтверждённые влиянием на кадр **[стенд]**):
1. разделение запроса на **fixed** (в кавычках — копируется посимвольно и в своём письме) и **open** (что досочинять); мета-инструкции исполняются молча и не попадают в промпт;
2. соотношение сторон живёт отдельно (поле `wh_ratio`), не в прозе;
3. первая фраза ~20 слов: носитель (poster / photograph / illustration / close-up…), стиль, объект, доминирующая палитра;
4. **инвентарь из 8–14 позиционных фраз** до начала прозы + обход кадра (walk-the-frame): примерно треть предложений начинается с позиции;
5. свет — одним предложением: источник, направление, мягкость/жёсткость, температура, что он делает с тенями/отражениями/материалами;
6. физическая согласованность (тени от света, отражения по тому, что смотрит в поверхность, правдоподобный масштаб и контакт);
7. последнее предложение — резюме (носитель + стиль + объект + палитра); первые и последние предложения alone описывают изображение;
8. описание всегда по-английски, рисуемый текст в кавычках в исходном письме; официально **400–500 слов**, без JSON/markdown/списков/длинных тире, без masterpiece/8K.
Правка (официальный `system_prompt_edit.txt`): Attribute Disentanglement (что меняется и что сохраняется — раздельно), симметричные обязательства leakage/under-reach, `<image1>`, `<image2>` в порядке загрузки, CLAUSE сохранения вместо пересказа, **40–150 слов**.
Локальная адаптация сжата до **300–400 слов (150–250 для простых)**: у qwen21 в WanGP `*_max_tokens = 768`, 400–500 слов при temperature 0.9 рискует обрезкой **[стенд]**.

### 4.3 Механика и референсы **[код-WanGP]**
- WanGP оборачивает промпт в чат-шаблон: t2i `system + user(prompt) + assistant`; для ti2i автоматически вставляет `<image1><|vision_start|>…` и далее `<image2>…` по числу референсов (`qwen21/prompt.py:19-29`) — теги в самом тексте промпта при этом можно писать, они совпадают по именованию.
- До **10 референсов**, порядок = порядок описания. Официальный текст WanGP: `Put the person from <image1> in the jacket from <image2>. Keep the person's face and pose. Number references in their selected order.`
- Старт для base: **40 шагов, guidance 4, ~1024 px**; нативное 2K: 2048×2048, 2400×1792, 2528×1696, 2752×1536 и портретные версии (до ~4.3 МП). **[код-WanGP]**; официально дефолт 2048×2048 и 40 шагов **[офиц]**, в sglang-рецепте `--guidance-scale 1`. Расхождение WanGP (guidance 4) и официального примера (1) — параметры хоста, не промпта.
- Негатив: работает при guidance > 1 («Use the negative prompt to describe unwanted content when guidance is above 1») **[код-WanGP]**; дефолт WanGP — `" "`.
- Прозрачность: официально `This is an RGBA image with transparency. <описание>. The image has alpha channel and the background is transparent.` **[офиц]**.

### 4.4 Текст в кадре и дефекты
- WanGP честно: «**Text-rendering quality is moderate: prefer short text and proofread spelling. Dense infographics are not a recommended use**» **[код-WanGP]**.
- **[стенд, 1 прогон на конфигурацию]**: skills-инструкция улучшила 5 из 6 критериев (плотность 177 → 264 слова, позиционные фразы 4 → 8); при этом проверка TI на turbo (12 прогонов) дала вердикт «энхансер нейтрален с лёгким негативным риском»: 1/6 — пропуск ключевой правки, 1/6 — дрейф неизменяемых областей, +18–24 с. Для edit-ветки энхансер не включать.
- **[стенд]**: Qwen 2.1 лучше других даёт любительский бытовой вид; упорно оставляет на ребёнке бельё — лечится явной формулировкой + негативом; голова/лицо почти всегда целиком в кадре.

---

## 5. MiniMax H3 Image

### 5.1 Идентичность **[офиц]**
- **MiniMax-H3-Image** (MiniMax / Hailuo AI), HF `MiniMaxAI/MiniMax-H3-Image`, создан 2026-11-03, лицензия **MiniMax-H3-Image Community License Agreement**; база — `MiniMaxAI/MiniMax-H3`. GitHub `MiniMax-AI/MiniMax-H3-Image`.
- DiT **33.1B** (50 слоёв, hidden 5376, 56 heads), H3-архитектура без аудиоветки; текстовый энкодер — полный **Qwen3-VL** текст-энкодер MiniMax-H3 (DiT читает скрытые состояния 50-го слоя); VAE: CNN-энкодер + 2D ViT-декодер, 16× сжатие, 24 латентных канала, патч 2×2 → один токен = 32×32 px.
- Дистиллирован до **6 шагов (6 NFE) без classifier-free guidance**; генерирует ~16 МП напрямую, без апскейла. Отдельный **MiniMax-H3-Image-PE** (NVFP4, 17.9 ГБ, дообучен из Qwen3.8-27B) — официальный prompt expander.
- Репак WanGP: `DeepBeepMeep/MiniMax-H3/MiniMax-H3-Image_bf16.safetensors` **[код-WanGP]**.
- **Отдельная модель рядом: P-H3-Image (PrunaAI)** — `minimax_p_h3_image`, производный от H3 FL2VA, 8 шагов, ~8 МП, до 8 референсов, силён в photorealism/editorial. **Это не MiniMax H3-Image**, режимы и длина промпта у них разные (см. 5.4).

Источники: https://huggingface.co/MiniMaxAI/MiniMax-H3-Image/raw/main/README.md · /api/models/MiniMaxAI/MiniMax-H3-Image · https://huggingface.co/MiniMaxAI/MiniMax-H3-Image-PE/raw/main/README.md · https://huggingface.co/PrunaAI/P-H3-Image · `platform.minimax.io/docs/api-reference/image-generation-h3-*`

### 5.2 Формат промпта **[офиц]**
- «MiniMax-H3-Image expects a **detailed English description of the whole image**». Лимит: промпт «used as given, **truncated to 4096 tokens**».
- **Негативный промпт не поддерживается и отвергается API** (`negative_prompt | Not supported | Rejected`). Исключения пишутся внутрь описания **[офиц]**.
- Структура официального примера t2i-промпта (официальный файл `examples/revised_prompt.t2i.txt`, ~200 слов): открыть фразой «**The image is an overhead, top-down photograph of…**», затем размещать всё по областям («In the center… To the left… On the right side… At the upper right… In the lower left…»), затем материалы и свет с направлением («The lighting is natural and warm, coming from the upper left and casting soft, long shadows to the lower right»).
- Официальный PE (`H3-Image-PE`): вывод — ровно один JSON `{expanded_caption, aspect_ratio}`; роль — «эксперт visual designer / technical illustrator, а не word expander»; сначала определить тип кадра («depicted scene/photograph» против «communication artifact»: постер, карточка персонажа, product-design board, UI, чарт, дашборд, медицинский infographic, диаграмма, упаковка, обложка, мультипанель) и построить законченную информационную архитектуру; сохранять точный текст, именованные сущности, количества, формулы, порядок слева/справа и сверху/снизу; содержание должно быть **видимым, а не подразумеваемым** **[офиц; локально не прогонялось — [не подтв] эффект]**.
- Текстовые подсказки WanGP по H3-Image (официальный текст хоста): «Write one detailed English paragraph that describes the whole image, the way a designer would brief it: 1. Say what the image is… 2. Place everything… 3. Spell out every word in double quotes, exactly, and say where it sits. 4. For posters, pages, charts and interfaces, describe each region in reading order… 5. Use concrete visual cues rather than hype words such as stunning, epic or masterpiece».

### 5.3 Правка и референсы **[офиц]**
- До **16 референсов**; порядок загрузки задаёт `<Picture 1>`, `<Picture 2>`… в промпте. WanGP: `KI` — первое изображение задаёт пропорции, `I` — выбранный размер; референсы сохраняют свой размер (ресайз только если короткая сторона вне 1024–2048), поэтому много крупных референсов резко дороже.
- Официальная форма edit-промпта (файл `examples/revised_prompt.edit.txt`): сначала **определить субъекты** — «The man on the left in a dark sweater and wristwatch in `<Picture 1>` is `<Subject 1>`…» — затем целевая сцена через `<Subject N>`, затем по каждому субъекту обязательство: «`<Subject 1>` is **partially preserved**; his identity, facial features, expression, dark sweater, and wristwatch remain, while…»; «`<Subject 3>` is **fully preserved**».
- WanGP-подсказка подтверждает и упрощённую форму: «A plain instruction also works: `Keep everything in <Picture 1> as it is, but remove the headphones and have the two hosts fist bump.` With several images, say what each one supplies: `the straw hat from <Picture 2>`. Quote new text exactly».
- Встроенная инструкция энхансера WanGP (`H3_STILL_IMAGE_SYSTEM_PROMPT`): начинать с «In `<Picture 1>`» для правки или «Using `<Picture 1>` as a reference» для новой сцены; для правки — сначала изменение, затем явный список сохраняемых признаков; «explicit user changes override preservation»; не пересказывать исходник вместо инструкции **[код-WanGP]**.
- **[стенд]**: для правки энхансер по умолчанию не нужен — короткая точная команда («измени только X… всё остальное оставь ровно как есть») выигрывает 11,25/12 против 9,50 / 8,75 / 6,50 у инструкций; раздувание команды до 120–150 слов ухудшает результат; дефект усиления — эхо (пересказ команды, Jaccard 0,89–0,91).

### 5.4 Разрешение, шаги, режимы
- **[офиц]** рабочий диапазон ~4–20 МП, лучше всего ~16 МП: 4096×4096, 4736×3552 / 3552×4736, 5024×3360 / 3360×5024, 5472×3072 / 3072×5472, 6272×2688, 2688×6272. `min_generation_area` по умолчанию 4194304: размер меньше генерируется на большем канвасе того же аспекта и ужимается (LANCZOS) — «меньше не значит быстрее».
- **[офиц]** `num_inference_steps` = 6, `guidance_scale` = 1, `negative_prompt` отвергается; в API другие значения дают HTTP 400.
- **[код-WanGP]** в WanGP шаги по умолчанию 6; другие значения используют shift-12 график и требуют pDMD-LoRA (профили `pDMD 2 Steps` / `4 Steps`); сэмплер и guidance фиксированы.
- **[код-WanGP]** режимы энхансера `minimax_p_h3_image`: `['T','TI']`, вторая панель (`T1`/`TI1`) молча отключает усиление; у архетипов `minimax_h3_fl2va_pruned` / `ref2va_pruned` — наоборот, работают только `T1`/`TI1`.
- **[стенд]** у P-H3-Image: сток-WanGP требует **60–130 слов**, рабочий skills-текст — **110–200 слов**, «очень длинные промпты тоже портят картинку» (подтверждено и WanGP-подсказкой для P-H3: «Very long prompts also make images worse»); хайп-слова (stunning, epic, cinematic, vibrant, hyper-detailed, 8k, masterpiece) толкают к лосню — убирать.
- **[не подтв]** согласованные параметры сэмплирования для P-H3-Image в локальных материалах (8 / 20 / 28 шагов в разных файлах).

---

## 6. Fibo 2

### 6.1 Идентичность **[офиц]**
- **Fibo 2.0**, издатель **Bria AI**: `briaai/Fibo-2.0-dev` и `briaai/Fibo-2.0-edit-turbo`; лицензия **bria-fibo**(веса открыты для некоммерческого использования; коммерческое — отдельный договор с Bria); техстатья arXiv:2511.06876 («Generating an Image From 1,000 Words: Enhancing Text-to-Image With Structured Captions», 2025 — это про линейку FIBO в целом).
- Состав: DiT **8B** (32 слоя × 3072, патч 1×2, текстовый контекст ≤ **2048 токенов**), текстовый энкодер **Qwen3-VL-4B-Instruct** (скрытые состояния 2-го слоя; чат-шаблон, системное сообщение — «Describe the image by detailing the color, shape, size, texture, quantity, text, spatial relationships of the objects and background:»), VAE — **FLUX.2** (16× сжатие, 128 каналов). Обучен исключительно на лицензированных данных.
- Позиционирование Bria: «#1 in image editing и #2 in text-to-image среди открытых весов на Artificial Analysis (20.10.2026)»; «обучение на длинных структурированных подписях через **Visual GenAI Language (VGL)**»; в Fibo 2.0 генерация и правка объединены в одной модели.
- Репак WanGP: `DeepBeepMeep/Fibo2` (`Fibo_2.0_Dev_bf16/int8_convrot`, `Fibo_2.0_Edit_Turbo_*`, `Fibo_RMBG_3.0_*`, Qwen3-VL-4B, FLUX.2 VAE, шрифты Aileron/DejaVu) — сопоставление подтверждено.
- Варианты в WanGP: `fibo2_dev` («Fibo 2.0 Dev», 50 шагов, CFG 5) и `fibo2_edit_turbo` («Fibo 2.0 Edit Turbo», 4 шага, правка, источник обязателен, CFG и негатив не используются). Плюс `Fibo 2 > RMBG-3.0` (4 шага, alpha-matte, нужен референс и дефолтный промпт) **[код-WanGP]**.

Источники: https://huggingface.co/DeepBeepMeep/Fibo2/raw/main/README.md · https://huggingface.co/DeepBeepMeep/Fibo2/raw/main/upstream/Fibo-2.0-dev.md · https://huggingface.co/briaai/Fibo-2.0-dev · https://arxiv.org/abs/2511.06876 · `models\fibo2\{prompts.py,help.py,fibo2_handler.py,defaults\fibo2_*.json}`

### 6.2 Формат промпта **[офиц]**
- Два равноправных формата: **естественный язык** и **структурированная подпись JSON** (VGL). Из карточки WanGP: «Natural-language prompts and structured JSON captions are supported»; из карточки Bria: «structured caption fields», «Structured JSON captions, optional».
- Поля структурированной подписи (WanGP-инструкция `STRUCTURED`, `[код-WanGP]`): `short_description`, `objects` (список описательных объектов), `background_setting`, `lighting`, `aesthetics`, `photographic_characteristics`, `style_medium`, `context`, `artistic_style`, `text_render` (список объектов с полем `text`). Неиспользуемые секции опускаются; «**Use semantic spatial descriptions in objects; there is no numeric-coordinate or bounding-box schema**».
- Текст в кадре: каждая строка в `text_render[].text` — точная видимая строка; WanGP дополнительно рендерит эти строки шрифтами в conditioning-изображения («text conditioning renders the exact strings with fonts») **[код-WanGP]**.
- Негатив **[офиц, карточка Bria]**: поддерживается, но сам имеет структуру — `{"objects": [], "style_medium": "", "photographic_characteristics": {"lighting": {}}}`; **edit** — «Use empty structured JSON negative». В Edit Turbo негатив и CFG не используются.
- Комментаторные строки: «Whole lines beginning with `#` are comments and ignored during encoding»; инлайн `#` и hex-цвета сохраняются **[код-WanGP]**.
- Синтаксис SD (веса/скобки) не документирован — не использовать.

### 6.3 Композиция, правка, референсы **[код-WanGP + офиц]**
- Генерация: `A red ceramic teapot on a wooden table beside a window, soft morning light, product photograph.`
- Правка: `Change the jacket to red leather; retain the face, pose, background and lighting.` Несколько источников нумеруются `<image_1>`, `<image_2>` в порядке подачи с указанием роли: `Put the person from <image_1> in the dress from <image_2>.`
- Комбинированная форма правки: `{"structured_caption":{"short_description":"A red leather jacket"},"edit_instruction":"Replace the jacket and preserve the rest of the image."}`
- До **4 упорядоченных референсов**; «Main Image Ref» берёт размеры с первого референса, альтернативный режим сохраняет выбранный размер; masked editing — Control Image + маска (белое = заменить), один источник без доп. референсов, всегда полный график; **«pixels outside the mask are not guaranteed to remain identical»**; outpainting не exposed.
- Настройки: старт **50 шагов, guidance 5, ~1 МП** (1024×1024), размеры кратны 16; «The base model is not a few-step model»; «Exact object counts and lettering can take errors — proofread faces, small details and unedited regions».
- **[не подтв]** эмпирика по Fibo 2 на этом стенде отсутствует полностью: ни одного кадра, ни одной измеренной длины промпта, ни вердикта по quality-приёмам. Все рекомендации выше — из официальных текстов и кода хоста.

---

## 7. Сводка «что нельзя смешивать»

| Свойство | Krea 2 | MOSS Image | Qwen Image 2.1 | MiniMax H3-Image | Fibo 2.0 |
|---|---|---|---|---|---|
| Лимит промпта | 512 токенов (≈507), режется хвост | 4096 токенов | нет документированного жёсткого лимита (в WanGP ограничена только генерация энхансера: `max_tokens` 768) | 4096 токенов | 2048 токенов текста |
| Рекомендуемая длина | длинные; на практике 150–300 слов | длинные абзацы; 90–170 слов для prose-режима | 400–500 слов официально, 300–400 в WanGP | 1 подробный абзац; 110–200 слов (P-H3 — 60–130) | короткие–средние или JSON |
| Негатив | Raw да; **Turbo при CFG 0 нет** (нужен NAG) | да, теги через запятую | да при guidance > 1 | **нет, отвергается** | да, но сам JSON-структуры; в Edit Turbo не используется |
| Референсы | ≤2 (через LoRA-адаптер) | 1–4 (edit-адаптер, не официальный) | до 10 (`<image1>`) | до 16 (`<Picture N>`) | до 4 (`<image_N>`) |
| Спец-формат | нет | JSON-layout с bbox от центра | нет (но `<imageN>` теги) | нет (`<Picture N>`, `<Subject N>` в расширенном виде) | структурированный caption JSON + `text_render` |
| Оптимум разрешения | Turbo до 2K, Raw до 1K; кратно 16 | 1–2 МП, кратно 16 | нативное 2K (до ~4.3 МП) | ~16 МП (минимум генерации 4 МП) | ~1 МП, кратно 16 |
| Шаги / CFG (дефолт хоста) | 8 / 0 (Turbo); 52 / 3.5 (Raw) | 50 / 3.0 (+shift 5, SLG 22) | 40 / 4.0 (Turbo 8 / 1) | 6 / нет | 50 / 5 (Edit Turbo 4 / нет) |

**Ни одна конструкция из таблицы не переносится между моделями.** Прямой запрет на перенос инструкций между моделями зафиксирован и локально: `WanGP_FineTune_Knowledge.md:190` — «не переносить чужие правила как шаблон».

---

## 8. Что осталось неизвестным и требует проверки

1. **Fibo 2 полностью не проверена эмпирически** (ни кадров, ни замеров): поля `lighting/aesthetics/photographic_characteristics` реально влияют на кадр или достаточно `short_description`+`objects`+`text_render` — неизвестно.
2. MOSS layout-JSON: почему bbox приходит лишь в 33–50 % усиленных промптов — не объяснено; надёжность bbox-размещения в кадре не измерена (WanGP прямо: «Boxes guide composition, not pixel masks»).
3. MOSS edit-адаптер: причина провалов (качество адаптера, множитель LoRA, порядок референсов) не проверялась; официальная edit-модель на момент проверки не вышла.
4. MiniMax H3: официальный PE (`expanded_caption` + `aspect_ratio`) локально не прогонялся; расхождение шагов (8 / 20 / 28) в разных документах не разрешено.
5. Krea 2: влияние обрезки хвоста 512 токенов на реальный кадр не измерено; визуальный вердикт по инструкциям не снят; доступен ли style-reference из техотчёта в открытых весах — не подтверждено.
6. Qwen 2.1: эффект официальных PE-чекпойнтов (`PE-T2I` / `PE-I2I`) вместо самописной инструкции не проверялся; статистически значимой выборки нет (1 прогон на конфигурацию).
7. Глобально: ни одной сравнительной серии с фиксированным сидом (`prompt_enhancer_randomize_seed: false`) — абсолютные баллы между прогонами несопоставимы.
8. HF-карточки Krea 2 Raw/Turbo gated: полный текст карточек не читался (401), официальный промпт-гайд взят из GitHub.
