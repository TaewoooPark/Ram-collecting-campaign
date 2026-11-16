"""Rebuild the small scene previews from the finished WebPs (requires Pillow)."""
import base64
from io import BytesIO
import json
from pathlib import Path

from PIL import Image

scenes = Path(__file__).resolve().parents[1] / "public" / "scenes"
out = scenes / "previews"
out.mkdir(exist_ok=True)
for suffix in ("", "-p"):
    files = sorted(scenes.glob(f"[0-9][0-9]{suffix}.webp"))
    for offset in range(0, len(files), 10):
        frames = []
        for path in files[offset:offset + 10]:
            with Image.open(path) as image:
                image.thumbnail((224, 280), Image.Resampling.LANCZOS)
                encoded = BytesIO()
                image.save(encoded, "WEBP", quality=40, method=5)
                frames.append(base64.b64encode(encoded.getvalue()).decode("ascii"))
        (out / f"{offset + 1:02d}{suffix}.mjs").write_text(
            "export default " + json.dumps(frames, indent=0) + ";\n", encoding="ascii"
        )
