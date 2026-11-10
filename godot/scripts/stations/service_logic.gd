extends RefCounted
## Vitrin, temizlik ve çöp istasyonlarının SAF mantığı (web js/stations_prep.js: vitrinLayout, DIRT_SPOTS,
## visibleDirtCount, updateWipe, itemCost, trash). Autoload kullanmaz; sahneler ve testler preload ile kullanır:
##   const Service := preload("res://scripts/stations/service_logic.gd")

# --- Vitrin --------------------------------------------------------------------

const VITRIN_COLS := 4
## Sıcak ve soğuk bölüm arasındaki ayıraç yüksekliği
const VITRIN_SEP := 8.0
const VITRIN_ROW_MAX := 80.0
## Cam iç alanı: üstte tabela (32), altta soğutma tabanı (58)
const VITRIN_TOP := 32.0
const VITRIN_BOTTOM := 58.0
const VITRIN_SIDE := 8.0
## Stok bu sayıya kadar turuncu rozet
const LOW_STOCK := 3


## Vitrin yerleşimi. products = data.products, stock = {id: adet}, level = oyuncu seviyesi.
## Sıcak raf: group "hazir" (unlu mamul + dış sipariş), soğutmalı bölüm: diğerleri (içecekler önce gelir, veri sırası).
## Stokta olanlar öne dizilir; satır sayısı stokta olanlara göre hesaplanır, stoksuzlar yalnızca boş hücrelere (soluk) girer.
## Dönüş: {gi: Rect2, cells: [{id, group, rect, row}], row_h, hot_rect, cold_rect, div_y, hr, cr}
static func vitrin_layout(area: Rect2, products: Dictionary, stock: Dictionary, level: int) -> Dictionary:
	var hot: Array = []
	var cold: Array = []
	for id: String in products:
		var p: Dictionary = products[id]
		if level < int(p.get("unlock", 1)):
			continue
		if p.get("group", "") == "hazir":
			hot.append(id)
		else:
			cold.append(id)
	var hl := _sort_stocked(hot, stock)
	var cl := _sort_stocked(cold, stock)
	var gi := Rect2(area.position.x + VITRIN_SIDE, area.position.y + VITRIN_TOP,
		area.size.x - VITRIN_SIDE * 2.0, area.size.y - VITRIN_TOP - VITRIN_BOTTOM)
	var hr := _rows_for(hl, stock)
	var cr := _rows_for(cl, stock)
	hl.resize(mini(hl.size(), hr * VITRIN_COLS))
	cl.resize(mini(cl.size(), cr * VITRIN_COLS))
	var row_h := minf(VITRIN_ROW_MAX, (gi.size.y - VITRIN_SEP - 6.0) / float(hr + cr))
	var cw := (gi.size.x - 8.0) / VITRIN_COLS
	var cells: Array = []
	var y := gi.position.y + 3.0
	y = _add_section(cells, hl, hr, "hazir", gi, cw, row_h, y)
	var div_y := y + 1.0
	y += VITRIN_SEP
	y = _add_section(cells, cl, cr, "paketli", gi, cw, row_h, y)
	var cold_top := div_y + VITRIN_SEP - 2.0
	return {
		"gi": gi,
		"cells": cells,
		"row_h": row_h,
		"hot_rect": Rect2(gi.position.x, gi.position.y, gi.size.x, div_y - gi.position.y),
		"cold_rect": Rect2(gi.position.x, cold_top, gi.size.x, gi.end.y - cold_top),
		"div_y": div_y,
		"hr": hr,
		"cr": cr,
	}


static func _stocked(id: String, stock: Dictionary) -> int:
	return 1 if int(stock.get(id, 0)) > 0 else 0


## Stokta olanlar önce, kendi aralarında veri sırası korunur (kararlı sıralama).
static func _sort_stocked(list: Array, stock: Dictionary) -> Array:
	var idx: Array = []
	for i in list.size():
		idx.append([list[i], i])
	idx.sort_custom(func(a: Array, b: Array) -> bool:
		var sa := _stocked(a[0], stock)
		var sb := _stocked(b[0], stock)
		if sa != sb:
			return sa > sb
		return a[1] < b[1])
	var out: Array = []
	for e: Array in idx:
		out.append(e[0])
	return out


static func _rows_for(list: Array, stock: Dictionary) -> int:
	var n := 0
	for id: String in list:
		n += _stocked(id, stock)
	return maxi(1, ceili(n / float(VITRIN_COLS)))


static func _add_section(cells: Array, list: Array, rows: int, group: String, gi: Rect2, cw: float, row_h: float, y: float) -> float:
	for r in rows:
		var items := list.slice(r * VITRIN_COLS, (r + 1) * VITRIN_COLS)
		var sx := gi.position.x + 4.0 + (VITRIN_COLS - items.size()) * cw * 0.5
		for k in items.size():
			cells.append({"id": items[k], "group": group, "rect": Rect2(sx + k * cw, y, cw, row_h), "row": r})
		y += row_h
	return y


## pt'nin altındaki vitrin hücresi ({} = yok)
static func cell_at(layout: Dictionary, pt: Vector2) -> Dictionary:
	for c: Dictionary in layout.cells:
		if (c.rect as Rect2).has_point(pt):
			return c
	return {}


static func any_stock(layout: Dictionary, stock: Dictionary) -> bool:
	for c: Dictionary in layout.cells:
		if int(stock.get(c.id, 0)) > 0:
			return true
	return false


## Vitrine bırakılabilir mi: bilinen hazır/paketli ürün.
static func vitrin_accepts(item: Dictionary, products: Dictionary) -> bool:
	return item.get("type", "") == "product" and products.has(item.get("id", ""))


static func vitrin_tooltip(p: Dictionary, n: int, price: int) -> String:
	var lines: Array = [p.get("name", "?"), "Stok: %d" % n, "Satış fiyatı: " + fmt_money(price)]
	if n <= 0:
		lines.append("Telefonla sipariş ver" if p.get("group", "") == "hazir" else "Toptancıdan sipariş ver")
	elif p.get("group", "") == "hazir":
		lines.append("Gün sonunda bozulur")
	return "\n".join(lines)


const VITRIN_EMPTY_TIP := "Vitrin boş\nTelefon/Toptancı'dan sipariş ver"


# --- Çöp ---------------------------------------------------------------------------

## Her çöpe atışta tezgah biraz kirlenir (web trash: KS.addDirt(0.3))
const TRASH_DIRT := 0.3


## Çöpe atılabilir mi: her item, bez (tool) hariç.
static func can_trash(item: Dictionary) -> bool:
	return not item.is_empty() and item.get("type", "") != "tool"


## Hammadde birim maliyeti (çiğ köfte = leğen malzemeleri / porsiyon, çay = paket / bardak).
static func ing_cost(id: String, data: Dictionary, batch: int = 8, glasses: int = 10) -> float:
	var ings: Dictionary = data.get("ingredients", {})
	if ings.has(id):
		return float(ings[id].get("cost", 0))
	if id == "cigkofte":
		var raw := 0.0
		for k: String in ["bulgur", "isot", "salca"]:
			raw += float(ings.get(k, {}).get("cost", 0))
		return raw / maxf(1.0, batch)
	if id == "cay":
		return float(ings.get("cay_yapragi", {}).get("cost", 0)) / maxf(1.0, glasses)
	return 0.0


## Çöpe giden item'ın maliyeti (israf). Ürün: alış fiyatı; yemek: taban + katmanlar.
static func item_cost(item: Dictionary, data: Dictionary, batch: int = 8, glasses: int = 10) -> float:
	var type: String = item.get("type", "")
	var id: String = item.get("id", "")
	var c := 0.0
	if type == "product":
		c = float(data.get("products", {}).get(id, {}).get("buy", 0))
	elif type == "ing":
		c = ing_cost(id, data, batch, glasses)
	elif type == "dish":
		c = ing_cost(id, data, batch, glasses)
		for l: Dictionary in item.get("layers", []):
			c += ing_cost(l.get("id", ""), data, batch, glasses)
	return roundf(c * 10.0) / 10.0


static func cop_tooltip(wasted: float) -> String:
	var s := "Çöp kutusu\nYanlış/yanmış yemeği buraya at"
	if roundi(wasted) > 0:
		s += "\nBugünkü israf: " + fmt_money(roundi(wasted))
	return s


## Çöp kutusu geometrisi (web copGeom)
static func cop_geom(area: Rect2) -> Dictionary:
	var cx := area.position.x + area.size.x * 0.5
	return {
		"cx": cx, "top": area.position.y + 52.0, "bottom": area.position.y + 142.0,
		"tw": 46.0, "bw": 40.0, "hinge": Vector2(cx + 50.0, area.position.y + 52.0),
	}


# --- Temizlik ------------------------------------------------------------------------

## Açıkken oyun saniyesi başına kirlenme (web update: KS.addDirt(dt * 0.05))
const DIRT_PER_SEC := 0.05
## Bezle lekenin üzerinden geçince piksel başına temizlik / boş yüzeyde
const WIPE_SPOT := 0.035
const WIPE_SURFACE := 0.005
const WIPE_PAD := 14.0
## Bu y'nin altı (tezgah + çalışma alanı) silinebilir yüzey
const SURFACE_Y := 352.0
## Servis tezgahı alt sınırı: bunun üstündeki lekeler tezgah üstünde
const COUNTER_BOTTOM := 422.0

## Sabit leke yerleri (web DIRT_SPOTS): servis tezgahı ve çalışma alanındaki boşluklar.
const DIRT_SPOTS := [
	{"pos": Vector2(452, 362), "r": 15.0, "type": "stain", "seed": 11},
	{"pos": Vector2(905, 398), "r": 13.0, "type": "sauce", "seed": 23},
	{"pos": Vector2(640, 366), "r": 18.0, "type": "crumbs", "seed": 37},
	{"pos": Vector2(1182, 393), "r": 17.0, "type": "oil", "seed": 41},
	{"pos": Vector2(1455, 364), "r": 14.0, "type": "stain", "seed": 53},
	{"pos": Vector2(786, 870), "r": 15.0, "type": "crumbs", "seed": 67},
	{"pos": Vector2(589, 522), "r": 12.0, "type": "sauce", "seed": 71},
	{"pos": Vector2(380, 866), "r": 14.0, "type": "stain", "seed": 83},
	{"pos": Vector2(812, 566), "r": 13.0, "type": "oil", "seed": 97},
	{"pos": Vector2(700, 638), "r": 13.0, "type": "crumbs", "seed": 101},
]
## Kirlilik eşikleri: temizlik < DIRT_T[k] iken k. leke görünür
const DIRT_T := [85.0, 72.0, 62.0, 53.0, 45.0, 37.0, 29.0, 21.0, 13.0, 6.0]
const DIRT_ORDER0 := [0, 5, 2, 7, 1, 9, 3, 6, 4, 8]


static func new_dirt_order() -> Array:
	return DIRT_ORDER0.duplicate()


static func visible_dirt_count(cleanliness: float) -> int:
	var n := 0
	for t: float in DIRT_T:
		if cleanliness < t:
			n += 1
	return n


## Görünen lekeler: [{spot, k, alpha}] (alpha eşik geçildikçe 0.2'den 1'e koyulaşır)
static func visible_spots(cleanliness: float, order: Array) -> Array:
	var out: Array = []
	for k in visible_dirt_count(cleanliness):
		out.append({"spot": DIRT_SPOTS[order[k]], "k": k, "alpha": clampf((DIRT_T[k] - cleanliness) / 6.0, 0.2, 1.0)})
	return out


## Bez eldeyken fare last → p hareket etti. Dönüş {clean: temizlik artışı, hit: lekeye değdi mi}.
## Ovulan leke "en son silinecek" sıraya alınır (order yerinde değişir) ki solan o olsun.
static func wipe(order: Array, cleanliness: float, p: Vector2, last: Vector2) -> Dictionary:
	var d := p.distance_to(last)
	var res := {"clean": 0.0, "hit": false}
	if d <= 0.5 or d >= 250.0:
		return res
	var n := visible_dirt_count(cleanliness)
	var hit := -1
	for k in n:
		var sp: Dictionary = DIRT_SPOTS[order[k]]
		if p.distance_to(sp.pos) < float(sp.r) + WIPE_PAD:
			hit = k
			break
	if hit >= 0:
		var last_k := n - 1
		if hit != last_k:
			var tmp: int = order[hit]
			order[hit] = order[last_k]
			order[last_k] = tmp
		res.clean = d * WIPE_SPOT
		res.hit = true
	elif p.y >= SURFACE_Y:
		res.clean = d * WIPE_SURFACE
	return res


static func is_bez(item: Dictionary) -> bool:
	return item.get("type", "") == "tool" and item.get("id", "") == "bez"


static func clean_color(c: float) -> Color:
	if c >= 70.0:
		return Color("#43d17a")
	if c >= 40.0:
		return Color("#ffc93c")
	return Color("#ff5a4f")


static func temizlik_tooltip(c: float) -> String:
	var ci := roundi(c)
	var s := "Temizlik: %" + str(ci)
	s += "\nBezi al, lekeleri sil" if ci < 70 else "\nTezgah tertemiz"
	if ci < 40:
		s += "\nDikkat: müfettiş gelirse ceza!"
	return s


## Temizlik istasyonu geometrisi (web tzGeom)
static func tz_geom(area: Rect2) -> Dictionary:
	var p := area.position
	return {
		"sink": Rect2(p.x + 10, p.y + 28, 134, 98),
		"basin": Rect2(p.x + 18, p.y + 44, 118, 72),
		"tap": Vector2(p.x + 112, p.y + 30),
		"bez": Rect2(p.x + 152, p.y + 22, 76, 84),
		"gauge": Rect2(p.x + 10, p.y + 140, area.size.x - 20, 48),
	}


# --- Ortak -----------------------------------------------------------------------------

static func fmt_money(tl: int) -> String:
	var s := str(absi(tl))
	var out := ""
	while s.length() > 3:
		out = "." + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if tl < 0 else "") + s + out + " ₺"
