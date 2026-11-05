"""history-server.py — Strawberry History Server 19:09 25.10.2026 v.2
Раздаёт UI из web/, проксирует запросы к LLM, хранит чаты в JSON.
"""
import os
import sys
import asyncio
from pydantic import BaseModel
import json
import re  
import shutil
import tempfile
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional 
from urllib.parse import urlparse, urlencode
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

# ================= КОНФИГУРАЦИЯ =================
# ================= КОНФИГУРАЦИЯ =================
BASE_DIR = Path(__file__).parent.resolve()
WEB_DIR = BASE_DIR / "web"
CHATS_DIR = BASE_DIR / "chats"
INDEX_DIR = BASE_DIR / "index"
BACKUP_DIR = BASE_DIR / "backup"
ATTACH_DIR = BASE_DIR / "attachments"

# --- ПАМЯТЬ ---
MEMORY_DIR = BASE_DIR / "memory"
MEMORY_FILE = BASE_DIR / "memory.md" # Оставляем для совместимости
PENDING_FILE = BASE_DIR / "memory-pending.json"
STATE_FILE = BASE_DIR / "memory-state.json"
LLM_BACKEND_URL = os.getenv("LLM_BACKEND_URL", "http://127.0.0.1:8080").rstrip("/")

# Хосты, к которым разрешено проксировать /api/proxy/*. По умолчанию — только
# локальные движки. Через запятую можно добавить LAN-адреса:
#   PROXY_ALLOWED_HOSTS=localhost,127.0.0.1,::1,192.168.1.50
PROXY_ALLOWED_HOSTS = {
    h.strip().lower()
    for h in os.getenv("PROXY_ALLOWED_HOSTS", "localhost,127.0.0.1,::1").split(",")
    if h.strip()
}
SYSTEM_PROMPT_FILE = BASE_DIR / "system-prompt.md"


# Создаём папки при старте
print(f"[START] Base directory: {BASE_DIR}")
print(f"[START] Creating directories...")


try:
    CHATS_DIR.mkdir(exist_ok=True)
    print(f"[OK] chats/ directory: {CHATS_DIR}")
except Exception as e:
    print(f"[ERROR] Cannot create chats/: {e}")

try:
    BACKUP_DIR.mkdir(exist_ok=True)
    print(f"[OK] backup/ directory: {BACKUP_DIR}")
except Exception as e:
    print(f"[ERROR] Cannot create backup/: {e}")

try:
    ATTACH_DIR.mkdir(exist_ok=True)
    print(f"[OK] attachments/ directory: {ATTACH_DIR}")
except Exception as e:
    print(f"[ERROR] Cannot create attachments/: {e}")
    
try:
    MEMORY_DIR.mkdir(exist_ok=True)
    print(f"[OK] memory/ directory: {MEMORY_DIR}")
except Exception as e:
    print(f"[ERROR] Cannot create memory/: {e}")    

# --- НОВОЕ: Создаем пустой memory.md, если его нет ---
try:
    if not MEMORY_FILE.exists():
        MEMORY_FILE.write_text("# Memory Dossier\n\n- Пользователь общается на русском.\n", encoding="utf-8")
        print(f"[OK] Created default memory file: {MEMORY_FILE}")
    else:
        print(f"[OK] Memory file exists: {MEMORY_FILE}")
except Exception as e:
    print(f"[ERROR] Cannot create memory.md: {e}")
    
for _dir in (CHATS_DIR, BACKUP_DIR, MEMORY_DIR, BASE_DIR / "profiles"):
    if _dir.exists():
        for _tmp in _dir.glob("*.tmp"):
            try: _tmp.unlink()
            except Exception: pass
            
# ================= FASTAPI APP =================
app = FastAPI(title="Strawberry History Server")

# ================= SYSTEM PROMPT =================
SYSTEM_PROMPT_FILE = BASE_DIR / "system-prompt.md"

@app.get("/api/system-prompt")
async def get_system_prompt():
    if not SYSTEM_PROMPT_FILE.exists():
        SYSTEM_PROMPT_FILE.write_text("", encoding="utf-8")
    return {"content": SYSTEM_PROMPT_FILE.read_text(encoding="utf-8")}

@app.post("/api/system-prompt")
async def save_system_prompt(request: Request):
    try:
        data = await request.json()
        content = data.get("content", "")
        tmp = SYSTEM_PROMPT_FILE.with_suffix(".tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(SYSTEM_PROMPT_FILE)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# ==============================================

# ================= ПРОКСИ К LLM =================
# HOP_BY_HOP: не пробрасываем заголовки, зависящие от конкретного соединения.
# "host" в списке — важно: браузерный Host (127.0.0.1:8088) не должен
# доходить до upstream. httpx.build_request() сам подставит Host из target URL.
HOP_BY_HOP = {
    "host", "content-length", "connection", "keep-alive",
    "transfer-encoding", "upgrade", "proxy-authenticate",
    "proxy-authorization", "te", "trailers",
}


async def _do_proxy(request: Request, url: str, *, error_url: str = None,
                    short_timeout: bool = False):
    """Прозрачный прокси к LLM-бэкенду с поддержкой стриминга."""
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}
    body = await request.body()

    timeout = httpx.Timeout(5.0, connect=3.0) if short_timeout else None
    client = httpx.AsyncClient(timeout=timeout)

    try:
        upstream_req = client.build_request(request.method, url, headers=headers, content=body)
        upstream_res = await client.send(upstream_req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        # Не спамим в консоль при проверках детектора (когда сервер выключен)
        if "/api/v1/models" not in url and "/props" not in url and "/metrics" not in url:
            print(f"[PROXY ERROR] {url}: LLM backend unreachable - {e}")
        
        if error_url:
            message = f"LLM backend unreachable at {error_url}: {e}"
        else:
            message = f"LLM backend unreachable: {e}"
        return JSONResponse({"error": {"message": message}}, status_code=502)

    async def body_stream():
        try:
            async for chunk in upstream_res.aiter_raw():
                yield chunk
        finally:
            await upstream_res.aclose()
            await client.aclose()

    resp_headers = {k: v for k, v in upstream_res.headers.items() if k.lower() not in HOP_BY_HOP}
    return StreamingResponse(
        body_stream(),
        status_code=upstream_res.status_code,
        headers=resp_headers,
    )


@app.get("/health")
async def health(request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/health",
                           error_url=LLM_BACKEND_URL, short_timeout=True)


@app.api_route("/v1/{path:path}", methods=["GET", "POST"])
async def v1(path: str, request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/v1/{path}",
                           error_url=LLM_BACKEND_URL)


@app.get("/metrics")
async def metrics(request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/metrics",
                           error_url=LLM_BACKEND_URL, short_timeout=True)

@app.get("/props")
async def props(request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/props",
                           error_url=LLM_BACKEND_URL, short_timeout=True)
                           
@app.get("/mcp")
async def mcp(request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/mcp",
                           error_url=LLM_BACKEND_URL, short_timeout=True)


@app.get("/config")
async def config_get(request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/config",
                           error_url=LLM_BACKEND_URL)


@app.post("/config")
async def config_post(request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/config",
                           error_url=LLM_BACKEND_URL)


@app.get("/settings")
async def settings_get(request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/settings",
                           error_url=LLM_BACKEND_URL)


@app.post("/settings")
async def settings_post(request: Request):
    return await _do_proxy(request, f"{LLM_BACKEND_URL}/settings",
                           error_url=LLM_BACKEND_URL)


# ================= ПРОКСИ К ВНЕШНИМ OPENAI-СОВМЕСТИМЫМ БЭКЕНДАМ =================
@app.api_route("/api/proxy/{path:path}", methods=["GET", "POST"])
async def proxy_to(request: Request, path: str, base: str = ""):
    """Прокси к LM Studio / llama.cpp по явно указанному base.

    base извлекается FastAPI из query и в upstream не передаётся.
    Остальные query-параметры сохраняются.
    """
    if not base:
        raise HTTPException(status_code=400, detail="base query parameter is required")

    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="base must use http or https")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="base must include a host")
    if parsed.path not in ("", "/"):
        raise HTTPException(status_code=400, detail="base must not contain a path")
    if parsed.params or parsed.query or parsed.fragment:
        raise HTTPException(status_code=400, detail="base must not contain query or fragment")
    if parsed.username is not None or parsed.password is not None:
        raise HTTPException(status_code=400, detail="credentials are not allowed in base")

    try:
        port = parsed.port
    except ValueError:
        raise HTTPException(status_code=400, detail="base has an invalid port")
    if port is not None and not (1 <= port <= 65535):
        raise HTTPException(status_code=400, detail="base port out of range")

    host = parsed.hostname.lower()
    if host not in PROXY_ALLOWED_HOSTS:
        raise HTTPException(
            status_code=400,
            detail=f"host '{host}' is not allowed; add it to PROXY_ALLOWED_HOSTS",
        )

    forwarded = [(k, v) for k, v in request.query_params.multi_items() if k != "base"]
    query = urlencode(forwarded)

    upstream = f"{base.rstrip('/')}/{path.lstrip('/')}"
    if query:
        upstream += "?" + query

    return await _do_proxy(request, upstream)



# ================= АРХИВ ЧАТОВ =================
def _validate_id(chat_id: str):
    """Проверка ID чата (разрешаем буквы, цифры, дефисы, подчёркивания, точки)"""
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    if not all(c in allowed for c in chat_id):
        raise HTTPException(status_code=400, detail=f"Invalid chat ID: contains forbidden characters")
    if len(chat_id) == 0 or len(chat_id) > 200:
        raise HTTPException(status_code=400, detail="Invalid chat ID: wrong length")

_TITLE_MAX = 100
_CODE_PREFIX_RE = re.compile(
    r"^\s*(?:<\?php|<\?|<#|#!|\{|\]|\(|import\s+|from\s+|def\s+|class\s+|function\s+|"
    r"const\s+|let\s+|var\s+|@|//|/\*)",
    re.IGNORECASE,
)

def _atomic_write_json(path: Path, data, *, indent=2):
    """Атомарная запись JSON. tmp — в той же директории. Чистка при ошибке."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try: os.unlink(tmp)
        except FileNotFoundError: pass
        raise

def _sanitize_title(title, fallback="Untitled"):
    if not isinstance(title, str) or not title.strip():
        return fallback
    raw = title.strip()
    flat = re.sub(r"\s+", " ", raw).strip()
    if _CODE_PREFIX_RE.match(flat):
        return f"{fallback} (code)"
    if len(flat) > _TITLE_MAX:
        flat = flat[:_TITLE_MAX].rstrip() + "…"
    return flat

def _atomic_write_json(path: Path, data, *, indent=2):
    """Атомарная запись JSON. tmp — в той же директории. Чистка при ошибке."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try: os.unlink(tmp)
        except FileNotFoundError: pass
        raise

def _cleanup_backups(chat_id: str):
    """Оставляем только 3 последних бэкапа для чата. Файлы корзины (DELETED_*) не трогаем."""
    import re
    pattern = re.compile(rf"^{re.escape(chat_id)}_\d{{8}}_\d{{6}}\.json$")
    try:
        backups = sorted(
            (p for p in BACKUP_DIR.iterdir()
             if pattern.match(p.name) and not p.name.startswith("DELETED_")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for old_backup in backups[3:]:
            old_backup.unlink()
            print(f"[BACKUP] Removed old backup: {old_backup.name}")
    except Exception as e:
        print(f"[BACKUP ERROR] Cleanup failed: {e}")
        
@app.get("/api/chats")
async def list_chats(pinned_only: bool = False, page: int = 0, page_size: int = 120):
    print(f"[API] GET /api/chats pinned_only={pinned_only} page={page} page_size={page_size}")
    if page < 0: page = 0
    if page_size < 1: page_size = 120
    if page_size > 500: page_size = 500
    try:
        files = sorted(CHATS_DIR.glob("*.json"),
                       key=lambda x: x.stat().st_mtime, reverse=True)
        all_chats = []
        for f in files:
            try:
                with open(f, 'r', encoding='utf-8') as file:
                    data = json.load(file)
                is_pinned = bool(data.get("pinned", False))
                if pinned_only and not is_pinned:
                    continue
                all_chats.append({
                    "source": data.get("source"),
                    "original_id": data.get("original_id"),
                    "source_updated_at": data.get("source_updated_at"),
                    "source_message_count": data.get("source_message_count"),
                    "source_content_hash": data.get("source_content_hash"),
                    "source_content_hash_version": data.get("source_content_hash_version"),
                    "id": f.stem,
                    "number": data.get("number"),
                    "title": _sanitize_title(data.get("title") or f.stem),
                    "created_at": data.get("created_at"),
                    "updated_at": data.get("updated_at", datetime.fromtimestamp(f.stat().st_mtime).isoformat()),
                    "imported_at": data.get("imported_at"),
                    "source_created_at": data.get("source_created_at"),
                    "model": data.get("model", "unknown"),
                    "message_count": len(data.get("messages", [])),
                    "pinned": is_pinned,
                })
            except Exception as e:
                print(f"[WARNING] Cannot read {f.name}: {e}")
                continue
        all_chats.sort(key=lambda c: not c["pinned"])
        total = len(all_chats)
        start = page * page_size
        end = start + page_size
        chats = all_chats[start:end]
        has_more = end < total
        
        # Подгружаем карточки ТОЛЬКО для чатов на этой странице
        for chat in chats:
            idx_file = INDEX_DIR / f"{chat['id']}.json"
            if idx_file.exists():
                try:
                    with open(idx_file, "r", encoding="utf-8") as f_idx:
                        card = json.load(f_idx)
                        chat["summary"] = card.get("summary", "")
                        chat["ai_tags"] = card.get("ai_tags", [])
                        chat["has_card"] = True
                except Exception:
                    pass
            if "has_card" not in chat:
                chat["has_card"] = False
                chat["summary"] = ""
                chat["ai_tags"] = []

        print(f"[API] Returned {len(chats)}/{total} chats (page {page}, has_more={has_more})")
        return {
            "chats": chats, "total": total,
            "page": page, "page_size": page_size, "has_more": has_more,
        }
    except Exception as e:
        print(f"[ERROR] list_chats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ================= ПОИСК ПО ИСТОРИИ =================
# ВАЖНО: объявлен до /api/chats/{chat_id}. Иначе FastAPI
# интерпретирует "search" как chat_id.
import re as _re

def _mtime_or_zero(p):
    """st_mtime без падения, если файл исчез между glob() и stat()."""
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0

def _make_snippet(text: str, idx: int, qlen: int, ctx: int = 60) -> str:
    start = max(0, idx - ctx)
    end = min(len(text), idx + qlen + ctx)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    body = text[start:end].replace("\r", " ").replace("\n", " ")
    return f"{prefix}{body}{suffix}"

import re as _re

def _normalize_text(text: str) -> str:
    text = text.lower()
    # Оставляем только буквы, цифры и пробелы
    text = _re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.split())

def _stem(word: str) -> str:
    """Примитивный стеммер: отрезает окончания для русских/английских слов."""
    if len(word) > 5:
        return word[:-2]
    elif len(word) > 4:
        return word[:-1]
    return word


@app.get("/api/chats/search")
async def search_chats(q: str = "", tag: str = "", mode: str = "strict", pinned_only: bool = False):
    import time as _time
    t0 = _time.perf_counter()
    
    # Собираем ID закрепленных чатов
    pinned_ids = set()
    if pinned_only:
        for f in CHATS_DIR.glob("*.json"):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                if d.get("pinned"): pinned_ids.add(f.stem)
            except: pass

    MAX_RESULTS = 100
    results = []
    scanned = 0
    query = (q or "").strip()

    # === РЕЖИМ 1: УМНЫЙ ПОИСК (по карточкам) ===
    if mode == "smart" or tag:
        target_tag = _normalize_text(tag) if tag else None
        query_norm = _normalize_text(query)
        query_words = [_stem(w) for w in query_norm.split()] if not target_tag else []

        if not query_words and not target_tag:
            return {"results": [], "query": q, "took_ms": 0.0, "truncated": False, "scanned": 0, "mode": "smart"}

        if INDEX_DIR.exists():
            for f in INDEX_DIR.glob("*.json"):
                scanned += 1
                try:
                    with open(f, "r", encoding="utf-8") as file:
                        card = json.load(file)
                except Exception:
                    continue
                
                chat_id = card.get("chat_id", f.stem)
                if pinned_only and chat_id not in pinned_ids:
                    continue

                # Считаем сообщения для этого чата
                msg_count = 0
                chat_file = CHATS_DIR / f"{chat_id}.json"
                if chat_file.exists():
                    try:
                        with open(chat_file, "r", encoding="utf-8") as f_chat:
                            msg_count = len(json.load(f_chat).get("messages", []))
                    except: pass

                if target_tag:
                    card_tags = [_normalize_text(t) for t in card.get("ai_tags", [])]
                    if target_tag in card_tags or any(target_tag in ct for ct in card_tags):
                        results.append({
                            "id": chat_id, 
                            "title": card.get("title", chat_id),
                            "source": None, 
                            "updated_at": card.get("generated_at", ""),
                            "snippet": card.get("summary", "")[:200], 
                            "msg_index": -1,
                            "match_in": "tag", 
                            "score": 999, 
                            "recall_cues": card.get("recall_cues", []),
                            "message_count": msg_count
                        })
                    continue

                # Поиск по смыслу
                score = 0
                title_norm = _normalize_text(card.get("title", ""))
                summary_norm = _normalize_text(card.get("summary", ""))
                tags_norm = _normalize_text(" ".join(card.get("ai_tags", [])))
                cues_norm = _normalize_text(" ".join(card.get("recall_cues", [])))
                extra_norm = _normalize_text(" ".join(card.get("projects", []) + card.get("decisions", []) + card.get("open_questions", [])))
                
                for w in query_words:
                    if w in title_norm: score += 100
                    if w in cues_norm: score += 50
                    if w in tags_norm: score += 30
                    if w in summary_norm: score += 20
                    if w in extra_norm: score += 10
                    
                if score > 0:
                    results.append({
                        "id": chat_id, 
                        "title": card.get("title", chat_id),
                        "source": None, 
                        "updated_at": card.get("generated_at", ""),
                        "snippet": card.get("summary", ""), 
                        "msg_index": -1,
                        "match_in": "card", 
                        "score": score, 
                        "recall_cues": card.get("recall_cues", []),
                        "message_count": msg_count
                    })

        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:MAX_RESULTS]
        took = (_time.perf_counter() - t0) * 1000
        return {"results": results, "query": q, "took_ms": round(took, 1), "truncated": len(results) == MAX_RESULTS, "scanned": scanned, "mode": "smart"}

    # === РЕЖИМ 2: СТРОГИЙ ПОИСК (по исходным сообщениям) ===
    if not query:
        return {"results": [], "query": "", "took_ms": 0.0, "truncated": False, "scanned": 0, "mode": "strict"}
    
    try:
        pattern = _re.compile(_re.escape(query), _re.IGNORECASE)
    except _re.error:
        return {"results": [], "query": query, "took_ms": 0.0, "truncated": False, "scanned": 0, "mode": "strict"}
        
    files = sorted(CHATS_DIR.glob("*.json"), key=_mtime_or_zero, reverse=True)
    
    for f in files:
        scanned += 1
        if pinned_only and f.stem not in pinned_ids:
            continue

        try:
            with open(f, "r", encoding="utf-8") as file:
                data = json.load(file)
        except Exception:
            continue
            
        title = data.get("title") or f.stem
        matched_title = bool(pattern.search(title))
        best_snippet = None
        msg_index = -1
        
        for i, msg in enumerate(data.get("messages") or []):
            if not isinstance(msg, dict): continue
            texts = []
            t = msg.get("text")
            if isinstance(t, str): texts.append(t)
            for att in (msg.get("files") or []):
                if isinstance(att, dict) and isinstance(att.get("text"), str):
                    texts.append(att["text"])
                    
            for text in texts:
                m = pattern.search(text)
                if m:
                    best_snippet = _make_snippet(text, m.start(), m.end() - m.start())
                    msg_index = i
                    break
            if best_snippet is not None:
                break
                
        if matched_title or best_snippet is not None:
            results.append({
                "id": f.stem,
                "title": title,
                "source": data.get("source"),
                "updated_at": data.get("updated_at", ""),
                "snippet": best_snippet or "",
                "msg_index": msg_index,
                "match_in": "messages" if best_snippet is not None else "title",
                "message_count": len(data.get("messages") or [])
            })
            if len(results) >= MAX_RESULTS:
                break
                
    took = (_time.perf_counter() - t0) * 1000
    return {"results": results, "query": query, "took_ms": round(took, 1), "truncated": len(results) >= MAX_RESULTS and scanned < len(files), "scanned": scanned, "mode": "strict"}
    

FILTERS_FILE = BASE_DIR / "saved_filters.json"

# 1. Сначала объявляем класс (Pydantic BaseModel)
class SaveFilterReq(BaseModel):
    name: str
    query: str
    tags: list[str] = []

# 2. И только потом используем его в эндпоинтах
@app.get("/api/filters")
async def get_filters():
    if not FILTERS_FILE.exists():
        return {"filters": []}
    try:
        return {"filters": json.loads(FILTERS_FILE.read_text(encoding="utf-8"))}
    except Exception:
        return {"filters": []}

@app.post("/api/filters")
async def save_filter(req: SaveFilterReq):
    filters = await get_filters()
    f_list = filters["filters"]
    
    new_filter = {
        "id": str(int(time.time() * 1000)),
        "name": req.name,
        "query": req.query,
        "tags": req.tags
    }
    f_list.append(new_filter)
    _atomic_write_json(FILTERS_FILE, f_list)
    return {"status": "ok", "filter": new_filter}

@app.delete("/api/filters/{filter_id}")
async def delete_filter(filter_id: str):
    filters = await get_filters()
    f_list = [f for f in filters["filters"] if f["id"] != filter_id]
    _atomic_write_json(FILTERS_FILE, f_list)
    return {"status": "ok"}

@app.get("/api/chats/{chat_id}")
async def get_chat(chat_id: str):
    """Возвращает полный JSON чата"""
    print(f"[API] GET /api/chats/{chat_id}")
    _validate_id(chat_id)
    file_path = CHATS_DIR / f"{chat_id}.json"
    
    if not file_path.exists():
        print(f"[API] Chat not found: {chat_id}")
        raise HTTPException(status_code=404, detail="Chat not found")
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            print(f"[API] Loaded chat: {chat_id}")
            return JSONResponse(content=data)
    except Exception as e:
        print(f"[ERROR] get_chat failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chats/{chat_id}")
async def save_chat(chat_id: str, request: Request):
    """Сохраняет чат (атомарная запись + бэкап)"""
    print(f"[API] POST /api/chats/{chat_id}")
    _validate_id(chat_id)
    
    try:
        data = await request.json()
    except Exception as e:
        print(f"[ERROR] Invalid JSON: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid chat: not an object")
    if "messages" in data and not isinstance(data["messages"], list):
        raise HTTPException(status_code=400, detail="Invalid chat: messages must be an array")

    # Имя файла — источник истины для id
    data["id"] = chat_id
    file_path = CHATS_DIR / f"{chat_id}.json"
    # Не терять pinned, если клиент его не прислал (старый клиент / curl)
    if file_path.exists() and "pinned" not in data:
        try:
            old = json.loads(file_path.read_text(encoding="utf-8"))
            if old.get("pinned"):
                data["pinned"] = True
        except Exception:
            pass
    # Автоматически вытаскиваем base64-картинки из нативных чатов в attachments/
    if "messages" in data and isinstance(data["messages"], list):
        try:
            _extract_images_from_messages(data["messages"], chat_id, ATTACH_DIR)
        except Exception as e:
            print(f"[SAVE CHAT IMG ERROR] {e}")
    # 1. Бэкап существующего файла
    if file_path.exists():
        try:
            backup_name = f"{chat_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            backup_path = BACKUP_DIR / backup_name
            shutil.copy2(file_path, backup_path)
            print(f"[BACKUP] Created: {backup_name}")
            _cleanup_backups(chat_id)
        except Exception as e:
            print(f"[WARNING] Backup failed: {e}")
            # Продолжаем, даже если бэкап не удался
        # --- ВЫТАСКИВАЕМ КАРТИНКИ ИЗ BASE64 ПЕРЕД СОХРАНЕНИЕМ ---
        if "messages" in data and isinstance(data["messages"], list):
            try:
                extracted = _extract_images_from_messages(data["messages"], chat_id, ATTACH_DIR)
                if extracted > 0:
                    print(f"[SAVE IMG] Extracted {extracted} images for {chat_id}")
            except Exception as e:
                print(f"[SAVE CHAT IMG ERROR] {e}")
        # ---------------------------------------------------------
    # 2. Атомарная запись
    try:
        fd, tmp_path = tempfile.mkstemp(dir=str(CHATS_DIR), suffix=".tmp")
        print(f"[SAVE] Writing to temp file: {tmp_path}")
        
        with os.fdopen(fd, 'w', encoding='utf-8') as tmp_file:
            json.dump(data, tmp_file, ensure_ascii=False, indent=2)
        
        os.replace(tmp_path, file_path)
        print(f"[SAVE] Success: {chat_id}.json")
        
        return {"status": "ok", "id": chat_id}
    except Exception as e:
        print(f"[ERROR] save_chat failed: {e}")
        # Удаляем временный файл, если он есть
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to save: {str(e)}")

@app.post("/api/chats/{chat_id}/pin")
async def pin_chat(chat_id: str, request: Request):
    """Устанавливает pinned. Не трогает messages, не делает бэкап."""
    print(f"[API] POST /api/chats/{chat_id}/pin")
    _validate_id(chat_id)
    file_path = CHATS_DIR / f"{chat_id}.json"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Chat not found")

    try:
        body = await request.json()
    except Exception:
        body = {}

    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cannot read chat: {e}")

    if "pinned" in body:
        data["pinned"] = bool(body["pinned"])
    else:
        data["pinned"] = not data.get("pinned", False)

    _atomic_write_json(file_path, data)
    print(f"[PIN] {chat_id} pinned={data['pinned']}")
    return {"status": "ok", "pinned": data["pinned"]}

@app.delete("/api/chats/{chat_id}")
async def delete_chat(chat_id: str):
    """Удаляет чат (перемещает в backup)"""
    print(f"[API] DELETE /api/chats/{chat_id}")
    _validate_id(chat_id)
    file_path = CHATS_DIR / f"{chat_id}.json"
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Chat not found")
    
    try:
        backup_name = f"DELETED_{chat_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        shutil.move(file_path, BACKUP_DIR / backup_name)
        print(f"[DELETE] Moved to backup: {backup_name}")
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] delete_chat failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
# ================= КОРЗИНА =================
# Удалённые чаты лежат в backup/ как DELETED_<chat_id>_<YYYYMMDD_HHMMSS>.json.
# Это уже фактически корзина, просто без API. Добавляем:
#   GET    /api/trash              — список
#   POST   /api/trash/{tid}/restore — восстановить в chats/
#   DELETE /api/trash/{tid}         — удалить навсегда
#   DELETE /api/trash               — очистить всё

TRASH_PREFIX = "DELETED_"
_TRASH_RE = re.compile(r"^DELETED_(?P<chat_id>.+)_(?P<ts>\d{8}_\d{6})\.json$")


def _parse_trash_name(name: str) -> Optional[dict]:
    m = _TRASH_RE.match(name)
    if not m:
        return None
    try:
        deleted_at = datetime.strptime(m.group("ts"), "%Y%m%d_%H%M%S").replace(
            tzinfo=timezone.utc
        ).isoformat()
    except ValueError:
        deleted_at = None
    return {
        "trash_id": name[:-len(".json")],
        "chat_id": m.group("chat_id"),
        "deleted_at": deleted_at,
    }


def _find_trash_file(trash_id: str) -> Path:
    if not trash_id or any(c in trash_id for c in ("/", "\\", "..")):
        raise HTTPException(status_code=400, detail="Invalid trash id")
    p = BACKUP_DIR / f"{trash_id}.json"
    if not p.exists() or not _parse_trash_name(p.name):
        raise HTTPException(status_code=404, detail="Trash item not found")
    return p


@app.get("/api/trash")
async def list_trash():
    """Список удалённых чатов. Только чтение."""
    print("[API] GET /api/trash")
    items = []
    try:
        files = sorted(
            BACKUP_DIR.glob(f"{TRASH_PREFIX}*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for f in files:
            info = _parse_trash_name(f.name)
            if not info:
                continue
            title, msg_count, source = info["chat_id"], None, None
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                title = data.get("title") or title
                source = data.get("source")
                msgs = data.get("messages")
                if isinstance(msgs, list):
                    msg_count = len(msgs)
            except Exception:
                pass
            info.update({
                "title": title,
                "source": source,
                "message_count": msg_count,
                "size": f.stat().st_size,
            })
            items.append(info)
        print(f"[API] Trash: {len(items)} items")
        return {"items": items}
    except Exception as e:
        print(f"[ERROR] list_trash failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/trash/{trash_id}/restore")
async def restore_from_trash(trash_id: str):
    """Восстановить чат из корзины в chats/<chat_id>.json."""
    print(f"[API] POST /api/trash/{trash_id}/restore")
    p = _find_trash_file(trash_id)
    info = _parse_trash_name(p.name)
    target = CHATS_DIR / f"{info['chat_id']}.json"
    if target.exists():
        raise HTTPException(
            status_code=409,
            detail=f"Chat '{info['chat_id']}' already exists; rename or delete it first",
        )
    try:
        shutil.move(p, target)
        print(f"[TRASH] Restored: {p.name} -> {target.name}")
        return {"status": "ok", "chat_id": info["chat_id"]}
    except Exception as e:
        print(f"[ERROR] restore failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/trash/{trash_id}")
async def purge_trash_item(trash_id: str):
    """Удалить из корзины навсегда."""
    print(f"[API] DELETE /api/trash/{trash_id}")
    p = _find_trash_file(trash_id)
    try:
        p.unlink()
        print(f"[TRASH] Purged: {p.name}")
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/trash")
async def purge_all_trash():
    """Очистить корзину полностью."""
    print("[API] DELETE /api/trash")
    count = 0
    try:
        for f in BACKUP_DIR.glob(f"{TRASH_PREFIX}*.json"):
            try:
                f.unlink()
                count += 1
            except Exception as e:
                print(f"[TRASH] Failed to purge {f.name}: {e}")
        print(f"[TRASH] Purged all: {count} items")
        return {"status": "ok", "purged": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# ================= ВЛОЖЕНИЯ =================
# Безопасная раздача уже сохранённых вложений. Ничего не пишет и не удаляет.
# Дисковая схема (заполнится на этапах B/D):
#     attachments/<chat_id>/<sha256>.<ext>
#
# MIME определяется по расширению:
#   - изображения из SAFE_INLINE_IMAGE_MIMES → Content-Disposition: inline
#   - известные типы из KNOWN_DOWNLOAD_MIMES → точный Content-Type, но attachment
#   - всё остальное (включая .svg, .html-в-неизвестном-контексте, .bin, .jinja)
#     → application/octet-stream + attachment (файл скачивается, не исполняется)
#
# Defense-in-depth для путей (5 независимых проверок):
#   1) charset/length для chat_id и filename (см. _validate_attachment_segment);
#   2) chat_dir = (ATTACH_DIR/chat_id).resolve() должен быть внутри ATTACH_DIR
#      (регистронезависимо на Windows, см. _is_within);
#   3) chat_dir должен существовать и быть каталогом;
#   4) raw_path не должен быть симлинком, а target = raw_path.resolve() должен
#      быть внутри chat_dir (вторая независимая проверка на случай разделителей);
#   5) target.is_file() — отсекает FIFO, сокеты, устройства.
#
# chat_id в URL вложений валидируется строже, чем в /api/chats: запрещены
# ведущая точка, `..`, подстрока `..` и любые символы вне [A-Za-z0-9._-].

SAFE_INLINE_IMAGE_MIMES = {
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".webp": "image/webp",
}

KNOWN_DOWNLOAD_MIMES = {
    ".pdf":      "application/pdf",
    ".txt":      "text/plain; charset=utf-8",
    ".md":       "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".json":     "application/json",
    ".jsonl":    "application/x-ndjson",
    ".csv":      "text/csv; charset=utf-8",
    ".tsv":      "text/tab-separated-values; charset=utf-8",
    ".log":      "text/plain; charset=utf-8",
    ".yaml":     "application/yaml",
    ".yml":      "application/yaml",
    ".toml":     "application/toml",
    ".xml":      "application/xml",
    ".html":     "text/html; charset=utf-8",
    ".htm":      "text/html; charset=utf-8",
    ".css":      "text/css; charset=utf-8",
    ".js":       "text/javascript; charset=utf-8",
    ".py":       "text/x-python; charset=utf-8",
    ".zip":      "application/zip",
    ".gz":       "application/gzip",
    ".tar":      "application/x-tar",
    ".7z":       "application/x-7z-compressed",
    ".mp3":      "audio/mpeg",
    ".wav":      "audio/wav",
    ".ogg":      "audio/ogg",
    ".mp4":      "video/mp4",
    ".webm":     "video/webm",
    ".mov":      "video/quicktime",
}


def _is_within(p: Path, base: Path) -> bool:
    """True, если p — потомок base (или равен ему). Регистронезависимо на Windows."""
    try:
        p_s = os.path.normcase(str(p))
        b_s = os.path.normcase(str(base))
    except Exception:
        return False
    if p_s == b_s:
        return True
    sep = os.sep
    return p_s.startswith(b_s + sep)


def _validate_attachment_segment(value: str, field: str):
    """Строгая валидация одного сегмента пути в URL вложений."""
    if not isinstance(value, str) or not value:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: empty")
    if len(value) > 200:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: too long")
    if value in (".", ".."):
        raise HTTPException(status_code=400, detail=f"Invalid {field}: reserved name")
    if value.startswith("."):
        raise HTTPException(status_code=400, detail=f"Invalid {field}: hidden name")
    if ".." in value:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: contains '..'")
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    if not all(c in allowed for c in value):
        raise HTTPException(status_code=400, detail=f"Invalid {field}: forbidden characters")


@app.get("/api/attachments/{chat_id}/{filename}")
async def get_attachment(chat_id: str, filename: str):
    """Отдаёт сохранённое вложение. Только чтение."""
    print(f"[API] GET /api/attachments/{chat_id}/{filename}")
    _validate_attachment_segment(chat_id, "chat_id")
    _validate_attachment_segment(filename, "filename")

    base = ATTACH_DIR.resolve()
    chat_dir = (ATTACH_DIR / chat_id).resolve()
    if not _is_within(chat_dir, base):
        raise HTTPException(status_code=400, detail="Invalid chat_id: escapes attachments/")
    if not chat_dir.exists() or not chat_dir.is_dir():
        raise HTTPException(status_code=404, detail="Attachment not found")

    raw_path = chat_dir / filename
    if raw_path.is_symlink():
        raise HTTPException(status_code=400, detail="Invalid filename: symlink")
    target = raw_path.resolve()
    if not _is_within(target, chat_dir):
        raise HTTPException(status_code=400, detail="Invalid filename: escapes chat dir")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Attachment not found")

    ext = target.suffix.lower()
    if ext in SAFE_INLINE_IMAGE_MIMES:
        media_type = SAFE_INLINE_IMAGE_MIMES[ext]
        disposition = "inline"
    elif ext in KNOWN_DOWNLOAD_MIMES:
        media_type = KNOWN_DOWNLOAD_MIMES[ext]
        disposition = "attachment"
    else:
        media_type = "application/octet-stream"
        disposition = "attachment"

    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'{disposition}; filename="{filename}"',
        "Content-Security-Policy": "default-src 'none'; sandbox",
    }
    print(f"[API] Attachment served: {media_type} ({disposition})")
    return FileResponse(target, media_type=media_type, headers=headers)

# ================= ПАМЯТЬ (PROFILES & PENDING) =================
@app.get("/api/memory/profiles")
async def get_memory_profiles():
    print("[MEMORY] GET profiles")
    files = [f.stem for f in MEMORY_DIR.glob("*.md")]
    if "core" not in files:
        files.append("core")
    return {"profiles": sorted(files)}

@app.get("/api/memory")
async def get_memory(profile: str = "core"):
    print(f"[MEMORY] GET /api/memory?profile={profile}")
    file_path = MEMORY_DIR / f"{profile}.md"
    
    if not file_path.exists():
        # Если файла нет, создаем пустой
        try:
            file_path.write_text(f"# Memory: {profile.title()}\n\n", encoding="utf-8")
            print(f"[MEMORY] Created new file: {file_path}")
        except Exception as e:
            print(f"[MEMORY ERROR] Cannot create {file_path}: {e}")
            raise HTTPException(status_code=500, detail="Cannot create profile file")
            
    return {"content": file_path.read_text(encoding="utf-8")}

@app.post("/api/memory")
async def save_memory(request: Request, profile: str = "core"):
    print(f"[MEMORY] POST /api/memory?profile={profile}")
    try:
        data = await request.json()
        content = data.get("content", "")
        file_path = MEMORY_DIR / f"{profile}.md"
        
        fd, tmp_path = tempfile.mkstemp(dir=str(MEMORY_DIR), suffix=".tmp")
        with os.fdopen(fd, 'w', encoding='utf-8') as tmp_file:
            tmp_file.write(content)
        os.replace(tmp_path, file_path)
        
        print(f"[MEMORY] Saved {len(content)} chars to {file_path}")
        return {"status": "ok"}
    except Exception as e:
        print(f"[MEMORY ERROR] Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/memory/pending")
async def get_memory_pending():
    if not PENDING_FILE.exists():
        return {"items": []}
    try:
        return {"items": json.loads(PENDING_FILE.read_text(encoding="utf-8"))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/memory/approve")
async def approve_memory(request: Request, profile: str = "core"):
    print(f"[MEMORY] POST /api/memory/approve?profile={profile}")
    try:
        data = await request.json()
        approved_facts = data.get("facts", [])
        print(f"[MEMORY] Approving {len(approved_facts)} facts...")
        
        if not approved_facts:
            return {"status": "ok", "message": "No facts"}
            
        file_path = MEMORY_DIR / f"{profile}.md"
        current_memory = file_path.read_text(encoding="utf-8") if file_path.exists() else f"# Memory: {profile.title()}\n\n"
        
        new_lines = []
        for fact in approved_facts:
            if fact not in current_memory:
                new_lines.append(f"- {fact}")
                
        if new_lines:
            with open(file_path, "a", encoding="utf-8") as f:
                f.write("\n" + "\n".join(new_lines) + "\n")
            print(f"[MEMORY] Appended {len(new_lines)} lines to {file_path}")
        else:
            print("[MEMORY] No new lines (duplicates)")
                
        pending = json.loads(PENDING_FILE.read_text(encoding="utf-8")) if PENDING_FILE.exists() else []
        remaining = [p for p in pending if p.get("fact") not in approved_facts]
        PENDING_FILE.write_text(json.dumps(remaining, ensure_ascii=False, indent=2), encoding="utf-8")
        
        return {"status": "ok", "added": len(new_lines)}
    except Exception as e:
        print(f"[MEMORY ERROR] Approve failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/memory/reject")
async def reject_memory(request: Request):
    print("[MEMORY] POST /api/memory/reject")
    try:
        data = await request.json()
        rejected_facts = data.get("facts", [])
        
        pending = json.loads(PENDING_FILE.read_text(encoding="utf-8")) if PENDING_FILE.exists() else []
        remaining = [p for p in pending if p.get("fact") not in rejected_facts]
        PENDING_FILE.write_text(json.dumps(remaining, ensure_ascii=False, indent=2), encoding="utf-8")
        
        print(f"[MEMORY] Rejected {len(rejected_facts)} facts.")
        return {"status": "ok"}
    except Exception as e:
        print(f"[MEMORY ERROR] Reject failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
# ================= ГЕНЕРАТОР ПРОФИЛЕЙ =================
PROFILES_DIR = BASE_DIR / "profiles"
PROFILES_DIR.mkdir(exist_ok=True)

def _safe_json_parse(text: str):
    if not text: return None
    t = text.strip()
    for fence in ("```json", "```"):
        if t.startswith(fence):
            t = t[len(fence):]
            if t.rstrip().endswith("```"):
                t = t.rstrip()[:-3]
            break
    t = t.strip()
    try: return json.loads(t)
    except json.JSONDecodeError:
        i, j = t.find("{"), t.rfind("}")
        if i != -1 and j > i:
            try: return json.loads(t[i:j+1])
            except json.JSONDecodeError: pass
    return None

def _clean_str_list(v):
    if not isinstance(v, list): return []
    return [str(x).strip() for x in v if isinstance(x, (str, int, float)) and str(x).strip()]

def _reasoning_payload() -> dict:
    """Как в memory-analyzer/pruner: Strata берёт reasoning_effort,
    llama.cpp и LM Studio игнорируют (свой reasoning задан при загрузке модели)."""
    return {
        "reasoning_effort": "none",
        "enable_thinking": False,
        "reasoning_budget_tokens": 0,
    }

class RouteProfileRequest(BaseModel):
    text: str
    model: str | None = None
    max_tokens: int = 800

ROUTER_SYSTEM_PROMPT = """Ты — маршрутизатор тем для локального чат-профиля.
Пользователь описал, о чём хочет говорить и чего избежать.
Верни ТОЛЬКО JSON без markdown:
{
  "anchors":  [3-6 коротких поисковых токенов],
  "generic":  [2-4 широких категорийных слова],
  "exclude":  [0-5 запрещённых тем],
  "note":     "одно короткое предложение — суть запроса"
}

КРИТИЧЕСКИ ВАЖНО — это поисковые ключи, а НЕ описание темы:

anchors: каждое — ОДНО слово (без пробелов) или дефисное слово.
  ✅ ХОРОШО: "промпт-инжиниринг", "отладка", "рефакторинг", "API", "нейросети"
  ❌ ПЛОХО:  "промпт-инжиниринг для кода", "отладка с помощью LLM" — это фразы

generic: отдельные слова, широкие категории, вероятные в тексте фактов.
  ✅ ХОРОШО: "код", "модель", "проект", "инструмент"
  ❌ ПЛОХО:  "искусственный интеллект" (это фраза), "программирование" (слишком абстрактно)

exclude: отдельные слова или короткие фразы (1-2 слова).
  ✅ ХОРОШО: "психоанализ", "терапия", "эзотерика"
  ❌ ПЛОХО:  "психоанализ и психология личности"

Никакого текста вне JSON."""

@app.post("/api/profile/route")
async def profile_route(req: RouteProfileRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 2000:
        text = text[:2000]

    payload = {
        "model": req.model or "local-model",
        "messages": [
            {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "temperature": 0.2,
        "max_tokens": req.max_tokens,
        "response_format": {"type": "json_object"},
        **_reasoning_payload(),
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            r = await client.post(f"{LLM_BACKEND_URL}/v1/chat/completions", json=payload)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"LLM unreachable: {e}")

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"LLM HTTP {r.status_code}: {r.text[:300]}")

    try:
        content = r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"Bad LLM response: {e}")

    parsed = _safe_json_parse(content)
    if parsed is None:
        raise HTTPException(status_code=502, detail="Router returned unparseable JSON")
    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=502,
            detail=f"Router returned {type(parsed).__name__}, expected JSON object",
        )

    profile = {
        "source_prompt": text,
        "anchors": _clean_str_list(parsed.get("anchors", [])),
        "generic": _clean_str_list(parsed.get("generic", [])),
        "exclude": _clean_str_list(parsed.get("exclude", [])),
        "note": str(parsed.get("note", "")).strip(),
        "routed_at": datetime.now(timezone.utc).isoformat(),
    }
    if not profile["anchors"] and not profile["generic"]:
        raise HTTPException(status_code=502, detail="Router returned empty anchors/generic")

    path = PROFILES_DIR / "current.json"
    _atomic_write_json(path, profile)
    print(f"[ROUTER] Profile → {path} (anchors={len(profile['anchors'])}, exclude={len(profile['exclude'])})")
    return {"ok": True, "profile": profile, "path": str(path)}


@app.post("/api/profile/build-from-current")
async def build_from_current_profile(name: str | None = None, budget: int = 4000, min_generic: int = 1):
    path = PROFILES_DIR / "current.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No routed profile. Call /api/profile/route first.")
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cannot read profile: {e}")

    anchors = profile.get("anchors") or []
    generics = profile.get("generic") or []
    excludes = profile.get("exclude") or []
    if not anchors and not generics:
        raise HTTPException(status_code=400, detail="Routed profile has no anchors or generic keywords")

    script_path = BASE_DIR / "profile-builder1.4.py"
    if not script_path.exists():
        raise HTTPException(status_code=500, detail="profile-builder1.4.py not found")

    if name and re.match(r"^[a-z0-9_-]+$", name):
        safe_name = name
    else:
        safe_name = "lamp_" + datetime.now().strftime("%Y%m%d_%H%M%S")

    keywords = ",".join(generics) if generics else ",".join(anchors[:3])
    cmd = [sys.executable, str(script_path), safe_name, keywords]
    if anchors:
        cmd += ["--anchor", ",".join(anchors)]
    if excludes:
        cmd += ["--exclude", ",".join(excludes)]
    # ВСЕГДА, независимо от наличия exclude:
    cmd += ["--dry-run", "--budget", str(budget), "--min-generic", str(min_generic)]

    print(f"[PROFILE] build-from-current: {' '.join(cmd)}")
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd, cwd=str(BASE_DIR),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Subprocess failed: {e}")

    out = stdout.decode("utf-8", errors="ignore")
    err = stderr.decode("utf-8", errors="ignore")
    if process.returncode != 0:
        short = (err or out).strip().split("\n")[-1][:400] or "Unknown error"
        raise HTTPException(status_code=500, detail=f"Builder failed: {short}")

    m = re.search(r"--- DRY RUN OUTPUT ---(.*?)--- END ---", out, re.DOTALL)
    if not m:
        print(f"[PROFILE] Unrecognized output:\n{out[:1000]}")
        raise HTTPException(status_code=500, detail="Could not parse builder output")
    return {"ok": True, "name": safe_name, "markdown": m.group(1).strip()}
    
class BuildProfileRequest(BaseModel):
    name: str
    keywords: str
    anchor: str
    min_generic: int = 2
    budget: int = 4000

@app.post("/api/memory/build-profile")
async def build_profile(req: BuildProfileRequest):
    # Защита от path traversal
    if not re.match(r"^[a-z0-9_-]+$", req.name):
        raise HTTPException(status_code=400, detail="Invalid profile name format")
        
    script_path = BASE_DIR / "profile-builder1.4.py"
    if not script_path.exists():
        raise HTTPException(status_code=500, detail="profile-builder1.4.py not found in BASE_DIR")

    # Собираем команду (всегда dry-run для предпросмотра)
    cmd = [
        sys.executable, str(script_path), 
        req.name, req.keywords,
        "--anchor", req.anchor,
        "--min-generic", str(req.min_generic),
        "--budget", str(req.budget),
        "--dry-run"
    ]

    print(f"[BUILD] Starting: {' '.join(cmd)}")
    
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(BASE_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        out = stdout.decode('utf-8', errors='ignore')
        err = stderr.decode('utf-8', errors='ignore')
        
            
        # Вытаскиваем Markdown между маркерами (учитываем любые переносы строк)
        match = re.search(r"--- DRY RUN OUTPUT ---(.*?)--- END ---", out, re.DOTALL)
        if match:
            markdown = match.group(1).strip()
            return {"status": "ok", "markdown": markdown}
        else:
            # Если маркеров нет - это баг парсинга или странное поведение. 
            # НИКАКИХ фоллбэков на старые файлы!
            print(f"[BUILD] Unrecognized output:\n{out}")
            raise HTTPException(status_code=500, detail="Could not parse builder output. Check server logs.")
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"[BUILD] Exception: {e}")
        raise HTTPException(status_code=500, detail=str(e))
# =======================================================
# ================= ИМПОРТ ЧАТОВ =================
from fastapi import UploadFile, File
from typing import List
import importlib.util
import tempfile
import traceback

def _load_import_module():
    """Загружает import.py как модуль (не запускает CLI)."""
    here = Path(__file__).resolve().parent
    import_path = here / "import.py"
    if not import_path.exists():
        return None
    try:
        spec = importlib.util.spec_from_file_location("strawberry_import", import_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception as e:
        print(f"[IMPORT MODULE ERROR] {e}")
        traceback.print_exc()
        return None

IMPORT_MOD = _load_import_module()

import re
import base64
import hashlib

IMAGE_B64_RE = re.compile(
    r'!\[([^\]]*)\]\(data:image/([a-zA-Z0-9.+\-]+);base64,([A-Za-z0-9+/=\s]+)\)'
)

_MIME_EXT_MAP = {
    "jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif",
    "webp": "webp", "svg+xml": "svg", "bmp": "bmp",
}

def _extract_images_from_messages(messages, chat_id, attach_dir):
    """Извлекает base64-картинки из массива images или из текста сообщений."""
    extracted = 0
    chat_attach_dir = attach_dir / chat_id
    
    for msg in messages:
        # --- ЧАСТЬ 1: Нативные картинки из массива images ---
        images = msg.get("images", [])
        for img in images:
            url = img.get("url", "")
            if isinstance(url, str) and url.startswith("data:image/"):
                try:
                    # Парсим data:image/jpeg;base64,...
                    header, b64 = url.split(",", 1)
                    mime_sub = header.split(";")[0].split("/")[1].lower()
                    ext = _MIME_EXT_MAP.get(mime_sub, "png")
                    
                    data = base64.b64decode(re.sub(r'\s+', '', b64), validate=False)
                    h = hashlib.sha256(data).hexdigest()[:16]
                    filename = f"{h}.{ext}"
                    filepath = chat_attach_dir / filename
                    
                    chat_attach_dir.mkdir(parents=True, exist_ok=True)
                    if not filepath.exists():
                        filepath.write_bytes(data)
                        print(f"[SAVE IMG] Saved {chat_id}/{filename} ({len(data)} bytes)")
                    
                    # Подменяем url на ссылку
                    img["url"] = f"/api/attachments/{chat_id}/{filename}"
                    if "status" in img:
                        del img["status"]  # Убираем "missing"
                    extracted += 1
                except Exception as e:
                    print(f"[SAVE IMG ERROR] {chat_id}: {e}")

        # --- ЧАСТЬ 2: Картинки внутри текста (как в импортах) ---
        text = msg.get("text", "")
        if text and "data:image/" in text:
            def replacer(m):
                nonlocal extracted
                alt = m.group(1)
                mime_sub = m.group(2).lower()
                b64 = re.sub(r'\s+', '', m.group(3))
                ext = _MIME_EXT_MAP.get(mime_sub, mime_sub.replace("+", "_"))
                try:
                    data = base64.b64decode(b64, validate=False)
                    h = hashlib.sha256(data).hexdigest()[:16]
                    filename = f"{h}.{ext}"
                    filepath = chat_attach_dir / filename
                    chat_attach_dir.mkdir(parents=True, exist_ok=True)
                    if not filepath.exists():
                        filepath.write_bytes(data)
                    extracted += 1
                    return f"![{alt}](/api/attachments/{chat_id}/{filename})"
                except Exception:
                    return m.group(0)
            new_text = IMAGE_B64_RE.sub(replacer, text)
            if new_text != text:
                msg["text"] = new_text
    
    return extracted


def _post_extract_images(chat_id: str):
    """После сохранения чата: извлечь base64-картинки из файла на диске."""
    chat_file = CHATS_DIR / f"{chat_id}.json"
    if not chat_file.exists():
        return
    try:
        data = json.loads(chat_file.read_text(encoding="utf-8"))
        messages = data.get("messages", [])
        count = _extract_images_from_messages(messages, chat_id, ATTACH_DIR)
        if count > 0:
            tmp = chat_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(chat_file)
            print(f"[IMPORT IMG] Re-saved {chat_id} with {count} image(s) extracted")
    except Exception as e:
        print(f"[IMPORT IMG ERROR] {chat_id}: {e}")
if IMPORT_MOD:
    print(f"[OK] import.py loaded as module")
else:
    print(f"[WARN] import.py not found - /api/import/upload will fail")


def _process_import_file(content: bytes, filename: str):
    """Парсит и сохраняет один файл через логику import.py."""
    if not IMPORT_MOD:
        return {"imported": 0, "failed": 1, "errors": ["import.py not loaded"]}
    
    # Сохраняем во временный файл (нужен для parse_llamacpp_jsonl и parse_markdown)
    tmp = Path(tempfile.gettempdir()) / f"strawberry_import_{Path(filename).name}"
    try:
        tmp.write_bytes(content)
        path_obj = Path(filename)
        ext_primary = IMPORT_MOD._primary_ext(path_obj)
        
        # Диспетчеризация по формату (как в import.py main())
        if ext_primary == ".jsonl":
            chats = IMPORT_MOD.parse_llamacpp_jsonl(tmp)
            source = "llamacpp"
        elif ext_primary == ".md":
            chats = IMPORT_MOD.parse_markdown(tmp)
            # Берем source из первого чата (парсер его извлек)
            if chats and isinstance(chats, list) and len(chats) > 0:
                source = chats[0].get("source", "markdown")
            else:
                source = "markdown"
        elif ext_primary == ".json":
            try:
                raw = json.loads(content.decode("utf-8"))
            except json.JSONDecodeError as e:
                return {"imported": 0, "failed": 1, "errors": [f"Invalid JSON: {e}"]}
            
            fmt = IMPORT_MOD.detect_format(tmp, raw)
            print(f"[IMPORT] Detected format: {fmt}")
            
            if fmt == "deepseek_json":
                chats = IMPORT_MOD.IM.parse_deepseek(raw if isinstance(raw, list) else [raw])
                source = "deepseek"
            elif fmt == "lmstudio_json":
                chats = IMPORT_MOD.parse_lmstudio(raw)
                source = "lmstudio"
            elif fmt == "chatgpt_legacy":
                chats = IMPORT_MOD.IM.parse_chatgpt(raw if isinstance(raw, list) else [raw])
                source = "chatgpt"
            elif fmt == "chatgpt_export_v1":
                chats = IMPORT_MOD.parse_chatgpt_export_v1(raw)
                source = "chatgpt"
            else:
                return {"imported": 0, "failed": 1, "errors": [f"Unknown format: {fmt}"]}
        else:
            return {"imported": 0, "failed": 1, "errors": [f"Unknown extension: {ext_primary}"]}
        
        if not chats:
            return {"imported": 0, "failed": 1, "errors": ["No chats found in file"]}
        
        print(f"[IMPORT] Parsed {len(chats)} chat(s) from {filename}")
        
        # Записываем каждый чат через write_chat из import.py
        ok = 0
        skipped = 0
        errors = []
        imported_ids = []
        
        for c in chats:
            try:
                r = IMPORT_MOD.write_chat(c, source, CHATS_DIR, BACKUP_DIR,
                                          attachments_dir=ATTACH_DIR)
                st = r.get("status")
                if st in ("new", "update"):
                    ok += 1
                    imported_ids.append(r["local_id"])
                    _post_extract_images(r["local_id"])   # ← ДОБАВИТЬ ЭТУ СТРОКУ
                    print(f"[IMPORT] ✓ {r['title']} → {r['local_id']}.json ({st})")
                elif st in ("skipped_dup", "skipped_local"):
                    skipped += 1
                    print(f"[IMPORT] ⊘ {r['title']}: {st}")
                elif st == "corrupt":
                    errors.append(f"{r['title']}: corrupt")
                elif st == "id_mismatch":
                    errors.append(f"{r['title']}: id mismatch")
                else:
                    errors.append(f"{r['title']}: {r.get('error', st)}")
            except Exception as e:
                errors.append(f"{c.get('title', '?')}: {e}")
        
        return {
            "imported": ok,
            "skipped": skipped,
            "failed": len(chats) - ok - skipped,
            "total": len(chats),
            "imported_ids": imported_ids,
            "errors": errors[:10]
        }
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except:
                pass


@app.post("/api/import/upload")
async def import_chats_upload(files: List[UploadFile] = File(...)):
    """Принимает файлы чатов через UI, парсит и сохраняет в chats/."""
    print(f"\n[IMPORT] ===== Received {len(files)} file(s) =====")
    
    total_imported = 0
    total_skipped = 0
    total_failed = 0
    all_errors = []
    all_imported_ids = []
    
    for f in files:
        try:
            content = await f.read()
            filename = f.filename or "unknown"
            print(f"[IMPORT] Processing: {filename} ({len(content)} bytes)")
            
            result = _process_import_file(content, filename)
            total_imported += result.get("imported", 0)
            total_skipped += result.get("skipped", 0)
            total_failed += result.get("failed", 0)
            all_errors.extend(result.get("errors", []))
            all_imported_ids.extend(result.get("imported_ids", []))
            
        except Exception as e:
            total_failed += 1
            err = f"{f.filename}: {type(e).__name__}: {e}"
            all_errors.append(err)
            print(f"[IMPORT ERROR] {err}")
            traceback.print_exc()
    
    print(f"[IMPORT] ===== Done. imported={total_imported} skipped={total_skipped} failed={total_failed} =====\n")
    
    return {
        "imported": total_imported,
        "skipped": total_skipped,
        "failed": total_failed,
        "errors": all_errors[:10],
        "imported_ids": all_imported_ids
    }        
        
# ================= СТАТИКА =================
@app.get("/")
async def index():
    p = WEB_DIR / "index.html"
    if not p.exists():
        return JSONResponse(
            {"error": f"web/index.html not found at {p}"},
            status_code=500,
        )
    return FileResponse(p)

if (WEB_DIR / "fonts").exists():
    app.mount("/fonts", StaticFiles(directory=str(WEB_DIR / "fonts")), name="fonts")

if WEB_DIR.exists():
    app.mount("/web", StaticFiles(directory=str(WEB_DIR)), name="web")

# ================= СТАРТ =================
print(f"\n[READY] Server starting...")
print(f"[READY] LLM backend: {LLM_BACKEND_URL}")
print(f"[READY] Web UI: http://127.0.0.1:8088/")
print(f"[READY] Chats dir: {CHATS_DIR}")
print(f"[READY] Backup dir: {BACKUP_DIR}")
print(f"[READY] Attach dir: {ATTACH_DIR}\n")