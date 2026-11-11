#!/usr/bin/env bash
# KantinSim — Android APK derleme (Gradle yok)
#
# Gereken araçlar: Android SDK (build-tools + platforms/android-35) ve JDK 17+.
# Gradle'a ihtiyaç duymaz; aapt2 + javac + d8 + zipalign + apksigner sırayla çalışır.
# Oyun dosyaları olduğu gibi APK'nın assets/ klasörüne kopyalanır.
#
# Kullanım:  tools/android/build.sh [--debug-imza]
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
BT=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)
PLATFORM=$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)
JDK=${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}
JAR="$PLATFORM/android.jar"
OUT="$ROOT/build/android"
DIST="$ROOT/dist"
KEYSTORE="$ROOT/build/android/kantinsim-debug.jks"
KSPASS="kantinsim"

[ -n "$BT" ] || { echo "HATA: build-tools bulunamadı (ANDROID_HOME=$SDK)"; exit 1; }
[ -f "$JAR" ] || { echo "HATA: $JAR yok"; exit 1; }
[ -x "$JDK/bin/javac" ] || { echo "HATA: JDK bulunamadı ($JDK)"; exit 1; }

echo "SDK: $SDK"
echo "build-tools: $(basename "$BT")   platform: $(basename "$PLATFORM")"

rm -rf "$OUT" "$DIST"
mkdir -p "$OUT/assets" "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex" "$DIST"

# 1) Oyun varlıkları: yalnız çalışması için gereken dosyalar
for p in index.html favicon.svg manifest.webmanifest icons css js fonts; do
  cp -R "$ROOT/$p" "$OUT/assets/"
done

# 2) Kaynaklar (simge, uygulama adı)
"$BT/aapt2" compile --dir "$ROOT/android/res" -o "$OUT/res/resources.zip"

# 3) Manifest + kaynaklar + assets
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  -R "$OUT/res/resources.zip" \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 35 \
  --version-code 1 \
  --version-name 1.0.0 \
  --auto-add-overlay

# 4) Java kaynakları
"$JDK/bin/javac" -source 8 -target 8 -Xlint:-options \
  -bootclasspath "$JAR" \
  -classpath "$OUT/gen" \
  -d "$OUT/classes" \
  $(find "$ROOT/android/src" "$OUT/gen" -name '*.java')

# 5) DEX
"$BT/d8" --lib "$JAR" --min-api 24 --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && zip -q ../base.apk classes.dex)

# 6) Hizalama + imza
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "Yerel imza anahtarı üretiliyor (yalnız geliştirme için): $KEYSTORE"
  "$JDK/bin/keytool" -genkeypair -keystore "$KEYSTORE" -alias kantinsim \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KSPASS" -keypass "$KSPASS" \
    -dname "CN=KantinSim, OU=Gelistirme, O=KimliksizPro, L=Istanbul, C=TR" >/dev/null 2>&1
fi

APK="$DIST/KantinSim-1.0.0.apk"
"$BT/apksigner" sign \
  --ks "$KEYSTORE" --ks-pass "pass:$KSPASS" --key-pass "pass:$KSPASS" \
  --min-sdk-version 24 \
  --out "$APK" "$OUT/aligned.apk"

"$BT/apksigner" verify --print-certs "$APK" | head -3
echo
echo "APK: $APK ($(du -h "$APK" | cut -f1))"
