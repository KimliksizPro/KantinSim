# KantinSim — Ekip Sözleşmesi (modül arayüzleri)

Tarayıcıda çalışan, build adımı olmayan bir HTML5 Canvas oyunu. Tüm kod `window.KS` ad alanında,
`index.html` içindeki `<script>` sırasıyla yüklenir (ES module YOK, dış kütüphane YOK).
Mantıksal çözünürlük **1600x900**; tüm koordinatlar bu uzaydadır (core ölçekler).
Oyun dili **Türkçe** (tüm metinler, etiketler, bildirimler Türkçe ve doğru Türkçe karakterlerle).

## Dosya sahipliği (herkes SADECE kendi dosyalarını düzenler)

| Dosya | Sahip | Not |
|---|---|---|
| `index.html`, `css/base.css`, `js/data.js`, `js/core.js`, `js/recipes.js`, `js/main.js` | Lead | Okuyun, değiştirmeyin. Eksik bir şey gerekirse kendi modülünüzde çözün ve rapor edin. |
| `js/art.js`, `js/audio.js` | Art & Ses | Şu an stub. |
| `js/stations_prep.js` | Hazırlık İstasyonları | malzeme kutuları, tezgah (tabaklar), çiğ köfte leğeni, sıcak dolap, vitrin, temizlik, çöp |
| `js/stations_cook.js` | Pişirme İstasyonları | tost makinesi, ızgara, fritöz, semaver |
| `js/customers.js` | Müşteriler | müşteri üretimi, sıra, sipariş, sabır, ödeme, itibar, müfettiş |
| `js/ui.js`, `css/ui.css` | Arayüz | HUD, menüler, paneller, gün özeti, bildirimler, eğitim |

| `js/meta.js` | Meta sistemler | günlük hedefler, başarımlar, rekorlar, kampanyalar, banka kredisi, toplu sipariş |

Yükleme sırası: data → core → recipes → audio → art → stations_prep → stations_cook → customers → meta → ui → main.
`KS.boot()` main.js'de çağrılır; modüller `KS.registerModule({...})` ile kayıt olur, `init()` boot'ta çağrılır.
Modül kodunu **init() içinde** çalıştırın (o anda tüm dosyalar yüklenmiştir). Başka modülün API'sini
çağırmadan önce varlığını kontrol edin (`KS.Customers && ...`).

## Çekirdek API (js/core.js — okuyun!)

- `KS.util`: clamp, lerp, rand, randInt, pick, chance, weighted({k:w}), uid, fmtMoney, fmtTime(dk), inRect, dist, easeOutBack, easeOutCubic
- `KS.bus.on(ev, fn)/emit`: olaylar — `newGame, prepStart(today), open, closing, dayEnd(report), bell(period), periodChange(period), moneyChanged, repChanged, levelUp(level), delivery(order), customerServed(info), customerLeft(info), itemTrashed(item), powerChange(on), pause(bool), stateLoaded, upgradeBought(id), staffChanged(id), boot`
- `KS.registerModule({name, order, init(), update(dt, realDt), draw(ctx, layer)})`
  - `update(dt)`: `dt` = oyun saniyesi (duraklatılınca / gün kapalıyken **0**), `realDt` = gerçek saniye (animasyon).
  - `draw(ctx, layer)` çizim katmanları sırası: Art.drawBackground → **'back'** → **'customers'** → Art.drawCounterFront → **'counter'** → Art.drawWorkspace → **'stations'** → (core: bırakma vurguları) → **'fx'** → core efektleri → elde tutulan item → ipucu kutusu.
- `KS.state` (bkz. core.js `newState`): `day, money, rep(0..5), xp, level, time(oyun dk; 480=08:00, 1020=17:00), phase('menu'|'prep'|'open'|'closing'|'summary'|'gameover'), paused, speedMult, inventory{ingId:n}, products{prodId:n}, menu{recipeId:{on,price}}, prices{prodId:price}, upgrades{id:lv}, staff{id:bool}, deliveries[], cleanliness(0..100), power, today{weekday, weather, event, featured, revenue, tips, served, lost, angry, perfect, expenses{}, sales{}, meta{}}, stats, tutorialDone, settings{sound,music}, history[]`
- Ekonomi: `KS.earn(tl, 'satis'|'bahsis', x?, y?)` (x,y verilirse uçan yazı), `KS.spend(tl, kategori, force?) -> bool`, `KS.inv.get/has/add/take(id,n)`, `KS.prod.get/has/add/take(id,n)`, `KS.addRep(d)`, `KS.addXP(n)`, `KS.levelProgress()`, `KS.priceOf(line)`, `KS.priceRatio(line)`, `KS.recordSale(line)`, `KS.addDirt(n)`, `KS.clean(n)`
- Geliştirme & personel: `KS.upg(id)` seviye, `KS.upgVal(id, alan)` (örn. `KS.upgVal('tost','slots')`), `KS.buyUpgrade(id)`, `KS.hasStaff(id)`, `KS.setStaff(id,on)`
- Kilitler: `KS.isRecipeUnlocked(id)`, `KS.isRecipeOnMenu(id)`, `KS.isProductUnlocked(id)`
- Günün menüsü: `KS.featuredId()` (gün içinde sabit kalan tarif kimliği), `KS.featuredBonus(line, price?)` (yalnızca o tarif için ek bahşiş; %25, en az 3 ₺). Alanlar: `today.featured`, `today.meta.featServ/featTip`, gün sonu raporunda `featured/featServ/featTip`.
- Sipariş: `KS.placeOrder({supplier, inv:{}, prod:{}, cost}) -> {ok, msg?, total}` (hazırlıkta verilen sipariş hemen gelir, açıkken `eta` dk sonra; tedarikçi `fee` eklenir)
- Gün akışı: `KS.game.newGame() / continueGame() / openShop() / endDay() / nextDay() / togglePause(v?)`; `KS.currentPeriod()`, `KS.isBreak()`, `KS.inputEnabled()`, `KS.powerOn()`, `KS.todayEvent()`, `KS.todayWeather()`, `KS.lastReport`
- Kayıt: `KS.save()`, `KS.load()`, `KS.hasSave()`, `KS.deleteSave()`
- Kancalar: `KS.hooks.activeCustomerCount = () => n`, `KS.hooks.forceCustomersLeave = () => {}` (müşteri modülü üzerine yazar)
- Meta kancaları (meta.js yazar, customers.js okur): `KS.hooks.demandMult/patienceMult/tipMult/studentMult = () => çarpan`
- `KS.bonus(tl, x?, y?)`: satış dışı ödül geliri (`today.bonus`, gün netine dahil). `beforeDayEnd` olayı sabit giderlerden önce yayılır (kredi taksiti, hedef değerlendirme).
- `KS.Meta = { goals(), goalProgress(g), achievements(), achProgress(a), isUnlocked(id), campaign(), canCampaign(id), runCampaign(id), loans(), loanOffer(id), canLoan(id), takeLoan(id), payOffLoan(uid), debt(), dailyInstallment(), lifeStats() }`
  - Olaylar: `goalDone(goal)`, `achievement(ach)`, `campaign(id)`, `loanTaken(loan)`, `loanRepaid(loan)`, `bulkOrder(info)`
- Efekt: `KS.fx.floatText(x,y,text,color,size)`, `KS.fx.burst(x,y,color,n,opts)`, `KS.fx.smoke(x,y,n,color)`, `KS.fx.coins(x,y,n)`, `KS.fx.shake(a)`
- `KS.notify(msg, 'info'|'good'|'bad'|'warn')` → UI'ın `KS.ui.notify`'ına gider
- `KS.time` gerçek geçen saniye (animasyon için), `KS.roundRectPath(ctx,x,y,w,h,r)`
- `KS.layout`: tüm istasyon dikdörtgenleri (aşağıda). **Bunlara uyun.**

### Yerleşim (KS.layout)
```
hud       0,0     1600x56   (HTML HUD burada; canvas arka planı da çizilir)
wall      0,56    1600x296  (arka duvar / servis penceresi; müşteriler burada görünür)
vitrin    14,66   300x338   hazır & paketli ürün vitrini (sol üst)
customerSlots: 4 slot, cx = 500, 780, 1060, 1340; baseY = 352 (tezgah üst çizgisi); rect = {cx-135, 64, 270, 300}
counter   0,352   1600x70   servis tezgahı (üst 352-372, ön panel 372-422) — Art.drawCounterFront çizer
workspace 0,422   1600x478  bizim mutfak çalışma alanı
bins      12,432  340x458   4 sütun x 5 satır malzeme kutusu (DATA.binOrder sırası)
yogurma   364,432 220x200   çiğ köfte leğeni
bekleme   594,432 212x200   sıcak dolap / bekleme rafı
tezgah    364,644 442x246   hazırlık tezgahı (tabaklar)
tost      818,432 262x200   tost makinesi
izgara    818,644 262x246   ızgara
fritoz    1092,432 236x250  fritöz
temizlik  1092,694 236x196  lavabo + temizlik bezi + kirlilik göstergesi
semaver   1340,432 248x290  çay ocağı / semaver
cop       1340,734 248x156  çöp kutusu
```

## Item modeli (sürüklenen her şey)
```js
{ uid, type:'ing',     id:'kofte', cookA, cookB }          // elde tek malzeme (kutudan / ızgaradan / leğenden)
{ uid, type:'ing',     id:'cigkofte', q }                  // leğenden çıkan porsiyon (q = yoğurma kalitesi)
{ uid, type:'dish',    id:'tost_ekmegi', layers:[{id,q,cook?,cookA?,cookB?}], toast:0 } // tabak yemeği
{ uid, type:'dish',    id:'kese',   layers:[{id:'patates', q, cook}] }   // fritözden çıkan patates
{ uid, type:'dish',    id:'bardak', layers:[{id:'cay', q}] }             // semaverden çay
{ uid, type:'product', id:'ayran' }                        // vitrinden hazır ürün
{ uid, type:'tool',    id:'bez' }                          // temizlik bezi (hazırlık modülü; Art.drawItem bunu da çizer)
```
Fabrikalar: `KS.items.ing(id, extra)`, `KS.items.dish(baseId, extra)`, `KS.items.product(id)`, `KS.items.name(item)`, `KS.items.describe(item)`.
Pişme değeri `cook`: 0 = çiğ, **0.85–1.2 = mükemmel**, 1.5+ = yanık. `KS.Recipes.cookQuality(c)`, `cookLabel(c)`, `cookStage(c)` (0 çiğ /1 iyi /2 yanık).
Köfte iki yüzlü: `cookA` (alt yüz), `cookB` (üst yüz). Tabağa eklerken **mutlaka** `KS.Recipes.layerFromIng(item)` ile layer'a çevirin.

Tarif yardımcıları (js/recipes.js): `KS.Recipes.identify(dish)->recipeId|null`, `evaluate(item, line)->{ok, quality, notes[]}`, `lineLabel(line)`, `lineMods(line)->{without[], extra[]}`, `nameOf(id)`, `itemName(item)`, `itemDescribe(item)`.

Sipariş satırı: `{type:'recipe', id:'kofte_ekmek', want:['domates','marul']}` veya `{type:'product', id:'ayran'}`. `want` = müşterinin istediği opsiyonel malzemeler (varsayılan: tarifin `defaults`'u).

## Sürükle-bırak bölgeleri (zones)
`KS.addZone({ id, rect | getRect(), z, enabled?(), onPick(pt)->item|null, onReturn(item), canDrop(item, pt?)->bool, onDrop(item, pt)->bool, onClick(pt), onDrag(pt), onRelease(pt), tooltip(pt)->string|null, noHighlight, solid })`
- Boş elle basınca, z sırasına göre noktayı içeren bölgelerin `onPick`'i denenir; item dönerse item ele alınır
  (**bölge item'ı kendinden ÇIKARIR**). Bırakma başarısızsa core `from.onReturn(item)` çağırır → item'ı geri koyun.
- `onPick` null dönerse ve `onClick` varsa tıklama olarak işlenir (bas-bırak aynı bölgede). `onDrag` basılı sürüklemede çağrılır (ör. yoğurma).
- Item elde iken, `canDrop(item)` (pt'siz) true dönen bölgeler core tarafından yeşil kesikli çizgiyle vurgulanır (`noHighlight:true` kapatır).
- Kısa dokunuş = "dokun-taşı" (item ele yapışır, sonraki tıklamada bırakılır). Sağ tık/Esc = iptal (geri döner).
- Müşteri slotları da bölgedir (customers modülü): `canDrop(item)` = müşterinin bekleyen satırlarından biri için
  `KS.Recipes.evaluate(item, line).ok`. Uymayan item bırakılamaz (kaynağına döner); kalite düşükse müşteri alır ama memnun kalmaz.

## Art API (js/art.js) — herkes çizimde bunları kullanır
```
Art.roundRect(ctx,x,y,w,h,r)                      // path oluşturur (fill/stroke çağıran yapar)
Art.text(ctx,str,x,y,{size,color,weight,align,baseline,stroke,strokeWidth,font})
Art.metalPanel(ctx, rect, {radius, tone})          // paslanmaz çelik gövde
Art.woodPanel(ctx, rect, {radius, tone})           // ahşap yüzey
Art.stationLabel(ctx, rect, label)                 // istasyon köşesine küçük etiket
Art.drawBackground(ctx, gameMin, weather, t)       // tüm ekran arka plan: duvar, pencere(gökyüzü saate göre), zemin
Art.drawCounterFront(ctx, t)                       // servis tezgahı (müşterilerin bel altını örter)
Art.drawWorkspace(ctx, t)                          // çalışma alanı üst yüzeyi detayları (istasyonlardan önce)
Art.drawIngredient(ctx, id, x, y, size, {cook, cookA, cookB, count})   // tek malzeme/ara ürün ikonu (merkez x,y)
Art.drawProduct(ctx, id, x, y, size)               // paketli/hazır ürün (merkez x,y)
Art.drawItem(ctx, item, x, y, scale)               // HERHANGİ bir item (ing/dish/product), merkez x,y, ~100px genişlik @1
Art.randomLook(typeId) -> look                     // müşteri görünüşü (tip: ogrenci, ogretmen, hizmetli, mudur, veli, mufettis)
Art.drawCustomer(ctx, customer, x, baseY, t)       // customer.look, customer.mood(0..1), customer.anim{state:'idle'|'walk'|'happy'|'angry'|'eat'|'talk', t}
Art.drawBubble(ctx, x, y, w, h, {tail:'down', color})   // konuşma balonu
Art.drawPatience(ctx, x, y, w, ratio)              // sabır çubuğu
Art.drawIcon(ctx, name, x, y, size)                // küçük ikonlar: 'coin','star','clock','check','cross','fire','snow','heart','angry','bolt','trash','drop','sparkle'
```

## Ses API (js/audio.js) — WebAudio ile prosedürel (dosya yok)
`KS.audio.play(name, {vol})`, `KS.audio.setLoop(key, on, type)` (ör. `setLoop('grill', true, 'sizzle')`, `type`: 'sizzle'|'fry'|'boil'|'hum'),
`KS.audio.unlock()`, `KS.audio.setMuted(bool)`, `KS.audio.setMusic(bool)`.
Ses adları: `pick, drop, click, ding (kasa), coin, bell (okul zili), error, trash, pour, fry_in, toast_done, burn, door, phone, scooter, levelup, angry, happy, knead, wipe, sizzle_start, ready, plate, squeeze, sprinkle, tick, alarm`.

## Diğer modüllerin dışa açtığı API'ler (rapor ettiğiniz şekilde)
- `KS.Customers = { list() -> [customer], queueLength() }` (customers.js)
- `KS.ui = { notify(msg,type), modalOpen:bool, modalPauses:bool, handleEscape()->bool, open(panelId) }` (ui.js)
  - `modalOpen` true iken canvas girdisi kapalı; `modalPauses` true iken oyun zamanı durur.
- `KS.Stations = { ... }` istasyon modülleri kendi içlerini `KS.Stations.prep` / `KS.Stations.cook` altında açabilir.

## Oyun tasarımı özeti
Okul kantini. Biz tezgahın içindeyiz; üstte servis penceresinde müşteriler (öğrenci, öğretmen, hizmetli, müdür, veli, müfettiş)
sıraya girer, balonda siparişleri görünür (ör. "Köfte Ekmek (soğansız)", "Ayran"). Altta mutfak: malzemeleri sürükleyip
tabakta birleştir, tost makinesinde bas, ızgarada köfte pişir/çevir, fritözde patates kızart, semaverde çay demle,
leğende çiğ köfte yoğur. Hazır ürünleri (ayran, kola, simit, poğaça, dışarıdan sipariş edilen döner/çiğ köfte/lahmacun)
vitrinden ver. Okul zil programı var: ders saatinde sakin, teneffüs/öğle arasında yoğun akın. Gün 08:00–17:00.
Gün sonunda gelir/gider raporu, bozulma, kira/fatura/personel. Para, itibar (yıldız), XP/seviye, kilit açma, geliştirmeler,
personel, hava durumu & günlük olaylar (müfettiş, elektrik kesintisi, maç günü...), temizlik.

## Kalite çıtası
- Görsel: "güzel grafik" isteniyor — gradyanlar, gölgeler, yumuşak köşeler, sıcak renkler, akıcı animasyon, buhar/duman/cızırtı
  efektleri. Düz renkli kutular kabul edilmez.
- Performans: 60 FPS; her karede gereksiz büyük gradyan üretmeyin (önbelleğe alın / offscreen canvas).
- Hata toleransı: draw/update içinde exception fırlatmayın; eksik veri için güvenli varsayılanlar.
- `node --check dosya.js` temiz olmalı.
