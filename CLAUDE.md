# KantinSim — Claude Code çalışma rehberi

Okul kantini simülasyonu. Oyuncu tezgahın içinde; servis penceresine gelen öğrenci, öğretmen ve diğer müşterilere
malzemeleri sürükleyip birleştirerek yemek hazırlıyor (tost, köfte ekmek, çay...). Stok, fiyat, temizlik ve itibar yönetiliyor.
**Oyun dili Türkçe**: tüm metinler, kod yorumları ve commit mesajları Türkçe, doğru Türkçe karakterlerle yazılır.

## Şu anki durum: web → Godot geçişi

| Klasör | Ne | Durum |
|---|---|---|
| kök (`index.html`, `js/`, `css/`) | Çalışan **web prototipi** (HTML5 Canvas, ~14 bin satır JS) | **Referans.** Oynanış mantığının kaynağı. Değiştirme; sadece referans olarak oku. |
| `godot/` | **Godot 4.7 projesi** (GDScript) | Oynanabilir tost dilimi hazır: kutular, tezgah (2 tabak), tost makinesi, tek müşteri slotu, uçan para, mini HUD. |
| `tools/export_assets.js` | Web sürümündeki çizimleri PNG'ye, verileri JSON'a aktarır | Çıktısı `godot/assets/` ve `godot/data/game_data.json` |

Hedef: oyunu Godot'da, web sürümünden daha güzel görünecek şekilde (2D ışık/gölge, parallax, partiküller → "2D ama 3D hissi")
yeniden kurmak. Veriler ve tasarım web sürümünden aynen taşınır; kod GDScript ile temiz bir yapıda yeniden yazılır.

## Komutlar

Godot tek bir çalıştırılabilir dosya. Kullanıcı yerini ilk mesajda söyler; bilinmiyorsa sor ve aşağıdaki `GODOT` yerine o yolu kullan.
Windows'ta çıktıyı görebilmek için **`_console.exe`** ile biten dosyayı kullan (örn. `Godot_v4.7.2-stable_win64_console.exe`).
Tüm komutlar repo kökünden.

```bash
# İlk açılışta / yeni görsel eklenince: kaynakları içe aktar (.godot/ önbelleğini üretir)
GODOT --headless --path godot --import

# Testler (bağımlılıksız mini çalıştırıcı; tests/test_*.gd)
GODOT --headless --path godot -s res://tests/run_tests.gd

# Ekran görüntüsü al (pencere açılır, N kare sonra kaydedip kapanır). --headless İLE ÇALIŞMAZ.
GODOT --path godot -- --shot=res://../shots/main.png --frames=60
#   isteğe bağlı: --scene=res://scenes/xyz.tscn   --mouse=800,450 (fare konumu; parallax/hover testi)
#   demo durumları: --tost-demo=1.3 (yuvada o pişme değerinde tost)  --fx-demo  --patience-demo=0.2

# Uçtan uca otomatik oynanış (sahte fareyle tost yapıp müşteriye verir; shots/auto_N.png kaydeder, çıkış kodu 0 = servis başarılı)
GODOT --path godot -- --autoplay

# Oyunu normal çalıştır (kullanıcı oynamak isterse)
GODOT --path godot

# Görselleri/verileri web sürümünden yeniden aktar (Node.js gerekir; bir kere: npm i -D playwright && npx playwright install chromium)
node tools/export_assets.js
```

Linux/bulut ortamında ekran yoksa: `xvfb-run -a -s "-screen 0 1600x900x24" GODOT --path godot --rendering-driver opengl3 -- --shot=...`

## Çalışma döngüsü (her değişiklikte)

1. Küçük bir adım yap (bir istasyon, bir mekanik).
2. Mantık için test yaz/güncelle → testleri çalıştır, hepsi geçmeli.
3. Görsel değiştiyse **ekran görüntüsü al ve PNG'yi açıp bak** (Read aracıyla). Gerekirse `--mouse` ile hover/parallax kontrol et.
4. Konsolda `ERROR`/`SCRIPT ERROR` satırı kalmamalı (ses sürücüsü uyarıları önemsiz).
5. Türkçe, açıklayıcı bir mesajla commit et. Kullanıcı istemedikçe push yapma.

Kullanıcıya sadece gerçekten oynayarak anlaşılacak şeyler için danış: oyun hissi, zorluk dengesi, ses, "beğendin mi".

## Godot proje yapısı ve kurallar

```
godot/
  project.godot          1600x900 mantıksal çözünürlük, stretch=canvas_items, renderer=gl_compatibility
  data/game_data.json    TÜM oyun verisi (web js/data.js + KS.layout). Elle düzenleme; export_assets.js üretir.
  assets/
    ingredients/ products/ dishes/ customers/ icons/ tools/   şeffaf sprite'lar (2x çözünürlük)
    background/          konumlu arka plan katmanları (sky_*, corridor, frame, counter, worktop, station_shadows)
    reference/           web sürümünden ekran görüntüleri (scene_prep.png, station_*.png): görünüm referansı, oyunda kullanılmaz
  scripts/game_data.gd   autoload "GameData": GameData.recipes, .ingredients, .products, .layout, .rect("tost") ...
  scripts/game.gd        autoload "Game": para, envanter, saat, earn/spend, sinyaller (money_changed, earned, float_text ...)
  scripts/drag.gd        autoload "Drag": sürükle-bırak bölgeleri (protokol dosyanın başında: zone_rect, pick, drop, click ...)
  scripts/recipes.gd     Recipes (statik): identify, evaluate, cook_quality, line_label  — web recipes.js karşılığı
  scripts/items.gd       Items (statik): ing / dish / product fabrikaları (item = Dictionary)
  scripts/item_view.gd   ItemView: herhangi bir item'ı çizer (ItemView.draw_item)
  scripts/stations/      bins, tezgah, tost (+ *_logic.gd: sahneden bağımsız, testli saf mantık)
  scripts/customers/     customer_slot + customer_logic (sabır, ödeme, bahşiş)
  scripts/fx/ scripts/ui/   uçan yazı + para efekti, mini HUD
  tools/screenshot.gd    autoload "Shot": --shot argümanıyla otomatik ekran görüntüsü
  tools/autoplay.gd      --autoplay: uçtan uca otomatik oynanış denemesi
  scenes/main.tscn       ana sahne: arka plan katmanları arasına müşteri / istasyon / fx / hud sahnelerini dizer (main.gd)
  tests/                 run_tests.gd (çalıştırıcı), test_case.gd (taban sınıf: check, check_eq, teardown), test_*.gd
```

- Koordinatlar web sürümüyle aynı **1600x900** uzayında. İstasyon yerleri `GameData.rect("tost")` vb. (web `CONTRACT.md` → "Yerleşim").
- Sprite'lar **2x** aktarıldı: `Sprite2D.scale = Vector2.ONE / GameData.sprite_scale`. Arka plan katmanlarının konumu `GameData.background_layers[ad]` (x, y, w, h).
- Her istasyon / müşteri / UI paneli **kendi sahnesi + kendi scripti**. Sahneler arası iletişim sinyallerle veya bir `Game` autoload'u üzerinden; başka sahnenin iç düğümlerine doğrudan erişme.
- Oyun durumu (para, itibar, envanter, saat, gün) tek bir autoload'da (`Game`) toplanır; kayıt sistemi `user://save.json`, **sürüm numaralı** (`"version": 1`) ve eski sürümü okuyabilen göç kodu ile.
- Statik tip kullan (`var x: int`, `-> void`), sihirli sayılar yerine `GameData` veya sabitler.
- Görsel: 2D ışık (`PointLight2D`, `LightOccluder2D`, `CanvasModulate` ile gün saati), `GPUParticles2D` (buhar, duman, cızırtı), `Tween` ile animasyon.
  Gölgelerde ışık sol üstten gelir (web sürümüyle tutarlı).
- Saf mantık autoload'a bağlı olmayan `*_logic.gd` scriptlerinde durur (testler `-s` modunda autoload'suz çalışır).
- Yeni `class_name` ekleyince bir kez `--import` çalıştır (sınıf önbelleği). İncelen/bozulan çokgenler `Geometry2D.triangulate_polygon` ile korunur (bkz. tost.gd `_cpoly`).

## Web sürümünde mantığın nerede olduğu (taşırken oku)

| Konu | Web dosyası | Not |
|---|---|---|
| Veri modeli, sözleşme, yerleşim, item modeli | `CONTRACT.md` | **Önce bunu oku.** |
| Tarif tanıma ve kalite değerlendirme | `js/recipes.js` (`identify`, `evaluate`, `cookQuality`, `layerFromIng`) | Pişme: 0 çiğ, 0.85–1.2 mükemmel, 1.5+ yanık |
| Ekonomi, gün akışı, saat, teslimat, sürükle-bırak bölgeleri | `js/core.js` (`KS.earn`, `KS.spend`, `KS.addRep`, `KS.placeOrder`, `updateTime`, zone sistemi) | |
| Tost, ızgara, fritöz, semaver | `js/stations_cook.js` | `TUNE` sabitleri: pişme süreleri |
| Malzeme kutuları, tezgah/tabaklar, leğen, vitrin, temizlik, çöp | `js/stations_prep.js` | |
| Müşteri üretimi, sabır, sipariş, ödeme, müfettiş | `js/customers.js` (`spawn`, `computePatience`) | |
| Hedefler, başarımlar, kampanya, kredi | `js/meta.js` | |
| HUD, paneller, eğitim, gün sonu | `js/ui.js`, `css/ui.css` | Godot'da `Control` sahneleri + tema |
| Çizimler | `js/art.js` | Artık PNG olarak `godot/assets/`'te |

Web sürümünü tarayıcıda açıp karşılaştırmak için: repo kökünde `python -m http.server 8000` → `http://localhost:8000`.

## Yol haritası

1. ~~Görselleri ve verileri aktar, Godot iskeleti, test + ekran görüntüsü araçları~~ ✅
2. ~~Oynanabilir dilim~~ ✅ (kullanıcı oynayıp geri bildirim verecek: oyun hissi, pişme süresi, sabır):
   - `Game` autoload: para, envanter, saat (08:00–17:00), `earn/spend`.
   - Sürükle-bırak sistemi: eldeki item, bırakma bölgeleri, geçersizse kaynağa dönüş (web `core.js` zone mantığı).
   - Malzeme kutuları (sadece tost ekmeği + kaşar yeterli), tezgahta 2 tabak, **tost makinesi** (kapak aç/kapa, pişme, yanma).
   - Tek müşteri slotu: müşteri gelir, balonda "Kaşarlı Tost", teslimde ödeme + uçan para yazısı.
   - Görsel: arka plan parallax (hazır), istasyonlara gölge, tost makinesine `PointLight2D` parıltısı, buhar partikülü.
   - Testler: tarif tanıma, pişme kalitesi, ödeme. Ekran görüntüsü ile görsel kontrol.
   - Kullanıcıya oynatıp geri bildirim al.
3. **(sıradaki iş)** Kalan istasyonlar: ızgara (iki yüzlü köfte), fritöz, semaver, leğen, vitrin + hazır ürünler, temizlik, çöp.
4. Müşteri sistemi tam hali: 4 slot, kuyruk, tipler, sabır, özel istekler, itibar, müfettiş.
5. HUD ve paneller (malzeme siparişi, telefon, menü & fiyat, geliştirme, personel, tarifler, hedefler), gün sonu raporu.
6. Meta sistemler, kayıt/yükleme, ses (web sürümündeki sesler prosedüreldi: Godot'da `AudioStreamGenerator` veya ses dosyaları).
7. Cila: ışıklar, normal map'li sprite'lar, ekran efektleri; masaüstü export (Windows/Linux/Mac), sonra Steam.

## Notlar

- Web sürümündeki son görsel çalışmalar (parallax, ışık katmanı, yeni HUD) Godot'daki hedefin taslağıdır.
- `shots/` klasörü geçicidir (git'e girmez).
- Aktarılan görseller başlangıç içindir; ileride çizilmiş sprite'larla değiştirilebilir. Dosya adlarını koru ki kod değişmesin.
