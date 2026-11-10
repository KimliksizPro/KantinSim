extends Node2D
## Hazırlık tezgahı: kesme tahtası üstünde porselen tabaklar. Boş tabağa taban malzemesi (ekmek) konur,
## üstüne malzemeler eklenir; yemek tabaktan alınıp tost makinesine / müşteriye götürülür.
## Her tabak ayrı bir sürükle-bırak bölgesidir (web stations_prep.js "prep_tezgah_i").

const Logic := preload("res://scripts/stations/prep_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

const ZONE_Z := 5
const BOARD_H := 172.0
const COL_OK := Color(0.14, 0.47, 0.28, 0.95)
const COL_UNKNOWN := Color(0.27, 0.3, 0.345, 0.92)
const COL_TOAST := Color(0.9, 0.43, 0.08, 0.94)
const WOOD := [[0.0, Color("#d9a86c")], [0.5, Color("#c08a4f")], [1.0, Color("#a06c38")]]


## Tek tabağın bölgesi: işi tezgaha devreder.
class PlateZone:
	extends Node
	var zone_z: int = 5
	var index: int = 0
	var tezgah: Node2D

	func _ready() -> void:
		Drag.register(self)

	func _exit_tree() -> void:
		Drag.unregister(self)

	func zone_rect() -> Rect2:
		return tezgah.call("plate_zone_rect", index)

	func pick(_pt: Vector2) -> Dictionary:
		return tezgah.call("take_plate", index)

	func return_item(item: Dictionary) -> void:
		tezgah.call("return_dish", item, index)

	func can_drop(item: Dictionary) -> bool:
		return tezgah.call("can_drop_on", index, item)

	func drop(item: Dictionary, _pt: Vector2) -> bool:
		return tezgah.call("drop_on", index, item)

	func hover_text(_pt: Vector2) -> String:
		return tezgah.call("plate_tooltip", index)


## Tabaklar: null = boş, Dictionary = dish item
var plates: Array = Logic.new_plates()
var _zones: Array = []
var _bump: Array = []
var _hover: int = -1


func _ready() -> void:
	set_plate_count(_upgrade_plates())
	Drag.returned.connect(_on_drag_returned)


## Tezgah geliştirmesinin tabak sayısı (geliştirme sistemi gelene kadar 1. kademe).
func _upgrade_plates() -> int:
	var levels: Array = GameData.upgrades.get("tezgah", {}).get("levels", [])
	return int(levels[0].get("plates", Logic.DEFAULT_PLATES)) if levels.size() > 0 else Logic.DEFAULT_PLATES


func _station_name() -> String:
	var up: Dictionary = GameData.upgrades.get("tezgah", {})
	var levels: Array = up.get("levels", [])
	return levels[0].get("name", "Hazırlık Tezgahı") if levels.size() > 0 else up.get("name", "Hazırlık Tezgahı")


## Tabak sayısını değiştirir (geliştirme); taşan yemekler boş tabaklara aktarılır.
func set_plate_count(n: int) -> void:
	n = clampi(n, 1, Logic.MAX_PLATES)
	var old := plates
	plates = Logic.new_plates(n)
	for d in old:
		if d != null:
			Logic.place_dish_back(plates, d)
	_bump.resize(n)
	_bump.fill(0.0)
	while _zones.size() > n:
		(_zones.pop_back() as Node).queue_free()
	while _zones.size() < n:
		var z := PlateZone.new()
		z.index = _zones.size()
		z.zone_z = ZONE_Z
		z.tezgah = self
		z.name = "Tabak%d" % z.index
		_zones.append(z)
		add_child(z)
	queue_redraw()


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


# --- Yerleşim (web plateSlot / plateZoneRect / plateGeom) ---------------------------

func plate_slot(i: int) -> Rect2:
	var a := GameData.rect("tezgah")
	var sw := a.size.x / plates.size()
	return Rect2(a.position.x + i * sw, a.position.y, sw, a.size.y)


func plate_zone_rect(i: int) -> Rect2:
	var s := plate_slot(i)
	return Rect2(s.position.x + 6, s.position.y + 26, s.size.x - 12, s.size.y - 30)


func _geom(i: int) -> Dictionary:
	var s := plate_slot(i)
	var board := Rect2(s.position.x + 10, s.position.y + 30, s.size.x - 20, BOARD_H)
	var rx := roundf(minf(board.size.x * 0.5 - 10.0, 86.0))
	return {
		"slot": s, "board": board, "rx": rx, "ry": roundf(rx * 0.6),
		"c": Vector2(s.get_center().x, board.position.y + 88.0),
		"scale": clampf(rx / 72.0, 0.7, 1.2), "ly": s.position.y + 222.0,
	}


# --- Tabak işlemleri (PlateZone ve diğer sahneler için) -----------------------------

func take_plate(i: int) -> Dictionary:
	var d := Logic.take_plate(plates, i)
	queue_redraw()
	return d


func return_dish(item: Dictionary, pref: int) -> void:
	if item.get("type", "") != "dish":
		return
	var j := Logic.place_dish_back(plates, item, pref)
	if j < 0:
		push_warning("tezgah: tabak geri konamadı")
		return
	_bump[j] = _now()
	queue_redraw()


## Boş bir tabağa yemek koyar (ör. başka istasyondan dönen yemek). Yer yoksa false.
func put_dish(dish: Dictionary) -> bool:
	if dish.get("type", "") != "dish":
		return false
	var j := Logic.place_dish_back(plates, dish)
	if j < 0:
		return false
	_bump[j] = _now()
	queue_redraw()
	return true


func can_drop_on(i: int, item: Dictionary) -> bool:
	return Logic.plate_check(plates, i, item, true).ok


func drop_on(i: int, item: Dictionary) -> bool:
	var res := Logic.drop_on_plate(plates, i, item)
	if not res.ok:
		_warn(i, res.msg)
		return false
	_bump[res.index] = _now()
	if res.warn != "":
		_warn(res.index, res.warn)
	queue_redraw()
	return true


func plate_tooltip(i: int) -> String:
	return Logic.plate_tooltip(plates[i])


func _warn(i: int, msg: String) -> void:
	if msg == "":
		return
	var g := _geom(i)
	Game.float_text.emit(g.c + Vector2(0, -40), msg, Game.COLOR_BAD)


## Tabağa bırakılamayan item kaynağına dönünce nedenini söyle ("Önce tabağa ekmek koy" ...).
func _on_drag_returned(item: Dictionary, to: Node) -> void:
	var m := get_viewport().get_mouse_position()
	for i in plates.size():
		if plate_zone_rect(i).has_point(m):
			if to != _zones[i]:
				_warn(i, Logic.plate_check(plates, i, item, true).msg)
			return


# --- Çizim --------------------------------------------------------------------------

func _process(_dt: float) -> void:
	var m := get_viewport().get_mouse_position()
	_hover = -1
	for i in plates.size():
		if plate_zone_rect(i).has_point(m):
			_hover = i
	queue_redraw()


func _draw() -> void:
	var area := GameData.rect("tezgah")
	# fırçalanmış çelik parıltısı (panel arka plan katmanında)
	Draw.rr_grad(self, area.grow(-2), 13, [[0.0, Color(1, 1, 1, 0.12)], [0.5, Color(1, 1, 1, 0.0)], [1.0, Color(0, 0, 0, 0.08)]], 1.0, Vector2(0, 0), Vector2(1, 1))
	for i in plates.size():
		_draw_plate_slot(i)
	Draw.station_label(self, area, _station_name())


func _draw_plate_slot(i: int) -> void:
	var g := _geom(i)
	var c: Vector2 = g.c
	var rx: float = g.rx
	var ry: float = g.ry
	_draw_board(g.board, i)
	_draw_plate(c, rx, ry)
	var p: Variant = plates[i]
	if p == null:
		Draw.text(self, "Boş tabak", Vector2(c.x, g.ly), 12, Color(0.16, 0.18, 0.22, 0.55))
		if i == _hover and Drag.is_holding() and can_drop_on(i, Drag.held):
			Draw.ellipse(self, c, rx + 4, ry + 4, Color(0.6, 1.0, 0.65, 0.2))
		return
	var dish: Dictionary = p
	var hov := i == _hover and not Drag.is_holding()
	if hov:
		Draw.ellipse(self, c, rx + 4, ry + 4, Color(1, 1, 1, 0.22))
	var b := Logic.bump_scale(_bump[i], _now(), 0.14)
	var iw: float = 104.0 * g.scale * b
	var ic := c + Vector2(0, -6 - (3 if hov else 0))
	Draw.ellipse_shadow(self, ic + Vector2(3, iw * 0.3), iw * 0.42, iw * 0.14, Color(0.1, 0.06, 0.03, 0.3), 5.0, 4)
	ItemView.draw_item(self, dish, ic, iw)
	# "tost makinesine götür" rozeti
	var rid := Recipes.identify(dish)
	var board: Rect2 = g.board
	if Logic.needs_toast(dish):
		var tr := Rect2(board.end.x - 62, board.position.y + 8, 54, 18)
		Draw.rr(self, tr, 9, COL_TOAST, 1.0, Color(1, 1, 1, 0.3), 3.0, Color(0, 0, 0, 0.25), Vector2(0, 1))
		Draw.text(self, "→ Tost", tr.get_center(), 11, Color.WHITE)
	# isim etiketi
	var label: String = Recipes.recipes()[rid].get("name", rid) if rid != "" else "?"
	var max_w: float = g.slot.size.x - 20.0
	var fs := Draw.fit_size(label, max_w - 22, 14, 9)
	var tw := minf(max_w, Draw.text_size(label, fs).x + 24.0)
	var lr := Rect2(c.x - tw * 0.5, g.ly - 11, tw, 22)
	Draw.rr(self, lr, 11, COL_OK if rid != "" else COL_UNKNOWN, 1.0, Color(1, 1, 1, 0.3), 4.0, Color(0, 0, 0, 0.25), Vector2(0, 2))
	Draw.text(self, label, lr.get_center(), fs, Color.WHITE)


## Ahşap kesme tahtası: damarlar, bıçak izleri, tutma deliği.
func _draw_board(r: Rect2, seed_i: int) -> void:
	Draw.rr(self, r, 14, Color("#7a4d26"), 0.0, Color.TRANSPARENT, 8.0, Color(0, 0, 0, 0.42), Vector2(2, 4))
	Draw.rr_grad(self, r, 14, WOOD)
	# sol üstten ışık
	Draw.rr_grad(self, r, 14, [[0.0, Color(1.0, 0.92, 0.76, 0.3)], [0.55, Color(1.0, 0.92, 0.76, 0.0)], [1.0, Color(0.3, 0.16, 0.06, 0.2)]], 1.0, Vector2(0, 0), Vector2(1, 1))
	var rng := RandomNumberGenerator.new()
	rng.seed = int(r.size.x) * 13 + seed_i * 101
	# damarlar
	var grain := Color(0.43, 0.24, 0.1, 0.24)
	for k in 9:
		var yy := r.position.y + 10 + rng.randf() * (r.size.y - 20)
		var pts := PackedVector2Array()
		var amp := (rng.randf() - 0.5) * 7.0
		var ph := rng.randf() * TAU
		for s in 13:
			var t := s / 12.0
			pts.append(Vector2(r.position.x + 5 + t * (r.size.x - 10), yy + sin(t * 3.2 + ph) * amp))
		draw_polyline(pts, grain, 1.0, true)
	# bıçak izleri
	var cut := Color(1.0, 0.94, 0.84, 0.28)
	for k in 6:
		var p0 := Vector2(r.position.x + 12 + rng.randf() * (r.size.x - 46), r.position.y + 14 + rng.randf() * (r.size.y - 30))
		draw_line(p0, p0 + Vector2(14 + rng.randf() * 18, (rng.randf() - 0.5) * 10), cut, 1.0, true)
	# kenar: üstte açık pah, altta koyu kalınlık
	Draw.rr(self, r, 14, Color.TRANSPARENT, 1.5, Color(0.27, 0.15, 0.055, 0.6))
	Draw.rr(self, r.grow(-1.5), 12.5, Color.TRANSPARENT, 1.0, Color(1.0, 0.9, 0.72, 0.22))
	# tutma deliği
	var hole := Rect2(r.end.x - 26, r.position.y + 9, 16, 8)
	Draw.rr(self, hole, 4, Color(0.16, 0.085, 0.04, 0.8), 1.0, Color(1.0, 0.9, 0.75, 0.3))


## Porselen tabak: gölge, kenar, mavi süs çizgisi, iç çukur, parlama.
func _draw_plate(c: Vector2, rx: float, ry: float) -> void:
	Draw.ellipse_shadow(self, c + Vector2(4, 8), rx, ry, Color(0.12, 0.07, 0.03, 0.4), 8.0)
	# kenar
	var rim := Draw.grad([[0.0, Color("#ffffff")], [0.7, Color("#f1f3f6")], [1.0, Color("#cfd5dc")]], Vector2(0.35, 0.3), Vector2(1.0, 0.85), true)
	Draw.ellipse_grad(self, c, rx, ry, rim)
	Draw.ellipse_line(self, c, rx, ry, Color(0.31, 0.35, 0.41, 0.4), 1.2)
	# alt kenarda kalınlık gölgesi
	Draw.ellipse_line(self, c, rx - 1.5, ry - 1.5, Color(0.45, 0.5, 0.58, 0.28), 2.0, 0.15, PI * 0.7)
	# süs çizgisi
	Draw.ellipse_line(self, c, rx * 0.92, ry * 0.92, Color(0.235, 0.43, 0.705, 0.6), 1.6)
	# iç çukur
	var well := Draw.grad([[0.0, Color("#d5dbe2")], [0.5, Color("#f6f7f9")], [1.0, Color("#ffffff")]])
	Draw.ellipse_grad(self, c + Vector2(0, 1), rx * 0.7, ry * 0.68, well)
	Draw.ellipse_line(self, c + Vector2(0, 1), rx * 0.7, ry * 0.68, Color(0.47, 0.51, 0.57, 0.3), 1.0)
	# sol üstte parlama
	Draw.ellipse_line(self, c, rx * 0.84, ry * 0.8, Color(1, 1, 1, 0.95), 2.2, PI * 1.08, PI * 1.42)
