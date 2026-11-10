extends RefCounted
## Bekleme rafı / sıcak dolabın SAF mantığı (web js/stations_prep.js "4) SICAK DOLAP / BEKLEME": holdSlot,
## putInHold, warmable, isCold, updateHold, holdTooltip, onDayEnd). Autoload kullanmaz:
##   const HoldLogic := preload("res://scripts/stations/bekleme_logic.gd")

const PrepLogic := preload("res://scripts/stations/prep_logic.gd")

const MAX_SLOTS := 4
const DEFAULT_SLOTS := 2
## Isıtmasız rafta pişmiş yemek bu kadar oyun saniyesinden sonra soğumaya başlar
const COLD_AFTER := 15.0
## Soğumuş katmanın saniyelik kalite kaybı ve alt sınırı
const DECAY_PER_SEC := 0.004
const MIN_Q := 0.05
## Bu kadar basılmış tost "sıcak servis" sayılır
const TOAST_WARM := 0.3

## Yuvalar: null ya da {"item": Dictionary, "t": rafta geçen oyun saniyesi}
var slots: Array = [null, null, null, null]
var count: int = DEFAULT_SLOTS
var keep_warm: bool = false
## Son alınan yuvanın süresi (iade edilince kaldığı yerden devam eder)
var picked_t: float = 0.0
var picked_slot: int = -1


## Yuva sayısını değiştirir; taşan item'lar boş yuvalara kaydırılır, yer yoksa listede döner.
func set_count(n: int) -> Array:
	count = clampi(n, 1, MAX_SLOTS)
	var lost: Array = []
	for i in range(count, MAX_SLOTS):
		var e: Variant = slots[i]
		if e == null:
			continue
		slots[i] = null
		var j := free_slot()
		if j >= 0:
			slots[j] = e
		else:
			lost.append(e.item)
	return lost


func free_slot() -> int:
	for i in count:
		if slots[i] == null:
			return i
	return -1


func has(i: int) -> bool:
	return i >= 0 and i < count and slots[i] != null


func item_at(i: int) -> Dictionary:
	return slots[i].item if has(i) else {}


func is_empty() -> bool:
	for i in count:
		if slots[i] != null:
			return false
	return true


## Rafa konabilir mi (alet hariç her şey: yemek, malzeme, ürün)?
static func accepts(item: Dictionary) -> bool:
	return not item.is_empty() and item.get("type", "") != "tool" and item.get("type", "") != ""


## Rafa koyar: tercih edilen yuva boşsa oraya, değilse ilk boşa. Konan yuva ya da -1.
func put(item: Dictionary, pref: int = -1, t0: float = 0.0) -> int:
	if not accepts(item):
		return -1
	var j := pref if (pref >= 0 and pref < count and slots[pref] == null) else free_slot()
	if j < 0:
		return -1
	slots[j] = {"item": item, "t": t0}
	return j


## Yuvadan alır ({} = boş). Süresi iade için saklanır.
func take(i: int) -> Dictionary:
	if not has(i):
		return {}
	var e: Dictionary = slots[i]
	slots[i] = null
	picked_t = float(e.t)
	picked_slot = i
	return e.item


## İptal / başarısız bırakma: alındığı yuvaya, süresi kaldığı yerden.
func put_back(item: Dictionary) -> int:
	return put(item, picked_slot, picked_t)


## Sıcak servis edilmesi gereken yemek mi (basılmış tost, pişmiş katman, çay, patates)?
static func warmable(item: Dictionary) -> bool:
	if item.get("type", "") != "dish":
		return false
	if float(item.get("toast", 0.0)) > TOAST_WARM:
		return true
	for l in item.get("layers", []):
		if (l as Dictionary).has("cook") or l.get("id", "") == "cay" or l.get("id", "") == "patates":
			return true
	return false


func is_cold(i: int) -> bool:
	if not has(i) or keep_warm:
		return false
	var e: Dictionary = slots[i]
	return float(e.t) > COLD_AFTER and warmable(e.item)


## Soğumaya kalan saniye (soğumayacaksa -1).
func cold_in(i: int) -> float:
	if not has(i) or keep_warm or not warmable(slots[i].item):
		return -1.0
	return maxf(0.0, COLD_AFTER - float(slots[i].t))


## Oyun zamanı ilerletir: ısıtmasız rafta COLD_AFTER'dan sonra sıcak katmanların kalitesi düşer.
func update(dt: float) -> void:
	if not (dt > 0.0):
		return
	for i in count:
		var e: Variant = slots[i]
		if e == null:
			continue
		e.t = float(e.t) + dt
		if keep_warm or float(e.t) <= COLD_AFTER or not warmable(e.item):
			continue
		var it: Dictionary = e.item
		var toasted := float(it.get("toast", 0.0)) > TOAST_WARM
		for l: Dictionary in it.get("layers", []):
			if toasted or l.has("cook") or l.get("id", "") == "cay" or l.get("id", "") == "patates":
				l.q = maxf(MIN_Q, float(l.get("q", 1.0)) - DECAY_PER_SEC * dt)


## Gün sonu: rafı boşaltır. Paketli ürünler ve kutusu olan çiğ malzemeler stoğa döner, gerisi bozulur.
## -> {"spoiled": int, "products": [id...], "ings": [id...]}
func day_end() -> Dictionary:
	var out := {"spoiled": 0, "products": [], "ings": []}
	var prods: Dictionary = Recipes.data().get("products", {})
	for i in MAX_SLOTS:
		var e: Variant = slots[i]
		if e == null:
			continue
		var it: Dictionary = e.item
		var id: String = it.get("id", "")
		if it.get("type", "") == "product" and prods.get(id, {}).get("group", "") == "paketli":
			out.products.append(id)
		elif PrepLogic.is_returnable_ing(it):
			out.ings.append(id)
		else:
			out.spoiled += 1
		slots[i] = null
	return out


## Yuva ipucu (web holdTooltip).
func tooltip(i: int) -> String:
	if not has(i):
		if keep_warm:
			return "Boş raf (ısıtmalı)\nYemekler burada sıcak kalır"
		return "Boş raf\nPişmiş yemek burada %d sn sonra soğumaya başlar" % int(COLD_AFTER)
	var it: Dictionary = slots[i].item
	var s := Recipes.item_name(it)
	if it.get("type", "") == "dish":
		var inside := PrepLogic.contents_text(it)
		if inside != "":
			s += "\nİçindekiler: " + inside
	if is_cold(i):
		s += "\nSoğumuş — kalitesi düşüyor"
	elif keep_warm and warmable(it):
		s += "\nSıcak tutuluyor"
	elif warmable(it):
		s += "\nSoğumasına %d sn" % int(ceilf(cold_in(i)))
	return s + "\nSürükle: müşteriye / tezgaha"
