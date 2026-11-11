#!/usr/bin/env bash
# Yayın paketi: itch.io / GitHub Pages için yalnız oyun dosyalarını içeren zip üretir.
# Kullanım (repo kökünden):  bash tools/paket.sh   →  dist/KantinSim-web.zip
set -euo pipefail
cd "$(dirname "$0")/.."
for f in js/*.js; do node --check "$f"; done
node --check sw.js
rm -rf dist && mkdir -p dist/KantinSim
cp -r index.html favicon.svg LICENSE.md manifest.webmanifest sw.js icons css js dist/KantinSim/
# Önbellek sürümü: her pakette değişsin ki oyuncular eski dosyaları görmesin
STAMP="$(date +%Y%m%d%H%M)"
sed -i "s/const CACHE_VERSION = 'dev';/const CACHE_VERSION = '$STAMP';/" dist/KantinSim/sw.js
grep -q "kantinsim-$STAMP" dist/KantinSim/sw.js
(cd dist/KantinSim && zip -qr ../KantinSim-web.zip .)
echo "Hazır: dist/KantinSim-web.zip ($(du -h dist/KantinSim-web.zip | cut -f1)) — index.html zip'in kökünde."
