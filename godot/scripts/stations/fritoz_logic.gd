extends RefCounted
## Fritözün saf mantığı (web js/stations_cook.js "FRİTÖZ": fryCanTake, makeKese, takeFries, toggleBasket,
## changeOil, placeFries, fritozZone.onReturn, updateFritoz). Sahneden ve autoload'lardan bağımsızdır;
## testlerde preload ile doğrudan kullanılır. Elektrik, hız ve şef bilgisi update() parametresiyle gelir.
##
## Sepet: {c: {} | {cook: float, oil_mult: float}, down: bool, down_t: 0..1 (0 yukarıda, 1 yağda),
##         ready, smk, burn: bool (eşik bayrakları), drip: sn (kaldırınca damlama), splash: 0..1, seed: int}

const Rec := preload("res://scripts/recipes.gd")
const ItemsS := preload("res://scripts/items.gd")

## Denge değerleri (web TUNE)
const FRY_TIME := 9.0      # 0 -> 1.0 için oyun saniyesi (tam ısıda)
const FRY_DONE := 0.9      # "Hazır!"
const FRY_SMOKE := 1.25    # duman başlar
const FRY_BURN := 1.5      # "Yandı!"
const FRY_MAX := 2.0
const FRY_HEAT_UP := 6.0     # soğuktan tam ısıya (oyun sn)
const FRY_COOL_DOWN := 25.0  # elektrik yokken tam ısıdan soğumaya (oyun sn)
const OIL_MAX := 30          # taze yağın porsiyon ömrü
const OIL_OLD := 8           # bu ve altı "eski yağ"
const OIL_OLD_MULT := 0.75
const OIL_DEAD_MULT := 0.5
## Sepet inip kalkma hızı (1/sn, gerçek zaman) ve "yağda" sayıldığı iniş oranı
const BASKET_SPEED := 3.2
const IN_OIL_T := 0.85
## Bu iniş oranından azsa sepet "yukarıda" sayılır: basınca patates doğrudan alınır
const PICK_UP_T := 0.5
## Şef bu pişme değerinde sepeti kendiliğinden kaldırır
const CHEF_LIFT := 1.02
const DRIP_TIME := 2.2
const MAX_BASKETS := 3

## Yağ sıcaklığı 0..1 (gün başında sıcak)
var temp: float = 1.0
## Yağ ömrü (porsiyon). Not: web'de KS.state.oilLife'ta kaydedilir; Godot'da kayıt sistemi gelince taşınmalı.
var oil_life: int = OIL_MAX
var old_warned: bool = false
var baskets: Array = []
## En son patates alınan sepet (iade için), yoksa -1
var last_basket: int = -1
## Son kare yağda kızaran patates var mıydı (ses / görsel için)
var frying: bool = false
## place() eski yağ uyarısını tetiklediyse true; pop_old_warning() okur ve sıfırlar
var _old_warning_pending: bool = false
var _seed: int = 1


func _init(count: int = 1) -> void:
	set_basket_count(count)


static func new_basket() -> Dictionary:
	return {"c": {}, "down": false, "down_t": 0.0, "ready": false, "smk": false, "burn": false,
		"drip": 0.0, "splash": 0.0, "seed": 1}


## Sepet sayısını geliştirme seviyesine eşitler (1..3). Kaybolan dolu sepet sayısını döndürür.
func set_basket_count(n: int) -> int:
	n = clampi(n, 1, MAX_BASKETS)
	var lost := 0
	while baskets.size() < n:
		baskets.append(new_basket())
	while baskets.size() > n:
		var b: Dictionary = baskets.pop_back()
		if not (b.c as Dictionary).is_empty():
			lost += 1
	if last_basket >= baskets.size():
		last_basket = -1
	return lost


## Sepete konabilir mi: çiğ patates (ing) ya da yalnız patates içeren kese (geri kızartma).
static func can_take(item: Dictionary) -> bool:
	if item.is_empty():
		return false
	if item.get("type", "") == "ing" and item.get("id", "") == "patates":
		return true
	if item.get("type", "") != "dish" or item.get("id", "") != "kese":
		return false
	var layers: Variant = item.get("layers")
	return layers is Array and (layers as Array).size() == 1 and (layers as Array)[0].get("id", "") == "patates"


## Yağın eskime oranı 0 (taze) .. 1 (bitmiş)
func oil_wear() -> float:
	return 1.0 - clampf(float(oil_life) / OIL_MAX, 0.0, 1.0)


## Şu anki yağda kızaran patatesin kalite çarpanı
func oil_mult() -> float:
	if oil_life > OIL_OLD:
		return 1.0
	return OIL_OLD_MULT if oil_life > 0 else OIL_DEAD_MULT


func is_oil_old() -> bool:
	return oil_life <= OIL_OLD


## Kızartma gücü: sıcaklığın yumuşak eşiği (web smooth(0.3, 0.9, temp))
func heat() -> float:
	var t := clampf((temp - 0.3) / 0.6, 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


func has_fries(i: int) -> bool:
	return i >= 0 and i < baskets.size() and not (baskets[i].c as Dictionary).is_empty()


func cook_of(i: int) -> float:
	return float(baskets[i].c.get("cook", 0.0)) if has_fries(i) else 0.0


func oil_mult_of(i: int) -> float:
	return float(baskets[i].c.get("oil_mult", 1.0)) if has_fries(i) else 1.0


func in_oil(i: int) -> bool:
	return baskets[i].down and float(baskets[i].down_t) > IN_OIL_T


func free_basket() -> int:
	for i in baskets.size():
		if not has_fries(i):
			return i
	return -1


func accepts() -> bool:
	return free_basket() >= 0


func is_empty() -> bool:
	for i in baskets.size():
		if has_fries(i):
			return false
	return true


func _flags(i: int) -> void:
	var c := cook_of(i)
	baskets[i].ready = c >= FRY_DONE
	baskets[i].smk = c >= FRY_SMOKE
	baskets[i].burn = c >= FRY_BURN


## Patatesi i. sepete koyar (sepet hareket etmez). Çiğ patates yağdan 1 porsiyon yer.
func place(i: int, item: Dictionary) -> bool:
	if i < 0 or i >= baskets.size() or has_fries(i) or not can_take(item):
		return false
	var b: Dictionary = baskets[i]
	if item.get("type", "") == "ing":
		b.c = {"cook": float(item.get("cook", 0.0)), "oil_mult": oil_mult()}
		oil_life = maxi(0, oil_life - 1)
		if not old_warned and oil_life <= OIL_OLD:
			old_warned = true
			_old_warning_pending = true
	else:
		var l: Dictionary = item.layers[0]
		b.c = {"cook": float(l.get("cook", 0.0)), "oil_mult": float(item.get("oil_mult", 1.0))}
	_seed += 7919
	b.seed = _seed
	_flags(i)
	return true


## Bırakma: pt_x'e en yakın boş sepete koyar ve sepeti yağa indirir. Konan sepeti döndürür, olmazsa -1.
func drop(item: Dictionary, centers_x: Array = [], pt_x: float = 0.0) -> int:
	var best := -1
	var bd := INF
	for i in baskets.size():
		if has_fries(i):
			continue
		var d := absf(pt_x - float(centers_x[i])) if i < centers_x.size() else float(i)
		if d < bd:
			bd = d
			best = i
	if best < 0 or not place(best, item):
		return -1
	baskets[best].down = true
	baskets[best].splash = 1.0
	return best


## Eski yağ uyarısı bekliyor mu (okununca sıfırlanır)?
func pop_old_warning() -> bool:
	var w := _old_warning_pending
	_old_warning_pending = false
	return w


## Patatesten kese yapar (kalite = pişme kalitesi × yağ çarpanı).
static func make_kese(c: Dictionary) -> Dictionary:
	var cook := float(c.get("cook", 0.0))
	var om := float(c.get("oil_mult", 1.0))
	var layer := {"id": "patates", "cook": cook, "q": Rec.cook_quality(cook) * om}
	var it := ItemsS.dish("kese", {"layers": [layer]})
	it["oil_mult"] = om
	return it


## i. sepetteki patatesi kese olarak çıkarır ({} = boş).
func take(i: int) -> Dictionary:
	if not has_fries(i):
		return {}
	var b: Dictionary = baskets[i]
	var it := make_kese(b.c)
	if b.down or float(b.down_t) > 0.3:
		b.drip = DRIP_TIME
	b.c = {}
	b.down = false
	_flags(i)
	last_basket = i
	return it


## İade (sürükleme iptal): son alınan sepete (yoksa ilk boşa) yukarıda koyar. Yer yoksa -1.
func put_back(item: Dictionary) -> int:
	var i := last_basket
	if not (i >= 0 and i < baskets.size() and not has_fries(i)):
		i = free_basket()
	if i < 0:
		return -1
	var b: Dictionary = baskets[i]
	if item.get("type", "") == "dish":
		var layers: Array = item.get("layers", [])
		var l: Dictionary = layers[0] if not layers.is_empty() else {}
		b.c = {"cook": float(l.get("cook", 0.0)), "oil_mult": float(item.get("oil_mult", 1.0))}
	else:
		b.c = {"cook": float(item.get("cook", 0.0)), "oil_mult": oil_mult()}
	b.down = false
	_flags(i)
	return i


## Sepeti indir / kaldır. Yeni durumu döndürür (true = yağa iniyor).
func toggle(i: int) -> bool:
	if i < 0 or i >= baskets.size():
		return false
	var b: Dictionary = baskets[i]
	b.down = not b.down
	if b.down:
		if has_fries(i):
			b.splash = 1.0
	else:
		b.drip = DRIP_TIME
	return b.down


func can_change_oil() -> bool:
	return oil_life < OIL_MAX


## Yağı tazeler (envanter kontrolü çağırana ait). Zaten tazeyse false.
func change_oil() -> bool:
	if not can_change_oil():
		return false
	oil_life = OIL_MAX
	old_warned = false
	return true


## Bir kare ilerlet. game_dt: oyun saniyesi (duraklatınca 0), real_dt: gerçek saniye (sepet animasyonu).
## Dönen olaylar: [{basket: int, type: "done" | "burn" | "chef_lift"}] — eşikler patates başına bir kez.
func update(game_dt: float, real_dt: float, power: bool = true, speed: float = 1.0, chef: bool = false) -> Array:
	var events: Array = []
	var run := game_dt > 0.0
	if run:
		if power:
			temp = minf(1.0, temp + game_dt / FRY_HEAT_UP)
		else:
			temp = maxf(0.0, temp - game_dt / FRY_COOL_DOWN)
	var h := heat()
	var spd := maxf(0.1, speed)
	frying = false
	for i in baskets.size():
		var b: Dictionary = baskets[i]
		var target := 1.0 if b.down else 0.0
		b.down_t = float(b.down_t) + clampf(target - float(b.down_t), -real_dt * BASKET_SPEED, real_dt * BASKET_SPEED)
		b.drip = maxf(0.0, float(b.drip) - real_dt)
		b.splash = maxf(0.0, float(b.splash) - real_dt * 2.0)
		if not has_fries(i):
			continue
		if run and in_oil(i) and h > 0.0:
			b.c.cook = minf(FRY_MAX, float(b.c.cook) + game_dt * spd * h / FRY_TIME)
			frying = true
		var c := float(b.c.cook)
		if run and chef and b.down and c >= CHEF_LIFT:
			toggle(i)
			events.append({"basket": i, "type": "chef_lift"})
		if not b.ready and c >= FRY_DONE:
			b.ready = true
			if c < FRY_BURN:
				events.append({"basket": i, "type": "done"})
		if not b.smk and c >= FRY_SMOKE:
			b.smk = true
		if not b.burn and c >= FRY_BURN:
			b.burn = true
			events.append({"basket": i, "type": "burn"})
	return events
