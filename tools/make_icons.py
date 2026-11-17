"""Render the AutoSkip icon (gradient tile + white skip-forward glyph) at all sizes."""
import os
import sys

from PIL import Image, ImageDraw

S = 1024  # draw large, then downsample for clean anti-aliasing
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "autoskip", "icons")
TOP_LEFT = (99, 102, 241)      # indigo
BOTTOM_RIGHT = (168, 85, 247)  # violet


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP_LEFT, BOTTOM_RIGHT))
    return img


def master():
    small = 256
    bg = gradient(small).resize((S, S), Image.BILINEAR)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=255)

    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(icon)
    white = (255, 255, 255, 255)
    top, bottom = S * 0.30, S * 0.70
    mid = (top + bottom) / 2
    d.polygon([(S * 0.20, top), (S * 0.20, bottom), (S * 0.46, mid)], fill=white)
    d.polygon([(S * 0.44, top), (S * 0.44, bottom), (S * 0.70, mid)], fill=white)
    d.rounded_rectangle([S * 0.71, top, S * 0.80, bottom], radius=int(S * 0.02), fill=white)
    return icon


def main():
    os.makedirs(OUT, exist_ok=True)
    big = master()
    for size in (16, 32, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f"icon-{size}.png"))
    print("wrote icons to", os.path.normpath(OUT), file=sys.stderr)


if __name__ == "__main__":
    main()
