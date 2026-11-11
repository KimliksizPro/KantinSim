# KantinSim — Claude Code çalışma rehberi

Okul kantini simülasyonu. Oyuncu tezgahın içinde; servis penceresine gelen öğrenci, öğretmen ve diğer müşterilere
malzemeleri sürükleyip birleştirerek yemek hazırlıyor (tost, köfte ekmek, çay...). Stok, fiyat, temizlik ve itibar yönetiliyor.
**Oyun dili Türkçe**: tüm metinler, kod yorumları ve commit mesajları Türkçe, doğru Türkçe karakterlerle yazılır.

## Platform: web (HTML5 Canvas)

Build adımı yok, dış kütüphane yok. Tüm kod `window.KS` ad alanında, `index.html` içindeki `<script>` sırasıyla yüklenir.
Mantıksal çözünürlük **1600x900**. (Godot'ya geçiş denemesi iptal edildi ve silindi; geliştirme web sürümünde devam ediyor.)

**Önce `CONTRACT.md`'yi oku**: modül arayüzleri, çizim katmanları, item modeli, sürükle-bırak bölgeleri, yerleşim.

## Komutlar

```bash
# Oyunu çalıştır (repo kökünde)
python3 -m http.server 8000      # → http://localhost:8000

# Yayın paketi (itch.io / GitHub Pages): dist/KantinSim-web.zip, index.html zip'in kökünde
bash tools/paket.sh

# Sözdizimi kontrolü (her değişiklikten sonra temiz olmalı)
for f in js/*.js; do node --check "$f" || echo "HATA: $f"; done
```

Claude masaüstü uygulamasında `.claude/launch.json` içindeki `kantinsim-web` yapılandırması (port 8765) önizleme panelinde açar.
Tarayıcı JS dosyalarını önbelleğe alır: değişiklikten sonra `?v=N` ile ya da `fetch(f, {cache:'reload'})` + yeniden yükleme ile aç.

Hızlı test için konsoldan: `KS.game.newGame(); KS.state.tutorialDone = true; KS.game.openShop(); KS.state.speedMult = 10;`
(Arka plandaki önizleme sekmesinde `requestAnimationFrame` kısılabilir; gerekirse `setTimeout` ile değiştir.)

## Dosyalar

| Dosya | Ne |
|---|---|
| `js/data.js` | Tüm oyun verisi: malzemeler, tarifler, ürünler, zil programı, hava, olaylar, geliştirmeler |
| `js/core.js` | Durum, ekonomi, gün akışı, sürükle-bırak bölgeleri, efektler, ana döngü ve çizim sırası |
| `js/recipes.js` | Tarif tanıma ve kalite (`identify`, `evaluate`, `cookQuality`) |
| `js/art.js` | Tüm çizimler + arka plan, parallax, ışık katmanı (`drawLighting`) |
| `js/depth.js` | Derinlik efektleri: güneş huzmeleri, tezgah yansıması/temas gölgesi, yüzey parlaması, ön plan bokeh |
| `js/stations_prep.js`, `js/stations_cook.js` | İstasyonlar (kutular, tezgah, leğen, vitrin, temizlik, çöp / tost, ızgara, fritöz, semaver) |
| `js/customers.js` | Müşteriler, sabır, sipariş, ödeme, müfettiş |
| `js/meta.js` | Hedefler, başarımlar, kampanya, kredi |
| `js/ui.js`, `css/ui.css` | HUD, paneller, eğitim, gün sonu |
| `js/assist.js` | Tarif yardımcısı (H), klavye kısayolları, gün şeridi (zil programı) |
| `js/audio.js` | Prosedürel WebAudio sesleri |
| `sw.js`, `manifest.webmanifest`, `icons/` | Çevrimdışı önbellek ve kurulabilir uygulama (PWA). Önbellek sürümü yayında otomatik damgalanır. |

## Otomatik kayıt

- Hazırlıkta ve gün sonunda kaydedilir; ayrıca oyun sırasında 20 saniyede bir ve sekme kapanırken kaydedilir.
- Gün ortasında çıkılırsa oyun **kaldığı saatten** devam eder (gün baştan başlamaz), böylece ciro/gider dengesi bozulmaz.

## Kurallar

- Modüller `KS.registerModule({name, order, init, update, draw})` ile kayıt olur; başka modülün API'sini çağırmadan önce varlığını kontrol et.
- `draw`/`update` içinde exception fırlatma; isteğe bağlı görsel efektleri `try/catch` ile sar.
- 60 FPS: her karede büyük gradyan üretme, önbelleğe al (offscreen canvas / sprite).
- Görsel efektler "Ayarlar → Işık & derinlik efektleri" (`KS.Art.fxActive()`) kapalıyken çizilmemeli.
- Gölgelerde ışık sol üstten gelir.

## Çalışma döngüsü

1. Küçük bir adım yap.
2. `node --check` temiz olmalı.
3. Görsel değiştiyse önizlemede ekran görüntüsü alıp bak; konsolda hata kalmamalı.
4. Türkçe, açıklayıcı bir mesajla commit et. Kullanıcı istemedikçe push yapma.

Kullanıcıya sadece gerçekten oynayarak anlaşılacak şeyler için danış: oyun hissi, zorluk dengesi, ses, "beğendin mi".

## Notlar

- `shots/` klasörü geçicidir (git'e girmez).
