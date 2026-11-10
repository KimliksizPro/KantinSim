extends RefCounted
## Izgaranın saf mantığı (web js/stations_cook.js "IZGARA" bölümü: placePatty, takePatty, flipPatty, updateIzgara).
## Sahneden ve autoload'lardan bağımsızdır; testlerde preload ile doğrudan kullanılır.
##
## Her yuvada en fazla bir çiğ/pişen köfte (type "ing", id "kofte") durur. Köftenin iki yüzü vardır:
##   cookA = ızgaraya değen ALT yüz (pişen), cookB = ÜST yüz (beklemede).
## Çevirmek iki değeri yer değiştirir. Izgara gazlıdır: elektrik gerekmez.

## Denge değerleri (web TUNE)
const GRILL_TIME := 7.0    # alt yüz 0 -> 1.0 için oyun saniyesi (hız 1)
const GRILL_READY := 0.85  # alt yüz pişti, "çevir" ipucu
const GRILL_SMOKE := 1.2   # duman başlar
const GRILL_BURN := 1.5    # "Yandı!"
const GRILL_MAX := 2.0
## Çevirme animasyonu süresi (gerçek saniye) ve bırakınca "zıplama" sönümü (1/sn)
const FLIP_TIME := 0.42
const DROP_DECAY := 5.0
## Usta aşçı: alt yüz bu değere gelince kendisi çevirir; iki yüz de bu değerdeyse köfteyi kenara çeker (pişme durur)
const CHEF_FLIP_AT := 1.0
const DEFAULT_SLOTS := 4

## Her yuva: {item: Dictionary ({} = boş), flip_t: float (-1 = çevrilmiyor, 0..1 animasyon),
##            ready: bool, smk: bool, burn: bool, drop: float (1 -> 0 bırakma zıplaması)}
var slots: Array = []
## En son köfte alınan yuva (iade için), yoksa -1
var last_slot: int = -1


func _init(count: int = DEFAULT_SLOTS) -> void:
	set_slot_count(count)


static func _new_slot() -> Dictionary:
	return {"item": {}, "flip_t": -1.0, "ready": false, "smk": false, "burn": false, "drop": 0.0}


## Yuva sayısını ayarlar (geliştirme). Büyütmek hep olur; küçültürken yalnız sondaki BOŞ yuvalar silinir.
func set_slot_count(n: int) -> void:
	n = maxi(1, n)
	while slots.size() < n:
		slots.append(_new_slot())
	while slots.size() > n and not has_item(slots.size() - 1):
		slots.pop_back()
	if last_slot >= slots.size():
		last_slot = -1


## Izgaraya konabilir mi: yalnız köfte malzemesi.
static func can_take(item: Dictionary) -> bool:
	return item.get("type", "") == "ing" and item.get("id", "") == "kofte"


func has_item(i: int) -> bool:
	return i >= 0 and i < slots.size() and not (slots[i].item as Dictionary).is_empty()


func item(i: int) -> Dictionary:
	return slots[i].item if has_item(i) else {}


## Alt yüz (ızgaraya değen) pişme değeri
func bottom_of(i: int) -> float:
	return float(item(i).get("cookA", 0.0))


## Üst yüz pişme değeri
func top_of(i: int) -> float:
	return float(item(i).get("cookB", 0.0))


func is_flipping(i: int) -> bool:
	return i >= 0 and i < slots.size() and float(slots[i].flip_t) >= 0.0


func count() -> int:
	var n := 0
	for i in slots.size():
		if has_item(i):
			n += 1
	return n


func free_count() -> int:
	return slots.size() - count()


func has_free_slot() -> bool:
	return free_count() > 0


func accepts(it: Dictionary) -> bool:
	return can_take(it) and has_free_slot()


## Alt yüz pişti ama üst yüz henüz pişmedi: "çevir" ipucu gösterilir.
func wants_flip(i: int) -> bool:
	return has_item(i) and bottom_of(i) >= GRILL_READY and top_of(i) < GRILL_READY


## Köftenin genel pişme değeri (web tooltip: bir yüz çiğse o yüz, değilse ortalama)
static func overall(a: float, b: float) -> float:
	var lo := minf(a, b)
	return lo if lo < 0.45 else (a + b) * 0.5


## Eşik bayraklarını alt yüzün şu anki değerine eşitler (olay üretmez; web pattyFlags).
func _sync_flags(i: int) -> void:
	var a := bottom_of(i) if has_item(i) else 0.0
	slots[i].ready = a >= GRILL_READY
	slots[i].smk = a >= GRILL_SMOKE
	slots[i].burn = a >= GRILL_BURN


## Köfteyi i. yuvaya koyar (yuva boş olmalı). cookA/cookB 0..GRILL_MAX aralığına sıkıştırılır.
func place_at(i: int, it: Dictionary) -> bool:
	if i < 0 or i >= slots.size() or has_item(i) or not can_take(it):
		return false
	it["cookA"] = clampf(float(it.get("cookA", 0.0)), 0.0, GRILL_MAX)
	it["cookB"] = clampf(float(it.get("cookB", 0.0)), 0.0, GRILL_MAX)
	var sl: Dictionary = slots[i]
	sl.item = it
	sl.flip_t = -1.0
	sl.drop = 1.0
	_sync_flags(i)
	return true


## order sırasıyla ilk boş yuvaya koyar (boşsa 0,1,..). Konan yuva ya da -1.
func place(it: Dictionary, order: Array = []) -> int:
	var try_order: Array = order if not order.is_empty() else range(slots.size())
	for i: int in try_order:
		if place_at(i, it):
			return i
	return -1


## İade: önce son alınan yuva, sonra ilk boş yuva (web izgaraZone.onReturn).
func put_back(it: Dictionary) -> int:
	var order: Array = []
	if last_slot >= 0:
		order.append(last_slot)
	order.append_array(range(slots.size()))
	return place(it, order)


## Yuvadaki köfteyi çıkarıp döndürür ({} = boş). Çevirme animasyonu iptal olur.
func take(i: int) -> Dictionary:
	if not has_item(i):
		return {}
	var it: Dictionary = slots[i].item
	slots[i].item = {}
	slots[i].flip_t = -1.0
	_sync_flags(i)
	last_slot = i
	it["cookA"] = float(it.get("cookA", 0.0))
	it["cookB"] = float(it.get("cookB", 0.0))
	return it


## Köfteyi çevirir: alt ve üst yüz yer değiştirir. Boşsa ya da zaten çevriliyorsa false.
func flip(i: int) -> bool:
	if not has_item(i) or is_flipping(i):
		return false
	var it: Dictionary = slots[i].item
	var a := float(it.get("cookA", 0.0))
	it["cookA"] = float(it.get("cookB", 0.0))
	it["cookB"] = a
	slots[i].flip_t = 0.0
	_sync_flags(i)
	return true


## Bir kare ilerlet.
##   game_dt: oyun saniyesi (duraklatınca / kapalıyken 0), real_dt: gerçek saniye (animasyonlar),
##   speed: geliştirme hız çarpanı, chef: usta aşçı var mı (otomatik çevirir, pişmişi kenara çeker).
## Dönen olaylar: [{slot: int, type: "ready" | "burn" | "chef_flip"}] — "ready" yalnız üst yüz henüz
## pişmemişken (çevir ipucu), "ready"/"burn" her eşik geçişinde bir kez.
func update(game_dt: float, real_dt: float, speed: float = 1.0, chef: bool = false) -> Array:
	var events: Array = []
	var spd := maxf(0.1, speed)
	var run := game_dt > 0.0
	for i in slots.size():
		var sl: Dictionary = slots[i]
		if float(sl.flip_t) >= 0.0:
			sl.flip_t = float(sl.flip_t) + real_dt / FLIP_TIME
			if float(sl.flip_t) >= 1.0:
				sl.flip_t = -1.0
		if float(sl.drop) > 0.0:
			sl.drop = maxf(0.0, float(sl.drop) - real_dt * DROP_DECAY)
		if not has_item(i):
			continue
		var it: Dictionary = sl.item
		var resting := chef and float(it.get("cookA", 0.0)) >= CHEF_FLIP_AT and float(it.get("cookB", 0.0)) >= CHEF_FLIP_AT
		if run and not resting:
			it["cookA"] = minf(GRILL_MAX, float(it.get("cookA", 0.0)) + game_dt * spd / GRILL_TIME)
		var a := float(it.get("cookA", 0.0))
		var b := float(it.get("cookB", 0.0))
		if chef and run and a >= CHEF_FLIP_AT and b < GRILL_READY and float(sl.flip_t) < 0.0:
			flip(i)
			events.append({"slot": i, "type": "chef_flip"})
			continue
		if not sl.ready and a >= GRILL_READY:
			sl.ready = true
			if b < GRILL_READY and a < GRILL_BURN:
				events.append({"slot": i, "type": "ready"})
		if not sl.smk and a >= GRILL_SMOKE:
			sl.smk = true
		if not sl.burn and a >= GRILL_BURN:
			sl.burn = true
			events.append({"slot": i, "type": "burn"})
	return events
