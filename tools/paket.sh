#!/usr/bin/env bash
# Yayın paketi: itch.io / GitHub Pages için yalnız oyun dosyalarını içeren zip üretir.
# Kullanım (repo kökünden):  bash tools/paket.sh   →  dist/KantinSim-web.zip
set -euo pipefail
cd "$(dirname "$0")/.."
for f in js/*.js; do node --check "$f"; done
rm -rf dist && mkdir -p dist/KantinSim
cp -r index.html favicon.svg css js dist/KantinSim/
(cd dist/KantinSim && zip -qr ../KantinSim-web.zip .)
echo "Hazır: dist/KantinSim-web.zip ($(du -h dist/KantinSim-web.zip | cut -f1)) — index.html zip'in kökünde."
