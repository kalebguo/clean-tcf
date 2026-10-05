"""Second OCR pass over the reading images with PaddleOCR-VL-1.6 (MLX, runs locally).

Used to cross-check the macOS Vision OCR in data/ocr/: words both engines agree on
are trusted, disagreements go to review. PaddleOCR-VL also reads multi-column
layouts in the right order, which Vision's line boxes do not.

Usage: .venv/bin/python scripts/ocr_vlm.py <out_dir> <image>...   → <out_dir>/<name>.txt
Images already done are skipped. To run in parallel, give each process a disjoint share of the images.
"""
import os
import sys
import time
from pathlib import Path

from PIL import Image
from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template

MODEL = "translate-studio/PaddleOCR-VL-1.6-8bit"   # 8-bit: 4-bit is prone to repetition loops


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    todo = [Path(p) for p in sys.argv[2:] if not (out / (Path(p).stem + ".txt")).exists()]
    if not todo:
        return
    model, processor = load(MODEL)
    prompt = apply_chat_template(processor, model.config, "OCR:", num_images=1)
    tmp = out / f"_flat_{os.getpid()}.png"   # per process, so several shards can run at once
    for i, path in enumerate(todo, 1):
        # Many "jpg" files are PNGs with transparent areas; flatten onto white.
        im = Image.open(path).convert("RGBA")
        bg = Image.new("RGBA", im.size, "white")
        bg.alpha_composite(im)
        bg.convert("RGB").save(tmp)
        t = time.time()
        r = generate(model, processor, prompt, image=[str(tmp)], max_tokens=2000, temperature=0.0, verbose=False)
        (out / (path.stem + ".txt")).write_text(r.text)
        print(f"[{i}/{len(todo)}] {path.name} {time.time() - t:.1f}s", flush=True)
    tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
