"""Generate the white-on-transparent navbar variant from public/logo.png.

Brand orange (#ff5000) -> pure white. Pre-existing white background -> transparent.
Black drop stays black (it will sit on a white square, which contrasts well with
the dark navy navbar background).

Run:  python scripts/utils/generate_navbar_logo.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "public" / "logo.png"
DST = ROOT / "public" / "logo-navbar.png"

ORANGE = (255, 80, 0)  # #ff5000
WHITE  = (255, 255, 255)

def color_distance(p, target):
    return ((p[0]-target[0])**2 + (p[1]-target[1])**2 + (p[2]-target[2])**2) ** 0.5

def main():
    img = Image.open(SRC).convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            d_orange = color_distance((r, g, b), ORANGE)
            d_white  = color_distance((r, g, b), WHITE)
            d_black  = color_distance((r, g, b), (0, 0, 0))

            # Closest-color recolor with anti-alias preservation.
            # 1. Pixels close to orange -> white.
            # 2. Pixels close to white -> transparent (we drop them; navbar bg shows).
            # 3. Pixels close to black -> stay (the drop).
            # 4. Mixed/anti-aliased pixels -> remap by nearest-neighbor of {orange, white, black}.
            nearest = min(
                ("orange", d_orange),
                ("white",  d_white),
                ("black",  d_black),
                key=lambda t: t[1],
            )[0]

            if nearest == "orange":
                px[x, y] = (255, 255, 255, a)  # orange -> white, keep alpha
            elif nearest == "white":
                px[x, y] = (255, 255, 255, 0)  # white -> transparent
            else:  # black
                px[x, y] = (0, 0, 0, a)        # black stays black

    img.save(DST, "PNG")
    print(f"Wrote {DST} ({DST.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
