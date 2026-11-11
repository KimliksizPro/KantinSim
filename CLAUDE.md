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

## Android kabuğu (APK)

Oyun `android/` altındaki ince WebView kabuğuyla APK olarak kurulabilir.
`tools/android/build.sh` aapt2 + javac + d8 + apksigner ile derler (Gradle yok).
İmza anahtarı `~/.local/share/kantinsim/kantinsim-debug.jks` (yayında `KS_FILE=...`) altında,
derleme çıktısının dışında tutulur: aynı anahtar kaldığı için yeni APK eskisinin üzerine
`adb install -r` ile kurulabilir.
`android/src/.../MainActivity.java` tam ekran, yatay kilit, ekran açık ve geri tuşu
davranışını yönetir; oyun dosyaları değişmez, APK'nın `assets/` klasörüne kopyalanır.
Yazı tipleri `fonts/` altında yereldir; APK ağ izni istemez.

## Mobil HUD ve native ekranlar

- Sahne `1600x900` mantıksal uzayda `transform: scale(...)` ile küçülür; **HUD ve DOM ekranları sahneyle küçülmez**.
- `js/core.js` → `resize()` beş CSS değişkeni yayınlar: `--hud-inv` (ters ölçek, en az 1), `--hud-width`, `--hud-left`, `--hud-top`, `--hud-vh`. `#ks-hud`, `#ks-dayline` ve `#ks-notifs` bu değişkenlerle native ölçekte konumlanır.
- Sahne küçüldüğünde (`KS.scale < 1`) dünyanın kendi `0..56` HUD bandı `body.ks-hud-fit #game { clip-path }` ile kırpılır ve sahne HUD + gün şeridinin **altına** yerleşir (`scale = min(vw/1600, (vh-chrome)/844)`). Böylece HUD native büyürken sahnenin üstünü örtmez; dünya `y=64`te başlayan sipariş balonları her boyutta görünür kalır. `1600×900` ve üstünde eski davranış (tam sahne, kırpma yok) korunur.
- `css/ui.css` içinde `1599px` altında olay chip'i, `1499px` altında veya `(pointer: coarse)` cihazlarda kompakt HUD (44×44 ikon düğmeler, gizli etiketler/chip'ler) devreye girer.
- Aynı eşikte paneller, hazırlık kartı, gün sonu, ana menü ve duraklat/onay kartları da native: `#ks-modal`, `#ks-summary`, `#ks-mainmenu`, `#ks-pause`, `#ks-prep` ters ölçekle ekranı kaplar; panel `width: 100%` + `max-width: 1200px`, gövde kayar, başlık/sekme/alt satır sabittir.
- Dar ekran ızgaraları: `.sup-grid` tek sütun, `.up-grid`/`.st-grid`/`.ach-grid` iki sütun, `.stt-tiles` üç sütun. `1000–1499px` arasında eski sütun sayıları korunur.
- Eğitim balonu `placeTutorial()` içinde `KS.scale < 0.95` iken alt kenara sabitlenir, ters ölçekle native boyutta çizilir; halka sahne koordinatında kalır.
- DOM sahnenin içinde kaldığı için `logicalRect` (eğitim halkası, konfeti) çalışmaya devam eder; duman testi 844×390'da HUD, menü, hazırlık ve dokuz paneli ölçer.

## Günün menüsü

- `rollToday()` her gün `today.featured` alanına açılmış, fiyatı ≥ 50 ₺ olan bir tarifi yazar; seçim gün numarasına göre döner ve gün içinde sabit kalır (eski kayıtlarda `KS.featuredId()` ilk çağrıda hesaplar).
- `KS.featuredBonus(line, price?)` o tarifin her servisi için ek bahşiş verir (menü fiyatının %25'i, en az 3 ₺). `customers.js` ödemede `today.meta.featServ/featTip` sayaçlarını tutar ve uçan yazı gösterir.
- Gün sonu raporu `featured/featServ/featTip` alanlarını taşır; hazırlık kartı (⭐ şerit), Menü paneli (rozet) ve gün sonu özeti bu alanlardan beslenir.
- Duman testi menü seçimini, hazırlık şeridini, panel rozetini, gerçek servis→bahşiş akışını ve günler arası dönüşü doğrular.

## Haftalık sözleşme ve kârlı gün serisi

- `js/meta.js` → `ensure()` eski kayıtlara `state.week` ve `state.streak` alanlarını ekler. Hafta 5 okul günüdür; `ensureWeek()` gün ilerleyince yeni haftayı açar (`{n, start, target, reward, done, paid, paidDay, failed}`).
- `weeklyTarget()` son 3 günün ortalama cirosundan (yoksa seviyeden) hedef üretir: ortalama × 5 × 1,05, en az 1.000 ₺, 100'er yuvarlanır. Ödül hedefin ~%15'i kadar para + XP.
- `settleWeek()` `beforeDayEnd` sırasında çalışır: hedef tuttuysa bir kez `KS.bonus` + `KS.addXP`; haftanın son günü hâlâ tutmuyorsa `failed` işaretlenir.
- `updateStreak(report)` `dayEnd` sırasında net kârı (ciro + bahşiş + bonus − gider) hesaplar; pozitifse seriyi büyütür, değilse sıfırlar. 3/5/10/20 günde bir kez para + XP ödülü verir (`state.streak.claimed`).
- Gün sonu raporuna `week{n,start,target,revenue,reward,done,paid,paidDay,failed}` ve `streak{days,best,profitable,net,lost,milestone,next}` alanları eklenir. Hazırlık kartı `.wk-row`, Kantin Defteri haftalık kart, gün sonu özeti bu alanları gösterir.
- `KS.Meta.week()` ve `KS.Meta.streak()` arayüz için canlı bilgi döndürür. Duman testi hedef/şerit varlığını, 3. gün ödülünün bir kez ödendiğini, serinin büyüdüğünü, zararlı günde sıfırlandığını ve son gün yanan sözleşmeyi doğrular.

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
