"""Crop Hengqin block tiles into fixed per-row strips for manual transcription.

Uses grid-line detection: finds horizontal dark lines (table borders) and
crops each inter-line band as one row strip.
"""
from pathlib import Path
from PIL import Image
import numpy as np

CROPS = Path(__file__).parent / "_tmp_crops"
OUT = CROPS / "_rows"
OUT.mkdir(exist_ok=True)


def find_hlines(img: Image.Image) -> list[int]:
    """Y-positions of horizontal grid lines (dense dark rows)."""
    a = np.array(img.convert("L"))
    # A grid line is a mostly-dark row — low mean
    mean = a.mean(axis=1)
    lines = []
    in_line = False
    start = 0
    for y, m in enumerate(mean):
        if m < 180 and not in_line:
            in_line = True
            start = y
        elif m >= 180 and in_line:
            in_line = False
            mid = (start + y) // 2
            lines.append(mid)
    return lines


def crop_rows(block_name: str) -> None:
    img = Image.open(CROPS / block_name)
    W, H = img.size
    lines = find_hlines(img)
    # Filter to lines in the data-grid region: between header (~700) and footer
    data_lines = [y for y in lines if 700 < y < H - 500]
    print(f"{block_name}: {len(data_lines)} grid-lines: {data_lines[:30]}...")
    # Consecutive line pairs define row bands
    for i in range(len(data_lines) - 1):
        y0 = data_lines[i]
        y1 = data_lines[i + 1]
        if y1 - y0 < 150 or y1 - y0 > 300:
            continue
        strip = img.crop((0, y0 - 5, W, y1 + 5))
        strip = strip.resize((strip.size[0] * 2, strip.size[1] * 2), Image.LANCZOS)
        strip.save(OUT / f"{block_name.replace('.png', '')}_row{i:02d}.png")


if __name__ == "__main__":
    for b in ["hqlot_fri_block.png", "hqlot_ssh_block.png",
              "hqhq_fri_block.png", "hqhq_ssh_block.png"]:
        crop_rows(b)
