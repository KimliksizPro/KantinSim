class_name Recipes
extends RefCounted
## Tarif tanıma ve kalite değerlendirme (web js/recipes.js'in birebir karşılığı).
## Hepsi statik: Recipes.identify(dish), Recipes.evaluate(item, line), Recipes.cook_quality(c) ...
## Veriyi doğrudan JSON'dan okur ki autoload olmadan (testlerde) de çalışsın.

const DATA_PATH := "res://data/game_data.json"

## Pişme eşikleri: 0 çiğ, 0.85–1.2 mükemmel, 1.5+ yanık
const COOK_RAW := 0.45
const COOK_GOOD := 0.85
const COOK_OVER := 1.2
const COOK_BURNT := 1.5

static var _data: Dictionary = {}


static func data() -> Dictionary:
	if _data.is_empty():
		var f := FileAccess.open(DATA_PATH, FileAccess.READ)
		if f != null:
			var parsed: Variant = JSON.parse_string(f.get_as_text())
			if typeof(parsed) == TYPE_DICTIONARY:
				_data = parsed
	return _data


static func recipes() -> Dictionary:
	return data().get("recipes", {})


## Pişme seviyesi -> kalite (0..1). 1.0 = tam kıvamında
static func cook_quality(c: float) -> float:
	if c < COOK_RAW:
		return 0.05
	if c < COOK_GOOD:
		return 0.3 + (c - COOK_RAW) / (COOK_GOOD - COOK_RAW) * 0.65
	if c <= COOK_OVER:
		return 1.0
	if c < COOK_BURNT:
		return 1.0 - (c - COOK_OVER) / (COOK_BURNT - COOK_OVER) * 0.65
	return 0.08


static func cook_label(c: float) -> String:
	if c < COOK_RAW:
		return "Çiğ"
	if c < COOK_GOOD:
		return "Az pişmiş"
	if c <= COOK_OVER:
		return "Tam kıvamında"
	if c < COOK_BURNT:
		return "Fazla pişmiş"
	return "Yanmış"


## 0 = çiğ, 1 = ideal, 2 = yanık (çizim için renk aşaması)
static func cook_stage(c: float) -> int:
	if c < COOK_RAW:
		return 0
	if c <= COOK_OVER:
		return 1
	return 2


## Elde taşınan 'ing' item'ı tabağa eklenecek katmana çevirir.
static func layer_from_ing(item: Dictionary) -> Dictionary:
	var id: String = item.get("id", "")
	var layer := {"id": id, "q": 1.0}
	if id == "kofte":
		var a: float = item.get("cookA", 0.0)
		var b: float = item.get("cookB", 0.0)
		layer.cook = (a + b) / 2.0
		layer.q = minf(cook_quality(a), cook_quality(b))
		if item.has("q"):
			layer.q = minf(layer.q, float(item.q))
		layer.cookA = a
		layer.cookB = b
	elif item.has("cook"):
		layer.cook = float(item.cook)
		layer.q = cook_quality(layer.cook)
	elif item.has("q"):
		layer.q = float(item.q)
	return layer


static func _ids(item: Dictionary) -> Array:
	var out: Array = []
	for l in item.get("layers", []):
		out.append(l.get("id", ""))
	return out


## Bir dish item'ın hangi tarif olduğunu tahmin eder; bulunamazsa "".
static func identify(item: Dictionary) -> String:
	if item.get("type", "") != "dish":
		return ""
	var have := _ids(item)
	var best := ""
	var best_score := -1
	for rid in recipes():
		var r: Dictionary = recipes()[rid]
		if r.get("base", "") != item.get("id", ""):
			continue
		var req: Array = r.get("required", [])
		var ok := true
		for x in req:
			if not have.has(x):
				ok = false
				break
		if not ok:
			continue
		var opt: Array = r.get("optional", [])
		var extra := 0
		for h in have:
			if not req.has(h) and not opt.has(h):
				extra += 1
		var score := req.size() * 10 - extra
		if score > best_score:
			best_score = score
			best = rid
	return best


## Item, sipariş satırını karşılıyor mu? -> {ok: bool, quality: float, notes: Array[String]}
## line: {type:"recipe", id:"kasarli_tost", want:[...]} veya {type:"product", id:"ayran"}
static func evaluate(item: Dictionary, line: Dictionary) -> Dictionary:
	var notes: Array = []
	if item.is_empty() or line.is_empty():
		return {"ok": false, "quality": 0.0, "notes": ["Geçersiz"]}
	if line.get("type", "") == "product":
		var okp: bool = item.get("type", "") == "product" and item.get("id", "") == line.get("id", "")
		return {"ok": okp, "quality": 1.0 if okp else 0.0, "notes": [] if okp else ["Yanlış ürün"]}
	var r: Dictionary = recipes().get(line.get("id", ""), {})
	if r.is_empty():
		return {"ok": false, "quality": 0.0, "notes": ["Bilinmeyen tarif"]}
	if item.get("type", "") != "dish" or item.get("id", "") != r.get("base", ""):
		return {"ok": false, "quality": 0.0, "notes": ["Yanlış yemek"]}
	var have := _ids(item)
	var req: Array = r.get("required", [])
	var opt: Array = r.get("optional", [])
	for x in req:
		if not have.has(x):
			return {"ok": false, "quality": 0.0, "notes": [name_of(x) + " eksik"]}
	var penalty := 0.0
	var want: Array = line.get("want", r.get("defaults", []))
	for w in want:
		if not have.has(w):
			penalty += 0.15
			notes.append(name_of(w) + " unutulmuş")
	var counted := {}
	for h in have:
		counted[h] = counted.get(h, 0) + 1
	for h in counted:
		if req.has(h):
			if counted[h] > 2:
				penalty += 0.1
				notes.append("Fazla " + name_of(h).to_lower())
			continue
		if opt.has(h):
			if not want.has(h):
				penalty += 0.25
				notes.append(name_of(h) + " istenmemişti")
			elif counted[h] > 2:
				penalty += 0.05
		else:
			penalty += 0.35
			notes.append(name_of(h) + " bu yemeğe konmaz")
	# pişme kalitesi: ortalama, ama en kötü katman ağır basar
	var layers: Array = item.get("layers", [])
	var cook_q := 1.0
	var sum := 0.0
	var worst := 1.0
	for l in layers:
		var q: float = l.get("q", 1.0)
		sum += q
		worst = minf(worst, q)
	if layers.size() > 0:
		cook_q = sum / layers.size()
	cook_q = minf(cook_q, worst * 0.6 + 0.4 * cook_q)
	if worst < 0.2:
		notes.append("Pişmesi berbat")
	var toast_q := 1.0
	var toast: float = item.get("toast", 0.0)
	if r.get("toast", false):
		toast_q = cook_quality(toast)
		if toast < COOK_RAW:
			notes.append("Tost basılmamış")
		elif toast > COOK_BURNT:
			notes.append("Tost yanmış")
	elif toast > 0.3:
		toast_q = 0.85
		notes.append("Neden tostlandı?")
	var quality := clampf(cook_q * toast_q * (1.0 - minf(0.9, penalty)), 0.0, 1.0)
	return {"ok": true, "quality": quality, "notes": notes}


static func name_of(id: String) -> String:
	var d := data()
	for key in ["ingredients", "prepared", "dishBases", "products", "recipes"]:
		var tbl: Dictionary = d.get(key, {})
		if tbl.has(id):
			return tbl[id].get("name", id)
	return id


## "Soğan" -> "soğansız", "Domates" -> "domatessiz" (Türkçe ünlü uyumu)
static func suffix_siz(word: String) -> String:
	var w := word.to_lower()
	var last := "e"
	for ch in w:
		if "aeıioöuü".contains(ch):
			last = ch
	var map := {"a": "sız", "ı": "sız", "e": "siz", "i": "siz", "o": "suz", "u": "suz", "ö": "süz", "ü": "süz"}
	return w + map[last]


## Sipariş satırının okunur etiketi: "Köfte Ekmek (soğansız, +turşu)"
static func line_label(line: Dictionary) -> String:
	if line.get("type", "") == "product":
		return name_of(line.get("id", ""))
	var r: Dictionary = recipes().get(line.get("id", ""), {})
	if r.is_empty():
		return line.get("id", "")
	var defaults: Array = r.get("defaults", [])
	var want: Array = line.get("want", defaults)
	var mods: Array = []
	for d in defaults:
		if not want.has(d):
			mods.append(suffix_siz(name_of(d)))
	for w in want:
		if not defaults.has(w):
			mods.append("+" + name_of(w).to_lower())
	var label: String = r.get("name", "")
	if mods.size() > 0:
		label += " (" + ", ".join(mods) + ")"
	return label


## Item'ın okunur adı
static func item_name(item: Dictionary) -> String:
	var type: String = item.get("type", "")
	var id: String = item.get("id", "")
	match type:
		"product":
			return name_of(id)
		"tool":
			return "Temizlik Bezi" if id == "bez" else id
		"ing":
			if item.has("cook"):
				return name_of(id) + " — " + cook_label(item.cook)
			return name_of(id)
		"dish":
			var rid := identify(item)
			if rid != "":
				return recipes()[rid].get("name", rid)
			var n: int = item.get("layers", []).size()
			return name_of(id) + (" +%d" % n if n > 0 else "")
	return ""
