"""Crop timetable images into per-block tiles for OCR.

Each timetable image has 3 day-group blocks stacked horizontally:
 - Mon-Thu, Friday, Sat/Sun/Holidays

Block x-boundaries are auto-detected per image since the leftmost block has a
station-label margin (~350 px) that narrows it.

Within each intermediate-station block there are 2 sub-columns
("To Barra" left, "To TFT" right); the OCR parser splits them after the fact
using the two hour-column x positions detected geometrically.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance
import numpy as np

ROOT = Path(__file__).parent.parent / "timetable_images"
OUT = Path(__file__).parent / "_tmp_crops"
OUT.mkdir(exist_ok=True)

Y_TOP = 400


def detect_block_boundaries(img: Image.Image) -> list[tuple[int, int]]:
    """Return x-ranges for the 3 day-group blocks.

    Finds the 2 interior x-positions with lowest column variance (the gaps
    between blocks) by searching windows near the 1/3 and 2/3 marks.
    """
    a = np.array(img.convert("L"))
    col_var = a[600:2900].std(axis=0)
    W = a.shape[1]
    kernel = np.ones(40) / 40
    smooth = np.convolve(col_var, kernel, mode="same")
    # Search for gap1 near x=W/3, gap2 near x=2W/3; each within ±W/10 window
    def find_gap(center: int, radius: int) -> int:
        lo = max(center - radius, 100)
        hi = min(center + radius, W - 100)
        return lo + int(smooth[lo:hi].argmin())
    gap1 = find_gap(W // 3, W // 10)
    gap2 = find_gap(2 * W // 3, W // 10)
    return [(0, gap1), (gap1, gap2), (gap2, W)]


def _save_2x(img: Image.Image, name: str, scale: int = 2) -> None:
    img = img.resize((img.size[0] * scale, img.size[1] * scale), Image.LANCZOS)
    img.save(OUT / name)


def crop_blocks(img_file: str, label: str, scale: int = 2) -> None:
    """Crop all 3 day-group blocks for a timetable image."""
    img = Image.open(ROOT / img_file)
    W, H = img.size
    y0, y1 = Y_TOP, H
    blocks = detect_block_boundaries(img)
    for sched, (x0, x1) in zip(["mon_thu", "fri", "ssh"], blocks):
        _save_2x(img.crop((x0, y0, x1, y1)), f"{label}_{sched}_block.png", scale)
    print(f"Cropped {label}: blocks at {blocks} (scale={scale}x)")


if __name__ == "__main__":
    import sys
    img, label = sys.argv[1], sys.argv[2]
    crop_blocks(img, label)
