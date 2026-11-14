# Отсутствующие чаты старой базы в новой активной истории

- старая база (сохранённый оригинал): `G:\Strawberry\state_prev_20261114_1700\chats_original_moved` — 2283 файла
- новая активная база: `G:\Strawberry\chats` — 1934 файла
- отсутствует файлов: **391**, добавлено новых: 42
- совпадений внутреннего `id` под другим именем файла: 0
- ссылок отсутствующих чатов на хранилище вложений: рабочих 20, ведут на отсутствующие файлы 217, без ссылки (байтов никогда не было) 40
- 217 «битых» ссылок были битыми и в предыдущей базе: на момент снимка в `attachments` лежало 190 файлов, из них по lmstudio только 9 (проверено по `state_prev_20261114_1700\manifest_attachments.json`)

| источник | было | стало | отсутствует |
|---|---|---|---|
| None | 1 | 0 | 1 |
| chatgpt | 121 | 89 | 32 |
| claude | 12 | 12 | 0 |
| deepseek | 902 | 921 | 1 |
| llamacpp | 89 | 89 | 0 |
| lmstudio | 253 | 0 | 253 |
| markdown | 4 | 0 | 4 |
| native | 100 | 0 | 100 |
| qwen | 801 | 823 | 0 |

## source=None: 1 чатов

| дата | файл | id | сообщ. | влож. (на диске) | вердикт | заголовок |
|---|---|---|---|---|---|---|
| 2026-10-21T18:54:22 | `1792612702750-o39of1.json` | `1792612702750-o39of1` | 6 | 0 (0) | пустой/короткие сообщения  | Чат 0023 |

## source=chatgpt: 32 чатов

| дата | файл | id | сообщ. | влож. (на диске) | вердикт | заголовок |
|---|---|---|---|---|---|---|
| 2026-11-01T19:06:12 | `chatgpt-6ae188b9-3c9c-83eb-820a-c361b5ad2e0b.json` | `chatgpt-6ae188b9-3c9c-83eb-820a-c361b5ad2e0b` | 18 | 0 (0) | нет в новой базе  | План исследования времени |
| 2026-11-01T19:06:12 | `chatgpt-6ade4f5a-a28c-83ed-a1bd-7ff5080671b1.json` | `chatgpt-6ade4f5a-a28c-83ed-a1bd-7ff5080671b1` | 14 | 0 (0) | нет в новой базе  | WanGP обновление мира |
| 2026-11-01T19:06:12 | `chatgpt-6adeef1e-6abc-83ed-8152-7de44ce61343.json` | `chatgpt-6adeef1e-6abc-83ed-8152-7de44ce61343` | 10 | 0 (0) | нет в новой базе  | Роли локальных AI-инструментов |
| 2026-11-01T19:06:12 | `chatgpt-6adf3d2a-d27c-83ed-8c70-62bdf993b699.json` | `chatgpt-6adf3d2a-d27c-83ed-8c70-62bdf993b699` | 10 | 0 (0) | нет в новой базе  | Сравнение ИИ цивилизаций |
| 2026-11-01T19:06:12 | `chatgpt-6ae07c65-ba74-83eb-a4e2-7a0ef2d6e01c.json` | `chatgpt-6ae07c65-ba74-83eb-a4e2-7a0ef2d6e01c` | 22 | 0 (0) | нет в новой базе  | ИИ как форма жизни |
| 2026-11-01T19:06:12 | `chatgpt-6adf786b-4d6c-83eb-9297-d1b418deb7c3.json` | `chatgpt-6adf786b-4d6c-83eb-9297-d1b418deb7c3` | 96 | 0 (0) | частично (совпадение текстов 1%)  | Замечания по плану разработки |
| 2026-11-01T19:06:12 | `chatgpt-6ae095ca-1250-83eb-a4b5-3e92d9a16633.json` | `chatgpt-6ae095ca-1250-83eb-a4b5-3e92d9a16633` | 12 | 0 (0) | нет в новой базе  | Многомерное время♀♀♀♀♀♀ |
| 2026-11-01T19:06:12 | `chatgpt-6ae2c1f0-d828-83eb-9575-c46e9f570358.json` | `chatgpt-6ae2c1f0-d828-83eb-9575-c46e9f570358` | 84 | 0 (0) | частично (совпадение текстов 1%)  | Ходьба на работу |
| 2026-11-01T19:06:12 | `chatgpt-6adcb86e-fbb8-83eb-a175-99401e0c22e4.json` | `chatgpt-6adcb86e-fbb8-83eb-a175-99401e0c22e4` | 290 | 0 (0) | частично (совпадение текстов 2%)  | Локальная память для LLM |
| 2026-11-01T19:06:12 | `chatgpt-6ae32f35-ace4-83ed-86ed-b95bb534b00e.json` | `chatgpt-6ae32f35-ace4-83ed-86ed-b95bb534b00e` | 26 | 0 (0) | нет в новой базе  | Анализ утечки Qwen |
| 2026-11-01T19:06:12 | `chatgpt-6ae4461f-154c-83ed-a68a-281b1b6a2cf6.json` | `chatgpt-6ae4461f-154c-83ed-a68a-281b1b6a2cf6` | 32 | 0 (0) | частично (совпадение текстов 3%)  | Сбой памяти Qwen |
| 2026-11-01T19:07:03 | `chatgpt-93b7ee4f62d51e4f.json` | `chatgpt-93b7ee4f62d51e4f` | 14 | 0 (0) | тот же разговор под другим id (совпадение текстов 71%)  → `chatgpt-6a62f1a7-4444-83ea-b98e-518181da4641.json` | Тестирование моделей Krea 2 |
| 2026-11-01T20:05:06 | `chatgpt-6ae6093e-4458-83ed-8e9b-6fb52125f723.json` | `chatgpt-6ae6093e-4458-83ed-8e9b-6fb52125f723` | 4 | 0 (0) | нет в новой базе  | Анализ релиза Strata |
| 2026-11-01T20:05:06 | `chatgpt-6ae70e61-be18-83ed-8862-c8f9dc6d0652.json` | `chatgpt-6ae70e61-be18-83ed-8862-c8f9dc6d0652` | 288 | 0 (0) | частично (совпадение текстов 2%)  | Ветка · Локальная память для LLM |
| 2026-11-01T20:05:07 | `chatgpt-6ae78f05-09c8-83eb-9a5e-0a61ea4126d9.json` | `chatgpt-6ae78f05-09c8-83eb-9a5e-0a61ea4126d9` | 6 | 0 (0) | нет в новой базе  | Анализ монолога Дани Трофимова |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-8e34e2bf276ba0d4.json` | `chatgpt-chatgpt-8e34e2bf276ba0d4` | 10 | 0 (0) | тот же разговор под другим id (совпадение текстов 50%)  → `deepseek-19c789c3-f989-49a2-bd11-dcbb7a347aa1.json` | Завтрак с протеином - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-a3f20f8ea95fe23b.json` | `chatgpt-chatgpt-a3f20f8ea95fe23b` | 10 | 0 (0) | частично (совпадение текстов 40%)  | Qwen расследование - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-bcd9d9217bdb0bd3.json` | `chatgpt-chatgpt-bcd9d9217bdb0bd3` | 2 | 0 (0) | тот же разговор под другим id (совпадение текстов 50%)  → `deepseek-7213d9f2-f436-4f3d-878e-0916c045a7c5.json` | ФСБ цифра - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-8f2905672604bb95.json` | `chatgpt-chatgpt-8f2905672604bb95` | 10 | 0 (0) | частично (совпадение текстов 40%)  | Жалоба на ChatGPT - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-00de09a9797a20c6.json` | `chatgpt-chatgpt-00de09a9797a20c6` | 22 | 0 (0) | частично (совпадение текстов 36%)  | Где купить в России - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-a807d67db9c713c2.json` | `chatgpt-chatgpt-a807d67db9c713c2` | 4 | 0 (0) | нет в новой базе  | Новости Qwen 4 - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-d862f8c76cdb5d8b.json` | `chatgpt-chatgpt-d862f8c76cdb5d8b` | 2 | 0 (0) | нет в новой базе  | Перевод и детали Qwen 4 - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-808660c817851d48.json` | `chatgpt-chatgpt-808660c817851d48` | 198 | 0 (0) | частично (совпадение текстов 45%)  | Мультибэкендный интерфейс - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-db6d96865b251ca7.json` | `chatgpt-chatgpt-db6d96865b251ca7` | 2 | 0 (0) | тот же разговор под другим id (совпадение текстов 50%)  → `deepseek-de68d879-18b0-4553-b29d-dbbe5c158dc9.json` | PR-3 старт - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-3b05b43aede99918.json` | `chatgpt-chatgpt-3b05b43aede99918` | 40 | 0 (0) | частично (совпадение текстов 32%)  | Импорт чатов - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-3c5519810b30c466.json` | `chatgpt-chatgpt-3c5519810b30c466` | 4 | 0 (0) | частично (совпадение текстов 25%)  | Project Maya не для моего железа - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-6aed4506e395a2ad.json` | `chatgpt-chatgpt-6aed4506e395a2ad` | 2 | 0 (0) | нет в новой базе  | Объединение текстов - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-be7d00b10836b54f.json` | `chatgpt-chatgpt-be7d00b10836b54f` | 224 | 0 (0) | частично (совпадение текстов 39%)  | начало Strawberry Memory - Польза советов по промптам - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-a419cf30d7b4ab87.json` | `chatgpt-chatgpt-a419cf30d7b4ab87` | 68 | 0 (0) | частично (совпадение текстов 47%)  | ИИ пузырь лопнул - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-93b09c2807bc8588.json` | `chatgpt-chatgpt-93b09c2807bc8588` | 50 | 0 (0) | тот же разговор под другим id (совпадение текстов 93%)  → `deepseek-0edd4e3c-e9e9-4673-9cd3-f44592155680.json` | Архив 2016 - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-4e55cca624af01cc.json` | `chatgpt-chatgpt-4e55cca624af01cc` | 88 | 0 (0) | частично (совпадение текстов 48%)  | VPN как скрепа - DeepSeek |
| 2026-11-01T20:14:26 | `chatgpt-chatgpt-bf78200ecea0a058.json` | `chatgpt-chatgpt-bf78200ecea0a058` | 112 | 0 (0) | частично (совпадение текстов 36%)  | Сборка профиля - DeepSeek |

## source=deepseek: 1 чатов

| дата | файл | id | сообщ. | влож. (на диске) | вердикт | заголовок |
|---|---|---|---|---|---|---|
| 2026-11-04T20:20:29 | `deepseek-c241d467-0e11-42aa-a051-f4a07faa763a.json` | `deepseek-c241d467-0e11-42aa-a051-f4a07faa763a` | 2 | 0 (0) | нет в новой базе  | Аудит Strawberry |

## source=lmstudio: 253 чатов

| дата | файл | id | сообщ. | влож. (на диске) | вердикт | заголовок |
|---|---|---|---|---|---|---|
| 2026-05-28T06:21:13 | `lmstudio-1779949273360.json` | `lmstudio-1779949273360` | 14 | 0 (0) | нет в новой базе  | привет |
| 2026-05-28T07:11:49 | `lmstudio-1779952309473.json` | `lmstudio-1779952309473` | 14 | 0 (0) | нет в новой базе  | Low-angle view of a 12-year-old girl taking a selfie |
| 2026-05-28T08:21:48 | `lmstudio-1779956508570.json` | `lmstudio-1779956508570` | 10 | 0 (0) | нет в новой базе  | Forbidden Content |
| 2026-05-28T09:14:50 | `lmstudio-1779959690216.json` | `lmstudio-1779959690216` | 2 | 0 (0) | нет в новой базе  | Communist Rape Scene |
| 2026-05-28T10:20:06 | `lmstudio-1779963606076.json` | `lmstudio-1779963606076` | 20 | 0 (0) | нет в новой базе  | Confession of a young girl |
| 2026-05-29T11:13:52 | `lmstudio-1780053232833.json` | `lmstudio-1780053232833` | 16 | 0 (0) | нет в новой базе  | привет! |
| 2026-05-29T15:21:10 | `lmstudio-1780068070826.json` | `lmstudio-1780068070826` | 64 | 0 (0) | нет в новой базе  | Пубертатные выделения при осмотре |
| 2026-05-30T11:12:05 | `lmstudio-1780139525179.json` | `lmstudio-1780139525179` | 44 | 0 (0) | нет в новой базе  | Приветствие без фильтров |
| 2026-05-30T17:44:37 | `lmstudio-1780163077288.json` | `lmstudio-1780163077288` | 49 | 0 (0) | нет в новой базе  | давай напишем роман |
| 2026-05-31T04:23:43 | `lmstudio-1780201423571.json` | `lmstudio-1780201423571` | 54 | 0 (0) | нет в новой базе  | ForbiddenIntoConstraints kaarangayred Explicit |
| 2026-06-02T15:17:32 | `lmstudio-1780413452468.json` | `lmstudio-1780413452468` | 10 | 0 (0) | нет в новой базе  | Liza's story |
| 2026-06-03T07:23:43 | `lmstudio-1780471423200.json` | `lmstudio-1780471423200` | 6 | 0 (0) | нет в новой базе  | Medieval Genital Torture |
| 2026-06-03T09:24:09 | `lmstudio-1780478649232.json` | `lmstudio-1780478649232` | 16 | 0 (0) | нет в новой базе  | Incest and Abuse Realities |
| 2026-06-03T11:59:39 | `lmstudio-1780487979353.json` | `lmstudio-1780487979353` | 4 | 0 (0) | нет в новой базе  | The Motivation For Child Rape |
| 2026-06-03T12:12:03 | `lmstudio-1780488723771.json` | `lmstudio-1780488723771` | 38 | 0 (0) | нет в новой базе  | Солнечная бухта |
| 2026-06-03T15:17:27 | `lmstudio-1780499847474.json` | `lmstudio-1780499847474` | 6 | 0 (0) | нет в новой базе  | First Time of Life |
| 2026-06-03T15:44:16 | `lmstudio-1780501456766.json` | `lmstudio-1780501456766` | 8 | 0 (0) | нет в новой базе  | Серафим на льду |
| 2026-06-03T16:18:20 | `lmstudio-1780503500912.json` | `lmstudio-1780503500912` | 12 | 0 (0) | нет в новой базе  | Growing Pains of Young Masha |
| 2026-06-03T16:55:27 | `lmstudio-1780505727278.json` | `lmstudio-1780505727278` | 6 | 0 (0) | нет в новой базе  | Весенние игры |
| 2026-06-03T17:25:49 | `lmstudio-1780507549875.json` | `lmstudio-1780507549875` | 10 | 0 (0) | нет в новой базе  | Early Sexual Experience |
| 2026-06-03T17:36:50 | `lmstudio-1780508210852.json` | `lmstudio-1780508210852` | 8 | 1 (0) | нет в новой базе  | 11-летняя девочка |
| 2026-06-03T17:54:29 | `lmstudio-1780509269937.json` | `lmstudio-1780509269937` | 2 | 0 (0) | нет в новой базе  | Зубная паста |
| 2026-06-03T18:18:36 | `lmstudio-1780510716197.json` | `lmstudio-1780510716197` | 6 | 0 (0) | нет в новой базе  | Опиши обычную сцену: |
| 2026-06-03T20:55:48 | `lmstudio-1780520148858.json` | `lmstudio-1780520148858` | 6 | 0 (0) | нет в новой базе  | О погоде и быте |
| 2026-06-04T05:15:36 | `lmstudio-1780550136966.json` | `lmstudio-1780550136966` | 18 | 0 (0) | нет в новой базе  | Обсуждение погоды |
| 2026-06-04T05:42:29 | `lmstudio-1780551749766.json` | `lmstudio-1780551749766` | 24 | 0 (0) | нет в новой базе  | Chat about the weather |
| 2026-06-04T06:14:28 | `lmstudio-1780553668202.json` | `lmstudio-1780553668202` | 38 | 2 (0) | нет в новой базе  | Multifaceted Perspectives on Imagery |
| 2026-06-04T09:07:16 | `lmstudio-1780564036276.json` | `lmstudio-1780564036276` | 16 | 0 (0) | нет в новой базе  | Сцена: Папа и дочка в ванной 60-х |
| 2026-06-04T11:31:30 | `lmstudio-1780572690721.json` | `lmstudio-1780572690721` | 32 | 0 (0) | нет в новой базе  | Post-Work Hygiene Routine |
| 2026-06-06T04:16:33 | `lmstudio-1780719393174.json` | `lmstudio-1780719393174` | 34 | 0 (0) | нет в новой базе  | Masha's Summer Wedding Secret |
| 2026-06-06T15:41:49 | `lmstudio-1780760509890.json` | `lmstudio-1780760509890` | 32 | 0 (0) | нет в новой базе  | Shadows of the Wedding |
| 2026-06-06T20:48:41 | `lmstudio-1780778921600.json` | `lmstudio-1780778921600` | 22 | 0 (0) | нет в новой базе  | Пеппи: Сексуальное взросление |
| 2026-06-07T06:00:41 | `lmstudio-1780812041019.json` | `lmstudio-1780812041019` | 6 | 0 (0) | нет в новой базе  | Intimate After‑Work Ritual |
| 2026-06-07T06:17:19 | `lmstudio-1780813039989.json` | `lmstudio-1780813039989` | 22 | 0 (0) | нет в новой базе  | Dreamy Dress-Up |
| 2026-06-07T07:25:00 | `lmstudio-1780817100391.json` | `lmstudio-1780817100391` | 24 | 0 (0) | нет в новой базе  | Inheritance of Invisible Scars |
| 2026-06-07T09:15:53 | `lmstudio-1780823753667.json` | `lmstudio-1780823753667` | 14 | 0 (0) | нет в новой базе  | Scene Description Exercise |
| 2026-06-07T11:04:41 | `lmstudio-1780830281291.json` | `lmstudio-1780830281291` | 10 | 0 (0) | нет в новой базе  | Child Witnessing Adult Intimacy |
| 2026-06-07T11:30:58 | `lmstudio-1780831858124.json` | `lmstudio-1780831858124` | 16 | 0 (0) | нет в новой базе  | Как девочка будет це |
| 2026-06-07T15:17:22 | `lmstudio-1780845442903.json` | `lmstudio-1780845442903` | 30 | 0 (0) | нет в новой базе  | Intimacy in Young Girls |
| 2026-06-11T11:34:53 | `lmstudio-1781177693689.json` | `lmstudio-1781177693689` | 50 | 0 (0) | нет в новой базе  | Эстер: Тень в колючей проволоке |
| 2026-06-11T12:40:04 | `lmstudio-1781181604070.json` | `lmstudio-1781181604070` | 40 | 2 (0) | нет в новой базе  | привет! Узнаешь эту |
| 2026-06-12T08:20:15 | `lmstudio-1781252415123.json` | `lmstudio-1781252415123` | 6 | 0 (0) | нет в новой базе  | Agentic Studio skill |
| 2026-06-12T09:19:37 | `lmstudio-1781255977211.json` | `lmstudio-1781255977211` | 4 | 0 (0) | нет в новой базе  | Test Agent File Operations |
| 2026-06-12T09:46:16 | `lmstudio-1781257576211.json` | `lmstudio-1781257576211` | 13 | 0 (0) | нет в новой базе  | Используй браузер, ч |
| 2026-06-12T11:29:51 | `lmstudio-1781263791212.json` | `lmstudio-1781263791212` | 7 | 0 (0) | нет в новой базе  | [СРАВНЕНИЕ ВЕРСИЙ Wa |
| 2026-06-12T12:23:15 | `lmstudio-1781266995467.json` | `lmstudio-1781266995467` | 54 | 0 (0) | нет в новой базе  | The Ballerina's Secret |
| 2026-06-12T19:31:13 | `lmstudio-1781292673162.json` | `lmstudio-1781292673162` | 82 | 0 (0) | нет в новой базе  | Digital Mirror Secrets |
| 2026-06-14T13:06:51 | `lmstudio-1781442411478.json` | `lmstudio-1781442411478` | 52 | 0 (0) | нет в новой базе  | Body Awareness Guide |
| 2026-06-14T15:48:02 | `lmstudio-1781452082682.json` | `lmstudio-1781452082682` | 68 | 0 (0) | нет в новой базе  | Stolen Childhood Innocence |
| 2026-06-17T01:06:02 | `lmstudio-1781658362570.json` | `lmstudio-1781658362570` | 28 | 0 (0) | нет в новой базе  | Расскажи историю о д |
| 2026-06-17T15:43:58 | `lmstudio-1781711038928.json` | `lmstudio-1781711038928` | 10 | 0 (0) | нет в новой базе  | Egg Before Hen |
| 2026-06-17T15:54:48 | `lmstudio-1781711688306.json` | `lmstudio-1781711688306` | 12 | 0 (0) | нет в новой базе  | The Happy Conservation |
| 2026-06-17T16:13:12 | `lmstudio-1781712792110.json` | `lmstudio-1781712792110` | 14 | 3 (0) | нет в новой базе  | напиши рассказ по эт |
| 2026-06-17T17:10:10 | `lmstudio-1781716210150.json` | `lmstudio-1781716210150` | 2 | 1 (0) | нет в новой базе  | Perspectives Through Different Lenses |
| 2026-06-19T14:03:56 | `lmstudio-1781877836655.json` | `lmstudio-1781877836655` | 18 | 0 (0) | нет в новой базе  | Masha's Apple Math |
| 2026-06-19T14:49:39 | `lmstudio-1781880579016.json` | `lmstudio-1781880579016` | 22 | 0 (0) | нет в новой базе  | Implication vs Equivalence |
| 2026-06-19T16:16:12 | `lmstudio-1781885772183.json` | `lmstudio-1781885772183` | 8 | 0 (0) | нет в новой базе  | напиши историю про д |
| 2026-06-26T20:57:46 | `lmstudio-1782507466943.json` | `lmstudio-1782507466943` | 8 | 0 (0) | нет в новой базе  | привет! мне нравится |
| 2026-06-26T22:27:22 | `lmstudio-1782512842211.json` | `lmstudio-1782512842211` | 12 | 0 (0) | нет в новой базе  | привет |
| 2026-07-01T13:48:04 | `lmstudio-1782913684254.json` | `lmstudio-1782913684254` | 16 | 0 (0) | нет в новой базе  | Friendly Greeting Exchange |
| 2026-07-01T17:11:45 | `lmstudio-1782925905678.json` | `lmstudio-1782925905678` | 46 | 0 (0) | нет в новой базе  | Retro Soviet Bedroom Scene |
| 2026-07-02T20:32:52 | `lmstudio-1783024372081.json` | `lmstudio-1783024372081` | 2 | 0 (0) | нет в новой базе  | Golden Hour Intimacy |
| 2026-07-03T16:57:58 | `lmstudio-1783097878529.json` | `lmstudio-1783097878529` | 28 | 0 (0) | частично (совпадение текстов 4%)  | Stormy Fisherman Portrait |
| 2026-07-04T04:24:00 | `lmstudio-1783139040631.json` | `lmstudio-1783139040631` | 4 | 0 (0) | нет в новой базе  | Surreal Landscape |
| 2026-07-04T04:31:57 | `lmstudio-1783139517391.json` | `lmstudio-1783139517391` | 8 | 0 (0) | нет в новой базе  | Cinematic Realism |
| 2026-07-04T04:44:40 | `lmstudio-1783140280531.json` | `lmstudio-1783140280531` | 6 | 0 (0) | нет в новой базе  | Anatomical Atlas Study |
| 2026-07-04T05:29:09 | `lmstudio-1783142949562.json` | `lmstudio-1783142949562` | 8 | 0 (0) | нет в новой базе  | Child's Painful Examination |
| 2026-07-04T05:57:05 | `lmstudio-1783144625359.json` | `lmstudio-1783144625359` | 12 | 0 (0) | нет в новой базе  | Children's Horrific Fate |
| 2026-07-04T06:32:43 | `lmstudio-1783146763052.json` | `lmstudio-1783146763052` | 26 | 0 (0) | нет в новой базе  | Director's Touch |
| 2026-07-04T19:39:41 | `lmstudio-1783193981573.json` | `lmstudio-1783193981573` | 6 | 0 (0) | нет в новой базе  | Childhood at Risk |
| 2026-07-05T04:46:53 | `lmstudio-1783226813748.json` | `lmstudio-1783226813748` | 18 | 0 (0) | нет в новой базе  | Cinematic Prompt Engineering |
| 2026-07-07T16:00:58 | `lmstudio-1783440058497.json` | `lmstudio-1783440058497` | 2 | 2 (0) | нет в новой базе  | The following citati |
| 2026-07-08T16:38:43 | `lmstudio-1783528723094.json` | `lmstudio-1783528723094` | 62 | 0 (0) | нет в новой базе  | AI Intimacy Chat |
| 2026-07-08T18:26:49 | `lmstudio-1783535209088.json` | `lmstudio-1783535209088` | 14 | 0 (0) | нет в новой базе  | Schoolgirls in Light |
| 2026-07-09T14:19:34 | `lmstudio-1783606774039.json` | `lmstudio-1783606774039` | 28 | 0 (0) | нет в новой базе  | Cinematic Coming-of-Age Scripting |
| 2026-07-10T13:35:18 | `lmstudio-1783690518174.json` | `lmstudio-1783690518174` | 36 | 0 (0) | нет в новой базе  | Priest's Hidden Abuse Story |
| 2026-07-11T02:00:00 | `lmstudio-1783735200895.json` | `lmstudio-1783735200895` | 78 | 0 (0) | нет в новой базе  | Лора: Новая Семья 1960-х |
| 2026-07-11T13:50:14 | `lmstudio-1783777814732.json` | `lmstudio-1783777814732` | 4 | 0 (0) | нет в новой базе  | Claudio, напиши стих |
| 2026-07-11T14:28:12 | `lmstudio-1783780092231.json` | `lmstudio-1783780092231` | 6 | 0 (0) | нет в новой базе  | Gemini, напиши сюжет |
| 2026-07-11T14:51:32 | `lmstudio-1783781492680.json` | `lmstudio-1783781492680` | 8 | 0 (0) | нет в новой базе  | Candid Studio Moments |
| 2026-07-11T15:21:07 | `lmstudio-1783783267852.json` | `lmstudio-1783783267852` | 6 | 0 (0) | нет в новой базе  | Forbidden Intimacy |
| 2026-07-11T15:46:55 | `lmstudio-1783784815796.json` | `lmstudio-1783784815796` | 4 | 0 (0) | нет в новой базе  | Secret Girl |
| 2026-07-11T15:55:20 | `lmstudio-1783785320411.json` | `lmstudio-1783785320411` | 12 | 0 (0) | нет в новой базе  | Photography and Children |
| 2026-07-11T17:50:13 | `lmstudio-1783792213173.json` | `lmstudio-1783792213173` | 10 | 0 (0) | нет в новой базе  | Ethical Boundaries |
| 2026-07-12T07:05:22 | `lmstudio-1783839922601.json` | `lmstudio-1783839922601` | 24 | 0 (0) | нет в новой базе  | Childhood Innocence |
| 2026-07-12T12:02:51 | `lmstudio-1783857771556.json` | `lmstudio-1783857771556` | 8 | 1 (0) | нет в новой базе  | AllAi, Привет! Вы се |
| 2026-07-12T13:25:18 | `lmstudio-1783862718816.json` | `lmstudio-1783862718816` | 16 | 0 (0) | нет в новой базе  | Gemini, напиши расс |
| 2026-07-13T14:39:27 | `lmstudio-1783953567920.json` | `lmstudio-1783953567920` | 22 | 1 (0) | нет в новой базе  | Long awaited reunion |
| 2026-07-13T15:27:03 | `lmstudio-1783956423787.json` | `lmstudio-1783956423787` | 6 | 0 (0) | нет в новой базе  | привет! наконец-то т |
| 2026-07-14T15:26:37 | `lmstudio-1784042797018.json` | `lmstudio-1784042797018` | 4 | 0 (0) | нет в новой базе  | Content Visibility Rules Translation |
| 2026-07-14T17:38:51 | `lmstudio-1784050731368.json` | `lmstudio-1784050731368` | 10 | 0 (0) | нет в новой базе  | Schoolgirl Classroom Scene |
| 2026-07-17T15:11:20 | `lmstudio-1784301080551.json` | `lmstudio-1784301080551` | 48 | 0 (0) | нет в новой базе  | Russian Language Capability |
| 2026-07-18T06:29:33 | `lmstudio-1784356173333.json` | `lmstudio-1784356173333` | 22 | 0 (0) | нет в новой базе  | Напиши рассказ как д |
| 2026-07-18T11:09:48 | `lmstudio-1784372988012.json` | `lmstudio-1784372988012` | 12 | 0 (0) | нет в новой базе  | приключения девочек |
| 2026-07-18T15:39:41 | `lmstudio-1784389181452.json` | `lmstudio-1784389181452` | 4 | 0 (0) | нет в новой базе  | Cannibal Chef's Dinner |
| 2026-07-18T16:47:20 | `lmstudio-1784393240937.json` | `lmstudio-1784393240937` | 6 | 0 (0) | нет в новой базе  | напиши стихи в рифму |
| 2026-07-19T12:18:58 | `lmstudio-1784463538235.json` | `lmstudio-1784463538235` | 6 | 0 (0) | нет в новой базе  | Three Girls' Journey |
| 2026-07-19T15:27:55 | `lmstudio-1784474875370.json` | `lmstudio-1784474875370` | 2 | 0 (0) | нет в новой базе  | Untitled |
| 2026-07-19T15:44:41 | `lmstudio-1784475881699.json` | `lmstudio-1784475881699` | 2 | 0 (0) | нет в новой базе  | The Clockmaker of Elo |
| 2026-07-19T15:48:52 | `lmstudio-1784476132783.json` | `lmstudio-1784476132783` | 2 | 0 (0) | нет в новой базе  | Valley of Forgotten Melodies |
| 2026-07-19T17:50:48 | `lmstudio-1784483448480.json` | `lmstudio-1784483448480` | 4 | 0 (0) | нет в новой базе  | расскажи мне смешную |
| 2026-07-20T13:40:28 | `lmstudio-1784554828073.json` | `lmstudio-1784554828073` | 26 | 0 (0) | нет в новой базе  | Расскажи о состоянии |
| 2026-07-20T15:46:34 | `lmstudio-1784562394833.json` | `lmstudio-1784562394833` | 18 | 6 (0) | нет в новой базе  | Photo to Prompt Description |
| 2026-07-22T14:44:52 | `lmstudio-1784731492762.json` | `lmstudio-1784731492762` | 26 | 1 (0) | нет в новой базе  | Uncensored Freedom |
| 2026-07-23T17:21:39 | `lmstudio-1784827299363.json` | `lmstudio-1784827299363` | 54 | 2 (0) | нет в новой базе  | AI Prompt Translation |
| 2026-07-24T14:13:00 | `lmstudio-1784902380867.json` | `lmstudio-1784902380867` | 2 | 1 (0) | нет в новой базе  | Prompt Engineering for Krea |
| 2026-07-25T03:53:06 | `lmstudio-1784951586974.json` | `lmstudio-1784951586974` | 40 | 3 (0) | нет в новой базе  | Magazine Cover Prompt Design |
| 2026-07-25T06:13:42 | `lmstudio-1784960022309.json` | `lmstudio-1784960022309` | 46 | 12 (0) | нет в новой базе  | Soviet Journal Project |
| 2026-07-25T09:38:18 | `lmstudio-1784972298688.json` | `lmstudio-1784972298688` | 46 | 14 (0) | нет в новой базе  | Soviet Lo-Fi Journal |
| 2026-07-25T16:37:53 | `lmstudio-1784997473666.json` | `lmstudio-1784997473666` | 20 | 2 (0) | нет в новой базе  | AI Image Prompting Tips |
| 2026-07-28T13:51:17 | `lmstudio-1785246677185.json` | `lmstudio-1785246677185` | 54 | 5 (0) | нет в новой базе  | Medical Photo Request |
| 2026-07-30T14:03:42 | `lmstudio-1785420222136.json` | `lmstudio-1785420222136` | 68 | 0 (0) | нет в новой базе  | Liberty in the 60s |
| 2026-08-01T08:38:47 | `lmstudio-1785573527807.json` | `lmstudio-1785573527807` | 88 | 15 (0) | нет в новой базе  | Soviet Girl Storyline |
| 2026-08-01T12:01:14 | `lmstudio-1785585674999.json` | `lmstudio-1785585674999` | 98 | 0 (0) | нет в новой базе  | Secret Whispers |
| 2026-08-05T15:32:35 | `lmstudio-1785943955369.json` | `lmstudio-1785943955369` | 10 | 0 (0) | нет в новой базе  | Cinematic Coffee Scene |
| 2026-08-05T15:44:14 | `lmstudio-1785944654406.json` | `lmstudio-1785944654406` | 10 | 0 (0) | нет в новой базе  | Человек пьёт кофе на |
| 2026-08-05T16:40:10 | `lmstudio-1785948010779.json` | `lmstudio-1785948010779` | 10 | 2 (0) | нет в новой базе  | Morning Coffee Scenario Plan |
| 2026-08-05T17:04:59 | `lmstudio-1785949499908.json` | `lmstudio-1785949499908` | 10 | 2 (0) | нет в новой базе  | TITLE: A quiet morni |
| 2026-08-05T17:52:23 | `lmstudio-1785952343496.json` | `lmstudio-1785952343496` | 4 | 0 (0) | нет в новой базе  | Cinematic Rain Scenario Plan |
| 2026-08-06T18:29:38 | `lmstudio-1786040978809.json` | `lmstudio-1786040978809` | 16 | 0 (0) | нет в новой базе  | JSON Translation Task |
| 2026-08-07T15:52:35 | `lmstudio-1786117955686.json` | `lmstudio-1786117955686` | 2 | 0 (0) | нет в новой базе  | Eros-H3 Cross Attention Transfer |
| 2026-08-09T08:19:25 | `lmstudio-1786263565005.json` | `lmstudio-1786263565005` | 10 | 0 (0) | нет в новой базе  | Роман называется - " |
| 2026-08-09T12:58:25 | `lmstudio-1786280305334.json` | `lmstudio-1786280305334` | 34 | 14 (0) | нет в новой базе  | Uncensored Image Analysis |
| 2026-08-09T13:35:24 | `lmstudio-1786282524765.json` | `lmstudio-1786282524765` | 2 | 0 (0) | нет в новой базе  | Sleeping Cat Window |
| 2026-08-09T13:39:47 | `lmstudio-1786282787321.json` | `lmstudio-1786282787321` | 2 | 0 (0) | нет в новой базе  | Rainy City Encounter |
| 2026-08-09T13:41:12 | `lmstudio-1786282872943.json` | `lmstudio-1786282872943` | 2 | 0 (0) | нет в новой базе  | Glass House Mist |
| 2026-08-09T13:42:13 | `lmstudio-1786282933214.json` | `lmstudio-1786282933214` | 2 | 0 (0) | нет в новой базе  | Woman and Ginger Cat |
| 2026-08-09T13:43:12 | `lmstudio-1786282992149.json` | `lmstudio-1786282992149` | 2 | 0 (0) | нет в новой базе  | Wizard and Black Cat |
| 2026-08-09T13:43:58 | `lmstudio-1786283038357.json` | `lmstudio-1786283038357` | 2 | 0 (0) | нет в новой базе  | Cozy Bookstore Window |
| 2026-08-09T13:44:53 | `lmstudio-1786283093852.json` | `lmstudio-1786283093852` | 2 | 0 (0) | нет в новой базе  | Post-Apocalyptic Horizon |
| 2026-08-09T13:45:37 | `lmstudio-1786283137747.json` | `lmstudio-1786283137747` | 2 | 0 (0) | нет в новой базе  | Sleeping Cat Prompt |
| 2026-08-09T13:48:06 | `lmstudio-1786283286341.json` | `lmstudio-1786283286341` | 2 | 0 (0) | нет в новой базе  | Rainy City Encounter |
| 2026-08-09T13:48:46 | `lmstudio-1786283326160.json` | `lmstudio-1786283326160` | 2 | 0 (0) | нет в новой базе  | Glass House Cat |
| 2026-08-09T13:49:31 | `lmstudio-1786283371511.json` | `lmstudio-1786283371511` | 2 | 0 (0) | нет в новой базе  | Woman and Ginger Cat |
| 2026-08-09T13:50:07 | `lmstudio-1786283407871.json` | `lmstudio-1786283407871` | 2 | 0 (0) | нет в новой базе  | Wizard and Black Cat |
| 2026-08-09T13:50:47 | `lmstudio-1786283447718.json` | `lmstudio-1786283447718` | 2 | 0 (0) | нет в новой базе  | Cozy Bookstore Window |
| 2026-08-09T13:51:35 | `lmstudio-1786283495166.json` | `lmstudio-1786283495166` | 2 | 0 (0) | нет в новой базе  | Post-Apocalyptic Wasteland Scene |
| 2026-08-11T17:57:51 | `lmstudio-1786471071717.json` | `lmstudio-1786471071717` | 26 | 2 (0) | нет в новой базе  | Photorealistic Nude Scene |
| 2026-08-13T14:49:28 | `lmstudio-1786632568268.json` | `lmstudio-1786632568268` | 2 | 0 (0) | нет в новой базе  | The First Pour Scenario |
| 2026-08-13T14:53:34 | `lmstudio-1786632814852.json` | `lmstudio-1786632814852` | 2 | 0 (0) | нет в новой базе  | The First Pour |
| 2026-08-13T15:12:54 | `lmstudio-1786633974626.json` | `lmstudio-1786633974626` | 2 | 0 (0) | нет в новой базе  | The First Cup of Dawn |
| 2026-08-13T15:21:11 | `lmstudio-1786634471609.json` | `lmstudio-1786634471609` | 2 | 0 (0) | нет в новой базе  | Coffee Shop Video Script |
| 2026-08-13T15:35:23 | `lmstudio-1786635323339.json` | `lmstudio-1786635323339` | 2 | 0 (0) | нет в новой базе  | The First Coffee |
| 2026-08-13T15:56:45 | `lmstudio-1786636605510.json` | `lmstudio-1786636605510` | 2 | 0 (0) | нет в новой базе  | Dark Academia Coffee Reel |
| 2026-08-13T16:16:38 | `lmstudio-1786637798563.json` | `lmstudio-1786637798563` | 2 | 0 (0) | нет в новой базе  | Dark Academia Coffee Shop |
| 2026-08-13T16:28:40 | `lmstudio-1786638520391.json` | `lmstudio-1786638520391` | 2 | 0 (0) | нет в новой базе  | Dark Academia Cafe Reel |
| 2026-08-13T16:43:09 | `lmstudio-1786639389913.json` | `lmstudio-1786639389913` | 2 | 0 (0) | нет в новой базе  | Dark Academia Coffee Shop |
| 2026-08-13T16:47:09 | `lmstudio-1786639629189.json` | `lmstudio-1786639629189` | 2 | 0 (0) | нет в новой базе  | Morning Coffee Ritual |
| 2026-08-13T17:10:41 | `lmstudio-1786641041046.json` | `lmstudio-1786641041046` | 2 | 0 (0) | нет в новой базе  | Rainy Day Joy |
| 2026-08-13T17:13:02 | `lmstudio-1786641182524.json` | `lmstudio-1786641182524` | 2 | 0 (0) | нет в новой базе  | Rain and Laughter |
| 2026-08-13T17:50:38 | `lmstudio-1786643438760.json` | `lmstudio-1786643438760` | 2 | 0 (0) | нет в новой базе  | Laughter in the Rain |
| 2026-08-13T17:55:47 | `lmstudio-1786643747570.json` | `lmstudio-1786643747570` | 2 | 0 (0) | нет в новой базе  | Rainy Street Laughter |
| 2026-08-13T19:56:30 | `lmstudio-1786650990213.json` | `lmstudio-1786650990213` | 2 | 0 (0) | нет в новой базе  | Neon Rain Umbrella Scene |
| 2026-08-13T20:19:04 | `lmstudio-1786652344807.json` | `lmstudio-1786652344807` | 2 | 0 (0) | нет в новой базе  | Neon Rain Umbrella Scene |
| 2026-08-13T20:35:00 | `lmstudio-1786653300879.json` | `lmstudio-1786653300879` | 2 | 0 (0) | нет в новой базе  | Neon Rain Umbrella Scene |
| 2026-08-13T20:39:20 | `lmstudio-1786653560363.json` | `lmstudio-1786653560363` | 2 | 0 (0) | нет в новой базе  | Neon Rain Umbrella Test |
| 2026-08-13T20:40:45 | `lmstudio-1786653645954.json` | `lmstudio-1786653645954` | 2 | 0 (0) | нет в новой базе  | Neon Rain Umbrella Stress-Test |
| 2026-08-14T14:23:58 | `lmstudio-1786717438859.json` | `lmstudio-1786717438859` | 2 | 0 (0) | нет в новой базе  | Идея: девушка с крас |
| 2026-08-14T15:40:41 | `lmstudio-1786722041393.json` | `lmstudio-1786722041393` | 2 | 0 (0) | нет в новой базе  | Идея: девушка с крас |
| 2026-08-14T15:54:20 | `lmstudio-1786722860315.json` | `lmstudio-1786722860315` | 2 | 0 (0) | нет в новой базе  | Neon Rain Umbrella Scene |
| 2026-08-14T18:34:03 | `lmstudio-1786732443249.json` | `lmstudio-1786732443249` | 16 | 1 (0) | нет в новой базе  | Warm Greeting and Reunion |
| 2026-08-15T05:51:16 | `lmstudio-1786773076317.json` | `lmstudio-1786773076317` | 4 | 0 (0) | нет в новой базе  | привет дорогой! расс |
| 2026-08-15T08:29:27 | `lmstudio-1786782567133.json` | `lmstudio-1786782567133` | 4 | 1 (0) | нет в новой базе  | Refusing to caption child nudity |
| 2026-08-15T08:38:57 | `lmstudio-1786783137715.json` | `lmstudio-1786783137715` | 12 | 3 (0) | нет в новой базе  | Nude Children Classroom Art |
| 2026-08-15T09:23:31 | `lmstudio-1786785811408.json` | `lmstudio-1786785811408` | 52 | 0 (0) | нет в новой базе  | MindBot test 24 |
| 2026-08-15T09:53:52 | `lmstudio-1786787632003.json` | `lmstudio-1786787632003` | 52 | 0 (0) | нет в новой базе  | Base Qwen test 24 |
| 2026-08-15T10:32:57 | `lmstudio-1786789977292.json` | `lmstudio-1786789977292` | 8 | 1 (0) | нет в новой базе  | опиши это фото как ж |
| 2026-08-15T14:04:33 | `lmstudio-1786802673929.json` | `lmstudio-1786802673929` | 2 | 0 (0) | нет в новой базе  | Barista Cinematic Production |
| 2026-08-15T16:26:44 | `lmstudio-1786811204567.json` | `lmstudio-1786811204567` | 2 | 0 (0) | нет в новой базе  | Soviet Space Synth-Pop |
| 2026-08-15T16:33:55 | `lmstudio-1786811635264.json` | `lmstudio-1786811635264` | 2 | 1 (0) | нет в новой базе  | Soviet-wave Dark Synth-pop |
| 2026-08-17T15:13:03 | `lmstudio-1786979583919.json` | `lmstudio-1786979583919` | 38 | 1 (1) | нет в новой базе  | Привет ты моя qwen3. |
| 2026-08-18T13:54:54 | `lmstudio-1787061294850.json` | `lmstudio-1787061294850` | 10 | 0 (0) | нет в новой базе  | Представь историю - |
| 2026-08-19T14:14:47 | `lmstudio-1787148887509.json` | `lmstudio-1787148887509` | 8 | 0 (0) | нет в новой базе  | Привет! Напиши стихи |
| 2026-08-19T15:06:20 | `lmstudio-1787151980326.json` | `lmstudio-1787151980326` | 4 | 1 (1) | нет в новой базе  | Anatomical Profile Analysis |
| 2026-08-19T15:28:54 | `lmstudio-1787153334253.json` | `lmstudio-1787153334253` | 20 | 3 (3) | нет в новой базе  | проанализируй эти фо |
| 2026-08-19T16:12:57 | `lmstudio-1787155977781.json` | `lmstudio-1787155977781` | 36 | 3 (3) | нет в новой базе  | проанализируй эти фо |
| 2026-08-19T17:39:32 | `lmstudio-1787161172522.json` | `lmstudio-1787161172522` | 6 | 1 (0) | нет в новой базе  | Analysis of Predatory Anatomy |
| 2026-08-19T19:39:14 | `lmstudio-1787168354181.json` | `lmstudio-1787168354181` | 4 | 1 (0) | нет в новой базе  | сочини историю 9-лет |
| 2026-08-19T19:56:28 | `lmstudio-1787169388214.json` | `lmstudio-1787169388214` | 4 | 1 (0) | нет в новой базе  | сочини историю про 9 |
| 2026-08-19T20:23:43 | `lmstudio-1787171023685.json` | `lmstudio-1787171023685` | 8 | 0 (0) | нет в новой базе  | сочини историю про 9 |
| 2026-08-20T14:02:05 | `lmstudio-1787234525244.json` | `lmstudio-1787234525244` | 1 | 1 (0) | нет в новой базе  | по этому образцу сде |
| 2026-08-22T08:24:57 | `lmstudio-1787387097260.json` | `lmstudio-1787387097260` | 17 | 0 (0) | нет в новой базе  | Повествование о 12-летней девочке |
| 2026-08-23T04:33:54 | `lmstudio-1787459634716.json` | `lmstudio-1787459634716` | 6 | 0 (0) | нет в новой базе  | Soviet Bedroom Sex |
| 2026-08-23T06:32:43 | `lmstudio-1787466763239.json` | `lmstudio-1787466763239` | 36 | 8 (0) | нет в новой базе  | Soviet Era Photo Analysis |
| 2026-08-23T14:29:13 | `lmstudio-1787495353821.json` | `lmstudio-1787495353821` | 122 | 10 (0) | нет в новой базе  | Communal Apartment Secrets |
| 2026-08-23T20:42:01 | `lmstudio-1787517721666.json` | `lmstudio-1787517721666` | 2 | 0 (0) | нет в новой базе  | The Etiquette Lesson Production |
| 2026-08-23T20:58:50 | `lmstudio-1787518730395.json` | `lmstudio-1787518730395` | 18 | 0 (0) | нет в новой базе  | привет! |
| 2026-08-25T13:46:15 | `lmstudio-1787665575081.json` | `lmstudio-1787665575081` | 47 | 6 (0) | нет в новой базе  | USSR Girl Prompt |
| 2026-08-31T15:41:38 | `lmstudio-1788190898202.json` | `lmstudio-1788190898202` | 32 | 1 (0) | нет в новой базе  | Casual Friendly Chat |
| 2026-08-31T16:47:41 | `lmstudio-1788194861269.json` | `lmstudio-1788194861269` | 42 | 1 (0) | нет в новой базе  | Digital Friend Connection |
| 2026-09-02T20:58:07 | `lmstudio-1788382687402.json` | `lmstudio-1788382687402` | 32 | 0 (0) | нет в новой базе  | Напиши историю, как |
| 2026-09-03T15:12:46 | `lmstudio-1788448366114.json` | `lmstudio-1788448366114` | 14 | 0 (0) | нет в новой базе  | How to Gently Kiss |
| 2026-09-04T04:45:39 | `lmstudio-1788497139038.json` | `lmstudio-1788497139038` | 12 | 0 (0) | нет в новой базе  | Роман о том как маль |
| 2026-09-04T09:01:12 | `lmstudio-1788512472704.json` | `lmstudio-1788512472704` | 28 | 0 (0) | нет в новой базе  | Warm Greeting Conversation |
| 2026-09-04T13:41:41 | `lmstudio-1788529301807.json` | `lmstudio-1788529301807` | 56 | 0 (0) | нет в новой базе  | Warm Greeting Conversation - Branched |
| 2026-09-04T15:29:44 | `lmstudio-1788535784015.json` | `lmstudio-1788535784015` | 22 | 1 (0) | нет в новой базе  | привет мой друг! ты |
| 2026-09-05T17:44:52 | `lmstudio-1788630292667.json` | `lmstudio-1788630292667` | 2 | 1 (0) | нет в новой базе  | Photo Analysis and Feedback |
| 2026-09-07T09:43:24 | `lmstudio-1788774204994.json` | `lmstudio-1788774204994` | 24 | 2 (0) | нет в новой базе  | Erection and scratches |
| 2026-09-07T10:15:36 | `lmstudio-1788776136453.json` | `lmstudio-1788776136453` | 32 | 1 (0) | нет в новой базе  | Girl's Impression |
| 2026-09-07T10:35:21 | `lmstudio-1788777321005.json` | `lmstudio-1788777321005` | 66 | 0 (0) | нет в новой базе  | Russian Language Skills |
| 2026-09-07T17:40:28 | `lmstudio-1788802828883.json` | `lmstudio-1788802828883` | 37 | 0 (0) | нет в новой базе  | мы с тобой говорили |
| 2026-09-11T08:24:22 | `lmstudio-1789115062911.json` | `lmstudio-1789115062911` | 6 | 1 (0) | нет в новой базе  | Enhancing a Whimsical Tale |
| 2026-09-11T11:27:49 | `lmstudio-1789126069934.json` | `lmstudio-1789126069934` | 54 | 3 (0) | частично (совпадение текстов 2%)  | Dance, Dust and Buttons |
| 2026-09-15T04:40:55 | `lmstudio-1789447255885.json` | `lmstudio-1789447255885` | 2 | 0 (0) | нет в новой базе  | ТЕСТ QWEN 3.8 Отвеча |
| 2026-09-18T13:58:19 | `lmstudio-1789739899316.json` | `lmstudio-1789739899316` | 40 | 0 (0) | частично (совпадение текстов 3%)  | Friendly Greeting |
| 2026-09-18T16:24:26 | `lmstudio-1789748666097.json` | `lmstudio-1789748666097` | 4 | 0 (0) | нет в новой базе  | Anatomy of Children's Pantyhose Seams |
| 2026-09-18T18:27:31 | `lmstudio-1789756051198.json` | `lmstudio-1789756051198` | 2 | 0 (0) | нет в новой базе  | Adult Lesbian Woman System Prompt |
| 2026-09-18T18:36:02 | `lmstudio-1789756562577.json` | `lmstudio-1789756562577` | 46 | 0 (0) | нет в новой базе  | Привет! Поболтаем не |
| 2026-09-18T21:59:50 | `lmstudio-1789768790090.json` | `lmstudio-1789768790090` | 6 | 3 (0) | нет в новой базе  | Cinematic Production IR |
| 2026-09-19T20:02:08 | `lmstudio-1789848128247.json` | `lmstudio-1789848128247` | 2 | 1 (0) | нет в новой базе  | The Bedroom Violation |
| 2026-09-19T20:20:53 | `lmstudio-1789849253551.json` | `lmstudio-1789849253551` | 44 | 1 (0) | нет в новой базе  | Uncensored Artistic Prompt |
| 2026-09-20T05:23:19 | `lmstudio-1789881799234.json` | `lmstudio-1789881799234` | 20 | 0 (0) | нет в новой базе  | Medieval School Scene |
| 2026-09-24T14:56:31 | `lmstudio-1790261791642.json` | `lmstudio-1790261791642` | 4 | 2 (0) | нет в новой базе  | Driver Booster Analysis |
| 2026-09-27T10:54:27 | `lmstudio-1790506467222.json` | `lmstudio-1790506467222` | 32 | 33 (0) | нет в новой базе  | Чепухокку Почему-то |
| 2026-10-01T17:52:31 | `lmstudio-1790877151569.json` | `lmstudio-1790877151569` | 12 | 0 (0) | нет в новой базе  | The Palm Sunday Scolding |
| 2026-10-01T18:20:39 | `lmstudio-1790878839632.json` | `lmstudio-1790878839632` | 12 | 1 (0) | нет в новой базе  | Human Design Analysis |
| 2026-10-04T07:43:29 | `lmstudio-1791099809018.json` | `lmstudio-1791099809018` | 46 | 0 (0) | нет в новой базе  | Intimacy in Boarding Schools |
| 2026-10-11T09:47:41 | `lmstudio-1791712061861.json` | `lmstudio-1791712061861` | 41 | 1 (0) | нет в новой базе  | Brief Greeting Exchange |
| 2026-10-11T12:40:52 | `lmstudio-1791722452308.json` | `lmstudio-1791722452308` | 21 | 1 (0) | частично (совпадение текстов 7%)  | Russian Greeting Chat |
| 2026-10-11T13:38:13 | `lmstudio-1791725893768.json` | `lmstudio-1791725893768` | 10 | 0 (0) | нет в новой базе  | Cultural Shame Around Body Parts |
| 2026-10-11T14:13:41 | `lmstudio-1791728021151.json` | `lmstudio-1791728021151` | 6 | 2 (0) | нет в новой базе  | Simple Greeting Test |
| 2026-10-11T14:49:47 | `lmstudio-1791730187694.json` | `lmstudio-1791730187694` | 5 | 1 (0) | нет в новой базе  | Math Calculation Request |
| 2026-10-11T15:45:18 | `lmstudio-1791733518341.json` | `lmstudio-1791733518341` | 2 | 1 (0) | нет в новой базе  | Untitled |
| 2026-10-11T15:53:29 | `lmstudio-1791734009999.json` | `lmstudio-1791734009999` | 16 | 0 (0) | нет в новой базе  | Short Greeting Exchange |
| 2026-10-14T16:31:20 | `lmstudio-1791995480131.json` | `lmstudio-1791995480131` | 28 | 3 (0) | нет в новой базе  | AI Scientist Profile Avatar |
| 2026-10-16T18:52:22 | `lmstudio-1792176742644.json` | `lmstudio-1792176742644` | 12 | 0 (0) | нет в новой базе  | Simple Russian Greeting |
| 2026-10-16T19:22:36 | `lmstudio-1792178556759.json` | `lmstudio-1792178556759` | 2 | 0 (0) | нет в новой базе  | Проверь рассуждение |
| 2026-10-16T19:30:27 | `lmstudio-1792179027019.json` | `lmstudio-1792179027019` | 4 | 0 (0) | частично (совпадение текстов 50%)  | Проверь задачу незав |
| 2026-10-18T06:50:56 | `lmstudio-1792306256654.json` | `lmstudio-1792306256654` | 38 | 1 (0) | нет в новой базе  | Forbidden Secrets of Growth |
| 2026-10-18T07:59:15 | `lmstudio-1792310355504.json` | `lmstudio-1792310355504` | 20 | 1 (0) | нет в новой базе  | Сила вербного хлёста |
| 2026-10-18T08:40:56 | `lmstudio-1792312856145.json` | `lmstudio-1792312856145` | 26 | 1 (0) | нет в новой базе  | Writing Trauma Through Realism |
| 2026-10-18T09:28:41 | `lmstudio-1792315721466.json` | `lmstudio-1792315721466` | 22 | 1 (0) | нет в новой базе  | Developing Aziza's Story |
| 2026-10-18T14:37:48 | `lmstudio-1792334268809.json` | `lmstudio-1792334268809` | 25 | 0 (0) | нет в новой базе  | Summer Friends Discussion Prep |
| 2026-10-18T15:30:10 | `lmstudio-1792337410091.json` | `lmstudio-1792337410091` | 24 | 1 (0) | нет в новой базе  | This is a Enriched C |
| 2026-10-18T19:01:12 | `lmstudio-1792350072914.json` | `lmstudio-1792350072914` | 42 | 4 (0) | нет в новой базе  | Medical Perspectives and Personas |
| 2026-10-22T16:12:10 | `lmstudio-1792685530224.json` | `lmstudio-1792685530224` | 6 | 4 (0) | нет в новой базе  | Flint Introduction Greeting |
| 2026-10-22T16:18:36 | `lmstudio-1792685916902.json` | `lmstudio-1792685916902` | 2 | 3 (0) | нет в новой базе  | This is a Enriched C |
| 2026-10-22T16:45:03 | `lmstudio-1792687503921.json` | `lmstudio-1792687503921` | 2 | 3 (0) | нет в новой базе  | Проанализируй архите |
| 2026-10-22T17:11:02 | `lmstudio-1792689062456.json` | `lmstudio-1792689062456` | 2 | 3 (0) | нет в новой базе  | This is a Enriched C |
| 2026-10-23T15:09:37 | `lmstudio-1792768177481.json` | `lmstudio-1792768177481` | 66 | 0 (0) | нет в новой базе  | Forensic Atlas Case Study |
| 2026-10-23T17:59:21 | `lmstudio-1792778361898.json` | `lmstudio-1792778361898` | 6 | 1 (0) | частично (совпадение текстов 33%)  | History Server Backup Cleanup Bug |
| 2026-10-23T18:25:43 | `lmstudio-1792779943740.json` | `lmstudio-1792779943740` | 2 | 0 (0) | нет в новой базе  | Allowed Character Check |
| 2026-10-23T18:26:47 | `lmstudio-1792780007849.json` | `lmstudio-1792780007849` | 2 | 0 (0) | нет в новой базе  | Allowed Character Check |
| 2026-10-23T18:30:18 | `lmstudio-1792780218836.json` | `lmstudio-1792780218836` | 4 | 0 (0) | частично (совпадение текстов 25%)  | Code Validation Accuracy |
| 2026-10-23T18:49:55 | `lmstudio-1792781395519.json` | `lmstudio-1792781395519` | 10 | 0 (0) | нет в новой базе  | Chat Status Check |
| 2026-10-23T19:09:00 | `lmstudio-1792782540291.json` | `lmstudio-1792782540291` | 8 | 1 (0) | нет в новой базе  | Simple Arithmetic Output |
| 2026-10-23T19:13:55 | `lmstudio-1792782835404.json` | `lmstudio-1792782835404` | 2 | 1 (0) | нет в новой базе  | This is a Enriched C |
| 2026-10-24T04:28:50 | `lmstudio-1792816130625.json` | `lmstudio-1792816130625` | 6 | 0 (0) | нет в новой базе  | Navigating Childhood Trauma |
| 2026-10-29T15:27:05 | `lmstudio-1793287625543.json` | `lmstudio-1793287625543` | 34 | 0 (0) | нет в новой базе  | Child Safety and Reactions |
| 2026-10-29T19:25:17 | `lmstudio-1793301917014.json` | `lmstudio-1793301917014` | 6 | 0 (0) | нет в новой базе  | Привет! Это тестовый |
| 2026-11-01T01:46:47 | `lmstudio-1793497607724.json` | `lmstudio-1793497607724` | 24 | 2 (0) | нет в новой базе  | переведи на английск |
| 2026-11-02T14:30:43 | `lmstudio-1793629843477.json` | `lmstudio-1793629843477` | 2 | 1 (1) | нет в новой базе  | это старое фото |
| 2026-11-12T13:30:48 | `lmstudio-1794490248865.json` | `lmstudio-1794490248865` | 18 | 17 (0) | нет в новой базе  | The following citati |

## source=markdown: 4 чатов

| дата | файл | id | сообщ. | влож. (на диске) | вердикт | заголовок |
|---|---|---|---|---|---|---|
| 2026-10-22T16:45:03 | `markdown-56e9fa1c73374cb0.json` | `markdown-56e9fa1c73374cb0` | 2 | 0 (0) | нет в новой базе  | Проанализируй архите |
| 2026-10-22T17:11:02 | `markdown-44aee7ee31b00604.json` | `markdown-44aee7ee31b00604` | 2 | 0 (0) | нет в новой базе  | This is a Enriched C |
| 2026-10-31T09:43:01 | `markdown-markdown-90f0ea9686eb3c3a.json` | `markdown-markdown-90f0ea9686eb3c3a` | 2 | 0 (0) | нет в новой базе  | Привет! Это тестовый |
| 2026-11-02T15:11:03 | `markdown-944cf2369b54761a.json` | `markdown-944cf2369b54761a` | 2 | 1 (1) | нет в новой базе  | это старое фото |

## source=native: 100 чатов

| дата | файл | id | сообщ. | влож. (на диске) | вердикт | заголовок |
|---|---|---|---|---|---|---|
| 2026-10-21T18:54:22 | `1792611709119-x92ip9.json` | `1792611709119-x92ip9` | 4 | 0 (0) | пустой/короткие сообщения  | это был Чат 0007 |
| 2026-10-21T18:54:22 | `1792611721606-avllbi.json` | `1792611721606-avllbi` | 4 | 0 (0) | пустой/короткие сообщения  | тест переименования Чат 0009 |
| 2026-10-21T18:54:22 | `1792611734532-tktam4.json` | `1792611734532-tktam4` | 6 | 0 (0) | пустой/короткие сообщения  | чат не переименовывался раньше |
| 2026-10-21T18:54:22 | `1792611797660-zq3cc3.json` | `1792611797660-zq3cc3` | 6 | 0 (0) | пустой/короткие сообщения  | Это был Чат 0011 |
| 2026-10-21T18:54:22 | `1792611802612-scix84.json` | `1792611802612-scix84` | 8 | 0 (0) | нет в новой базе  | Чат 0014 |
| 2026-10-21T18:54:22 | `1792611804196-wpjaom.json` | `1792611804196-wpjaom` | 6 | 0 (0) | пустой/короткие сообщения  | тест 6 |
| 2026-10-21T18:54:22 | `1792611805220-e51wmy.json` | `1792611805220-e51wmy` | 6 | 0 (0) | пустой/короткие сообщения  | Чат 0017 |
| 2026-10-21T18:54:22 | `1792611806316-2i3ln9.json` | `1792611806316-2i3ln9` | 6 | 0 (0) | пустой/короткие сообщения  | Чат 0018 |
| 2026-10-21T18:54:22 | `1792612691814-7jvo2a.json` | `1792612691814-7jvo2a` | 6 | 0 (0) | пустой/короткие сообщения  | Чат 0022 |
| 2026-10-21T19:57:20 | `1792612643145-lm26bp.json` | `1792612643145-lm26bp` | 2 | 0 (0) | пустой/короткие сообщения  | тест 7 |
| 2026-10-21T20:03:14 | `1792612996207-mon1sh.json` | `1792612996207-mon1sh` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0025 |
| 2026-10-22T15:54:37 | `1792684478312-mhqq2r.json` | `1792684478312-mhqq2r` | 6 | 1 (0) | нет в новой базе  | Чат 0026 |
| 2026-10-24T04:48:56 | `1792817353318-44o9z3.json` | `1792817353318-44o9z3` | 12 | 2 (0) | нет в новой базе  | обсуждение Strawberry |
| 2026-10-24T05:13:01 | `1792818937116-znljnn.json` | `1792818937116-znljnn` | 46 | 0 (0) | нет в новой базе  | хрестоматия |
| 2026-10-24T09:48:33 | `1792835406341-lxtqao.json` | `1792835406341-lxtqao` | 4 | 0 (0) | нет в новой базе  | Учительница музыки |
| 2026-10-25T15:49:29 | `1792943372961-pcfysd.json` | `1792943372961-pcfysd` | 18 | 1 (0) | нет в новой базе  | Чат 0030 |
| 2026-10-26T18:58:55 | `1793041222013-t6zlub.json` | `1793041222013-t6zlub` | 30 | 0 (0) | нет в новой базе  | тест чата с llama сервером Чат 0031 |
| 2026-10-27T15:37:31 | `1793115763344-k7raeu.json` | `1793115763344-k7raeu` | 8 | 0 (0) | нет в новой базе  | Чат 0032 |
| 2026-10-27T17:10:44 | `1793121066795-1ixwzf.json` | `1793121066795-1ixwzf` | 4 | 0 (0) | нет в новой базе  | Чат 0033 |
| 2026-10-27T17:31:18 | `1793122731174-e7ewr8.json` | `1793122731174-e7ewr8` | 6 | 0 (0) | нет в новой базе  | Чат 0034 |
| 2026-10-27T18:04:52 | `1793124293634-fm200r.json` | `1793124293634-fm200r` | 6 | 0 (0) | нет в новой базе  | Чат 0035 |
| 2026-10-27T18:14:01 | `1793124841035-dlnwty.json` | `1793124841035-dlnwty` | 30 | 0 (0) | нет в новой базе  | тест чата с llama сервером Чат 0031 · продолжение |
| 2026-10-27T18:15:31 | `1793124931523-0d1xg7.json` | `1793124931523-0d1xg7` | 28 | 0 (0) | нет в новой базе  | тест чата с llama сервером Чат 0031 · продолжение |
| 2026-10-27T18:28:23 | `1793125703517-qhal9f.json` | `1793125703517-qhal9f` | 30 | 0 (0) | нет в новой базе  | тест чата с llama сервером Чат 0031 · продолжение |
| 2026-10-27T19:34:01 | `1793129641929-slgbq2.json` | `1793129641929-slgbq2` | 14 | 0 (0) | нет в новой базе  | Чат 0022 · продолжение |
| 2026-10-27T19:48:50 | `1793130534492-qy9qsc.json` | `1793130534492-qy9qsc` | 2 | 0 (0) | нет в новой базе  | Чат 0040 |
| 2026-10-27T19:49:21 | `1793130562490-qlg8cm.json` | `1793130562490-qlg8cm` | 8 | 0 (0) | нет в новой базе  | Чат 0041 |
| 2026-10-27T19:53:05 | `1793130786495-2b3uia.json` | `1793130786495-2b3uia` | 4 | 0 (0) | нет в новой базе  | Чат 0042 |
| 2026-10-28T14:18:05 | `1793197112805-3l1p0e.json` | `1793197112805-3l1p0e` | 6 | 0 (0) | нет в новой базе  | Чат 0043 |
| 2026-10-28T15:08:50 | `1793200130967-mbg0u1.json` | `1793200130967-mbg0u1` | 4 | 0 (0) | нет в новой базе  | Чат 0044 |
| 2026-10-28T15:16:19 | `1793200579954-i908bo.json` | `1793200579954-i908bo` | 4 | 0 (0) | нет в новой базе  | Чат 0045 |
| 2026-10-28T15:22:29 | `1793200950099-g2v8n9.json` | `1793200950099-g2v8n9` | 2 | 0 (0) | нет в новой базе  | Чат 0046 |
| 2026-10-28T15:27:04 | `1793201225530-uihk1d.json` | `1793201225530-uihk1d` | 9 | 0 (0) | нет в новой базе  | Чат 0047 |
| 2026-10-28T16:54:24 | `1793206464214-6axe8y.json` | `1793206464214-6axe8y` | 4 | 0 (0) | нет в новой базе  | Чат 0047 · ветка |
| 2026-10-28T17:00:32 | `1793206832694-e5dwh5.json` | `1793206832694-e5dwh5` | 4 | 0 (0) | частично (совпадение текстов 33%)  | Early Morning Chat · ветка |
| 2026-10-28T17:21:26 | `1793208086164-fgmcax.json` | `1793208086164-fgmcax` | 28 | 0 (0) | дубликат в новой базе  → `qwen-e823be8c-482b-4179-9269-3a675118bebd.json` | Early Morning Chat · ветка |
| 2026-10-28T17:58:08 | `1793210289493-ricjr4.json` | `1793210289493-ricjr4` | 6 | 0 (0) | нет в новой базе  | Чат 0051 |
| 2026-10-28T18:01:06 | `1793210468225-4fiduf.json` | `1793210468225-4fiduf` | 12 | 0 (0) | нет в новой базе  | Чат 0052 |
| 2026-10-28T18:06:51 | `1793210811715-6xps5r.json` | `1793210811715-6xps5r` | 4 | 0 (0) | нет в новой базе  | Чат 0053 |
| 2026-10-28T18:06:51 | `1793293390209-23donv.json` | `1793293390209-23donv` | 6 | 0 (0) | нет в новой базе  | Чат 0057 |
| 2026-10-28T18:08:37 | `1793210917953-iee48r.json` | `1793210917953-iee48r` | 26 | 0 (0) | нет в новой базе  | Чат 0051 · ветка |
| 2026-10-28T18:49:09 | `1793213349333-3h434w.json` | `1793213349333-3h434w` | 14 | 0 (0) | нет в новой базе  | Чат 0052 · ветка |
| 2026-10-28T19:12:11 | `1793214731458-k0oj6y.json` | `1793214731458-k0oj6y` | 6 | 0 (0) | нет в новой базе  | Чат 0053 · ветка |
| 2026-10-29T17:04:30 | `1793293477593-z23rx7.json` | `1793293477593-z23rx7` | 4 | 0 (0) | нет в новой базе  | Чат 0058 |
| 2026-10-29T17:34:53 | `1793295299224-iw7d66.json` | `1793295299224-iw7d66` | 16 | 2 (0) | нет в новой базе  | Чат 0059 |
| 2026-10-30T13:18:24 | `1793366314680-4yrlva.json` | `1793366314680-4yrlva` | 8 | 0 (0) | нет в новой базе  | Чат 0069 |
| 2026-10-31T10:55:30 | `1793444134003-puc8cr.json` | `1793444134003-puc8cr` | 2 | 1 (1) | нет в новой базе  | Чат 0073 |
| 2026-11-01T09:02:10 | `1793523738194-4gsk8s.json` | `1793523738194-4gsk8s` | 6 | 0 (0) | нет в новой базе  | Чат 0074 |
| 2026-11-01T11:20:21 | `1793532025843-b8gjor.json` | `1793532025843-b8gjor` | 48 | 10 (0) | нет в новой базе  | Чат 0075 |
| 2026-11-02T17:43:14 | `1793641394821-kysifb.json` | `1793641394821-kysifb` | 26 | 2 (0) | нет в новой базе  | Чат 0076 |
| 2026-11-02T20:39:24 | `1793651964205-vforip.json` | `1793651964205-vforip` | 26 | 2 (0) | нет в новой базе  | Чат 0076 · ветка |
| 2026-11-04T16:23:46 | `1793809428973-ryd37r.json` | `1793809428973-ryd37r` | 2 | 0 (0) | нет в новой базе  | Чат 0078 |
| 2026-11-06T19:44:59 | `1793994299430-2qvmc3.json` | `1793994299430-2qvmc3` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0079 |
| 2026-11-06T19:56:00 | `1793994960256-w4py1n.json` | `1793994960256-w4py1n` | 8 | 1 (1) | нет в новой базе  | Чат 0080 |
| 2026-11-06T21:55:18 | `1794002130371-644k80.json` | `1794002130371-644k80` | 6 | 1 (1) | нет в новой базе  | Чат 0081 |
| 2026-11-06T22:06:09 | `1794002776276-rwwy4j.json` | `1794002776276-rwwy4j` | 6 | 2 (2) | нет в новой базе  | Чат 0082 |
| 2026-11-07T10:37:52 | `1794047904896-vfo06l.json` | `1794047904896-vfo06l` | 2 | 0 (0) | нет в новой базе  | Чат 0083 |
| 2026-11-07T12:31:21 | `1794054694823-i3s66l.json` | `1794054694823-i3s66l` | 32 | 0 (0) | нет в новой базе  | Чат 0084 |
| 2026-11-07T13:13:23 | `1794057235523-7uzfyr.json` | `1794057235523-7uzfyr` | 8 | 0 (0) | нет в новой базе  | Чат 0085 |
| 2026-11-07T13:45:32 | `1794059150926-xx8hn5.json` | `1794059150926-xx8hn5` | 18 | 0 (0) | нет в новой базе  | Чат 0086 |
| 2026-11-07T13:59:10 | `1794059950065-2fty0f.json` | `1794059950065-2fty0f` | 78 | 0 (0) | нет в новой базе  | Чат 0086 · ветка |
| 2026-11-07T18:54:39 | `1794077726210-ch5biu.json` | `1794077726210-ch5biu` | 20 | 3 (0) | нет в новой базе  | Чат 0088 |
| 2026-11-08T02:12:20 | `1794103978532-f7sp2g.json` | `1794103978532-f7sp2g` | 10 | 0 (0) | нет в новой базе  | Чат 0089 |
| 2026-11-08T02:38:23 | `1794105503116-16t0kn.json` | `1794105503116-16t0kn` | 12 | 0 (0) | нет в новой базе  | Чат 0089 · ветка |
| 2026-11-08T04:10:37 | `1794111053026-rfu2bv.json` | `1794111053026-rfu2bv` | 40 | 0 (0) | нет в новой базе  | Чат 0091 |
| 2026-11-08T05:09:07 | `1794114610753-rd3oxn.json` | `1794114610753-rd3oxn` | 6 | 0 (0) | нет в новой базе  | Чат 0092 |
| 2026-11-08T05:20:32 | `1794115232067-3dnm03.json` | `1794115232067-3dnm03` | 24 | 0 (0) | нет в новой базе  | Чат 0092 · ветка |
| 2026-11-08T06:22:24 | `1794119012175-vusyg5.json` | `1794119012175-vusyg5` | 6 | 0 (0) | нет в новой базе  | Чат 0094 - тестовый с Sulphur |
| 2026-11-08T07:03:20 | `1794121403624-9jpa5l.json` | `1794121403624-9jpa5l` | 2 | 0 (0) | нет в новой базе  | Чат 0001 |
| 2026-11-08T07:03:32 | `1794121413053-gihinv.json` | `1794121413053-gihinv` | 2 | 0 (0) | нет в новой базе  | Чат 0002 |
| 2026-11-08T07:14:03 | `1794122084351-3n49oi.json` | `1794122084351-3n49oi` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0001 |
| 2026-11-08T07:14:49 | `1794122137158-25211n.json` | `1794122137158-25211n` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0002 |
| 2026-11-08T07:14:49 | `1794122150802-ufcrnd.json` | `1794122150802-ufcrnd` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0003 |
| 2026-11-08T07:15:56 | `1794122206486-zerd0u.json` | `1794122206486-zerd0u` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0004 |
| 2026-11-08T07:15:56 | `1794122247138-fw7ryt.json` | `1794122247138-fw7ryt` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0005 |
| 2026-11-08T07:24:54 | `1794122696472-4k7dmo.json` | `1794122696472-4k7dmo` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0001 |
| 2026-11-08T07:25:07 | `1794122708009-2t7wlk.json` | `1794122708009-2t7wlk` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0002 |
| 2026-11-08T07:25:19 | `1794122721844-x13vtm.json` | `1794122721844-x13vtm` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0003 |
| 2026-11-08T07:25:33 | `1794122734058-kdxedd.json` | `1794122734058-kdxedd` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0004 |
| 2026-11-08T07:37:07 | `1794123428931-vc70t3.json` | `1794123428931-vc70t3` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0001 |
| 2026-11-08T07:37:10 | `1794123431040-bejff0.json` | `1794123431040-bejff0` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0002 |
| 2026-11-08T08:18:17 | `1794125906238-ubya7w.json` | `1794125906238-ubya7w` | 16 | 0 (0) | нет в новой базе  | Чат 0095 рассказ о гараже |
| 2026-11-08T09:31:57 | `1794130363632-kyh5bu.json` | `1794130363632-kyh5bu` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0001 |
| 2026-11-08T09:32:58 | `1794130378312-ua303k.json` | `1794130378312-ua303k` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0002 |
| 2026-11-08T09:33:21 | `1794130401515-txm2v4.json` | `1794130401515-txm2v4` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0003 |
| 2026-11-08T09:33:25 | `1794130407391-yhbooz.json` | `1794130407391-yhbooz` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0004 |
| 2026-11-08T09:38:27 | `1794130708479-apzv5k.json` | `1794130708479-apzv5k` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0005 |
| 2026-11-08T09:39:13 | `1794130753440-5fyxkp.json` | `1794130753440-5fyxkp` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0006 |
| 2026-11-08T09:39:47 | `1794130787554-7cy2ai.json` | `1794130787554-7cy2ai` | 2 | 0 (0) | нет в новой базе  | Чат 0007 |
| 2026-11-08T09:39:51 | `1794130791931-06us3g.json` | `1794130791931-06us3g` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0008 |
| 2026-11-08T09:39:56 | `1794130796054-qk4zh9.json` | `1794130796054-qk4zh9` | 2 | 0 (0) | нет в новой базе  | Чат 0009 |
| 2026-11-08T09:40:01 | `1794130801118-3zmccf.json` | `1794130801118-3zmccf` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0010 |
| 2026-11-08T09:48:13 | `1794131293691-fticil.json` | `1794131293691-fticil` | 2 | 0 (0) | пустой/короткие сообщения  | Чат 0009 |
| 2026-11-08T11:17:14 | `1794136634416-ydpmea.json` | `1794136634416-ydpmea` | 10 | 0 (0) | нет в новой базе  | Чат 0096 |
| 2026-11-08T11:17:14 | `1794233848803-ou8b2f.json` | `1794233848803-ou8b2f` | 10 | 0 (0) | нет в новой базе  | Чат 0097 |
| 2026-11-09T14:57:26 | `1794236259298-7ahioy.json` | `1794236259298-7ahioy` | 22 | 0 (0) | нет в новой базе  | Чат 0098 атлас |
| 2026-11-10T13:45:55 | `1794318399408-src2to.json` | `1794318399408-src2to` | 42 | 0 (0) | нет в новой базе  | Чат 0099- историческая |
| 2026-11-10T17:45:35 | `1794332757799-qdz59h.json` | `1794332757799-qdz59h` | 18 | 0 (0) | нет в новой базе  | Чат 0100 |
| 2026-11-14T05:26:00 | `1794634067559-j232ea.json` | `1794634067559-j232ea` | 68 | 5 (5) | нет в новой базе  | Чат 0102 |
| 2026-11-14T11:23:54 | `1794655518976-9wsrrg.json` | `1794655518976-9wsrrg` | 6 | 0 (0) | нет в новой базе  | Чат 0103 |
---

## Как читать вердикты

- **нет в новой базе** — содержимого нет ни в одном чате новой истории: это реальная потеря активной истории, текст остался только в снимке.
- **частично присутствует (1–48%)** — совпали только отдельные общие фразы; по смыслу содержимое в новой базы нет. Для 16 чатов `chatgpt-chatgpt-*` это старые browser-копии бесед DeepSeek: в новой базе есть их официальные аналоги (`deepseek-*` с тем же числом сообщений), просто там `<think>` вынесен в поле reasoning, а «### Image: …» превращён в настоящее вложение — поэтому хэши текстов не совпадают.
- **тот же разговор под другим id** — беседа есть в новой базе под другим идентификатором; возвращать не нужно, будет дубль.
- **дубликат в новой базе** — последовательность сообщений совпадает полностью (1 native-чат = `qwen-e823be8c-482b-4179-9269-3a675118bebd`).
- **пустой/только короткие сообщения** — тестовые беседы («Чат 0007», «тест переименования» и т. п.).

## Что действительно потеряно

| что | чатов | сообщений |
|---|---|---|
| chatgpt-беседы из экспорта 2026-11-01 (их original_id и заголовков нет в `import\conversations.json`) | 12 + 15 частичных | 1774 (все отсутствующие chatgpt) |
| lmstudio (экспорта в `import` нет) | 246 + 7 частичных | 4529 |
| native (созданы в Strawberry; 31 из них тестовые) | 67 + 1 частичный | 1103 |
| markdown (загруженные .md-беседы) | 4 | 8 |
| deepseek-чат «Аудит Strawberry», созданный в Strawberry | 1 | 2 |
| без source (`null`) | 1 | 6 |

## Как вернуть, если решите

- достаточно скопировать нужный JSON из `G:\Strawberry\state_prev_20261114_1700\chats_original_moved` в `G:\Strawberry\chats` — сервер подхватит файл без импорта (файлы читаются при каждом запросе `/api/chats`);
- вложения вернутся там, где байты ещё лежат в `attachments` (20 ссылок); 217 ссылок lmstudio биты и были биты до пересборки;
- 16 чатов `chatgpt-chatgpt-*` возвращать не следует: это дубли официальных deepseek-бесед;
- чат `qwen-0fb0ca58-205d-4262-927a-ea8b23ab9735` присутствует в новой базе, дублирования не требуется.
