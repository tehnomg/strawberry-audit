#!/usr/bin/env python3
"""
import.py — CLI-импорт одиночных чатов в Strawberry (тонкая обёртка).

Форматы:
  .jsonl — llama.cpp (session + message)
  .json  — LM Studio (messages[].versions[])
         — ChatGPT export-v1 (schemaVersion, source.platform, messages[])
         — ChatGPT conversations.json (legacy: массив с mapping) → делегируется в модуль
  .md    — Markdown (beta, эвристика)

Не изменяет import_chats_v1.4.1-stageB.py — только импортирует его функции.
"""

import argparse
import base64 
import hashlib
import importlib.util
import json
import os
import re
import sys
import time 
import urllib.parse 
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# ----------------------------------------------------------------------------
# Загрузка существующего модуля (имя файла с дефисами — только через importlib)
# ----------------------------------------------------------------------------

def _load_importer_module():
    here = Path(__file__).resolve().parent
    candidates = (
        sorted(here.glob("import_chats*.py"))
        + sorted(here.glob("strawberry_importer*.py"))
    )
    if not candidates:
        sys.exit("[ERROR] Рядом с import.py не найден import_chats_v1.4.1-stageB.py")
    path = candidates[0]
    spec = importlib.util.spec_from_file_location("strawberry_importer", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


IM = _load_importer_module()

# ----------------------------------------------------------------------------
# Вложения: data:image/...;base64 → файл в attachments/
# ----------------------------------------------------------------------------

_MIME_EXT_MAP = {
    "jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif",
    "webp": "webp", "bmp": "bmp", "tiff": "tiff",
    "svg+xml": "svg",
}

LMSTUDIO_FILES_DIR = Path(
    os.getenv("LMSTUDIO_FILES_DIR", str(Path.home() / ".lmstudio" / "user-files"))
)


def set_lmstudio_files_dir(p):
    global LMSTUDIO_FILES_DIR
    LMSTUDIO_FILES_DIR = Path(p)


def _resolve_lmstudio_file(file_identifier, original_name=None):
    """Ищет байты картинки LM Studio. Сначала сам файл, потом .json с preview.data.
       Возвращает (bytes, mime_sub) или None."""
    if not file_identifier or not LMSTUDIO_FILES_DIR.exists():
        return None
    p = LMSTUDIO_FILES_DIR / file_identifier
    if p.is_file():
        try:
            data = p.read_bytes()
        except Exception as e:
            print(f"  [ATTACH WARN] LM Studio read {p}: {e}", file=sys.stderr)
            return None
        ext = p.suffix.lower().lstrip(".")
        mime = {
            "jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif",
            "webp": "webp", "bmp": "bmp", "tiff": "tiff", "svg": "svg+xml",
        }.get(ext, "png")
        return data, mime

    # Fallback: рядом лежит <fileIdentifier>.json с preview.data
    for candidate in (p.with_suffix(".json"),
                      Path(str(p) + ".json"),
                      Path(str(p) + ".metadata.json")):
        if not candidate.is_file():
            continue
        try:
            meta = json.loads(candidate.read_text(encoding="utf-8"))
            prev = meta.get("preview")
            data_url = prev.get("data") if isinstance(prev, dict) else None
            if isinstance(data_url, str) and data_url.startswith("data:image/"):
                header, b64 = data_url.split(",", 1)
                mime_sub = header.split(";")[0].split("/", 1)[1].lower()
                return base64.b64decode(re.sub(r"\s+", "", b64), validate=False), mime_sub
        except Exception as e:
            print(f"  [ATTACH WARN] LM Studio preview {candidate}: {e}", file=sys.stderr)
    return None

def _stage_data_url(data_url: str, chat_id: str, attach_dir: Path,
                    write_file: bool = True) -> Optional[tuple[str, str]]:
    """Decode data:image/...;base64,... → attachments/<chat_id>/<sha256>.<ext>.
       Возвращает (url_path, sha256_hex) или None.
       write_file=False → только вычисляет url, не пишет (для dry-run)."""
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        return None
    try:
        header, b64 = data_url.split(",", 1)
        mime_sub = header.split(";")[0].split("/", 1)[1].lower()
        ext = _MIME_EXT_MAP.get(mime_sub, mime_sub.replace("+", "_"))
        data = base64.b64decode(re.sub(r"\s+", "", b64), validate=False)
        h = hashlib.sha256(data).hexdigest()
        filename = f"{h}.{ext}"
        if write_file:
            chat_dir = attach_dir / chat_id
            filepath = chat_dir / filename
            if not filepath.exists():
                chat_dir.mkdir(parents=True, exist_ok=True)
                filepath.write_bytes(data)
                print(f"  [ATTACH] {chat_id}/{filename} ({len(data)} bytes)")
        return f"/api/attachments/{chat_id}/{filename}", h
    except Exception as e:
        print(f"  [ATTACH WARN] {chat_id}: {e}", file=sys.stderr)
        return None


def _process_images_in_messages(messages, chat_id, attach_dir, write_files=True):
    count = 0
    for m in messages:
        if not isinstance(m, dict):
            continue
        for img in m.get("images") or []:
            if not isinstance(img, dict):
                continue
            url = img.get("url")

            # 1. data:image/... уже в url (llama.cpp)
            if isinstance(url, str) and url.startswith("data:image/"):
                result = _stage_data_url(url, chat_id, attach_dir, write_file=write_files)
                if result:
                    new_url, _sha = result
                    img["url"] = new_url
                    img["status"] = "available"
                    count += 1
                continue

            # 2. LM Studio: file_identifier → искать в LMSTUDIO_FILES_DIR
            fid = img.get("file_identifier")
            if fid and not url:
                resolved = _resolve_lmstudio_file(fid, img.get("name"))
                if not resolved:
                    img["status"] = "missing"
                    continue
                data, mime_sub = resolved
                ext = _MIME_EXT_MAP.get(mime_sub, mime_sub.replace("+", "_"))
                h = hashlib.sha256(data).hexdigest()
                filename = f"{h}.{ext}"
                if write_files:
                    chat_dir = attach_dir / chat_id
                    filepath = chat_dir / filename
                    if not filepath.exists():
                        chat_dir.mkdir(parents=True, exist_ok=True)
                        filepath.write_bytes(data)
                        print(f"  [ATTACH] {chat_id}/{filename} ({len(data)} bytes)")
                img["url"] = f"/api/attachments/{chat_id}/{filename}"
                img["status"] = "available"
                img["mime"] = f"image/{mime_sub}"
                count += 1
                
            # 3. Markdown: локальный файл, путь к которому был в file:///
            local_path = img.get("local_path")
            if local_path and not url:
                p = Path(local_path)
                if p.is_file():
                    try:
                        data = p.read_bytes()
                        ext = p.suffix.lower().lstrip(".") or "png"
                        mime_sub = _MIME_EXT_MAP.get(ext, "png")
                        h = hashlib.sha256(data).hexdigest()
                        filename = f"{h}.{ext}"
                        if write_files:
                            chat_dir = attach_dir / chat_id
                            filepath = chat_dir / filename
                            if not filepath.exists():
                                chat_dir.mkdir(parents=True, exist_ok=True)
                                filepath.write_bytes(data)
                                print(f"  [ATTACH] {chat_id}/{filename} ({len(data)} bytes)")
                        img["url"] = f"/api/attachments/{chat_id}/{filename}"
                        img["status"] = "available"
                        count += 1
                    except Exception as e:
                        print(f"  [ATTACH WARN] Markdown local {p}: {e}", file=sys.stderr)
                else:
                    img["status"] = "missing"            
    return count
    
def _primary_ext(path: Path) -> str:
    """Первое узнаваемое расширение (учитывает foo.jsonl.txt / foo.md.txt)."""
    sufs = [s.lower() for s in path.suffixes]
    for want in (".jsonl", ".md", ".json"):
        if want in sufs:
            return want
    return sufs[-1] if sufs else ""

_TITLE_MAX = 100
_CODE_PREFIX_RE = re.compile(
    r"^\s*(?:<\?php|<\?|<#|#!|\{|\]|\(|import\s+|from\s+|def\s+|class\s+|function\s+|"
    r"const\s+|let\s+|var\s+|@|//|/\*)",
    re.IGNORECASE,
)


def _sanitize_title(title, fallback="Untitled"):
    """Если llama.cpp назвал сессию первой репликой, а реплика — код,
       показываем не «весь файл», а аккуратную заглушку."""
    if not isinstance(title, str) or not title.strip():
        return fallback
    raw = title.strip()
    flat = re.sub(r"\s+", " ", raw).strip()
    if _CODE_PREFIX_RE.match(flat):
        return f"{fallback} (code)"
    if len(flat) > _TITLE_MAX:
        flat = flat[:_TITLE_MAX].rstrip() + "…"
    return flat

def _atomic_replace_windows(tmp: Path, target: Path,
                            attempts: int = 6,
                            base_delay: float = 0.05) -> bool:
    """
    os.replace с retry-логикой для Windows: PermissionError WinError 32
    возникает, если target в этот момент читается другим процессом (uvicorn).
    ~0.05 + 0.1 + 0.2 + 0.4 + 0.8 + финальная = ~1.6 с на выход из блокировки.
    """
    for i in range(attempts):
        try:
            os.replace(tmp, target)
            return True
        except PermissionError as e:
            if i == attempts - 1:
                print(f"  [WARN] os.replace failed after {attempts} attempts: {e}",
                      file=sys.stderr)
                return False
            time.sleep(base_delay * (2 ** i))
    return False
# ----------------------------------------------------------------------------
# Общие утилиты
# ----------------------------------------------------------------------------

def _parse_human_ts(ts) -> Optional[str]:
    """'06.10.2026, 13:04:12' / '9/13/2026 22:29:15' → ISO UTC; иначе как есть."""
    if not isinstance(ts, str) or not ts.strip():
        return None
    s = ts.strip()
    for fmt in ("%d.%m.%Y, %H:%M:%S", "%d.%m.%Y %H:%M:%S",
                "%m/%d/%Y %H:%M:%S", "%m/%d/%Y, %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    return s


def _text_from_parts(parts) -> str:
    if isinstance(parts, str):
        return parts
    if not isinstance(parts, list):
        return ""
    out = []
    for p in parts:
        if isinstance(p, dict) and p.get("type") == "text":
            t = p.get("text")
            if isinstance(t, str):
                out.append(t)
    return "".join(out)


def _reasoning_from_parts(parts) -> str:
    if not isinstance(parts, list):
        return ""
    out = []
    for p in parts:
        if isinstance(p, dict) and p.get("type") in ("reasoning", "thinking"):
            t = p.get("text") or p.get("content")
            if isinstance(t, str):
                out.append(t)
    return "".join(out)


# ----------------------------------------------------------------------------
# llama.cpp JSONL
# ----------------------------------------------------------------------------
def _extract_llamacpp_images(msg: dict) -> list[dict]:
    """Картинки в llama.cpp лежат в msg['extra'][], где type='IMAGE'."""
    images = []
    for item in msg.get("extra") or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("type", "")).upper() != "IMAGE":
            continue
        b64_url = item.get("base64Url")
        mime = None
        if isinstance(b64_url, str) and b64_url.startswith("data:image/"):
            try:
                mime = b64_url.split(",", 1)[0].split(";")[0].split(":", 1)[1]
            except Exception:
                pass
        images.append({
            "kind": "image",
            "source": "llamacpp",
            "source_id": item.get("name") or item.get("id"),
            "name": item.get("name"),
            "mime": mime,
            "size": item.get("size"),
            "status": "available" if b64_url else "missing",
            "url": b64_url,   # data URI, write_chat превратит в файл
        })
    return images


def parse_llamacpp_jsonl(path: Path) -> list[dict]:
    session = None
    nodes: dict[str, dict] = {}
    order: list[str] = []

    with open(path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"[WARN] {path.name}:{line_no}: invalid JSON ({e})", file=sys.stderr)
                continue
            t = obj.get("type")
            if t == "session":
                session = obj
            elif t == "message":
                msg = obj.get("message") or {}
                mid = msg.get("id")
                if isinstance(mid, str) and mid:
                    nodes[mid] = msg
                    order.append(mid)

    if not nodes:
        return []

    root_id = next(
        (mid for mid, m in nodes.items() if m.get("parent") in (None, "")),
        None,
    )
    chain, visited, has_branches = [], set(), False
    cur = root_id
    while cur and cur in nodes and cur not in visited:
        visited.add(cur)
        m = nodes[cur]
        chain.append(m)
        ch = m.get("children") or []
        if len(ch) > 1:
            has_branches = True
        cur = ch[0] if ch else None
    if not chain:  # fallback: порядок строк
        chain = [nodes[i] for i in order]

    session = session or {}
    title = session.get("name") or "Untitled"
    created = IM.normalize_timestamp(session.get("lastModified"))
    model = None
    messages = []

    for m in chain:
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        text = IM.normalize_content(m.get("content", ""))
        images = _extract_llamacpp_images(m)
        if not text.strip() and not images:
            continue
        entry = {
            "role": role,
            "text": text,
            "time": IM.normalize_timestamp(m.get("timestamp"), fallback=created),
        }
        r = m.get("reasoning") or m.get("reasoning_content")
        if isinstance(r, str) and r:
            entry["reasoning"] = r
        if images:
            entry["images"] = images
        messages.append(entry)
        if role == "assistant" and not model and isinstance(m.get("model"), str):
            model = m["model"]

    if not messages:
        return []

    oid = session.get("id") or (
        "llamacpp-" + hashlib.sha256(path.name.encode()).hexdigest()[:16]
    )
    return [{
        "original_id": oid,
        "title": title,
        "messages": messages,
        "source_created_at": messages[0].get("time") if messages else created,
        "source_updated_at": messages[-1].get("time") if messages else created,
        "model": model or "llamacpp",
        "_meta": {"format": "llamacpp_jsonl", "has_branches": has_branches},
    }]


# ----------------------------------------------------------------------------
# LM Studio (внутренний JSON)
# ----------------------------------------------------------------------------

def _lmstudio_pick_version(msg: dict) -> Optional[dict]:
    versions = msg.get("versions") or []
    if not versions:
        return None
    idx = msg.get("currentlySelected", 0)
    if not isinstance(idx, int) or idx < 0 or idx >= len(versions):
        idx = 0
    v = versions[idx]
    return v if isinstance(v, dict) else None


def _lmstudio_msg_text(v: dict) -> tuple[str, str]:
    vtype = v.get("type")
    if vtype == "singleStep":
        c = v.get("content")
        return _text_from_parts(c), _reasoning_from_parts(c)
    if vtype == "multiStep":
        texts, reas = [], []
        for step in v.get("steps") or []:
            if not isinstance(step, dict) or step.get("type") != "contentBlock":
                continue
            c = step.get("content")
            texts.append(_text_from_parts(c))
            reas.append(_reasoning_from_parts(c))
        return "".join(texts), "".join(reas)
    return "", ""

def _lmstudio_collect_content_lists(v):
    """Все content[] внутри version (singleStep и multiStep)."""
    out = []
    vtype = v.get("type")
    if vtype == "singleStep":
        if isinstance(v.get("content"), list):
            out.append(v["content"])
        pre = v.get("preprocessed")
        if isinstance(pre, dict) and isinstance(pre.get("content"), list):
            out.append(pre["content"])
    elif vtype == "multiStep":
        for step in v.get("steps") or []:
            if not isinstance(step, dict):
                continue
            if isinstance(step.get("content"), list):
                out.append(step["content"])
    return out


def _lmstudio_msg_attachments(v):
    """Собирает images[] из version. Картинки LM Studio = type=file, fileType=image,
       с fileIdentifier. Байтов в JSON нет — writer возьмёт их из LMSTUDIO_FILES_DIR."""
    by_id = {}
    for content_list in _lmstudio_collect_content_lists(v):
        for c in content_list:
            if not isinstance(c, dict):
                continue
            ctype = str(c.get("type", "")).lower()
            if ctype not in ("file", "image", "image_url"):
                continue
            fid = c.get("fileIdentifier") or c.get("identifier") or c.get("id")
            name = c.get("name") or c.get("originalName")
            file_type = str(c.get("fileType", "")).lower()
            is_image = (file_type == "image") or ctype in ("image", "image_url")

            if not fid:
                if ctype == "image_url":
                    iu = c.get("image_url") or {}
                    url = iu.get("url") if isinstance(iu, dict) else None
                    if isinstance(url, str) and url:
                        by_id[url] = {
                            "kind": "image", "source": "lmstudio",
                            "source_id": None, "name": None, "mime": None,
                            "size": None,
                            "status": "available" if url.startswith("data:image/") else "missing",
                            "url": url,
                        }
                continue

            entry = by_id.setdefault(fid, {
                "kind": "image" if is_image else "file",
                "source": "lmstudio",
                "source_id": fid,
                "name": None,
                "mime": None,
                "size": c.get("sizeBytes"),
                "status": "missing",
                "url": None,
                "file_identifier": fid,
            })
            if name and not entry["name"]:
                entry["name"] = name

    # writer умеет только images, files пока пропускаем
    return [a for a in by_id.values() if a["kind"] == "image"]

def parse_lmstudio(data) -> list[dict]:
    items = data if isinstance(data, list) else [data]
    out = []
    for chat in items:
        if not isinstance(chat, dict):
            continue

        now_iso = datetime.now(timezone.utc).isoformat()
        default_time = IM.normalize_timestamp(chat.get("createdAt")) or now_iso
        user_last_time = (IM.normalize_timestamp(chat.get("userLastMessagedAt"))
                          or default_time)
        asst_last_time = (IM.normalize_timestamp(chat.get("assistantLastMessagedAt"))
                          or default_time)

        messages = []
        model = None
        last_user_idx = None
        last_asst_idx = None

        for m in chat.get("messages") or []:
            if not isinstance(m, dict):
                continue
            v = _lmstudio_pick_version(m)
            if not v:
                continue
            role = v.get("role")
            if role not in ("user", "assistant"):
                continue
            text, reas = _lmstudio_msg_text(v)
            lm_images = _lmstudio_msg_attachments(v)
            if not text.strip() and not reas and not lm_images:
                continue
            entry = {"role": role, "text": text, "time": default_time}
            if reas:
                entry["reasoning"] = reas
            if lm_images:
                entry["images"] = lm_images
            messages.append(entry)
            if role == "user":
                last_user_idx = len(messages) - 1
            else:
                last_asst_idx = len(messages) - 1
                if not model:
                    si = v.get("senderInfo") or {}
                    if isinstance(si.get("senderName"), str):
                        model = si["senderName"]

        # Уточняем время последних сообщений из чат-уровневых полей.
        # Промежуточные сообщения остаются на createdAt — лучшего в формате нет.
        if last_user_idx is not None:
            messages[last_user_idx]["time"] = user_last_time
        if last_asst_idx is not None:
            messages[last_asst_idx]["time"] = asst_last_time

        if not messages:
            continue

        created = IM.normalize_timestamp(chat.get("createdAt"))
        updated = IM.normalize_timestamp(
            chat.get("assistantLastMessagedAt"), fallback=created
        )

        sp = chat.get("systemPrompt")
        if isinstance(sp, str) and sp.strip():
            messages.insert(0, {"role": "system", "text": sp, "time": default_time})

        if not model:
            lum = chat.get("lastUsedModel") or {}
            if isinstance(lum.get("identifier"), str):
                model = lum["identifier"]
        if not model and isinstance(chat.get("preset"), str):
            model = chat["preset"]

        oid = str(chat.get("createdAt") or (
            "lmstudio-" + hashlib.sha256(
                json.dumps(chat, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()[:16]
        ))

        out.append({
            "original_id": oid,
            "title": chat.get("name") or "Untitled",
            "messages": messages,
            "source_created_at": created,
            "source_updated_at": updated,
            "model": model or "lmstudio",
            "_meta": {"format": "lmstudio_json"},
        })
    return out

# ----------------------------------------------------------------------------
# ChatGPT export-v1
# ----------------------------------------------------------------------------

def _chatgpt_uuid(url) -> Optional[str]:
    if not isinstance(url, str):
        return None
    m = re.search(r"/c/([0-9a-fA-F-]{8,})", url)
    return m.group(1) if m else None


def parse_chatgpt_export_v1(data) -> list[dict]:
    items = data if isinstance(data, list) else [data]
    out = []
    for chat in items:
        if not isinstance(chat, dict):
            continue
        src = chat.get("source") or {}
        meta = chat.get("metadata") or {}
        messages = []
        for m in chat.get("messages") or []:
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            if role not in ("user", "assistant"):
                continue
            text = m.get("content")
            if not isinstance(text, str):
                text = IM.normalize_content(text)
            if not text.strip():
                continue
            entry = {"role": role, "text": text}
            t = _parse_human_ts(m.get("timestamp"))
            if t:
                entry["time"] = t
            messages.append(entry)

        if not messages:
            continue

        oid = _chatgpt_uuid(src.get("url")) or (
            "chatgpt-" + hashlib.sha256(
                json.dumps(chat, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()[:16]
        )

        out.append({
            "original_id": oid,
            "title": src.get("title") or "Untitled",
            "messages": messages,
            "source_updated_at": IM.normalize_timestamp(chat.get("exportedAt")),
            "model": meta.get("Model") or src.get("platform") or "chatgpt",
            "_meta": {"format": "chatgpt_export_v1"},
        })
    return out


# ----------------------------------------------------------------------------
# Markdown (beta)
# ----------------------------------------------------------------------------

_MD_META = (
    "**created:**", "**updated:**", "**exported:**", "**link:**",
    "**user:**", "**model:**", "**method:**", "**source:**",
)


def parse_markdown(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    title = None
    created = None
    source = "markdown"  # дефолт
    model_name = None
    messages = []
    cur_role = None
    cur_buf: list[str] = []
    cur_ts = None

    def flush():
        nonlocal cur_role, cur_buf, cur_ts
        if cur_role and cur_buf:
            text = "\n".join(cur_buf).strip()
            # отрезаем хвост экспортёра (Powered by / Exported with)
            text = re.split(r"\n---\s*\n(?:Powered by|Exported with)", text, flags=re.IGNORECASE)[0].rstrip()
            
            images = []
            
            def _md_img_replacer(m):
                alt = m.group(1)
                src = m.group(2)
                
                # 1. Локальные файлы LM Studio (file:///)
                if src.startswith("file:///"):
                    # отрезаем file:/// и декодируем %20 в пробелы
                    decoded_path = urllib.parse.unquote(src[8:])
                    images.append({
                        "kind": "image",
                        "source": "markdown",
                        "name": alt,
                        "local_path": decoded_path,
                        "status": "available" # статус уточнится в writer
                    })
                    return "" # удаляем из текста
                    
                # 2. Base64 (браузерные расширения)
                elif src.startswith("data:image/"):
                    images.append({
                        "kind": "image",
                        "source": "markdown",
                        "name": alt,
                        "url": src,
                        "status": "available"
                    })
                    return "" # удаляем из текста
                    
                # 3. Внешние ссылки (https://...) оставляем в тексте, 
                # чтобы UI отрендерил их через свой markdown-парсер
                return m.group(0)

            # Ищем ![alt](url)
            text = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', _md_img_replacer, text).strip()

            if text or images:
                entry = {"role": cur_role, "text": text}
                if cur_ts:
                    entry["time"] = cur_ts
                if images:
                    entry["images"] = images
                messages.append(entry)
                
        cur_role, cur_buf, cur_ts = None, [], None

    for line in lines:
        s = line.strip()
        low = s.lower()
        
        if s.startswith("# ") and title is None:
            title = s[2:].strip()
            continue
            
        role_match = re.match(r'^#+\s*(prompt|response|user|assistant|human|chatgpt|model|you)\s*:?\s*$', low)
        if role_match:
            flush()
            rtype = role_match.group(1)
            if rtype in ("prompt", "user", "human", "you"):
                cur_role = "user"
            else:
                cur_role = "assistant"
            continue
            
        # Метаданные (очищаем от ** и #)
        if not cur_role:
            clean_s = re.sub(r'[*#_]', '', s).strip()
            clean_low = clean_s.lower()
            
            if clean_low.startswith("source:"):
                source = clean_s.split(":", 1)[1].strip().lower()
            elif clean_low.startswith("model:"):
                model_name = clean_s.split(":", 1)[1].strip()
            elif clean_low.startswith("date:") or clean_low.startswith("created:"):
                date_str = clean_s.split(":", 1)[1].strip()
                parsed = _parse_human_ts(date_str)
                if parsed and created is None:
                    created = parsed
            elif clean_low.startswith("exported") or clean_low.startswith("link") or clean_low.startswith("method"):
                continue
            else:
                continue
                
        if cur_role and cur_ts is None and re.fullmatch(r'\d{1,2}\.\d{1,2}\.\d{4},\s*\d{1,2}:\d{2}:\d{2}', s):
            cur_ts = _parse_human_ts(s)
            continue
            
        if cur_role is not None:
            if line.startswith("> "):
                continue 
            cur_buf.append(line)
            
    flush()

    if not messages:
        return []

    # Меняем генерацию ID: убираем жесткий префикс "markdown-"
    # чтобы import_chats не делал "markdown-markdown-..."
    oid = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    
    return [{
        "original_id": oid,
        "title": title or path.stem,
        "messages": messages,
        "source_updated_at": created,
        "model": model_name or source,
        "source": source,  # <-- передаем реальный источник
        "_meta": {"format": "markdown", "beta": True},
    }]

# ----------------------------------------------------------------------------
# Диспетчер форматов
# ----------------------------------------------------------------------------

def _is_deepseek_mapping(mapping) -> bool:
    """DeepSeek: mapping[i].message.fragments[] (REQUEST/RESPONSE/...).
       ChatGPT: mapping[i].message.author.role + message.content.parts[]."""
    if not isinstance(mapping, dict):
        return False
    for node in mapping.values():
        if not isinstance(node, dict):
            continue
        msg = node.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("fragments"), list):
            return True
    return False


def detect_format(path: Path, data) -> str:
    suf = path.suffix.lower()
    if suf == ".jsonl":
        return "llamacpp_jsonl"
    if suf == ".md":
        return "markdown"
    if suf != ".json":
        return "unknown"
    items = data if isinstance(data, list) else [data]
    if not items:
        return "unknown"
    first = items[0]
    if not isinstance(first, dict):
        return "unknown"
    if "mapping" in first:
        if _is_deepseek_mapping(first.get("mapping") or {}):
            return "deepseek_json"
        return "chatgpt_legacy"
    if "versions" in first or ("messages" in first and "lastUsedModel" in first):
        return "lmstudio_json"
    if "schemaVersion" in first and "source" in first and "messages" in first:
        return "chatgpt_export_v1"
    return "unknown"

# ----------------------------------------------------------------------------
# Writer (та же схема, что у модуля; модуль не меняем)
# ----------------------------------------------------------------------------

def write_chat(chat, source, chats_dir, backup_dir, force=False, dry_run=False,
               attachments_dir=None):
    oid = chat["original_id"]
    local_id, is_corrupt = IM.sanitize_id(oid, chats_dir, source)
    target = chats_dir / f"{local_id}.json"

    if is_corrupt:
        return {"status": "corrupt", "local_id": local_id, "title": chat["title"]}
    existing = IM.load_existing_chat(target)
    if existing is None and target.exists():
        return {"status": "corrupt", "local_id": local_id, "title": chat["title"]}
    # Pre-process: data:image/... → attachments/<local_id>/<sha256>.<ext>,
    # url заменяется на /api/attachments/... ДО compute_hash — чтобы дедуп
    # работал и для картинок (url становится детерминированным).
    if attachments_dir:
        _process_images_in_messages(chat["messages"], local_id, attachments_dir,
                                    write_files=not dry_run)
    action = "NEW"
    if existing:
        if existing.get("original_id") != oid:
            return {"status": "id_mismatch", "local_id": local_id,
                    "title": chat["title"]}

        ex_ver = IM.get_hash_version(existing)
        msgs = existing.get("messages", [])
        ex_hash = (IM.compute_content_hash_v1(msgs) if ex_ver == 1
                   else IM.compute_content_hash_v2(msgs))
        ex_meta = existing.get("source_content_hash")
        locally_modified = (ex_hash != ex_meta) if ex_meta else True

        if locally_modified and not force:
            return {"status": "skipped_local", "local_id": local_id,
                    "title": chat["title"]}
        if ex_meta and ex_meta == IM.compute_content_hash_v2(chat["messages"]) and not force:
            return {"status": "skipped_dup", "local_id": local_id,
                    "title": chat["title"]}
        action = "UPDATE"

    if dry_run:
        return {"status": "would_" + action.lower(), "local_id": local_id,
                "title": chat["title"], "msgs": len(chat["messages"])}

    now = datetime.now(timezone.utc).isoformat()
    new_hash = IM.compute_content_hash_v2(chat["messages"])
    out = {
        "id": local_id,
        "title": _sanitize_title(chat.get("title")),
        "source": source,
        "original_id": oid,
        "source_created_at": chat.get("source_created_at"),
        "source_updated_at": chat.get("source_updated_at"),
        "source_message_count": len(chat["messages"]),
        "source_content_hash": new_hash,
        "source_content_hash_version": 2,
        # created_at / updated_at — «человеческие» даты для сортировки и UI.
        # Для импортов = даты оригинала; imported_at — когда физически импортирован.
        "created_at": chat.get("source_created_at")
                      or (existing.get("created_at") if existing else None)
                      or now,
        "updated_at": chat.get("source_updated_at")
                      or (existing.get("updated_at") if existing else None)
                      or now,
        "imported_at": (existing.get("imported_at") if existing else None) or now,
        "model": chat.get("model", source),
        "messages": chat["messages"],
    }

    chats_dir.mkdir(parents=True, exist_ok=True)
    if existing:
        backup_dir.mkdir(parents=True, exist_ok=True)
        IM.backup_chat(target, backup_dir)

    tmp = target.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        if not _atomic_replace_windows(tmp, target):
            if tmp.exists():
                tmp.unlink()
            return {"status": "error", "local_id": local_id,
                    "title": chat["title"],
                    "error": "target locked (uvicorn reading?), try again"}
    except Exception as e:
        if tmp.exists():
            tmp.unlink()
        return {"status": "error", "local_id": local_id,
                "title": chat["title"], "error": str(e)}

    return {"status": action.lower(), "local_id": local_id, "title": chat["title"]}
    

# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def _do_import_file(path, chats_dir, backup_dir, attachments_dir,
                    force=False, dry_run=False, fmt_override="auto", allow_all=False):
    """Импортирует один файл. Возвращает {'imported', 'skipped', 'failed', 'errors'}."""
    result = {"imported": 0, "skipped": 0, "failed": 0, "errors": []}
    ext = _primary_ext(path)
    chats = source = fmt = None

    try:
        if fmt_override == "auto":
            if ext == ".jsonl":
                chats = parse_llamacpp_jsonl(path)
                source, fmt = "llamacpp", "llamacpp_jsonl"
            elif ext == ".md":
                chats = parse_markdown(path)
                source, fmt = "markdown", "markdown"
            else:
                try:
                    raw = json.loads(path.read_text(encoding="utf-8"))
                except json.JSONDecodeError as e:
                    result["failed"] = 1
                    result["errors"].append(f"Invalid JSON: {e}")
                    return result
                fmt = detect_format(path, raw)
                if fmt == "deepseek_json":
                    chats = IM.parse_deepseek(raw if isinstance(raw, list) else [raw])
                    source, fmt = "deepseek", "deepseek_json"
                elif fmt == "lmstudio_json":
                    chats, source = parse_lmstudio(raw), "lmstudio"
                elif fmt == "chatgpt_legacy":
                    chats = IM.parse_chatgpt(raw if isinstance(raw, list) else [raw])
                    source = "chatgpt"
                elif fmt == "chatgpt_export_v1":
                    chats, source = parse_chatgpt_export_v1(raw), "chatgpt"
                else:
                    result["failed"] = 1
                    result["errors"].append(f"Unknown format: {fmt}")
                    return result
        else:
            if fmt_override == "llamacpp":
                chats = parse_llamacpp_jsonl(path)
                source, fmt = "llamacpp", "llamacpp_jsonl"
            elif fmt_override == "markdown":
                chats = parse_markdown(path)
                source, fmt = "markdown", "markdown"
            else:
                try:
                    raw = json.loads(path.read_text(encoding="utf-8"))
                except json.JSONDecodeError as e:
                    result["failed"] = 1
                    result["errors"].append(f"Invalid JSON: {e}")
                    return result
                if fmt_override == "deepseek":
                    chats, source, fmt = (
                        IM.parse_deepseek(raw if isinstance(raw, list) else [raw]),
                        "deepseek",
                        "deepseek_json",
                    )
                elif fmt_override == "lmstudio":
                    chats, source, fmt = parse_lmstudio(raw), "lmstudio", "lmstudio_json"
                else:
                    if isinstance(raw, dict) and "schemaVersion" in raw:
                        chats, source, fmt = parse_chatgpt_export_v1(raw), "chatgpt", "chatgpt_export_v1"
                    elif isinstance(raw, list):
                        chats, source, fmt = IM.parse_chatgpt(raw), "chatgpt", "chatgpt_legacy"
                    else:
                        result["failed"] = 1
                        result["errors"].append("Cannot detect ChatGPT format")
                        return result
    except Exception as e:
        result["failed"] = 1
        result["errors"].append(f"Parse: {e}")
        return result

    if not chats:
        result["failed"] = 1
        result["errors"].append("No chats found")
        return result
    if len(chats) > 1 and not allow_all:
        result["failed"] = len(chats)
        result["errors"].append(f"{len(chats)} chats, use --all")
        return result

    print(f"[INFO] {path.name}: {fmt}; chats: {len(chats)}")

    for c in chats:
        try:
            r = write_chat(c, source, chats_dir, backup_dir,
                           force=force, dry_run=dry_run,
                           attachments_dir=attachments_dir)
            st = r["status"]
            if st in ("new", "update"):
                print(f"  Imported: {r['title']} → chats/{r['local_id']}.json ({st})")
                result["imported"] += 1
            elif st in ("would_new", "would_update"):
                print(f"  DRY: would import {r['title']} → chats/{r['local_id']}.json")
                result["imported"] += 1
            elif st == "skipped_dup":
                print(f"  SKIPPED (duplicate): {r['title']}")
                result["skipped"] += 1
            elif st == "skipped_local":
                print(f"  SKIPPED (local edits): {r['title']}")
                result["skipped"] += 1
            else:
                result["failed"] += 1
                result["errors"].append(f"{r['title']}: {st}")
        except Exception as e:
            result["failed"] += 1
            result["errors"].append(f"{c.get('title', '?')}: {e}")

    return result


def _run_batch(args):
    d = args.import_dir
    if not d.exists() or not d.is_dir():
        sys.exit(f"[ERROR] Not a directory: {d}")

    files = []
    for pattern in ("*.json", "*.jsonl", "*.txt", "*.md"):
        files.extend(d.glob(pattern))
    files = sorted(set(files), key=lambda p: (p.suffix, p.name))
    # LM Studio складывает метаданные картинок рядом — их импортировать не надо
    files = [f for f in files if not f.name.endswith(".metadata.json")]

    print(f"[BATCH] {len(files)} file(s) in {d}  (force={args.force}, dry_run={args.dry_run})\n")

    total = {"imported": 0, "skipped": 0, "failed": 0}
    for i, f in enumerate(files, 1):
        print(f"=== [{i}/{len(files)}] {f.name} ===")
        r = _do_import_file(
            f, args.chats_dir, args.backup_dir, args.attachments_dir,
            force=args.force, dry_run=args.dry_run,
            fmt_override=args.format, allow_all=True,
        )
        total["imported"] += r["imported"]
        total["skipped"] += r["skipped"]
        total["failed"] += r["failed"]
        if r["failed"]:
            for e in r["errors"][:3]:
                print(f"  [ERROR] {e}", file=sys.stderr)
        print()

    print("=== ИТОГО ===")
    print(f"Файлов:                  {len(files)}")
    print(f"Импортировано/обновлено: {total['imported']}")
    print(f"Пропущено:               {total['skipped']}")
    print(f"Ошибок:                  {total['failed']}")


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="Strawberry Chat Importer (CLI)")
    ap.add_argument("path", type=Path, nargs="?", default=None,
                    help="Файл чата (.json/.jsonl/.md) или пусто при --import-dir")
    ap.add_argument("--import-dir", type=Path, default=None,
                    help="Импортировать все *.json/*.jsonl/*.md из папки")
    ap.add_argument("--all", action="store_true",
                    help="Импортировать все чаты из массива")
    ap.add_argument("--force", action="store_true",
                    help="Перезаписать всё: игнорировать skipped_dup и локальные правки")
    ap.add_argument("--format", choices=["auto", "llamacpp", "lmstudio", "chatgpt", "deepseek", "markdown"],
                    default="auto")                
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--chats-dir", type=Path, default=here / "chats")
    ap.add_argument("--backup-dir", type=Path, default=here / "backup")
    ap.add_argument("--attachments-dir", type=Path, default=here / "attachments")
    ap.add_argument("--lmstudio-files-dir", type=Path, default=None,
                    help="Папка user-files LM Studio (по умолчанию ~/.lmstudio/user-files)")
    args = ap.parse_args()

    if args.lmstudio_files_dir:
        set_lmstudio_files_dir(args.lmstudio_files_dir)

    if args.import_dir:
        _run_batch(args)
        return

    if not args.path:
        ap.error("path is required (or use --import-dir)")
    if not args.path.exists():
        sys.exit(f"[ERROR] Файл не найден: {args.path}")

    result = _do_import_file(
        args.path, args.chats_dir, args.backup_dir, args.attachments_dir,
        force=args.force, dry_run=args.dry_run,
        fmt_override=args.format, allow_all=args.all,
    )
    print(f"\n=== Итого ===\nИмпортировано/обновлено: {result['imported']} "
          f"(пропущено: {result['skipped']}, ошибок: {result['failed']})")
    if result["failed"]:
        for e in result["errors"][:10]:
            print(f"  [ERROR] {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()