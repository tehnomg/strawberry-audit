import os
import json
import httpx
import time
from pathlib import Path

# ================= КОНФИГУРАЦИЯ =================
BASE_DIR = Path(__file__).parent.resolve()
PENDING_FILE = BASE_DIR / "memory-pending.json"
CLEAN_FILE = BASE_DIR / "memory-clean.json"

LLM_BASE_URL = os.getenv("LLM_BACKEND_URL", "http://127.0.0.1:8080").rstrip("/")
LLM_URL = f"{LLM_BASE_URL}/v1/chat/completions"
MODEL_NAME = "local-model"

# Настройки стабильности (снижены для защиты от обрыва JSON)
BATCH_SIZE = 15
SLEEP_BETWEEN_BATCHES = 5.0
MAX_RESPONSE_TOKENS = 3000

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

def normalize_text(text):
    """Простая нормализация для сравнения строк (без учета регистра и лишних пробелов)"""
    return " ".join(str(text).strip().split()).lower()

SYSTEM_PROMPT = """Ты — опытный архивариус памяти. Твоя задача — классифицировать факты о пользователе.
Ты НЕ УДАЛЯЕШЬ факты. Ты только присваиваешь каждому вердикт.

ВХОД:
Список фактов в формате JSON. Каждый факт имеет поля:
- fact: текст факта
- category: profile | preference | project | history
- confidence: high | medium

ВЫХОД:
Для КАЖДОГО факта верни объект:
- index: порядковый номер во входном списке (0-based)
- verdict: KEEP | REFINE | TEMPORARY | DISCARD | DUPLICATE
- reason: краткое обоснование (1 предложение)
- refined_text: если verdict = REFINE, переформулированный факт; иначе null
- duplicate_of: если verdict = DUPLICATE, индекс основного факта в этом же батче; иначе null

ПРАВИЛА КЛАССИФИКАЦИИ:

KEEP — устойчивый факт, имеющий долговременную ценность:
- Биографические сведения
- Устойчивые черты и предпочтения
- Долговременные проекты и цели
- Технический стек и оборудование
- Необычные увлечения и гипотезы

REFINE — полезный факт, но с плохой или неполной формулировкой.
TEMPORARY — актуально сейчас, но может устареть.
DISCARD — мусор (бытовые предметы без контекста, единичные действия).
DUPLICATE — два факта содержат ОДНУ И ТУ ЖЕ информацию.

ФОРМАТ ОТВЕТА:
Строго валидный JSON-массив. Каждый входной индекс должен присутствовать ровно один раз."""

def validate_response(proposals, batch_size):
    if not isinstance(proposals, list): return False, "Not a list"
    seen_indices = set()
    for p in proposals:
        if not isinstance(p, dict): return False, "Not a dict"
        idx = p.get("index")
        verdict = p.get("verdict")
        if idx is None or idx < 0 or idx >= batch_size: return False, f"Bad index: {idx}"
        if idx in seen_indices: return False, f"Duplicate index: {idx}"
        seen_indices.add(idx)
        if verdict not in ("KEEP", "REFINE", "TEMPORARY", "DISCARD", "DUPLICATE"): return False, f"Bad verdict: {verdict}"
    if len(seen_indices) != batch_size: return False, "Missing indices"
    return True, "OK"

# ================= ОСНОВНАЯ ЛОГИКА =================
def main():
    print("=== Strawberry Memory Pruner (v0.3 - Smart Dedup) ===")
    
    pending = load_json(PENDING_FILE, [])
    if not pending:
        print("memory-pending.json is empty. Exiting.")
        return
    
    total = len(pending)
    print(f"Loaded {total} facts from memory-pending.json")
    
    clean = load_json(CLEAN_FILE, [])
    processed_indices = {c["source_index"] for c in clean if "source_index" in c}
    print(f"Already processed: {len(processed_indices)} facts")
    
    to_process = [i for i in range(total) if i not in processed_indices]
    if not to_process:
        print("All facts already processed. Exiting.")
        return
    
    print(f"To process: {len(to_process)} facts")
    print(f"Batch size: {BATCH_SIZE}")
    
    batches = [to_process[i:i+BATCH_SIZE] for i in range(0, len(to_process), BATCH_SIZE)]
    total_batches = len(batches)
    
    try:
        for b_idx, batch_indices in enumerate(batches, 1):
            print(f"[{b_idx}/{total_batches}] Processing batch of {len(batch_indices)} facts...")
            
            # 1. ПРОВЕРКА НА ДУБЛИКАТЫ (Python-level)
            new_batch_indices = []
            for i in batch_indices:
                original = pending[i]
                norm_orig = normalize_text(original.get("fact", ""))
                
                # Ищем точный дубликат в уже обработанных clean фактах
                dup_idx = None
                for c in clean:
                    if normalize_text(c.get("fact", "")) == norm_orig:
                        dup_idx = c["source_index"]
                        break
                
                if dup_idx is not None:
                    # Если нашли - сохраняем в clean как DUPLICATE и НЕ отправляем в LLM
                    clean.append({
                        "source_index": i,
                        "fact": original.get("fact", ""),
                        "category": original.get("category", "unknown"),
                        "confidence": original.get("confidence", "medium"),
                        "verdict": "DUPLICATE",
                        "reason": f"Точный дубликат факта {dup_idx} из прошлых батчей",
                        "refined_text": None,
                        "duplicate_of": dup_idx
                    })
                    print(f"  [SKIP-DUP] {original.get('fact', '')[:50]}...")
                else:
                    new_batch_indices.append(i)
                    
            save_json(CLEAN_FILE, clean)
            
            if not new_batch_indices:
                print("  All facts in batch were duplicates. Skipping LLM.")
                continue
                
            # 2. ФОРМИРУЕМ ЗАПРОС К LLM (только для уникальных)
            batch_data = []
            for i in new_batch_indices:
                fact = pending[i]
                batch_data.append({
                    "fact": fact.get("fact", ""),
                    "category": fact.get("category", "unknown"),
                    "confidence": fact.get("confidence", "medium")
                })
            
            prompt = f"Классифицируй эти {len(batch_data)} фактов. Верни JSON-массив ровно из {len(batch_data)} элементов.\n\n{batch_data}"
            
            try:
                response = httpx.post(LLM_URL, json={
                    "model": MODEL_NAME,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.05,
                    "max_tokens": MAX_RESPONSE_TOKENS,
                    "reasoning_effort": "none",
                    "enable_thinking": False,
                    "reasoning_budget_tokens": 0
                }, timeout=120.0)
                
                if response.status_code != 200:
                    print(f"  [ERROR] LLM HTTP {response.status_code}")
                    continue
                
                result = response.json()
                choice = result["choices"][0]
                content = choice["message"].get("content", "").strip()
                
                if not content:
                    print("  [ERROR] LLM returned None/Empty.")
                    continue
                    
                # Очистка от markdown
                if content.startswith("```json"):
                    content = content[7:-3]
                elif content.startswith("```"):
                    content = content[3:-3]
                
                # Ремонт JSON
                try:
                    proposals = json.loads(content)
                except json.JSONDecodeError:
                    last_brace = content.rfind('}')
                    if last_brace != -1:
                        content = content[:last_brace + 1] + ']'
                        proposals = json.loads(content)
                    else:
                        raise ValueError("Unparseable JSON")
                
                # Валидация (проверяем, что индексы от 0 до len(new_batch_indices)-1)
                valid, msg = validate_response(proposals, len(new_batch_indices))
                if not valid:
                    print(f"  [INVALID RESPONSE] {msg}")
                    continue
                
                # Сохраняем результаты
                for p in proposals:
                    local_idx = p["index"]
                    global_idx = new_batch_indices[local_idx] # мапим на реальный индекс
                    original = pending[global_idx]
                    
                    dup_global = None
                    if p.get("duplicate_of") is not None:
                        dup_global = new_batch_indices[p["duplicate_of"]]
                    
                    clean.append({
                        "source_index": global_idx,
                        "fact": original.get("fact", ""),
                        "category": original.get("category", "unknown"),
                        "confidence": original.get("confidence", "medium"),
                        "verdict": p["verdict"],
                        "reason": p["reason"],
                        "refined_text": p.get("refined_text"),
                        "duplicate_of": dup_global
                    })
                
                counts = {}
                for p in proposals:
                    counts[p["verdict"]] = counts.get(p["verdict"], 0) + 1
                stats = ", ".join(f"{k}:{v}" for k, v in sorted(counts.items()))
                print(f"  Done. {stats}")
                
                save_json(CLEAN_FILE, clean)
                time.sleep(SLEEP_BETWEEN_BATCHES)
                
            except Exception as e:
                print(f"  [ERROR] {e}")
                continue
        
    except KeyboardInterrupt:
        print("\n\n[STOP] Interrupted by user.")
        save_json(CLEAN_FILE, clean)
        return
    
    print(f"\n=== Pruner complete. Total classified: {len(clean)} ===")

if __name__ == "__main__":
    main()