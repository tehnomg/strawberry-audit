import json
from pathlib import Path
from collections import Counter

BASE_DIR = Path(__file__).parent.resolve()
INDEX_DIR = BASE_DIR / "index"
META_FILE = BASE_DIR / "_meta.json"

def main():
    print("=== АУДИТ P2 (Карточки) ===\n")
    if not INDEX_DIR.exists():
        print("Папка index/ не найдена.")
        return

    files = list(INDEX_DIR.glob("*.json"))
    print(f"1. Всего карточек: {len(files)}")

    all_tags = []
    empty_summary = 0
    empty_cues = 0
    long_summary = 0
    len_tags_counter = Counter()
    
    # Для поиска дублей и общих тегов
    tag_to_chats = {}

    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[ERROR] Битый файл {f.name}: {e}")
            continue

        # Summary
        summary = data.get("summary", "")
        if not summary: empty_summary += 1
        elif len(summary) > 300: long_summary += 1

        # Теги
        tags = data.get("ai_tags", [])
        len_tags_counter[len(tags)] += 1
        for t in tags:
            t_lower = t.lower().strip()
            all_tags.append(t_lower)
            if t_lower not in tag_to_chats:
                tag_to_chats[t_lower] = []
            tag_to_chats[t_lower].append(data.get("title", f.name))

        # Recall Cues
        cues = data.get("recall_cues", [])
        if not cues: empty_cues += 1

    print(f"2. Карточек без summary: {empty_summary}")
    print(f"   Слишком длинных summary (>300 симв): {long_summary}")
    print(f"   Карточек без recall_cues: {empty_cues}")
    
    print(f"\n3. Распределение количества тегов на карточку:")
    for k in sorted(len_tags_counter.keys()):
        print(f"   {k} тегов: {len_tags_counter[k]} чатов")

    print(f"\n4. ТОП-20 самых частых тегов:")
    tag_counts = Counter(all_tags)
    for tag, count in tag_counts.most_common(20):
        print(f"   {tag}: {count} чатов")

    print(f"\n5. Потенциально общие/бесполезные теги (встречаются > 15 раз):")
    generic_tags = [t for t, c in tag_counts.items() if c > 15]
    print(f"   {', '.join(generic_tags)}")

    print(f"\n6. Уникальные теги (встречаются 1 раз) — {len([t for t, c in tag_counts.items() if c == 1])} шт.")

    if META_FILE.exists():
        meta = json.loads(META_FILE.read_text(encoding="utf-8"))
        print(f"\n7. Всего тегов в словаре _meta.json: {len(meta.get('tags', {}))}")
        pending = sum(1 for t, d in meta.get("tags", {}).items() if d.get("status") == "pending")
        print(f"   Из них в статусе pending: {pending}")

if __name__ == "__main__":
    main()