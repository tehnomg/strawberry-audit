"""cleanup-attachments.py — вытаскивает base64-картинки из уже импортированных чатов."""
import json
import re
import base64
import hashlib
from pathlib import Path

BASE_DIR = Path(__file__).parent.resolve()
CHATS_DIR = BASE_DIR / "chats"
ATTACH_DIR = BASE_DIR / "attachments"

IMAGE_B64_RE = re.compile(
    r'!\[([^\]]*)\]\(data:image/([a-zA-Z0-9.+\-]+);base64,([A-Za-z0-9+/=\s]+)\)'
)
_MIME_EXT_MAP = {
    "jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif",
    "webp": "webp", "svg+xml": "svg", "bmp": "bmp",
}


def extract(text, chat_id):
    if "data:image/" not in text:
        return text, 0
    count = [0]
    chat_attach_dir = ATTACH_DIR / chat_id
    
    def replacer(m):
        alt = m.group(1)
        mime = m.group(2).lower()
        b64 = re.sub(r'\s+', '', m.group(3))
        ext = _MIME_EXT_MAP.get(mime, mime.replace("+", "_"))
        try:
            data = base64.b64decode(b64, validate=False)
        except Exception:
            return m.group(0)
        h = hashlib.sha256(data).hexdigest()[:16]
        filename = f"{h}.{ext}"
        filepath = chat_attach_dir / filename
        try:
            chat_attach_dir.mkdir(parents=True, exist_ok=True)
            if not filepath.exists():
                filepath.write_bytes(data)
            count[0] += 1
            return f"![{alt}](/api/attachments/{chat_id}/{filename})"
        except Exception:
            return m.group(0)
    
    return IMAGE_B64_RE.sub(replacer, text), count[0]


def main():
    if not CHATS_DIR.exists():
        print(f"Not found: {CHATS_DIR}")
        return
    total = 0
    modified = 0
    images = 0
    for f in sorted(CHATS_DIR.glob("*.json")):
        total += 1
        chat_id = f.stem
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            changed = False
            for msg in data.get("messages", []):
                t = msg.get("text", "")
                if not t or "data:image/" not in t:
                    continue
                nt, cnt = extract(t, chat_id)
                if nt != t:
                    msg["text"] = nt
                    changed = True
                    images += cnt
            if changed:
                tmp = f.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                tmp.replace(f)
                modified += 1
                print(f"✓ {chat_id}")
        except Exception as e:
            print(f"✗ {chat_id}: {e}")
    print(f"\n=== Done. scanned={total} modified={modified} images={images} ===")


if __name__ == "__main__":
    main()