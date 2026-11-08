# 🥪 KantinSim — Okul Kantini Simülasyonu

Okul kantininin içindesin. Servis penceresine gelen öğrencilere, öğretmenlere, hizmetlilere ve müdüre
malzemelerden kendi elinle yemek hazırla, dışarıdan hazır döner / çiğ köfte / lahmacun sipariş edip vitrinde sat,
stok, fiyat, temizlik ve itibar yöneterek kantinini büyüt.

## Nasıl oynanır?

Kurulum yok. `index.html` dosyasını bir tarayıcıda aç (veya klasörde `python3 -m http.server` çalıştırıp
`http://localhost:8000` adresine git). Fare ve dokunmatik ekranla oynanır.

- **Sürükle-bırak**: malzemeyi kutudan tabağa, tabağı tost makinesine, yemeği müşteriye sürükle.
- **Kısa dokun** = eşyayı ele al, tekrar dokun = bırak. **Sağ tık / Esc** = eldekini geri koy.
- Köfteye **tıkla** = çevir · tost makinesinin **kapağına tıkla** · semaverde **demliğe tıkla** · fritöz **sepetine tıkla**.
- Elinde **bez** varken kirlerin üzerinden geç = temizle.
- **P / Esc** = duraklat.

## Tarifler (elle yapılan)

| Yemek | Nasıl |
|---|---|
| Kaşarlı Tost | Tost ekmeği + kaşar → tost makinesi |
| Karışık Tost | Tost ekmeği + kaşar + sucuk → tost makinesi |
| Köfte Ekmek | Izgarada iki yüzü pişmiş köfte + yarım ekmek + domates/soğan/marul |
| Hamburger | Köfte + cheddar + hamburger ekmeği + garnitür & sos |
| Çiğ Köfte Dürüm | Leğende bulgur + isot + salça yoğur → lavaş + çiğ köfte + marul + nar ekşisi + limon |
| Patates Kızartması | Fritözde kızart → keseye → tuz / ketçap / mayonez |
| Çay | Semaverde demle → ince belli bardağa doldur |

Müşteriler özel istekte bulunabilir: **"soğansız"**, **"+turşu"**, **"+pul biber"**… Balona dikkat!

## Hazır ürünler

- **Toptancı / Bakkal**: ayran, su, kola, meyve suyu, cips, çikolata ve tüm malzemeler (toptancı ucuz ama geç; bakkal pahalı ama hızlı).
- **Telefonla sipariş (kurye)**: Dönerci (et/tavuk döner dürüm), Çiğköfteci (hazır dürüm), Fırın (simit, poğaça), Pideci (lahmacun, kıymalı pide).
  Hazır yemekler gün sonunda bozulur — doğru miktarda sipariş ver!

## Simülasyon mekanikleri

- **Okul zil programı**: ders saatinde sakin, teneffüste ve öğle arasında akın. Zil çalınca öğrenciler derse yetişmek için sabırsızlanır.
- **Pişme dereceleri**: çiğ → tam kıvamında → fazla → yanık. Tost, köfte (iki yüz), patates, çay demi.
- **Kalite & bahşiş**: doğru, sıcak ve hızlı servis = bahşiş ve itibar. Yanlış garnitür, yanık yemek = şikâyet.
- **Ekonomi**: kira, elektrik/su/tüp faturası, personel yevmiyesi, malzeme bozulması (buzdolabı geliştirmesi azaltır), iflas sınırı.
- **Fiyatlandırma**: menü fiyatlarını kendin belirle — pahalıysa talep düşer.
- **Geliştirmeler**: tost makinesi, ızgara, fritöz, semaver, tezgah, sıcak dolap, çiğ köfte leğeni, buzdolabı, kasa, dekorasyon.
- **Personel**: çaycı çırak, temizlikçi, kasiyer.
- **Hava durumu & günlük olaylar**: yağmurda çay, sıcakta ayran; sağlık müfettişi denetimi, elektrik kesintisi, maç günü, veli toplantısı, sınav haftası, harçlık günü.
- **Temizlik**: tezgah kirlenir, müşteriler ve müfettiş fark eder.
- **Seviye & kilitler**: XP ile yeni tarifler, restoranlar ve personel açılır. Oyun otomatik kaydedilir.

## Proje yapısı

Vanilla JS + HTML5 Canvas, build adımı yok, tüm grafikler ve sesler prosedürel olarak kodla üretilir.

```
index.html
css/base.css, css/ui.css
js/data.js            oyun verileri (malzeme, tarif, ürün, tedarikçi, geliştirme, zil programı, olaylar)
js/core.js            motor: durum, kayıt, ekonomi, gün akışı, sürükle-bırak bölgeleri, efektler, döngü
js/recipes.js         tarif değerlendirme / kalite hesabı
js/art.js             prosedürel grafikler (yemekler, müşteriler, mekân)
js/audio.js           prosedürel ses efektleri ve müzik (WebAudio)
js/stations_prep.js   malzeme kutuları, tezgah, çiğ köfte leğeni, sıcak dolap, vitrin, temizlik, çöp
js/stations_cook.js   tost makinesi, ızgara, fritöz, semaver
js/customers.js       müşteri yapay zekâsı, sipariş, sabır, ödeme, müfettiş
js/ui.js              HUD, paneller, gün sonu raporu, eğitim
CONTRACT.md           modüller arası arayüz sözleşmesi
```
