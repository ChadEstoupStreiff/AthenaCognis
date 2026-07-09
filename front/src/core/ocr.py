import io
from urllib.parse import quote

import requests
from PIL import Image, ImageDraw, ImageFont


def _open_image(file: str) -> Image.Image:
    # Try local path, else try your backend (adjust endpoint if needed)
    try:
        return Image.open(file).convert("RGB")
    except Exception:
        encoded_file_name = quote(file)
        resp = requests.get(
            f"http://back:80/files/download/{encoded_file_name}", timeout=20
        )
        resp.raise_for_status()
        return Image.open(io.BytesIO(resp.content)).convert("RGB")


def _bbox_from_any(b, W, H):
    # b can be [x1,y1,x2,y2] or [[x,y],... polygon]
    # Detect normalized coords and scale if needed.
    if isinstance(b, dict) and "bbox" in b:
        b = b["bbox"]

    if isinstance(b, (list, tuple)) and len(b) >= 4:
        # polygon -> flatten
        if all(isinstance(p, (list, tuple)) and len(p) == 2 for p in b):
            xs, ys = [p[0] for p in b], [p[1] for p in b]
            x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        else:
            x1, y1, x2, y2 = b[0], b[1], b[2], b[3]
        # normalize if looks like 0..1
        if max(x1, y1, x2, y2) <= 1.05:
            x1, x2 = x1 * W, x2 * W
            y1, y2 = y1 * H, y2 * H
        return (int(max(0, x1)), int(max(0, y1)), int(min(W, x2)), int(min(H, y2)))
    # Fallback: whole image
    return (0, 0, W, H)

def _get_font(size: int = 16):
    # Use a font with full Unicode support
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        # fallback if font not available
        return ImageFont.load_default()
    
def _draw_label(draw: ImageDraw.ImageDraw, xyxy, text, scale=1.0):
    x1, y1, x2, y2 = xyxy
    # Box
    draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=max(1, int(2 * scale)))
    # Text bg
    font = _get_font(max(12, int(20 * scale)))
    tw, th = draw.textbbox((0, 0), text, font=font)[2:]
    pad = max(2, int(2 * scale))
    tx, ty = x1, max(0, y1 - th - 2 * pad)
    draw.rectangle([tx, ty, tx + tw + 2 * pad, ty + th + 2 * pad], fill=(255, 255, 255))
    draw.text((tx + pad, ty + pad), text, fill=(0, 0, 0), font=font)
