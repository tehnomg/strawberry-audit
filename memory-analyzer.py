import os
import json
import httpx
import time
from pathlib import Path

# ================= КОНФИГУРАЦИЯ =================
BASE_DIR = Path(__file__).parent.resolve()
CHATS_DIR = BASE_DIR / "chats"
MEMORY_FILE = BASE_DIR / "memory.md"
PENDING_FILE = BASE_DIR / "memory-pending.json"
STATE_FILE = BASE_DIR / "memory-state.json"

LLM_BASE_URL = os.getenv("LLM_BACKEND_URL", "http://127.0.0.1:8080").rstrip("/")
LLM_URL = f"{LLM_BASE_URL}/v1/chat/completions"
MODEL_NAME = "local-model"

# Настройки безопасности
MAX_PROMPT_CHARS = 6000  # Максимум символов текста для отправки
MAX_MEMORY_CHARS = 3000  # Максимум символов из памяти
MAX_RESPONSE_TOKENS = 4000 # Должно быть много, чтобы JSON не обрывался

SLEEP_BETWEEN_BATCHES = 2.0
SLEEP_BETWEEN_CHATS = 5.0

# ================= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =================
def load_json(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[WARN] Failed to load {path.name}: {e}")
            return default
    return default

def save_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)

def process_batch(messages, memory_snippet, pending_list):
    """Отправляет батч сообщений в LLM и сохраняет результаты с защитой от ошибок."""
    SYSTEM_PROMPT = """Ты — внимательный и аккуратный архивариус. Твоя задача — извлекать факты, предпочтения и контекст о пользователе из его сообщений.
    
ПРАВИЛА ИЗВЛЕЧЕНИЯ:
1. Извлекай ТОЛЬКО явные утверждения о пользователе.
2. НЕ ДОДУМЫВАЙ. Не связывай факты причинно-следственной связью, если это не сказано прямо.
3. ИГНОРИРУЙ репосты, код, цитаты.
4. Учитывай временную актуальность.
5. Отвечай ТОЛЬКО валидным JSON массивом объектов формата {"fact": "...", "category": "...", "confidence": "..."}. Без markdown, без комментариев.
6. Если нет фактов, верни [].
"""
    
    user_content = f"Текущая память:\n{memory_snippet}\n\nНовые сообщения:\n" + "\n".join(messages)
    
    try:
        response = httpx.post(LLM_URL, json={
            "model": MODEL_NAME,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content}
            ],
            "temperature": 0.1,
            "max_tokens": MAX_RESPONSE_TOKENS,
            # Отключаем размышления для всех известных бэкендов
            "reasoning_effort": "none",
            "enable_thinking": False,
            "reasoning_budget_tokens": 0
        }, timeout=180.0)
        
        if response.status_code != 200:
            print(f"  [ERROR] LLM HTTP {response.status_code}")
            return False
            
        result = response.json()
        choice = result["choices"][0]
        content = choice["message"].get("content")
        
        if content is None:
            print(f"  [ERROR] LLM returned None. finish_reason: {choice.get('finish_reason')}")
            return False
            
        content = content.strip()
        # Убираем markdown, если модель его добавила
        if content.startswith("```json"):
            content = content[7:-3]
        elif content.startswith("```"):
            content = content[3:-3]
            
        # БРОНЕБОЙНЫЙ РЕМОНТ JSON
        try:
            proposals = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"  [WARN] JSON broken ({e}). Trying to repair...")
            start_idx = content.find('[')
            if start_idx != -1:
                content = content[start_idx:]
            else:
                content = "[" + content
                
            last_brace = content.rfind('}')
            if last_brace != -1:
                content = content[:last_brace + 1] + ']'
            else:
                print("  [ERROR] No valid JSON objects found.")
                return False
                
            try:
                proposals = json.loads(content)
                print("  [FIXED] Dropped truncated tail. Saved valid facts.")
            except Exception:
                return False
                
        if isinstance(proposals, list):
            added = 0
            for p in proposals:
                if not isinstance(p, dict) or "fact" not in p:
                    continue
                if not any(existing.get("fact") == p.get("fact") for existing in pending_list):
                    pending_list.append(p)
                    added += 1
            if added > 0:
                print(f"  + Extracted {added} new facts.")
        return True
        
    except Exception as e:
        print(f"  [ERROR] LLM call failed: {e}")
        return False

# ================= ОСНОВНАЯ ЛОГИКА =================
def main():
    print("=== Strawberry Memory Analyzer (v0.5 - Smart Batching) ===")
    
    pending = load_json(PENDING_FILE, [])
    state = load_json(STATE_FILE, {})
    
    chats_to_scan = []
    for f in CHATS_DIR.glob("*.json"):
        chat_id = f.stem
        mtime = f.stat().st_mtime
        if chat_id not in state or state[chat_id] < mtime:
            chats_to_scan.append((f, chat_id, mtime))
            
    if not chats_to_scan:
        print("No new or modified chats to scan.")
        return

    total_chats = len(chats_to_scan)
    print(f"Found {total_chats} chats to process.")
    
    for idx, (f, chat_id, mtime) in enumerate(chats_to_scan, 1):
        print(f"\n[{idx}/{total_chats}] Processing: {chat_id}")
        
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            messages = data.get("messages", [])
            
            # Собираем только сообщения пользователя
            user_msgs = []
            for msg in messages:
                if msg.get("role") == "user":
                    text = msg.get("text", "").strip()
                    if text:
                        user_msgs.append(f"Пользователь: {text}")
                        
            if not user_msgs:
                print("  No user messages. Skipping.")
                state[chat_id] = mtime
                save_json(STATE_FILE, state)
                continue
                
            # Обновляем фрагмент памяти перед обработкой чата
            memory_snippet = ""
            if MEMORY_FILE.exists():
                full_mem = MEMORY_FILE.read_text(encoding="utf-8")
                memory_snippet = full_mem[-MAX_MEMORY_CHARS:] if len(full_mem) > MAX_MEMORY_CHARS else full_mem
            
            chat_processed_successfully = True
            current_batch = []
            current_batch_chars = 0
            
            for msg_text in user_msgs:
                msg_chars = len(msg_text)
                
                # Если добавление сообщения превысит лимит - отправляем батч
                if current_batch_chars + msg_chars > MAX_PROMPT_CHARS and current_batch:
                    if not process_batch(current_batch, memory_snippet, pending):
                        chat_processed_successfully = False
                        break
                    save_json(PENDING_FILE, pending)
                    
                    # --- ОБНОВЛЕНИЕ ПАМЯТИ (патч от ChatGPT) ---
                    if MEMORY_FILE.exists():
                        full_mem = MEMORY_FILE.read_text(encoding="utf-8")
                        memory_snippet = full_mem[-MAX_MEMORY_CHARS:] if len(full_mem) > MAX_MEMORY_CHARS else full_mem
                    else:
                        memory_snippet = ""
                    # -------------------------------------------
                    
                    current_batch = []
                    current_batch_chars = 0
                    time.sleep(SLEEP_BETWEEN_BATCHES)
                    
                # Если одно сообщение больше лимита - обрезаем его
                if msg_chars > MAX_PROMPT_CHARS:
                    msg_text = msg_text[:MAX_PROMPT_CHARS] + "... [обрезано]"
                    msg_chars = len(msg_text)
                    
                current_batch.append(msg_text)
                current_batch_chars += msg_chars
                
            # Обработка последнего оставшегося батча
            if current_batch and chat_processed_successfully:
                # --- ОБНОВЛЕНИЕ ПАМЯТИ ПЕРЕД ФИНАЛОМ ---
                if MEMORY_FILE.exists():
                    full_mem = MEMORY_FILE.read_text(encoding="utf-8")
                    memory_snippet = full_mem[-MAX_MEMORY_CHARS:] if len(full_mem) > MAX_MEMORY_CHARS else full_mem
                else:
                    memory_snippet = ""
                # ---------------------------------------
                
                if not process_batch(current_batch, memory_snippet, pending):
                    chat_processed_successfully = False
                save_json(PENDING_FILE, pending)
                
            # Ставим галочку только если чат прошел успешно
            if chat_processed_successfully:
                state[chat_id] = mtime
                save_json(STATE_FILE, state)
                print(f"  Done. Sleeping {SLEEP_BETWEEN_CHATS}s...")
                time.sleep(SLEEP_BETWEEN_CHATS)
            else:
                print(f"  [SKIP] Chat marked for retry next time.")
                
        except Exception as e:
            print(f"[ERROR] Failed to process {chat_id}: {e}")

    print(f"\n=== Scan complete. Total pending proposals: {len(pending)} ===")

if __name__ == "__main__":
    main()