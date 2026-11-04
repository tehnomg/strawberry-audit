#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
profile-builder.py — сборка тематического профиля из memory-clean.json (v1.4).

Источник (memory-clean.json) — READ ONLY. memory-pending.json не затрагивается.

Схема memory-clean.json (подтверждена 2026-10-31):
    source_index : int, уникален
    fact         : str
    refined_text : str | null
    category     : str (history | preference | profile | project | intent)
    confidence   : "high" | "medium"
    verdict      : KEEP | REFINE | TEMPORARY | DISCARD | DUPLICATE
    reason       : str
    duplicate_of : int | null

Эволюция:
  v1   — первый рабочий вариант.
  v1.1 — --dry-run, бэкап (с багом float("high")).
  v1.2 — parse_confidence, --no-backup (убран --force), mkdir вынесен,
         --strict-refs, --include-category.
  v1.3 — --anchor / --min-generic. Лечит off-topic от общих ключей
         ("модели радиоприемников", "протеомные сигнатуры").
         Dry-run показал: anchor работает идеально (202/203 по anchor,
         0 мусора), НО LLM сорвалась в repetition loop на длинном
         перечислении ref'ов — max_tokens обрезал посреди [ref:48.
  v1.4 — защита от дегенерации и дисциплина промпта:
         * SYSTEM_PROMPT: максимум 5 ref на пункт, не повторять, не
           перечислять все подходящие ref.
         * detect_degeneration(): незакрытый [ref:, любой ref >20 раз,
           повторы подстрок 150+ символов 3+ раз.
         * finish_reason проверяется: WARN при "length".
         * --frequency-penalty (default 0.3, OpenAI-совместимо).
         * --repeat-penalty (llama.cpp-специфично, если нужно).
         * При дегенерации — exit 5, файлы НЕ пишутся.
         * --no-degeneration-check для отладки.
         Fuzzy-dedup по-прежнему НЕ добавлен (LLM схлопывает сама).

Примеры:
    # Dry-run с anchor-логикой + защитой от петель:
    python profile-builder.py krea "модели, генерация, промпты, изображения" \
        --anchor "krea,krea2,wangp,wan2gp,wan2.2" --min-generic 2 \
        --dry-run --budget 4000

    # Если петля повторилась — усилить пенальти:
    python profile-builder.py krea "..." --anchor "..." \
        --frequency-penalty 0.6 --max-facts 150 --dry-run

    # Запись с бэкапом:
    python profile-builder.py krea "..." --anchor "..." --budget 4000
"""

import argparse
import json
import os
import re
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

import httpx

# ================= КОНФИГУРАЦИЯ =================
BASE_DIR = Path(__file__).parent.resolve()
CLEAN_FILE = BASE_DIR / "memory-clean.json"   # READ ONLY
MEMORY_DIR = BASE_DIR / "memory"              # mkdir не делаем на импорте!

DEFAULT_LLM_URL = os.getenv("LLM_BACKEND_URL", "http://127.0.0.1:8080").rstrip("/")

VERDICT_WEIGHT = {"KEEP": 1.0, "REFINE": 0.9, "TEMPORARY": 0.5}

CONFIDENCE_MAP = {
    "high": 1.0, "very high": 1.0, "certain": 1.0, "strong": 1.0,
    "medium": 0.7, "moderate": 0.7, "mid": 0.7,
    "low": 0.4, "weak": 0.4, "uncertain": 0.3,
}

ANCHOR_WEIGHT = 3.0

# Порог для detect_degeneration: если один и тот же ref встречается чаще — петля.
DEGENERATION_REF_THRESHOLD = 20
DEGENERATION_SUBSTRING_LEN = 150
DEGENERATION_REPEAT_COUNT = 3


# ================= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =================
def load_json(path: Path):
    if not path.exists():
        print(f"[ERROR] File not found: {path}", file=sys.stderr)
        sys.exit(1)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[ERROR] Bad JSON in {path}: {e}", file=sys.stderr)
        sys.exit(1)


def parse_confidence(raw):
    """float 0..1 или None. Никогда не бросает исключение."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        v = float(raw)
        if 0.0 <= v <= 1.0:
            return v
        if 1.0 < v <= 100.0:
            return v / 100.0
        return None
    if isinstance(raw, str):
        s = raw.strip().lower()
        if s in CONFIDENCE_MAP:
            return CONFIDENCE_MAP[s]
        try:
            return parse_confidence(float(s))
        except ValueError:
            print(f"[WARN] Unknown confidence value: {raw!r} — treated as None.")
            return None
    return None


def sanitize_name(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^\w\-]+", "_", name, flags=re.UNICODE).strip("_")
    if not name:
        print("[ERROR] Bad profile name", file=sys.stderr)
        sys.exit(1)
    return name


def compile_generic_patterns(keywords):
    patterns = []
    for kw in keywords:
        kw = kw.strip()
        if not kw:
            continue
        esc = re.escape(kw)
        patterns.append(re.compile(rf"(?<!\w){esc}(?!\w)", re.IGNORECASE | re.UNICODE))
    return patterns


def compile_anchor_patterns(anchors):
    """Anchor матчится с начала слова: "krea" ловит "krea2", "krea-2"."""
    patterns = []
    for kw in anchors:
        kw = kw.strip()
        if not kw:
            continue
        esc = re.escape(kw)
        patterns.append(re.compile(rf"(?<!\w){esc}", re.IGNORECASE | re.UNICODE))
    return patterns


def fact_hits(fact: dict, anchor_patterns, generic_patterns):
    text = fact["text"].lower()
    a = sum(1 for p in anchor_patterns if p.search(text))
    g = sum(1 for p in generic_patterns if p.search(text))
    return a, g


def fact_passes(anchor_hits: int, generic_hits: int, min_generic: int) -> bool:
    if anchor_hits > 0:
        return True
    return generic_hits >= min_generic


def fact_score(fact: dict, anchor_hits: int, generic_hits: int) -> float:
    if anchor_hits == 0 and generic_hits == 0:
        return 0.0
    weight = VERDICT_WEIGHT.get(fact["verdict"], 0.5)
    conf = fact["confidence"] if fact["confidence"] is not None else 0.7
    n = len(fact["text"])
    length_penalty = 0.7 if n > 400 else (0.85 if n > 200 else 1.0)
    hits_weighted = anchor_hits * ANCHOR_WEIGHT + generic_hits
    return hits_weighted * weight * conf * length_penalty


def clean_markdown(content: str) -> str:
    content = content.strip()
    for fence in ("```markdown", "```md", "```"):
        if content.startswith(fence):
            content = content[len(fence):]
            break
    if content.rstrip().endswith("```"):
        content = content.rstrip()[:-3]
    return content.strip()


def extract_refs(content: str):
    refs = set()
    for m in re.finditer(r"\[ref:([^\]]+)\]", content):
        for part in re.split(r"[,\s]+", m.group(1)):
            part = part.replace("ref:", "").strip()
            if part.isdigit():
                refs.add(part)
    return refs


def detect_degeneration(content: str) -> tuple:
    """
    Возвращает (is_degenerate: bool, reason: str).
    Ловит три класса проблем:
      1. Незакрытый [ref: (обрыв).
      2. Любой отдельный ref повторяется > DEGENERATION_REF_THRESHOLD раз.
      3. Подстрока длины DEGENERATION_SUBSTRING_LEN повторяется >= REPEAT_COUNT раз.
    """
    # 1. Незакрытые [ref: — считаем открытые маркеры vs закрытые скобки
    if content.count("[ref:") > content.count("]"):
        return True, "unterminated [ref: block (truncated mid-structure)"

    # 2. Один ref повторяется слишком часто
    all_ref_ids = []
    for block in re.findall(r"\[ref:([^\]]+)\]", content):
        for part in re.split(r"[,\s]+", block):
            part = part.replace("ref:", "").strip()
            if part.isdigit():
                all_ref_ids.append(part)
    if all_ref_ids:
        top = Counter(all_ref_ids).most_common(1)[0]
        if top[1] > DEGENERATION_REF_THRESHOLD:
            return True, f"ref:{top[0]} repeated {top[1]} times"

    # 3. Повторяющаяся подстрока
    L = DEGENERATION_SUBSTRING_LEN
    if len(content) > L * DEGENERATION_REPEAT_COUNT:
        for i in range(0, len(content) - L * DEGENERATION_REPEAT_COUNT, L):
            chunk = content[i:i + L]
            if chunk.strip() and content.count(chunk) >= DEGENERATION_REPEAT_COUNT:
                return True, f"substring of {L} chars repeated {content.count(chunk)}+ times"

    return False, ""


def save_with_backup(path: Path, content: str, backup: bool):
    backup_path = None
    if path.exists():
        if backup:
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup_path = path.with_name(path.name + f".bak-{stamp}")
            shutil.copy2(path, backup_path)
            print(f"[INFO] Backup: {backup_path}")
        else:
            print(f"[WARN] Overwriting {path} without backup (--no-backup).")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return backup_path


SYSTEM_PROMPT = """Ты — ассистент, который собирает тематический профиль пользователя из уже проверенных фактов памяти.

На вход дают список фактов, отфильтрованных по теме. Каждый факт помечен [ref:ID].
Составь из них компактный, связный Markdown-документ.

ПРАВИЛА:
1. Используй ТОЛЬКО предоставленные факты. Ничего не выдумывай.
2. Если факт НЕ относится к теме профиля — исключи его, даже если он есть во входных данных.
3. Объединяй дубли и очень близкие формулировки в один пункт.
4. Противоречия не склеивай — явно отметь их.
5. В конце каждого пункта указывай источник — МАКСИМУМ 5 наиболее релевантных ref
   в формате [ref:1, 7, 12]. НИКОГДА не перечисляй все подходящие refs,
   НЕ повторяй один и тот же ref, НЕ выписывай ref по циклу.
   Если фактов по пункту много — выбери 3-5 самых характерных.
6. Разбей на логические секции: "Оборудование", "Опыт", "Предпочтения", "Текущие задачи" и т.п.
7. Пиши нейтрально, от третьего лица.
8. Никаких вступлений, пояснений и метакомментариев.

ФОРМАТ ОТВЕТА: только валидный Markdown, без ```-обёрток."""


# ================= ОСНОВНАЯ ЛОГИКА =================
def main():
    parser = argparse.ArgumentParser(
        description="Build topic profile from memory-clean.json (read-only source)."
    )
    parser.add_argument("name", help="Profile name, e.g. krea")
    parser.add_argument("keywords",
                        help='Comma-separated generic keywords, e.g. "модели, генерация"')

    parser.add_argument("--anchor", default=None,
                        help='Strong topic keywords (comma-separated). Match starts of words: '
                             '"krea" catches "krea2", "krea-2".')
    parser.add_argument("--min-generic", type=int, default=2,
                        help='How many generic keywords when anchor did NOT match. '
                             'Default: 2 (ignored if --anchor not set).')

    parser.add_argument("--dry-run", action="store_true",
                        help="Print result and exit; do not write files / dirs")
    parser.add_argument("--out", type=Path, default=None,
                        help="Custom output .md path (default: memory/<name>.md)")
    parser.add_argument("--budget", type=int, default=6000,
                        help="Soft max characters for final md (warning only)")
    parser.add_argument("--max-facts", type=int, default=300,
                        help="Max facts sent to LLM after ranking (default: 300)")
    parser.add_argument("--min-confidence", type=float, default=0.0,
                        help="Skip facts with confidence below this (0..1)")
    parser.add_argument("--include-temporary", action="store_true",
                        help="Include TEMPORARY facts (default: off)")
    parser.add_argument("--include-category", default=None,
                        help='Comma-separated category filter, e.g. "project,preference"')
    parser.add_argument("--exclude", default=None,
                        help="Comma-separated exclusion terms. Facts containing any are dropped.")
    parser.add_argument("--no-backup", action="store_true",
                        help="Overwrite existing profile WITHOUT backup (dangerous)")
    parser.add_argument("--no-meta", action="store_true",
                        help="Do not write sidecar .meta.json")
    parser.add_argument("--strict-refs", action="store_true",
                        help="Fail (exit 4) if LLM references unknown ids")
    parser.add_argument("--no-degeneration-check", action="store_true",
                        help="Disable repetition-loop detection (for debugging only)")

    parser.add_argument("--model", default="local-model")
    parser.add_argument("--url", default=DEFAULT_LLM_URL)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--max-tokens", type=int, default=4000)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--frequency-penalty", type=float, default=0.3,
                        help="OpenAI-style frequency_penalty (default: 0.3). "
                             "0 to disable; 0.5-0.7 if degeneration repeats.")
    parser.add_argument("--repeat-penalty", type=float, default=None,
                        help="llama.cpp-style repeat_penalty (e.g. 1.1-1.3). "
                             "Passed only if set.")

    args = parser.parse_args()

    profile_name = sanitize_name(args.name)
    generic_keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    if not generic_keywords:
        print("[ERROR] No generic keywords given", file=sys.stderr)
        sys.exit(1)

    anchor_keywords = []
    if args.anchor:
        anchor_keywords = [k.strip() for k in args.anchor.split(",") if k.strip()]

    generic_patterns = compile_generic_patterns(generic_keywords)
    anchor_patterns = compile_anchor_patterns(anchor_keywords) if anchor_keywords else []
    exclude_terms = []
    if args.exclude:
        exclude_terms = [k.strip() for k in args.exclude.split(",") if k.strip()]
    exclude_patterns = [
        re.compile(rf"(?<!\w){re.escape(kw)}(?!\w)", re.IGNORECASE | re.UNICODE)
        for kw in exclude_terms
    ]
    min_generic = args.min_generic if anchor_patterns else 1
    if anchor_patterns and min_generic < 1:
        min_generic = 1

    include_categories = None
    if args.include_category:
        include_categories = {c.strip() for c in args.include_category.split(",") if c.strip()}

    print(f"=== Profile Builder: {profile_name} ===")
    print(f"Generic keywords: {generic_keywords}")
    print(f"Anchor keywords : {anchor_keywords or '(none — legacy generic-only mode)'}")
    print(f"min-generic     : {min_generic}")
    print(f"Dry run: {args.dry_run} | TEMPORARY: {args.include_temporary} | "
          f"Category filter: {include_categories or 'any'} | Budget: {args.budget} chars")
    print(f"Penalties       : frequency={args.frequency_penalty} "
          f"repeat={args.repeat_penalty if args.repeat_penalty is not None else '(default)'}")
    print(f"Exclude terms   : {exclude_terms or '(none)'}")
    
    # -------- 1. Читаем память --------
    print("[1/5] Loading memory-clean.json (read-only)...")
    clean_data = load_json(CLEAN_FILE)
    if not isinstance(clean_data, list):
        print("[ERROR] memory-clean.json must be a list", file=sys.stderr)
        sys.exit(1)

    allowed_verdicts = {"KEEP", "REFINE"}
    if args.include_temporary:
        allowed_verdicts.add("TEMPORARY")

    usable = []
    refine_without_refined = 0

    for item in clean_data:
        verdict = item.get("verdict")
        if verdict not in allowed_verdicts:
            continue

        if verdict == "REFINE":
            text = item.get("refined_text") or item.get("fact")
            if not item.get("refined_text"):
                refine_without_refined += 1
        else:
            text = (item.get("fact") or item.get("text") or item.get("content"))
        if not text:
            continue

        category = item.get("category")
        if include_categories is not None and category not in include_categories:
            continue

        conf = parse_confidence(item.get("confidence"))
        if args.min_confidence > 0 and conf is not None and conf < args.min_confidence:
            continue

        usable.append({
            "id": item.get("source_index", item.get("id")),
            "text": str(text).strip(),
            "verdict": verdict,
            "confidence": conf,
            "category": category,
        })

    if refine_without_refined:
        print(f"[WARN] {refine_without_refined} REFINE facts have null refined_text.")
    print(f"      Usable facts after verdict/confidence/category filter: {len(usable)}")

    ids = [str(f["id"]) for f in usable if f["id"] is not None]
    if len(ids) != len(set(ids)):
        dup = sorted({i for i in ids if ids.count(i) > 1})[:10]
        print(f"[WARN] Duplicate source_index: {dup}...")

    # -------- 2. Anchor/generic фильтр + ранжирование --------
    print("[2/5] Matching by anchor/generic keywords and ranking...")
    passed = []
    by_anchor = 0
    by_generic_only = 0

    for f in usable:
        if exclude_patterns and any(p.search(f["text"]) for p in exclude_patterns):
            continue
        a, g = fact_hits(f, anchor_patterns, generic_patterns)
        if not fact_passes(a, g, min_generic):
            continue
        if a > 0:
            by_anchor += 1
        else:
            by_generic_only += 1
        passed.append((f, a, g))

    print(f"      Passed filter: {len(passed)} "
          f"(by anchor: {by_anchor}, generic-only: {by_generic_only})")

    if not passed:
        print("[ERROR] No facts passed keyword filter.", file=sys.stderr)
        sys.exit(3)

    scored = [(fact_score(f, a, g), f) for f, a, g in passed]
    scored.sort(key=lambda x: x[0], reverse=True)
    relevant = [f for _, f in scored[: args.max_facts]]
    print(f"      Selected (top {args.max_facts}) by score: {len(relevant)}")

    if not relevant:
        print("[ERROR] Selection empty — check --max-facts.", file=sys.stderr)
        sys.exit(3)

    # -------- 3. LLM --------
    print("[3/5] Asking LLM to build the profile...")
    facts_lines = []
    for f in relevant:
        if f["id"] is not None:
            facts_lines.append(f"[ref:{f['id']}] {f['text']}")
        else:
            facts_lines.append(f["text"])
    facts_text = "\n".join(facts_lines)

    user_prompt = (
        f"Тема профиля: {profile_name}\n"
        f"Сильные ключи (anchor): {', '.join(anchor_keywords) if anchor_keywords else '(не заданы)'}\n"
        f"Общие ключи: {', '.join(generic_keywords)}\n\n"
        f"Список фактов ({len(relevant)} штук):\n{facts_text}"
    )

    url = args.url.rstrip("/") + "/v1/chat/completions"
    payload = {
        "model": args.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": args.temperature,
        "max_tokens": args.max_tokens,
        # Та же модель, что в memory-analyzer/pruner:
        # Strata берёт reasoning_effort, llama.cpp / LM Studio игнорируют
        # (reasoning там задан на сервере при загрузке модели).
        "reasoning_effort": "none",
        "enable_thinking": False,
        "reasoning_budget_tokens": 0,
    }
    if args.frequency_penalty != 0:
        payload["frequency_penalty"] = args.frequency_penalty
    if args.repeat_penalty is not None:
        payload["repeat_penalty"] = args.repeat_penalty

    try:
        response = httpx.post(url, json=payload, timeout=args.timeout)
    except Exception as e:
        print(f"[ERROR] LLM request failed: {e}", file=sys.stderr)
        sys.exit(1)
    if response.status_code != 200:
        print(f"[ERROR] LLM HTTP {response.status_code}: {response.text[:500]}",
              file=sys.stderr)
        sys.exit(1)
    try:
        resp_json = response.json()
        choice = resp_json["choices"][0]
        msg = choice.get("message") or {}
        content = msg.get("content")
        reasoning = msg.get("reasoning_content") or msg.get("reasoning")
        finish_reason = choice.get("finish_reason")
    except (KeyError, IndexError, ValueError, AttributeError) as e:
        print(f"[ERROR] Unexpected LLM response: {e}", file=sys.stderr)
        sys.exit(1)

    if finish_reason == "length":
        print(f"[WARN] LLM hit max_tokens ({args.max_tokens}); output likely truncated.")
    elif finish_reason and finish_reason not in ("stop", "eos"):
        print(f"[WARN] Unexpected finish_reason: {finish_reason}")

    if content is None:
        if reasoning:
            print(f"[ERROR] LLM returned reasoning only ({len(reasoning)} chars); no answer text. "
                  f"finish_reason={finish_reason}.", file=sys.stderr)
            print(f"        Preview: {reasoning[:200]!r}", file=sys.stderr)
        else:
            print(f"[ERROR] LLM returned no content (finish_reason={finish_reason}).", file=sys.stderr)
        sys.exit(1)

    content = clean_markdown(content)
    if not content:
        print("[ERROR] LLM returned empty content.", file=sys.stderr)
        sys.exit(1)

    # Проверка дегенерации
    if not args.no_degeneration_check:
        is_degen, reason = detect_degeneration(content)
        if is_degen:
            print(f"[ERROR] LLM degeneration detected: {reason}", file=sys.stderr)
            print(f"        Size: {len(content)} chars; finish_reason: {finish_reason}",
                  file=sys.stderr)
            print("        Try: rerun, or --frequency-penalty 0.6, or --max-facts 150.",
                  file=sys.stderr)
            print("        Nothing was written.", file=sys.stderr)
            sys.exit(5)

    used_refs = extract_refs(content)
    known_ids = {str(f["id"]) for f in relevant if f["id"] is not None}
    unknown_refs = used_refs - known_ids

    if unknown_refs:
        print(f"[WARN] LLM referenced unknown ids: {sorted(unknown_refs)}")
        if args.strict_refs:
            print("[ERROR] --strict-refs: refusing to save.", file=sys.stderr)
            sys.exit(4)
    if not used_refs:
        print("[WARN] LLM output has no [ref:...] markers.")
    if len(content) > args.budget:
        print(f"[WARN] Size {len(content)} > budget {args.budget}.")

    # -------- 4. Отчёт --------
    print("[4/5] Report:")
    print(f"      finish_reason   : {finish_reason}")
    print(f"      facts in prompt : {len(relevant)}")
    print(f"      refs in output  : {len(used_refs)}")
    print(f"      unknown refs    : {len(unknown_refs)}")
    print(f"      size            : {len(content)} chars")

    out_path = args.out if args.out else (MEMORY_DIR / f"{profile_name}.md")
    meta_path = out_path.with_name(out_path.stem + ".meta.json")

    if args.dry_run:
        print("[5/5] DRY RUN — nothing written.")
        print("\n--- DRY RUN OUTPUT ---")
        print(content)
        print("--- END ---")
        return

    # -------- 5. Сохранение --------
    print("[5/5] Saving...")
    backup_path = save_with_backup(out_path, content, backup=not args.no_backup)

    if not args.no_meta:
        verdicts_used = {v: sum(1 for f in relevant if f["verdict"] == v)
                         for v in ("KEEP", "REFINE", "TEMPORARY")}
        meta = {
            "profile": profile_name,
            "built_at": datetime.now().isoformat(timespec="seconds"),
            "source": CLEAN_FILE.name,
            "generic_keywords": generic_keywords,
            "anchor_keywords": anchor_keywords or None,
            "min_generic": min_generic,
            "include_category": sorted(include_categories) if include_categories else None,
            "include_temporary": args.include_temporary,
            "min_confidence": args.min_confidence,
            "model": args.model,
            "llm_url": url,
            "frequency_penalty": args.frequency_penalty,
            "repeat_penalty": args.repeat_penalty,
            "finish_reason": finish_reason,
            "facts_passed_filter": len(passed),
            "matched_by_anchor": by_anchor,
            "matched_by_generic_only": by_generic_only,
            "facts_sent_to_llm": len(relevant),
            "verdicts_used": verdicts_used,
            "fact_ids_sent": sorted(str(f["id"]) for f in relevant if f["id"] is not None),
            "refs_in_output": sorted(used_refs),
            "unknown_refs": sorted(unknown_refs),
            "content_chars": len(content),
            "budget_chars": args.budget,
            "backup": str(backup_path) if backup_path else None,
        }
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                             encoding="utf-8")
        print(f"[INFO] Meta: {meta_path}")

    print(f"\n=== SUCCESS! Profile saved to: {out_path} ===")
    print(f"Size: {len(content)} characters.")


if __name__ == "__main__":
    main()