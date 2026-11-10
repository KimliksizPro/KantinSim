extends RefCounted
## Malzeme kutuları ve hazırlık tezgahının SAF mantığı (web js/stations_prep.js: binRect, plateCheck, dropOnPlate ...).
## Autoload kullanmaz; sahneler ve testler preload ile kullanır:
##   const Logic := preload("res://scripts/stations/prep_logic.gd")

## Bir tabağa en fazla bu kadar katman konur (web MAX_LAYERS)
const MAX_LAYERS := 15
## Tabak sayısı sınırları (geliştirme ile 3'e çıkar)
const MAX_PLATES := 3
const DEFAULT_PLATES := 2
## Stok bu sayının altına inince "az kaldı" uyarısı
const LOW_STOCK := 3
## Kutu hücresinin iç boşluğu
const BIN_PAD := 4.0

const BIN_SHORT := {
	"hamburger_ekmegi": "Hamburger Ek.",
	"nar_eksisi": "Nar Ekşisi",
	"tost_ekmegi": "Tost Ekmeği",
}


static func _ings() -> Dictionary:
	return Recipes.data().get("ingredients", {})


static func bin_order() -> Array:
	return Recipes.data().get("binOrder", [])


# --- Kutular -------------------------------------------------------------------

## i. kutunun dikdörtgeni (area = layout.bins).
static func bin_rect(area: Rect2, i: int, cols: int = 4, rows: int = 5) -> Rect2:
	var cw := area.size.x / cols
	var ch := area.size.y / rows
	var c := i % cols
	var r := i / cols
	return Rect2(area.position.x + c * cw + BIN_PAD, area.position.y + r * ch + BIN_PAD, cw - BIN_PAD * 2, ch - BIN_PAD * 2)


## pt'nin altındaki kutunun sırası; yoksa -1.
static func bin_index_at(area: Rect2, pt: Vector2, count: int, cols: int = 4, rows: int = 5) -> int:
	for i in count:
		if bin_rect(area, i, cols, rows).has_point(pt):
			return i
	return -1


## Kutudan alınan malzeme item'ı (köfte iki yüzlü pişer).
static func make_ing(id: String) -> Dictionary:
	if id == "kofte":
		return Items.ing("kofte", {"cookA": 0.0, "cookB": 0.0})
	return Items.ing(id)


## Kutuya geri bırakılabilir mi: kutusu olan, hiç pişmemiş malzeme.
static func is_returnable_ing(item: Dictionary) -> bool:
	if item.get("type", "") != "ing" or not bin_order().has(item.get("id", "")):
		return false
	if item.has("cook"):
		return false
	return not (float(item.get("cookA", 0.0)) > 0.02 or float(item.get("cookB", 0.0)) > 0.02)


## Malzemenin kullanıldığı tariflerin en düşük açılma seviyesi (hiçbirinde yoksa 1).
static func ing_unlock_level(id: String) -> int:
	var best := -1
	var recs: Dictionary = Recipes.recipes()
	for rid in recs:
		var r: Dictionary = recs[rid]
		if r.get("base", "") == id or r.get("required", []).has(id) or r.get("optional", []).has(id):
			var u := int(r.get("unlock", 1))
			if best < 0 or u < best:
				best = u
	return 1 if best < 0 else best


static func bin_label(id: String) -> String:
	return BIN_SHORT.get(id, _ings().get(id, {}).get("name", id))


static func bin_hint(id: String) -> String:
	if id == "kofte":
		return "Izgarada iki yüzünü pişir"
	if id == "patates":
		return "Fritözde kızart"
	var kind: String = _ings().get(id, {}).get("kind", "")
	if kind == "base":
		return "Tezgahtaki boş tabağa koy"
	if kind == "sauce":
		return "Tabaktaki yemeğe ekle"
	return "Tabaktaki ekmeğe ekle"


static func bin_tooltip(id: String, stock: int, level: int) -> String:
	var lines: Array = [_ings().get(id, {}).get("name", id), "Stok: %d porsiyon" % stock]
	if stock <= 0:
		var ul := ing_unlock_level(id)
		if ul > level:
			lines.append("Seviye %d tarifi için gerekli" % ul)
		lines.append("Bitti! Toptancıdan sipariş et (acil: Bakkal)")
	else:
		if stock <= LOW_STOCK:
			lines.append("Az kaldı — Toptancıdan sipariş et")
		lines.append(bin_hint(id))
	return "\n".join(lines)


## Kutudaki doluluk: {icons: 0..3, heap: 0..4}
static func bin_fill(id: String, stock: int) -> Dictionary:
	if stock <= 0:
		return {"icons": 0, "heap": 0}
	var ref := maxf(float(_ings().get(id, {}).get("pack", 10)), 10.0)
	var fill := clampf(stock / ref, 0.0, 1.0)
	var icons := 1 if fill < 0.34 else (2 if fill < 0.67 else 3)
	return {"icons": icons, "heap": maxi(1, ceili(fill * 4.0))}


# --- Tabaklar ------------------------------------------------------------------

## plates: uzunluğu tabak sayısı kadar Array; boş tabak = null, dolu = dish item.
static func new_plates(n: int = DEFAULT_PLATES) -> Array:
	var a: Array = []
	a.resize(clampi(n, 1, MAX_PLATES))
	return a


static func free_plate(plates: Array, except: int = -1) -> int:
	for i in plates.size():
		if i != except and plates[i] == null:
			return i
	return -1


## Bırakma kontrolü -> {ok: bool, msg: String, redirect: int (-1 = yok)}
## allow_redirect: dolu tabağa bırakılan yemek boş bir tabağa yönlendirilebilir.
static func plate_check(plates: Array, i: int, item: Dictionary, allow_redirect: bool = false) -> Dictionary:
	var type: String = item.get("type", "")
	var id: String = item.get("id", "")
	if item.is_empty() or type == "tool" or i < 0 or i >= plates.size():
		return _no("")
	if type == "product":
		return _no("Hazır ürünü doğrudan müşteriye ver")
	var kind: String = _ings().get(id, {}).get("kind", "") if type == "ing" else ""
	var raw_potato := type == "ing" and id == "patates" and not (float(item.get("cook", 0.0)) >= Recipes.COOK_RAW)
	if plates[i] == null:
		if type == "dish":
			return _yes()
		if type == "ing":
			if kind == "base":
				return _yes()
			if raw_potato:
				return _no("Çiğ patates önce fritöze!")
			if id == "cigkofte":
				return _no("Önce tabağa lavaş koy")
			return _no("Önce tabağa ekmek koy")
		return _no("")
	var p: Dictionary = plates[i]
	if type == "dish":
		if allow_redirect:
			var j := free_plate(plates, i)
			if j >= 0:
				return {"ok": true, "msg": "", "redirect": j}
		return _no("Bu tabak dolu")
	if type != "ing":
		return _no("")
	if p.get("id", "") == "bardak":
		return _no("Bardağa yiyecek konmaz!")
	if p.get("layers", []).size() >= MAX_LAYERS:
		return _no("Tabak taşıyor!")
	if kind == "base":
		return _no("Ekmek üstüne ekmek olmaz")
	if raw_potato:
		return _no("Çiğ patates önce fritöze!")
	if kind == "raw":
		return _no("Bu hammadde tabağa konmaz")
	if p.get("id", "") == "kese" and kind != "sauce":
		return _no("Keseye sadece tuz ve sos eklenir")
	if id == "cigkofte" or kind == "topping" or kind == "sauce" or kind == "cookable":
		return _yes()
	return _no("Bu tabağa eklenemez")


static func _yes() -> Dictionary:
	return {"ok": true, "msg": "", "redirect": -1}


static func _no(msg: String) -> Dictionary:
	return {"ok": false, "msg": msg, "redirect": -1}


## Item'ı i. tabağa bırakır (plates yerinde değişir).
## -> {ok, msg, index: item'ın gittiği tabak, added: "dish" | "layer" | "", warn: ek uyarı}
static func drop_on_plate(plates: Array, i: int, item: Dictionary) -> Dictionary:
	var res := plate_check(plates, i, item, true)
	var out := {"ok": res.ok, "msg": res.msg, "index": i, "added": "", "warn": ""}
	if not res.ok:
		return out
	if res.redirect >= 0:
		i = res.redirect
		out.index = i
	if plates[i] == null:
		plates[i] = item if item.get("type", "") == "dish" else Items.dish(item.get("id", ""))
		out.added = "dish"
	else:
		var p: Dictionary = plates[i]
		p.layers.append(Recipes.layer_from_ing(item))
		out.added = "layer"
		if item.get("id", "") == "kofte" and maxf(float(item.get("cookA", 0.0)), float(item.get("cookB", 0.0))) < Recipes.COOK_RAW:
			out.warn = "Köfte çiğ!"
	return out


## Elden geri dönen yemeği tabağa koyar: önce pref, yoksa ilk boş tabak. Konulan sıra; yer yoksa -1.
static func place_dish_back(plates: Array, item: Dictionary, pref: int = -1) -> int:
	if item.is_empty():
		return -1
	if pref >= 0 and pref < plates.size() and plates[pref] == null:
		plates[pref] = item
		return pref
	var j := free_plate(plates)
	if j >= 0:
		plates[j] = item
	return j


## Tabaktaki yemeği alır (tabak boşalır); boşsa {}.
static func take_plate(plates: Array, i: int) -> Dictionary:
	if i < 0 or i >= plates.size() or plates[i] == null:
		return {}
	var p: Dictionary = plates[i]
	plates[i] = null
	return p


## Tanınan tarif tost makinesi gerektiriyor ve henüz basılmamış mı?
static func needs_toast(dish: Dictionary) -> bool:
	var rid := Recipes.identify(dish)
	if rid == "":
		return false
	return bool(Recipes.recipes()[rid].get("toast", false)) and not (float(dish.get("toast", 0.0)) >= Recipes.COOK_RAW)


## "Kaşar, Domates x2" gibi içindekiler listesi ("" = sadece taban).
static func contents_text(dish: Dictionary) -> String:
	var order: Array = []
	var counts := {}
	for l in dish.get("layers", []):
		var id: String = l.get("id", "")
		if not counts.has(id):
			order.append(id)
		counts[id] = counts.get(id, 0) + 1
	var parts: Array = []
	for id in order:
		parts.append(Recipes.name_of(id) + (" x%d" % counts[id] if counts[id] > 1 else ""))
	return ", ".join(parts)


static func plate_tooltip(dish: Variant) -> String:
	if dish == null:
		return "Boş tabak\nTost ekmeği, yarım ekmek, lavaş veya\nhamburger ekmeği koyarak başla"
	var d: Dictionary = dish
	var s := Recipes.item_name(d)
	var inside := contents_text(d)
	s += "\nİçindekiler: " + (Recipes.name_of(d.get("id", "")) + (", " + inside if inside != "" else ""))
	if needs_toast(d):
		s += "\nTost makinesine götür"
	elif Recipes.identify(d) == "":
		s += "\nTanınan bir tarif değil"
	s += "\nSürükle: müşteriye / makineye / çöpe"
	return s


## Bırakma/alma anındaki kısa "zıplama" ölçeği (web bumpScale).
static func bump_scale(t0: float, now: float, amp: float = 0.12) -> float:
	if t0 <= 0.0:
		return 1.0
	var e := now - t0
	if e < 0.0 or e > 0.32:
		return 1.0
	return 1.0 + amp * sin(e / 0.32 * PI) * (1.0 - e / 0.32)
