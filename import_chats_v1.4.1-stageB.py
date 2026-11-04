#!/usr/bin/env python3
"""
Strawberry Chat Importer v1.4.1-stageB
Импорт чатов из архивов DeepSeek, Qwen и ChatGPT в локальное хранилище Strawberry.

Изменения v1.4.1 (правки после ревью v1.4.0-stageB):
- parse_deepseek: детерминированное присвоение роли, никогда не пишем role=None.
- _build_qwen_attachment: чтение метаданных из meta.size/meta.content_type/
  meta.id/meta.name; filename приоритетнее name; file_type сохраняется в
  format_hint, если это не MIME; без фиктивного "attachment".
- _dedupe_attachments_message: дедупликация вложений в одном сообщении по
  source_id (не по имени). Объекты без source_id всегда сохраняются.
- _count_deepseek_all_branches / _count_qwen_all_branches: используют те же
  функции классификации, что парсер (raw occurrences без dedupe).
  Счётчики raw и deduped разделены; "outside main chain" не путается с
  "отброшено дедупликацией".
- _sanitize_source_url: без userinfo, query, fragment; только
  scheme://hostname[:port]/path.
- import_chats: явная семантика миграции v1→v2 — отдельный stats['migrated'],
  [MIGRATE-FMT] в dry-run, бэкап создаётся через backup_chat как раньше.
- _meta.attachment_stats: схема raw_files/raw_images/deduped_files/deduped_images.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse


IMAGE_EXTS = {
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif",
    "svg", "heic", "heif", "avif", "ico",
}


def normalize_timestamp(ts: Any, fallback: Optional[str] = None) -> Optional[str]:
    if ts is None:
        return fallback
    if isinstance(ts, (int, float)):
        try:
            seconds = ts / 1000 if ts > 1e12 else ts
            return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
        except (ValueError, OSError):
            return fallback
    if isinstance(ts, str):
        if len(ts) >= 10:
            return ts
        return fallback
    return fallback


def normalize_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if text is None:
                    text = item.get("content")
                if isinstance(text, str):
                    parts.append(text)
            elif isinstance(item, str):
                parts.append(item)
        return "".join(parts)
    return str(content) if content else ""


def _classify_attachment_kind(name: Any, mime: Any = None) -> str:
    if isinstance(mime, str) and mime:
        lm = mime.lower()
        if lm.startswith("image/"):
            return "image"
    if isinstance(name, str) and "." in name:
        ext = name.rsplit(".", 1)[-1].lower()
        if ext in IMAGE_EXTS:
            return "image"
    return "file"


def _sanitize_source_url(url: Any) -> Optional[str]:
    if not isinstance(url, str):
        return None
    try:
        p = urlparse(url)
    except Exception:
        return None
    if p.scheme not in ("http", "https"):
        return None
    try:
        hostname = p.hostname
        port = p.port
    except ValueError:
        return None
    if not hostname or not re.fullmatch(r"[A-Za-z0-9.\-]+", hostname):
        return None
    host_part = f"{hostname}:{port}" if port is not None else hostname
    path = p.path or ""
    return f"{p.scheme}://{host_part}{path}"


def _dedupe_attachments_message(
    images: list[dict], files: list[dict]
) -> tuple[list[dict], list[dict]]:
    seen: set[str] = set()
    deduped_files: list[dict] = []
    for att in files:
        sid = att.get("source_id")
        if isinstance(sid, str) and sid:
            if sid in seen:
                continue
            seen.add(sid)
        deduped_files.append(att)
    deduped_images: list[dict] = []
    for att in images:
        sid = att.get("source_id")
        if isinstance(sid, str) and sid:
            if sid in seen:
                continue
            seen.add(sid)
        deduped_images.append(att)
    return deduped_images, deduped_files


def _build_qwen_attachment(obj: dict, default_kind: str) -> Optional[dict]:
    if not isinstance(obj, dict):
        return None

    meta = obj.get("meta") if isinstance(obj.get("meta"), dict) else {}

    name = None
    for key in ("filename", "name", "fileName", "file_name"):
        v = obj.get(key)
        if isinstance(v, str) and v:
            name = v; break
    if not name and isinstance(meta.get("name"), str) and meta["name"]:
        name = meta["name"]

    fid = None
    for key in ("id", "file_id", "fileId"):
        v = obj.get(key)
        if isinstance(v, str) and v:
            fid = v; break
    if not fid and isinstance(meta.get("id"), str) and meta["id"]:
        fid = meta["id"]

    mime = None
    for key in ("mime", "mime_type", "mimeType", "content_type"):
        v = obj.get(key)
        if isinstance(v, str) and v:
            mime = v; break
    if not mime and isinstance(meta.get("content_type"), str) and meta["content_type"]:
        mime = meta["content_type"]
    if not isinstance(mime, str):
        mime = None

    size = None
    for key in ("size", "file_size", "fileSize"):
        v = obj.get(key)
        if isinstance(v, (int, float)):
            size = v; break
    if size is None and isinstance(meta.get("size"), (int, float)):
        size = meta["size"]

    url = None
    for key in ("url", "download_url", "file_url"):
        v = obj.get(key)
        if isinstance(v, str) and v:
            url = v; break

    file_type = obj.get("file_type") or obj.get("fileType")
    format_hint = None
    if isinstance(file_type, str) and file_type and "/" not in file_type:
        format_hint = file_type

    type_hint = str(obj.get("type", "")).lower()
    if type_hint.startswith("image"):
        kind = "image"
    else:
        kind = _classify_attachment_kind(name, mime)
        if default_kind == "image" and kind == "file":
            kind = "image"

    att = {
        "kind":       kind,
        "source":     "qwen",
        "source_id":  fid,
        "source_url": _sanitize_source_url(url),
        "name":       name,
        "mime":       mime,
        "size":       int(size) if size is not None else None,
        "status":     "missing",
    }
    if format_hint:
        att["format_hint"] = format_hint
    return att


def _normalize_attachment_for_hash(att: Any) -> dict:
    if not isinstance(att, dict):
        return {"_non_dict": str(att)}
    norm = {
        "kind":      att.get("kind"),
        "name":      att.get("name"),
        "source":    att.get("source"),
        "source_id": att.get("source_id"),
        "size":      att.get("size"),
        "mime":      att.get("mime"),
    }
    url = att.get("url")
    if isinstance(url, str):
        norm["url_sha"] = hashlib.sha256(url.encode("utf-8")).hexdigest()
    text = att.get("text")
    if isinstance(text, str):
        norm["text_sha"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    aid = att.get("id")
    if isinstance(aid, str):
        norm["content_id"] = aid
    return norm


def compute_content_hash_v1(messages: list[dict]) -> str:
    normalized = [
        {
            "role": m.get("role"),
            "text": m.get("text", ""),
            "reasoning": m.get("reasoning"),
            "images": m.get("images"),
            "files": m.get("files"),
        }
        for m in messages
    ]
    payload = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_content_hash_v2(messages: list[dict]) -> str:
    normalized = []
    for m in messages:
        images_val = m.get("images")
        images_norm = [_normalize_attachment_for_hash(a) for a in images_val] if images_val else images_val
        files_val = m.get("files")
        files_norm = [_normalize_attachment_for_hash(a) for a in files_val] if files_val else files_val
        normalized.append({
            "role": m.get("role"),
            "text": m.get("text", ""),
            "reasoning": m.get("reasoning"),
            "images": images_norm,
            "files": files_norm,
        })
    payload = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_content_hash(messages: list[dict]) -> str:
    return compute_content_hash_v2(messages)


def get_hash_version(chat: dict) -> int:
    v = chat.get("source_content_hash_version")
    if isinstance(v, int) and v >= 2:
        return v
    return 1


def _is_valid_chat_structure(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    if "id" not in data or "messages" not in data:
        return False
    if not isinstance(data["messages"], list):
        return False
    return True


def sanitize_id(oid: str, target_dir: Path, source_prefix: str) -> tuple[str, bool]:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", str(oid))[:100] or "unknown"
    local_id = f"{source_prefix}-{safe}"
    target_path = target_dir / f"{local_id}.json"
    if target_path.exists():
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            if not _is_valid_chat_structure(existing):
                return local_id, True
            if existing.get("original_id") == oid:
                return local_id, False
            suffix = hashlib.md5(oid.encode()).hexdigest()[:6]
            local_id = f"{source_prefix}-{safe}_{suffix}"
            alt_path = target_dir / f"{local_id}.json"
            if alt_path.exists():
                try:
                    with open(alt_path, "r", encoding="utf-8") as f:
                        alt_existing = json.load(f)
                    if not _is_valid_chat_structure(alt_existing):
                        return local_id, True
                except Exception:
                    return local_id, True
            return local_id, False
        except Exception:
            return local_id, True
    return local_id, False


def chain_to_root(mapping: dict, node_id: str) -> tuple[list[str], bool]:
    chain = []
    visited = set()
    has_branches = False
    current = node_id
    while current and current in mapping and current not in visited:
        visited.add(current)
        chain.append(current)
        node = mapping[current]
        children = node.get("children") or node.get("childrenIds") or []
        if len(children) > 1:
            has_branches = True
        current = node.get("parent") or node.get("parentId")
    chain.reverse()
    return chain, has_branches


def traverse_mapping_fallback(mapping: dict) -> tuple[list[dict], bool]:
    nodes = []
    has_branches = False
    root_id = None
    if "root" in mapping:
        root_id = "root"
    else:
        for mid, node in mapping.items():
            parent = node.get("parent") or node.get("parentId")
            if parent is None or parent == "" or parent == "root":
                if mid != "root" and parent not in (None, "", "root"):
                    continue
                root_id = mid
                break
        if not root_id:
            for mid, node in mapping.items():
                p = node.get("parent") or node.get("parentId")
                if p is None or p not in mapping:
                    root_id = mid
                    break
    current_id = root_id
    visited = set()
    while current_id and current_id in mapping and current_id not in visited:
        visited.add(current_id)
        node = mapping[current_id]
        nodes.append(node)
        children = node.get("children") or node.get("childrenIds") or []
        if len(children) > 1:
            has_branches = True
        current_id = children[0] if children else None
    return nodes, has_branches


def parse_deepseek(data: list[dict]) -> list[dict]:
    chats = []
    for conv in data:
        try:
            original_id = conv.get("id")
            title = conv.get("title") or "Untitled"
            chat_updated_at = normalize_timestamp(conv.get("updated_at") or conv.get("inserted_at"))
            model = conv.get("model") or "deepseek"
            if not original_id:
                continue
            mapping = conv.get("mapping", {})
            raw_nodes, has_branches = traverse_mapping_fallback(mapping)
            messages = []
            chat_raw_files = 0
            chat_raw_images = 0
            chat_deduped_files = 0
            chat_deduped_images = 0

            for node in raw_nodes:
                msg = node.get("message")
                if not msg:
                    continue
                fragments = msg.get("fragments", [])
                role = None
                content_parts = []
                reasoning_parts = []
                images = []
                files = []
                found_request = False
                found_response = False

                for frag in fragments:
                    if not isinstance(frag, dict):
                        continue
                    f_type = str(frag.get("type", "")).upper()
                    if f_type in ("REQUEST", "RESPONSE", "THINK"):
                        text = normalize_content(frag.get("content", ""))
                        if f_type == "REQUEST":
                            found_request = True
                            content_parts.append(text)
                        elif f_type == "RESPONSE":
                            found_response = True
                            content_parts.append(text)
                        else:
                            reasoning_parts.append(text)
                    elif f_type == "FILE":
                        items = frag.get("files") or []
                        if not isinstance(items, list):
                            continue
                        for item in items:
                            if not isinstance(item, dict):
                                continue
                            name = (item.get("file_name")
                                    or item.get("fileName")
                                    or item.get("name"))
                            fid = (item.get("file_id")
                                   or item.get("fileId")
                                   or item.get("id"))
                            size = (item.get("file_size") if isinstance(item.get("file_size"), (int, float)) else
                                    item.get("fileSize") if isinstance(item.get("fileSize"), (int, float)) else
                                    item.get("size") if isinstance(item.get("size"), (int, float)) else None)
                            kind = _classify_attachment_kind(name)
                            att = {
                                "kind":      kind,
                                "source":    "deepseek",
                                "source_id": fid,
                                "name":      name,
                                "size":      int(size) if size is not None else None,
                                "status":    "missing",
                            }
                            (images if kind == "image" else files).append(att)
                    elif f_type == "IMAGE":
                        name = frag.get("name") or frag.get("fileName")
                        images.append({
                            "kind":      "image",
                            "source":    "deepseek",
                            "source_id": frag.get("id"),
                            "name":      name,
                            "size":      None,
                            "status":    "missing",
                        })

                if not found_request and not found_response:
                    if images or files:
                        print(
                            f"[WARN] DeepSeek {original_id}: сообщение с вложениями "
                            f"без REQUEST/RESPONSE пропущено (роль не определена)",
                            file=sys.stderr,
                        )
                    continue
                role = "user" if found_request else "assistant"
                if role not in ("user", "assistant"):
                    continue

                chat_raw_images += len(images)
                chat_raw_files += len(files)
                images, files = _dedupe_attachments_message(images, files)
                chat_deduped_images += len(images)
                chat_deduped_files += len(files)

                if content_parts or reasoning_parts or images or files:
                    entry = {
                        "role": role,
                        "text": "".join(content_parts),
                        "time": normalize_timestamp(msg.get("inserted_at"), fallback=chat_updated_at),
                    }
                    if reasoning_parts:
                        entry["reasoning"] = "".join(reasoning_parts)
                    if images:
                        entry["images"] = images
                    if files:
                        entry["files"] = files
                    messages.append(entry)

            if messages:
                chats.append({
                    "original_id": original_id,
                    "title": title,
                    "messages": messages,
                    "source_updated_at": chat_updated_at,
                    "model": model,
                    "_meta": {
                        "has_attachments": bool(chat_raw_files or chat_raw_images),
                        "has_branches": has_branches,
                        "attachment_stats": {
                            "raw_files":      chat_raw_files,
                            "raw_images":     chat_raw_images,
                            "deduped_files":  chat_deduped_files,
                            "deduped_images": chat_deduped_images,
                        },
                    },
                })
        except Exception as e:
            print(f"[WARN] Ошибка парсинга чата DeepSeek {conv.get('id', '?')}: {e}", file=sys.stderr)
    return chats


def parse_qwen(raw_data: dict) -> list[dict]:
    chats = []
    payload = raw_data.get("data", raw_data)
    items = payload if isinstance(payload, list) else [payload]
    for item in items:
        try:
            chat_obj = item.get("chat", item)
            original_id = item.get("id") or chat_obj.get("id")
            title = item.get("title") or chat_obj.get("title") or "Untitled"
            chat_updated_at = normalize_timestamp(item.get("updated_at"))
            if not original_id:
                continue
            history = chat_obj.get("history", {})
            msgs_map = history.get("messages", {})
            root_id = None
            for mid, mdata in msgs_map.items():
                if isinstance(mdata, dict) and mdata.get("parentId") is None:
                    root_id = mid
                    break
            messages = []
            has_branches = False
            visited = set()
            current_id = root_id
            chat_raw_files = 0
            chat_raw_images = 0
            chat_deduped_files = 0
            chat_deduped_images = 0

            while current_id and current_id in msgs_map and current_id not in visited:
                visited.add(current_id)
                mdata = msgs_map[current_id]
                children = mdata.get("childrenIds", [])
                if len(children) > 1:
                    has_branches = True
                role = mdata.get("role")
                content = normalize_content(mdata.get("content", ""))

                images = []
                files = []

                for f in mdata.get("files") or []:
                    att = _build_qwen_attachment(f, default_kind="file")
                    if att is None:
                        continue
                    (images if att["kind"] == "image" else files).append(att)

                for im in mdata.get("images") or []:
                    att = _build_qwen_attachment(im, default_kind="image")
                    if att is not None:
                        images.append(att)

                content_list = mdata.get("content")
                if isinstance(content_list, list):
                    for block in content_list:
                        if not isinstance(block, dict):
                            continue
                        b_type = str(block.get("type", "")).lower()
                        if b_type in ("image", "image_url"):
                            att = _build_qwen_attachment(block, default_kind="image")
                            if att:
                                images.append(att)
                        elif b_type in ("file", "attachment"):
                            att = _build_qwen_attachment(block, default_kind="file")
                            if att:
                                (images if att["kind"] == "image" else files).append(att)

                chat_raw_images += len(images)
                chat_raw_files += len(files)
                images, files = _dedupe_attachments_message(images, files)
                chat_deduped_images += len(images)
                chat_deduped_files += len(files)

                if role in ("user", "assistant") and (content or images or files):
                    ts = mdata.get("created_at") or mdata.get("timestamp") or mdata.get("createTime")
                    entry = {
                        "role": role,
                        "text": content,
                        "time": normalize_timestamp(ts, fallback=chat_updated_at),
                    }
                    if images:
                        entry["images"] = images
                    if files:
                        entry["files"] = files
                    messages.append(entry)

                current_id = children[0] if children else None

            if messages:
                chats.append({
                    "original_id": original_id,
                    "title": title,
                    "messages": messages,
                    "source_updated_at": chat_updated_at,
                    "model": "qwen",
                    "_meta": {
                        "has_attachments": bool(chat_raw_files or chat_raw_images),
                        "has_branches": has_branches,
                        "attachment_stats": {
                            "raw_files":      chat_raw_files,
                            "raw_images":     chat_raw_images,
                            "deduped_files":  chat_deduped_files,
                            "deduped_images": chat_deduped_images,
                        },
                    },
                })
        except Exception as e:
            print(f"[WARN] Ошибка парсинга чата Qwen {item.get('id', '?')}: {e}", file=sys.stderr)
    return chats


def parse_chatgpt(data: list[dict]) -> list[dict]:
    chats = []
    for conv in data:
        try:
            original_id = conv.get("id")
            title = conv.get("title") or "Untitled"
            chat_updated_at = normalize_timestamp(conv.get("update_time") or conv.get("create_time"))
            if not original_id:
                continue
            mapping = conv.get("mapping", {})
            current_node = conv.get("current_node")
            has_branches = False
            raw_nodes = []
            if current_node and current_node in mapping:
                chain_ids, has_branches = chain_to_root(mapping, current_node)
                raw_nodes = [mapping[nid] for nid in chain_ids]
            else:
                raw_nodes, has_branches_fb = traverse_mapping_fallback(mapping)
                has_branches = has_branches or has_branches_fb

            messages = []
            has_attachments = False
            chat_raw_images = 0
            chat_deduped_images = 0

            for node in raw_nodes:
                msg = node.get("message")
                if not msg or not msg.get("content"):
                    continue
                author = msg.get("author", {})
                role = author.get("role")
                if role not in ("user", "assistant"):
                    continue
                content = msg["content"]
                text_parts = []
                images = []
                parts = content.get("parts", [])
                for part in parts:
                    if isinstance(part, str):
                        text_parts.append(part)
                    elif isinstance(part, dict):
                        if part.get("text"):
                            text_parts.append(part["text"])
                        elif part.get("content_type") == "image_asset_pointer":
                            asset = part.get("asset_pointer")
                            images.append({
                                "kind":      "image",
                                "source":    "chatgpt",
                                "source_id": asset,
                                "name":      asset,
                                "status":    "missing",
                            })
                            has_attachments = True
                text = "".join(text_parts)

                if images:
                    chat_raw_images += len(images)
                    images, _ = _dedupe_attachments_message(images, [])
                    chat_deduped_images += len(images)

                if text.strip() or images:
                    entry = {
                        "role": role,
                        "text": text,
                        "time": normalize_timestamp(msg.get("create_time"), fallback=chat_updated_at),
                    }
                    if images:
                        entry["images"] = images
                    messages.append(entry)

            if messages:
                meta = {
                    "has_attachments": has_attachments,
                    "has_branches": has_branches,
                    "attachment_stats": {
                        "raw_files":      0,
                        "raw_images":     chat_raw_images,
                        "deduped_files":  0,
                        "deduped_images": chat_deduped_images,
                    },
                }
                if not current_node:
                    meta["warning"] = "current_node missing, used children[0] fallback"
                chats.append({
                    "original_id": original_id,
                    "title": title,
                    "messages": messages,
                    "source_updated_at": chat_updated_at,
                    "model": "chatgpt",
                    "_meta": meta,
                })
        except Exception as e:
            print(f"[WARN] Ошибка парсинга чата ChatGPT {conv.get('id', '?')}: {e}", file=sys.stderr)
    return chats


def _count_deepseek_all_branches(data: Any) -> dict:
    files_t = 0
    images_t = 0
    if not isinstance(data, list):
        return {"raw_files": 0, "raw_images": 0}
    for conv in data:
        if not isinstance(conv, dict):
            continue
        mapping = conv.get("mapping") or {}
        if not isinstance(mapping, dict):
            continue
        for node in mapping.values():
            if not isinstance(node, dict):
                continue
            msg = node.get("message")
            if not isinstance(msg, dict):
                continue
            for frag in msg.get("fragments") or []:
                if not isinstance(frag, dict):
                    continue
                f_type = str(frag.get("type", "")).upper()
                if f_type == "FILE":
                    for item in frag.get("files") or []:
                        if not isinstance(item, dict):
                            continue
                        name = (item.get("file_name")
                                or item.get("fileName")
                                or item.get("name"))
                        if _classify_attachment_kind(name) == "image":
                            images_t += 1
                        else:
                            files_t += 1
                elif f_type == "IMAGE":
                    images_t += 1
    return {"raw_files": files_t, "raw_images": images_t}


def _count_qwen_all_branches(data: Any) -> dict:
    files_t = 0
    images_t = 0
    items = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), list) else data
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        return {"raw_files": 0, "raw_images": 0}
    for item in items:
        if not isinstance(item, dict):
            continue
        chat = item.get("chat", item)
        if not isinstance(chat, dict):
            continue
        history = chat.get("history") or item.get("history") or {}
        msgs_map = history.get("messages") if isinstance(history, dict) else None
        if not isinstance(msgs_map, dict):
            alt = chat.get("messages")
            msgs_map = alt if isinstance(alt, dict) else {}
        if not isinstance(msgs_map, dict):
            continue
        for mdata in msgs_map.values():
            if not isinstance(mdata, dict):
                continue
            for f in mdata.get("files") or []:
                att = _build_qwen_attachment(f, default_kind="file")
                if att is None:
                    continue
                if att["kind"] == "image":
                    images_t += 1
                else:
                    files_t += 1
            for im in mdata.get("images") or []:
                if _build_qwen_attachment(im, default_kind="image") is not None:
                    images_t += 1
            cl = mdata.get("content")
            if isinstance(cl, list):
                for block in cl:
                    if not isinstance(block, dict):
                        continue
                    b_type = str(block.get("type", "")).lower()
                    if b_type in ("image", "image_url"):
                        if _build_qwen_attachment(block, default_kind="image"):
                            images_t += 1
                    elif b_type in ("file", "attachment"):
                        att = _build_qwen_attachment(block, default_kind="file")
                        if att:
                            if att["kind"] == "image":
                                images_t += 1
                            else:
                                files_t += 1
    return {"raw_files": files_t, "raw_images": images_t}


def load_existing_chat(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not _is_valid_chat_structure(data):
            print(f"  [CORRUPT] {path.name}: invalid structure", file=sys.stderr)
            return None
        return data
    except json.JSONDecodeError as e:
        print(f"  [CORRUPT] {path.name}: invalid JSON ({e})", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [ERROR] {path.name}: read failed ({e})", file=sys.stderr)
        return None


def backup_chat(path: Path, backup_dir: Path):
    if path.exists():
        backup_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        dest = backup_dir / f"{path.stem}_{ts}{path.suffix}"
        shutil.copy2(path, dest)


def import_chats(
    input_file: Path,
    chats_dir: Path,
    backup_dir: Path,
    source: str,
    dry_run: bool = False,
    force: bool = False,
):
    print(f"[INFO] Чтение {input_file}...")
    with open(input_file, "r", encoding="utf-8") as f:
        raw = json.load(f)

    parsers = {"deepseek": parse_deepseek, "qwen": parse_qwen, "chatgpt": parse_chatgpt}
    parsed = parsers[source](raw)
    print(f"[INFO] Распознано {len(parsed)} чатов в архиве.")

    main_raw_files = main_raw_images = 0
    main_deduped_files = main_deduped_images = 0
    for c in parsed:
        ms = c.get("_meta", {}).get("attachment_stats", {}) or {}
        main_raw_files      += ms.get("raw_files", 0)
        main_raw_images     += ms.get("raw_images", 0)
        main_deduped_files  += ms.get("deduped_files", 0)
        main_deduped_images += ms.get("deduped_images", 0)

    all_files = all_images = None
    if dry_run:
        if source == "deepseek":
            branch = _count_deepseek_all_branches(raw)
        elif source == "qwen":
            branch = _count_qwen_all_branches(raw)
        else:
            branch = {"raw_files": 0, "raw_images": 0}
        all_files = branch["raw_files"]
        all_images = branch["raw_images"]

    stats = {
        "new": 0, "updated": 0, "migrated": 0,
        "skipped_local": 0, "skipped_dup": 0, "skipped_corrupt": 0,
        "att_files_imported": 0, "att_images_imported": 0,
    }

    for chat in parsed:
        oid = chat["original_id"]
        local_id, is_corrupt = sanitize_id(oid, chats_dir, source)
        target_path = chats_dir / f"{local_id}.json"
        meta = chat.pop("_meta", {})
        astats = meta.get("attachment_stats", {}) or {}
        chat_deduped_files = astats.get("deduped_files", 0)
        chat_deduped_images = astats.get("deduped_images", 0)

        if is_corrupt:
            stats["skipped_corrupt"] += 1
            if dry_run:
                print(f"  [SKIP-CORRUPT] {chat['title']} ({local_id})")
            continue

        new_hash = compute_content_hash_v2(chat["messages"])
        existing = load_existing_chat(target_path)

        if existing is None and target_path.exists():
            stats["skipped_corrupt"] += 1
            if dry_run:
                print(f"  [SKIP-CORRUPT] {chat['title']} ({local_id})")
            continue

        action = "NEW"
        is_format_migration = False
        is_locally_modified = False

        if existing:
            ex_version = get_hash_version(existing)
            existing_hash_meta = existing.get("source_content_hash")

            if existing.get("original_id") != oid:
                stats["skipped_corrupt"] += 1
                if dry_run:
                    print(f"  [SKIP-ID-MISMATCH] {chat['title']}")
                continue

            if ex_version == 1:
                existing_content_hash = compute_content_hash_v1(existing.get("messages", []))
            else:
                existing_content_hash = compute_content_hash_v2(existing.get("messages", []))

            is_locally_modified = (
                (existing_content_hash != existing_hash_meta)
                if existing_hash_meta else True
            )

            if is_locally_modified and not force:
                stats["skipped_local"] += 1
                if dry_run:
                    print(f"  [SKIP-LOCAL] {chat['title']} (локальные правки или старый формат, нужен --force)")
                continue

            existing_has_att = any(
                (m.get("images") or m.get("files"))
                for m in existing.get("messages", [])
                if isinstance(m, dict)
            )
            new_has_att = any(
                (m.get("images") or m.get("files"))
                for m in chat["messages"]
                if isinstance(m, dict)
            )
            is_format_migration = (ex_version == 1 and (existing_has_att or new_has_att))

            if is_format_migration:
                action = "UPDATE"
            elif existing_hash_meta and existing_hash_meta == new_hash:
                stats["skipped_dup"] += 1
                if dry_run:
                    print(f"  [SKIP-DUP] {chat['title']} (без изменений)")
                continue
            else:
                action = "UPDATE"

        if dry_run:
            label = action
            if is_format_migration:
                label = "MIGRATE-FMT"
            if is_locally_modified:
                label += " --force"
            notes = []
            if meta.get("has_branches"):
                notes.append("ветки")
            notes.append(f"raw files={astats.get('raw_files',0)} imgs={astats.get('raw_images',0)}, "
                         f"deduped files={chat_deduped_files} imgs={chat_deduped_images}")
            print(f"  [{label}] {chat['title']} ({len(chat['messages'])} msgs) {' '.join(notes)}")
            if action == "NEW":
                stats["new"] += 1
            elif action == "UPDATE":
                if is_format_migration:
                    stats["migrated"] += 1
                else:
                    stats["updated"] += 1
            if action in ("NEW", "UPDATE"):
                stats["att_files_imported"] += chat_deduped_files
                stats["att_images_imported"] += chat_deduped_images
            continue

        now = datetime.now(timezone.utc).isoformat()
        strawberry_chat = {
            "id": local_id,
            "title": chat["title"],
            "source": source,
            "original_id": oid,
            "source_updated_at": chat.get("source_updated_at"),
            "source_message_count": len(chat["messages"]),
            "source_content_hash": new_hash,
            "source_content_hash_version": 2,
            "created_at": existing.get("created_at", now) if existing else now,
            "updated_at": now,
            "model": chat.get("model", source),
            "messages": chat["messages"],
        }

        chats_dir.mkdir(parents=True, exist_ok=True)
        if existing:
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup_chat(target_path, backup_dir)

        tmp_path = target_path.with_suffix(".tmp")
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(strawberry_chat, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, target_path)
            if action == "NEW":
                stats["new"] += 1
            elif action == "UPDATE":
                if is_format_migration:
                    stats["migrated"] += 1
                else:
                    stats["updated"] += 1
            if action in ("NEW", "UPDATE"):
                stats["att_files_imported"] += chat_deduped_files
                stats["att_images_imported"] += chat_deduped_images
        except Exception as e:
            print(f"[ERROR] Запись {local_id}: {e}", file=sys.stderr)
            if tmp_path.exists():
                tmp_path.unlink()

    print("\n=== Вложения ===")
    print(f"Main chain, raw:           files={main_raw_files}, images={main_raw_images}")
    print(f"Записано в JSON (deduped): files={main_deduped_files}, images={main_deduped_images}")
    dropped_f = main_raw_files - main_deduped_files
    dropped_i = main_raw_images - main_deduped_images
    if dropped_f or dropped_i:
        print(f"Отброшено дедупликацией:   files={dropped_f}, images={dropped_i} "
              f"(один source_id в разных полях одного сообщения)")
    if all_files is not None:
        print(f"В архиве, все ветки, raw:  files={all_files}, images={all_images}")
        print(f"Вне main chain:            files={all_files - main_raw_files}, "
              f"images={all_images - main_raw_images}")

    print("\n=== Результаты ===")
    print(f"Новых:                        {stats['new']}")
    print(f"Обновлено (источник):         {stats['updated']}")
    print(f"Обновлено (миграция v1→v2):   {stats['migrated']}")
    print(f"Пропущено (локальные правки): {stats['skipped_local']}")
    print(f"Пропущено (без изменений):    {stats['skipped_dup']}")
    print(f"Пропущено (повреждённые):     {stats['skipped_corrupt']}")
    if dry_run:
        print(f"Вложений попадёт в JSON:      files={stats['att_files_imported']}, "
              f"images={stats['att_images_imported']} (status='missing')")
        print("(Режим DRY-RUN: файлы не изменены)")
    else:
        print(f"Вложений сохранено в JSON:    files={stats['att_files_imported']}, "
              f"images={stats['att_images_imported']} (status='missing', байты отсутствуют в архиве)")


def main():
    parser = argparse.ArgumentParser(description="Strawberry Chat Importer v1.4.1-stageB")
    parser.add_argument("input", type=Path, help="Путь к JSON-файлу экспорта")
    script_dir = Path(__file__).resolve().parent
    default_chats = script_dir / "chats"
    default_backup = script_dir / "backup"
    parser.add_argument("--chats-dir", type=Path, default=default_chats)
    parser.add_argument("--backup-dir", type=Path, default=default_backup)
    parser.add_argument("--source", choices=["deepseek", "qwen", "chatgpt"], required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not args.input.exists():
        print(f"[ERROR] Файл не найден: {args.input}", file=sys.stderr)
        sys.exit(1)
    import_chats(
        input_file=args.input,
        chats_dir=args.chats_dir,
        backup_dir=args.backup_dir,
        source=args.source,
        dry_run=args.dry_run,
        force=args.force,
    )


if __name__ == "__main__":
    main()