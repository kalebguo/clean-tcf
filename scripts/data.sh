#!/bin/sh
# Rebuild all site data from the Anki collection. Safe to re-run.
set -e
cd "$(dirname "$0")/.."
PY=.venv/bin/python
MEDIA="$HOME/Library/Application Support/Anki2/User 1/collection.media"
if [ ! -x build/ocr ]; then
  mkdir -p build && swiftc -O scripts/ocr.swift -o build/ocr
fi
mkdir -p data/ocr
# OCR only images that have no result yet
find "$MEDIA" -name 'CE_*' -print0 | xargs -0 -n 40 -P 6 ./build/ocr data/ocr > /dev/null
# Second pass with PaddleOCR-VL (local MLX model, ~1 s per new image), then the checked merge of both
find "$MEDIA" -name 'CE_*' -print0 | xargs -0 $PY scripts/ocr_vlm.py data/ocr_vlm
$PY scripts/merge_ocr.py
$PY scripts/export_anki.py
$PY scripts/vocab_mapreduce.py
$PY scripts/build_site_data.py
# P2: per-question translations / analysis positions for the site (public/data/p2)
$PY scripts/p2/build_p2.py
# Speaking / writing prompts for the site (public/data/oral-writing.json); not in the public repo
if [ -f scripts/oral_writing/build_site.py ]; then $PY scripts/oral_writing/build_site.py; fi
