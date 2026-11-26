import os
import json
import httpx
import time
import tempfile
from pathlib import Path
from datetime import datetime, timezone

BASE_DIR = Path(__file__).parent.resolve()
CHATS_DIR = BASE_DIR / "chats"
INDEX_DIR = BASE_DIR / "index"
META_FILE = BASE_DIR / "_meta.json"
STATE_FILE = BASE_DIR / "card-builder-state.json"

LLM_URL = f"{os.getenv('LLM_BACKEND_URL', 'http://127.0.0.1:8080')}/v1/chat/completions"
MODEL_NAME = "local-model"

INDEX_DIR.mkdir(exist_ok=True)

SYSTEM_PROMPT = """Ты — архивариус. Твоя задача — проанализировать диалог и составить его карточку для поиска.
Верни ТОЛЬКО валидный JSON без markdown:
{
  "summary": "Краткое саммари диалога в 1-2 предложениях (макс 300 символов).",
  "ai_tags": ["тема1", "тема2"],
  "projects": ["Название проекта, если обсуждался"],
  "decisions": ["Принятые решения, если были"],
  "open_questions": ["Открытые вопросы, если остались"],
  "recall_cues": ["ассоциативная фраза 1", "ассоциативная фраза 2"]
}
Правила:
- ai_tags: 3-6 штук, строго существительные в нижнем регистре (например, "python", "философия", "дизайн").
- recall_cues: 2-4 короткие фразы, по которым человек вспомнил бы этот чат (например, "спор про базы данных", "настройка FastAPI").
- Все поля обязательны. Если чего-то нет — верни пустой массив [].
"""

def load_json(path, default, strict=False):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        if strict:
            print(f"[ERROR] Corrupted JSON in {path.name}: {e}")
            raise
        return default

def save_json_atomic(path, data):
    """Атомарная запись с использованием временного файла в той же директории."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try: os.unlink(tmp)
        except: pass
        raise

def extract_chat_text(chat_data, max_chars=6000):
    """Равномерная выборка текста с защитой от гигантских сообщений."""
    messages = chat_data.get("messages", [])
    if not messages:
        return ""
    
    texts = []
    for m in messages:
        t = m.get("text") or m.get("content") or ""
        if isinstance(t, str) and t.strip():
            t = t.strip()
            # Ограничиваем каждое сообщение, чтобы один огромный ответ не съел весь контекст
            if len(t) > 800:
                t = t[:800] + "... (обрезано)"
            role = m.get("role", "user").capitalize()
            texts.append(f"{role}: {t}")
    
    if not texts:
        return ""
        
    full_text = "\n\n".join(texts)
    if len(full_text) <= max_chars:
        return full_text
        
    # Если текст все еще длинный — берем равномерно начало, середину и конец
    third = max_chars // 3
    start_part = "\n\n".join(texts[:max(1, len(texts)//3)])[:third]
    mid_idx = len(texts) // 2
    mid_part = "\n\n".join(texts[max(0, mid_idx-2):mid_idx+2])[:third]
    end_part = "\n\n".join(texts[-max(1, len(texts)//3):])[:third]
    
    return f"{start_part}\n\n... [середина пропущена] ...\n\n{mid_part}\n\n... [конец пропущен] ...\n\n{end_part}"
    
def robust_json_loads(text):
    """Пытается распарсить JSON, даже если LLM его обрезала."""
    if not text:
        return None
    t = text.strip()
    
    # 1. Убираем markdown-обертку
    if t.startswith("```json"): t = t[7:]
    elif t.startswith("```"): t = t[3:]
    if t.endswith("```"): t = t[:-3]
    t = t.strip()
    
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
        
    # 2. Вырезаем от первой { до последней }
    start = t.find("{")
    end = t.rfind("}")
    if start != -1:
        # Если закрывающей скобки нет, берем до конца
        block = t[start:end+1] if end > start else t[start:]
        
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            # 3. Пытаемся "починить" обрезанный JSON
            # Считаем незакрытые скобки
            open_braces = block.count("{") - block.count("}")
            open_brackets = block.count("[") - block.count("]")
            
            repaired = block
            # Закрываем кавычки, если их нечетное количество
            if repaired.count('"') % 2 != 0:
                repaired += '"'
                
            if open_brackets > 0:
                repaired += "]" * open_brackets
            if open_braces > 0:
                repaired += "}" * open_braces
                
            try:
                return json.loads(repaired)
            except:
                pass
                
    return None
    
def sanitize_card(card):
    """Исправляет мелкие огрехи LLM вместо того, чтобы выбрасывать всю карточку."""
    if not isinstance(card, dict):
        return None
        
    # 1. Чистим summary
    summary = str(card.get("summary", "")).strip()
    if len(summary) > 400:
        summary = summary[:397] + "..."
        
    cleaned = {"summary": summary}
    
    # 2. Чистим массивы
    list_keys = ["ai_tags", "projects", "decisions", "open_questions", "recall_cues"]
    for key in list_keys:
        arr = card.get(key, [])
        if not isinstance(arr, list):
            arr = []
            
        clean_arr = []
        for item in arr:
            # Если LLM вернула словарь (например, {"decision": "fix bug"}), склеиваем его значения
            if isinstance(item, dict):
                item = " ".join(str(v) for v in item.values())
            else:
                item = str(item)
            
            item = item.strip()
            if not item:
                continue
                
            # Обрезаем, если слишком длинно
            if len(item) > 100:
                item = item[:97] + "..."
                
            clean_arr.append(item)
            
        # Ограничиваем количество элементов
        cleaned[key] = clean_arr[:10] 
        
    return cleaned

def build_card(chat_data):
    text_to_analyze = extract_chat_text(chat_data)
    if not text_to_analyze:
        return None, "empty_chat"

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Проанализируй диалог:\n\n{text_to_analyze}"}
        ],
        "temperature": 0.1,
        "max_tokens": 1500,
        # ЖЕЛЕЗОБЕТОННЫЙ JSON-РЕЖИМ (llama.cpp и LM Studio это поддерживают)
        "response_format": {"type": "json_object"},
        "reasoning_effort": "none",
        "enable_thinking": False,
        "reasoning_budget_tokens": 0
    }

    try:
        r = httpx.post(LLM_URL, json=payload, timeout=120.0)
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}"
            
        content = r.json()["choices"][0]["message"].get("content", "").strip()
        
        # Используем надежный парсер
        card = robust_json_loads(content)
        if not card:
            return None, f"LLM parse failed: invalid JSON syntax"
            
        cleaned_card = sanitize_card(card)
        if not cleaned_card:
            return None, "Sanitize failed (not a dict)"
            
        return cleaned_card, "ok"
    except Exception as e:
        return None, f"LLM call failed: {e}"
        

def rebuild_meta_tags():
    """Пересчитывает теги по всем существующим карточкам, чтобы избежать инфляции."""
    meta = {"tags": {}}
    for idx_file in INDEX_DIR.glob("*.json"):
        try:
            card = load_json(idx_file, {})
            # Берем только AI-теги
            for tag in card.get("ai_tags", []):
                tag = str(tag).lower().strip()
                if not tag: continue
                if tag not in meta["tags"]:
                    meta["tags"][tag] = {"status": "pending", "count": 0}
                meta["tags"][tag]["count"] += 1
        except Exception:
            continue
    save_json_atomic(META_FILE, meta)
    print(f"[META] Rebuilt tags dictionary: {len(meta['tags'])} tags.")

def main():
    print("=== Card Builder (P2 Industrial) ===")
    
    # Строгая загрузка стейта, чтобы не замаскировать повреждение
    state = load_json(STATE_FILE, {}, strict=True)
    
    chats_to_process = []
    for f in CHATS_DIR.glob("*.json"):
        chat_id = f.stem
        mtime = f.stat().st_mtime
        idx_file = INDEX_DIR / f"{chat_id}.json"
        
        st = state.get(chat_id, {})
        last_mtime = st.get("mtime", 0)
        status = st.get("status", "unknown")
        
        # Логика пропуска:
        # Если чат не менялся и карточка уже есть (или статус skip) — пропускаем
        if status == "skip" and mtime == last_mtime:
            continue
        if idx_file.exists() and mtime <= last_mtime and status == "ok":
            continue
            
        chats_to_process.append((f, chat_id, mtime))

    if not chats_to_process:
        print("Все карточки актуальны.")
        rebuild_meta_tags() # Обновим статистику на всякий случай
        return

    print(f"Найдено {len(chats_to_process)} чатов для обработки.")
    
    try:
        for idx, (f, chat_id, mtime) in enumerate(chats_to_process, 1):
            print(f"[{idx}/{len(chats_to_process)}] {chat_id} ... ", end="", flush=True)
            
            try:
                chat_data = load_json(f, {})
                card, status_msg = build_card(chat_data)
                
                if card:
                    card["chat_id"] = chat_id
                    card["title"] = chat_data.get("title", "")
                    card["generated_at"] = datetime.now(timezone.utc).isoformat()
                    
                    # ВАЖНО: сохраняем AI-данные в отдельные поля (ai_tags)
                    save_json_atomic(INDEX_DIR / f"{chat_id}.json", card)
                    
                    state[chat_id] = {"mtime": mtime, "status": "ok"}
                    print("OK")
                elif status_msg == "empty_chat":
                    state[chat_id] = {"mtime": mtime, "status": "skip"}
                    print("SKIP (empty)")
                else:
                    print(f"FAIL ({status_msg})")
                    # Не сохраняем mtime при ошибке, попробуем в следующий раз
                    
            except Exception as e:
                print(f"FAIL ({e})")
                
            # Сохраняем стейт после каждого чата, чтобы прерывание не сбрасывало прогресс
            save_json_atomic(STATE_FILE, state)
            time.sleep(2.0) # Защита GPU

    except KeyboardInterrupt:
        print("\n[STOP] Прервано пользователем.")
        
    # В конце пересчитываем словарь тегов (решает проблему счётчиков)
    rebuild_meta_tags()
    print("\n=== Готово ===")

if __name__ == "__main__":
    main()