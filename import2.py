"""CLI нового импортёра (importer_v2).

Примеры:
    python import2.py <файл_экспорта>... --chats-dir <каталог> [--dry-run] [--force]
    python import2.py G:\\Strawberry\\import\\conversations.json --source deepseek --dry-run
    python import2.py G:\\lmstudio-export.zip --dry-run          # ZIP как транспорт (C2)

Формат определяется по структуре файла, не по имени; --source задаёт адаптер
явно, если автоматического определения мало. Рабочие пути v1 (import.py,
import_chats_v1.4.1-stageB.py) этот вызов не использует.

ZIP (этап C2) распаковывается во временную область вне рабочего архива и
сразу отдаётся тем же адаптерам и поясам поиска вложений; архив целиком
отклоняется при превышении лимитов или опасной записи — частичного импорта нет.

План импорта (этап C4b, принятый контракт STAGE_C4B_PLAN_CONTRACT.md): --plan
составляет план на том же маршруте разбора, что и обычный прогон (dry_run=True),
и ничего не пишет в архив; --plan-out кладёт план в файл атомарно, без флага план
идёт в stdout (вся диагностика — в stderr). --overwrite-plan разрешает перезапись
существующего ФАЙЛА ПЛАНА (любой другой файл — отказ, D-23/D-29/D-31/D-34).
--answers читает ответы оператора на неоднозначности; ответы привязаны к
inputsFingerprint входов, а не к экземпляру плана. --strict-ambiguous останавливает
прогон до первой записи, если осталась неразрешённая неоднозначность (код 5).
Режима «применить план» нет: реальный прогон заново выводит решения тем же кодом.

Пакет strawberry.v1 (этап C3) — экспорт форка ACE: chat.json + manifest.json +
attachments/<assetId>.dat. Формат определяется только полем format, идентификатор
берётся из conversationId (или из /c/ в адресе), вложения получают available только
после проверки размера и SHA256 по манифесту. Запись в архиве остаётся записью
ChatGPT (имя chatgpt-<uuid>.json), повторный импорт даёт SKIP.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from importer_v2 import ImportEngine, ImportStats, container, report  # noqa: E402
from importer_v2 import plan as planning   # C4b: план, отпечатки, ответы, артефакты


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Импорт чатов в архив Strawberry (v2)")
    p.add_argument("inputs", nargs="+", help="файлы или каталоги экспортов")
    p.add_argument("--chats-dir", default=str(ROOT / "chats"),
                   help="каталог чатов архива (по умолчанию G:\\Strawberry\\chats)")
    p.add_argument("--attachments-dir", default=None,
                   help="каталог вложений (по умолчанию <chats-dir>/../attachments)")
    p.add_argument("--backup-dir", default=None,
                   help="каталог бэкапов перед перезаписью (<chats-dir>/../backup)")
    p.add_argument("--assets-dir", default=None,
                   help="каталог .dat-вложений ChatGPT (conversation_asset_file_names.json)")
    p.add_argument("--lmstudio-files-dir", default=None,
                   help="каталог user-files LM Studio (верхний, явный пояс поиска; "
                        "затем проверяются user-files внутри папки экспорта, "
                        "соседняя с ней и локальная ~/.lmstudio/user-files)")
    p.add_argument("--source", default=None,
                   help="явный формат: deepseek|qwen|chatgpt|claude|browser|lmstudio|"
                        "llamacpp|markdown|strawberry (пакет chat.json + manifest.json)")
    p.add_argument("--min-confidence", type=float, default=0.4,
                   help="минимальная уверенность автоопределения (по умолчанию 0.4)")
    p.add_argument("--tz-offset", default=None,
                   help="пояс для меток без пояса, например +05:00 (по умолчанию системный)")
    p.add_argument("--dry-run", action="store_true", help="только разбор и план, без записи")
    p.add_argument("--force", action="store_true",
                   help="перезаписывать локально изменённые чаты (с бэкапом)")
    p.add_argument("--report", default=None, help="куда положить JSON-отчёт прогона")
    p.add_argument("--allow-missing-assets", action="store_true",
                   help="разрешить импорт без переноса вложений, если --assets-dir недоступен")
    p.add_argument("--quiet", action="store_true", help="не печатать по каждой беседе")
    # этап C2: ZIP как транспортный контейнер
    p.add_argument("--unpack-dir", default=None,
                   help="куда распаковывать архивы (по умолчанию %%TEMP%%\\strawberry-import-<pid>-<случай>); "
                        "обязательно вне chats/attachments/backup")
    p.add_argument("--keep-unpacked", action="store_true",
                   help="не удалять временную область распаковки (отладка)")
    p.add_argument("--zip-max-entries", type=int, default=container.DEFAULT_MAX_ENTRIES,
                   help="максимум записей в архиве (по умолчанию %(default)s)")
    p.add_argument("--zip-max-total-mb", type=int, default=container.DEFAULT_MAX_TOTAL_BYTES // (1024 * 1024),
                   help="максимум распакованных байт на архив, МиБ (по умолчанию %(default)s)")
    p.add_argument("--zip-max-entry-mb", type=int, default=container.DEFAULT_MAX_ENTRY_BYTES // (1024 * 1024),
                   help="максимум одной записи, МиБ (по умолчанию %(default)s)")
    # этап C4b: план импорта, ответы оператора, строгая неоднозначность
    p.add_argument("--plan", action="store_true",
                   help="составить план импорта и ничего не писать (тот же код разбора, "
                        "dry_run=True); JSON плана — в stdout, диагностика — в stderr")
    p.add_argument("--plan-out", default=None, metavar="ФАЙЛ",
                   help="куда положить файл плана (атомарная запись); без флага план в stdout. "
                        "В chats/attachments/backup класть нельзя, существующий файл "
                        "перезаписывается только с --overwrite-plan и только если он план")
    p.add_argument("--overwrite-plan", action="store_true",
                   help="разрешить перезапись существующего файла плана (не любого файла)")
    p.add_argument("--answers", default=None, metavar="ФАЙЛ",
                   help="JSON с ответами оператора на неоднозначности; сверяется "
                        "inputsFingerprint входов")
    p.add_argument("--strict-ambiguous", action="store_true",
                   help="остановить прогон до первой записи, если осталась неразрешённая "
                        "неоднозначность (код возврата 5, записей и бэкапов ноль)")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    # C2: сироты распаковки (остались после Ctrl+C или падения процесса) чистятся
    # по маске только в %TEMP% и только старше порога — чужие файлы не трогаются
    if not args.keep_unpacked:
        removed = container.sweep_temp_orphans()
        if removed:
            print(f"[УБОРКА] удалены старые временные области распаковки: {len(removed)}")

    local_tz = None
    if args.tz_offset:
        sign = 1 if not args.tz_offset.startswith("-") else -1
        hh, _, mm = args.tz_offset.lstrip("+-").partition(":")
        from datetime import timedelta
        local_tz = timezone(sign * timedelta(hours=int(hh), minutes=int(mm or 0)))
    else:
        local_tz = datetime.now().astimezone().tzinfo

    # Этап B: указанный каталог — только верхний (явный) пояс поиска. Остальные
    # пояса (переносимая user-files внутри папки экспорта, соседняя с ней и
    # локальная папка LM Studio) строит движок по входам прогона; локальный путь
    # не зашит с именем пользователя — это Path.home()/.lmstudio/user-files либо
    # переменная окружения LMSTUDIO_FILES_DIR.
    lm_dir = args.lmstudio_files_dir

    chats_dir = Path(args.chats_dir)
    if not args.dry_run:
        chats_dir.mkdir(parents=True, exist_ok=True)

    # ---- C4b: уровень 0 (§3.2) — решение о судьбе цели --plan-out ДО обхода входов
    plan_mode = bool(args.plan or args.plan_out)
    plan_out = Path(args.plan_out) if args.plan_out else None
    attachments_dir = (Path(args.attachments_dir) if args.attachments_dir
                       else chats_dir.parent / "attachments")
    backup_dir = (Path(args.backup_dir) if args.backup_dir
                  else chats_dir.parent / "backup")

    def plan_stop(reason: str, detail: str) -> int:
        """Причина кода 2 из §8.1: diagnostic before any walk, no writes at all."""
        print("[ОШИБКА ПЛАНА] " + reason + ": " + detail, file=sys.stderr)
        print("ИТОГ: " + json.dumps({"code": 2, "plan_error": reason,
                                     "detail": detail}, ensure_ascii=False),
              file=sys.stderr)
        return 2

    if plan_out is not None:
        target_canon = planning.canon(plan_out)
        for label, d in (("chats", chats_dir), ("attachments", attachments_dir),
                         ("backup", backup_dir)):
            if planning.is_within(target_canon, planning.canon(d)):
                return plan_stop(
                    "plan_out_in_data_dir",
                    f"--plan-out указывает в каталог данных {label} "
                    f"({planning.canon(d)}): план не должен лежать там, где импортёр "
                    "пишет чаты, вложения и резервные копии (D-25, §3.1 — сравнение по "
                    "каноническим путям: регистр, `..`, junction, ловушка префикса)")
        kind0 = planning.classify_plan_target(plan_out)
        if kind0 == "input":
            return plan_stop(
                "plan_out_is_input",
                f"цель --plan-out — существующий читаемый вход ({plan_out}): это может "
                "быть настоящая беседа, перезаписать её планом нельзя. --overwrite-plan "
                "права не даёт: он разрешает перезапись плана планом (D-29, D-34). "
                "Обход входов не начинался, файл не тронут")
        if kind0 == "unreadable":
            return plan_stop(
                "plan_out_unreadable_target",
                f"содержимое цели --plan-out ({plan_out}) не читается и маркеров плана "
                "в первых 512 байтах нет: нельзя доказать ни «это план», ни «это вход» "
                "(D-31). Файл не тронут, обход не начинался, read_errors не появляется")
        if kind0 in ("plan", "plan_damaged") and not args.overwrite_plan:
            return plan_stop(
                "plan_out_exists",
                f"файл плана уже существует ({plan_out}), --overwrite-plan не указан "
                "(D-23): прежний план сохраняется, новый не записан, обход не начинался")

    # ---- C4b: файл ответов оператора (§7, §8.1) — до разбора и до первой записи
    answers_obj = None
    if args.answers:
        obj, bad, why = planning.load_answers(Path(args.answers))
        if bad:
            return plan_stop(bad, why)
        if not planning.is_fingerprint(obj.get("inputsFingerprint")):
            return plan_stop(
                "answers_malformed",
                f"в файле ответов нет поля inputsFingerprint формы sha256:<64 hex> "
                f"({args.answers}): ответы привязаны к отпечатку входов (У-Д)")
        answers_obj = obj

    # T-P-20: в режиме плана stdout отдаётся плану, вся диагностика — в stderr
    real_stdout = sys.stdout
    if plan_mode:
        sys.stdout = sys.stderr

    engine = ImportEngine(
        chats_dir,
        attachments_dir=args.attachments_dir,
        backup_dir=args.backup_dir,
        assets_dir=args.assets_dir,
        lmstudio_files_dir=lm_dir,
        local_tz=local_tz,
        force=args.force,
        source_hint=args.source,
        min_confidence=args.min_confidence,
        quiet=args.quiet,
        allow_missing_assets=args.allow_missing_assets,
        unpack_dir=args.unpack_dir,
        keep_unpacked=args.keep_unpacked,
        zip_max_entries=args.zip_max_entries,
        zip_max_total_bytes=args.zip_max_total_mb * 1024 * 1024,
        zip_max_entry_bytes=args.zip_max_entry_mb * 1024 * 1024,
        dry_run=args.dry_run or plan_mode,
        plan_mode=plan_mode,
        plan_out=plan_out,
        answers=answers_obj,
        answers_path=Path(args.answers) if args.answers else None,
        strict_ambiguous=args.strict_ambiguous,
        tz_offset_label=args.tz_offset,
    )
    # §8.3: различие входов при plan_stale считается по идентичностям ПРЕДЫДУЩЕГО
    # прогона из файла отчёта по тому же пути --report; движку нужен этот путь в
    # любом режиме, а не только в плане (--dry-run и признак плана включены выше,
    # второй маршрут разбора не появляется — D-20)
    engine.report_path = Path(args.report) if args.report else None

    stats = None
    fatal = None
    try:
        stats = engine.run([Path(p) for p in args.inputs])
        # C4b (§8.2): пока не сняты причины кодов 2 и 5 и не снят ASSETS_GUARD,
        # ни одна отложенная запись не выполняется. Порядок: 4 → 2 → 5 → 3 → 1 → 0.
        stop = bool(stats.plan_errors) or bool(stats.counts.get("ASSETS_GUARD"))
        # C4b (§8.1): каждая причина кода 2 называется машиночитаемо и человекочитаемо
        for pe in stats.plan_errors[:12]:
            print(f"[ОШИБКА ПЛАНА] {pe['reason']}: {pe['detail']}", file=sys.stderr)
        if len(stats.plan_errors) > 12:
            print(f"[ОШИБКА ПЛАНА] и ещё {len(stats.plan_errors) - 12} причин",
                  file=sys.stderr)
        if args.strict_ambiguous and stats.counts.get("AMBIGUOUS"):
            stop = True
        if not stop and stats.pending_writes:
            try:
                engine.commit_writes(stats)
            except Exception as e:
                fatal = f"write: {type(e).__name__}: {e}"
                stats.bump("WRITE_ERRORS")
                print(f"[FATAL] отложенная запись не удалась: {fatal}")
    except (Exception, KeyboardInterrupt) as e:
        # прогон упал целиком или прерван (Ctrl+C): отчёт всё равно нужен (A5).
        # SystemExit (в том числе argparse) не перехватываем — его код 2 уже верён.
        fatal = f"{type(e).__name__}: {e}"
        stats = ImportStats()
        stats.bump("FATAL")
        stats.errors.append({"file": "(прогон)", "error": f"fatal: {fatal}"})
        print(f"[FATAL] прогон прерван: {fatal}")
    try:
        print(report.summary_text(stats))
    except Exception as e:
        fatal = fatal or f"summary: {type(e).__name__}: {e}"
        print(f"[FATAL] сводка не построена: {type(e).__name__}: {e}")
    finally:
        # C2: подстраховка — временная область распаковки не должна пережить прогон
        engine.cleanup_unpack()
        report_path = None
        if args.report:
            try:
                report_path = report.write_json(stats, Path(args.report))
                print(f"отчёт: {report_path}")
            except Exception as e:
                fatal = fatal or f"report: {type(e).__name__}: {e}"
                print(f"[FATAL] отчёт не записан: {type(e).__name__}: {e}")

    # ---- C4b: файл плана. plannedExitCode — код, который даст обычный прогон этих
    # же входов без --strict-ambiguous (§6); расхождение предсказания и факта означает,
    # что план устарел (§8.3)
    if plan_mode:
        planned = exit_code(stats, fatal)
        if stats.plan_errors or fatal:
            print("[ОШИБКА ПЛАНА] план не записан (причины названы выше)",
                  file=sys.stderr)
        else:
            try:
                doc = engine.plan_document(stats, planned)
                text = planning.serialize_plan(doc)
                if plan_out is not None:
                    planning.write_plan_atomic(plan_out, text)
                    print(f"план: {plan_out}", file=sys.stderr)
                else:
                    real_stdout.write(text)
            except Exception as e:
                fatal = fatal or f"plan: {type(e).__name__}: {e}"
                print(f"[FATAL] план не записан: {type(e).__name__}: {e}",
                      file=sys.stderr)

    code = exit_code(stats, fatal, stats.plan_errors,
                     bool(args.strict_ambiguous and stats.counts.get("AMBIGUOUS")))
    if stats.counts.get("ASSETS_GUARD"):
        print("Импорт остановлен, чаты не записаны: без доступного --assets-dir "
              "перенос вложений официального экспорта ChatGPT невозможен. "
              "Укажите каталог ассетов или передайте --allow-missing-assets, "
              "если вложения переносить не нужно.")
    # машиночитаемая строка для будущего окна импорта (этап D): один JSON в последней
    # строке вывода, без необходимости разбирать человекочитаемую сводку
    print("ИТОГ: " + json.dumps({
        "code": code,
        "fatal": fatal,
        "counts": stats.counts,
        "chats": len(stats.chats),
        "attachments": stats.attachments,
        "lmstudio": stats.lmstudio,
        "containers": stats.containers,
        "packages": stats.packages,
        "errors_total": len(stats.errors),
        "report": str(report_path) if report_path else None,
        "plan_errors": [e["reason"] for e in stats.plan_errors] or None,
        "ambiguities": len(stats.ambiguities) or None,
        "plan_artifacts": len(stats.plan_artifacts) or None,
        "inputs_fingerprint": getattr(engine, "_inputs_fp", None),
    }, ensure_ascii=False))
    return code


def exit_code(stats, fatal=None, plan_errors=None, strict_unresolved: bool = False) -> int:
    """Коды завершения (согласованы, Stage A):

    0 — прогон прошёл без проблем;
    1 — прогон завершён, но есть проблемы входных данных (не прочитан, формат
        не распознан, ошибка формата, отказ одной беседы);
    2 — ошибка аргументов (её обрабатывает argparse);
    3 — остановлено из-за отсутствия необходимых байтов вложений (ASSETS_GUARD);
    4 — фатальное прерывание или внутренняя ошибка (отказ записи, отказ отчёта,
        необработанное исключение). Фатальные ошибки кодом 1 не маскируются.

    Служебные входы LM Studio (sidecar'ы user-files и легаси-копии уже
    представленных бесед, счётчики not_a_chat, LEGACY_DUP и DUP) кодом завершения
    не считаются: это не проблемы входных данных, их причина видна в отчёте прогона.
    DUP_SUSPECT (этап C1: у входов один и тот же идентификатор, но разное
    содержимое) — наоборот, даёт код 1: это вход, который импортёр не стал переносить
    автоматически, и оператор должен это увидеть. Нового кода для этого нет.

    Отклонённый ZIP-контейнер (этап C2, счётчик ZIP_ERRORS) — тоже код 1: архив
    не импортирован целиком, частичного импорта его содержимого не бывает, а
    остальные входы прогона обработаны. Основание отказа видно в блоке
    containers отчёта.

    AMBIGUOUS (этап C3) — код 1: у входа не определён формат (пакет StrawBerry
    без маркера format) либо у пакета нет устойчивого идентификатора беседы.
    Такой вход не импортирован и ждёт явного решения оператора (--source);
    придумывать идентификатор вместо отсутствующего нельзя, иначе идемпотентный
    импорт теряет смысл.

    SOURCE_MISMATCH (защита явного выбора, 21.11.2026 21:07) — тоже код 1: вход
    распознан как пакет strawberry.v1 (с маркером или в серой зоне), но оператор
    явно выбрал чужой источник (--source browser, chatgpt, lmstudio...). Пакет
    отклонён целиком, ни чата, ни вложений; разбор чужим адаптером стоил бы
    данных, поэтому молча продолжать нельзя. Источник не подменяется, флага
    «разрешить потерю» нет.

    PACKAGE_STRUCTURE (целостность пакета, 21.11.2026 22:08) — тоже код 1: в
    пакете strawberry.v1 больше одного файла данных беседы либо conversationId
    файла беседы не совпадает с conversationId из manifest.json. По контракту
    пакета один пакет — одна беседа (один manifest.json с одним
    conversationId), поэтому пакет отклонён целиком и до первой записи: ни
    чата, ни вложений, ни резервных копий. Пакет не разделяется, первая беседа
    не импортируется, вложения не распределяются по совпавшим attachmentId:
    проверка SHA256 доказывает целостность байтов, но не их принадлежность
    беседе. Причины package_multiple_chats и package_manifest_id_mismatch
    видны в отчёте прогона.

    Классификация входов (этап C4a): неподдерживаемый документ или файл
    (офисный .docx/.xlsx/.pptx, картинка, аудио, видео, PDF, текст, неизвестные
    байты) и байты вложений в известных каталогах вложений (user-files,
    <id>_files, attachments пакета) кодом завершения НЕ считаются — счётчики
    not_supported и asset_bytes. Это не проблемы входных данных: файл не беседa,
    он снят с разбора с классом и причиной, список — в блоке inputs JSON-отчёта,
    а число видно в сводке и (для неподдерживаемых) в предупреждении даже при
    --quiet. Повреждённый вход поддерживаемого формата (.json, который не
    читается или не является беседой) по-прежнему даёт код 1.

    UNKNOWN_INPUT (уточнение пользователя от 22.11.2026 17:44) — код 1 для
    входа, содержимое которого не опознано ни одним правилом (класс unknown,
    причина unknown_bytes). Это предупреждение, а не read_errors и не
    parse_errors: файл не читался как чат и не разбирался адаптером, но
    промолчать о нём нельзя — мы не знаем, что это. unsupported (офис, медиа,
    текст, PDF, прочие архивы) при этом остаётся допустимым пропуском с кодом 0.

    Архив по ZIP-сигнатуре внутри папки раскрывается независимо от расширения
    (уточнение от 22.11.2026 17:44); имя .zip без сигнатуры ZIP по-прежнему
    ведёт контейнерный слой этапа C2. Отдельного счётчика zip_unscanned больше
    нет: таких архивов не остаётся.

    КОД 5 (этап C4b, принятый контракт C4b): --strict-ambiguous и осталась хотя бы
    одна неразрешённая неоднозначность. Записей и резервных копий при этом ноль
    (движок откладывает и стадию вложений, и запись файла чата), а остальные проблемы
    входов остаются названными — код 5 отвечает только на вопрос «были ли записи».

    Порядок выбора кода при планах и ответах принят пользователем (решение D-26):
    4 → 2 → 5 → 3 → 1 → 0. Код 2 получает любая из девяти диагностических причин
    §8.1 (plan_stale, answers_malformed, answers_duplicate,
    answer_source_not_candidate, answer_field_not_allowed, plan_out_exists,
    plan_out_in_data_dir, plan_out_is_input, plan_out_unreadable_target) — они
    проверяются до разбора и до первой записи. Код 5 младше кода 2, но старше кода 3:
    при одновременном ASSETS_GUARD и неразрешённой неоднозначности строгий режим даёт
    5, а не 3 (T-P-21).

    Артефакты планирования (файл плана в папке входов, его обрезок, временный файл
    атомарной записи) — не проблемы входов: счётчик PLAN_ARTIFACTS на код возврата не
    влияет (D-32), как и пропуски not_supported / asset_bytes на C4a.
    """
    if fatal:
        return 4
    if stats.counts.get("FATAL") or stats.counts.get("WRITE_ERRORS"):
        return 4
    if plan_errors:
        return 2
    if strict_unresolved:
        return 5
    if stats.counts.get("ASSETS_GUARD"):
        return 3
    for key in ("read_errors", "parse_errors", "undetected",
                "FILE_ERRORS", "CHAT_ERRORS", "ITEM_ERRORS", "DUP_SUSPECT",
                "ZIP_ERRORS", "AMBIGUOUS", "SOURCE_MISMATCH", "PACKAGE_STRUCTURE",
                "UNKNOWN_INPUT"):
        if stats.counts.get(key):
            return 1
    if stats.errors or stats.attachment_errors:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
