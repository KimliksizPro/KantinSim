extends Node2D
## Malzeme kutuları: 4x5 gastronom küvet. Kutudan malzeme alınır (stok düşer), pişmemiş malzeme geri bırakılabilir.
## Tek bir sürükle-bırak bölgesidir; hangi kutu olduğu pt'ye göre bulunur (web stations_prep.js "prep_bins").

const Logic := preload("res://scripts/stations/prep_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

const PAN_H := 60.0
const ICON_SCALE := 1.3
const COL_WARN := Color("#ff8c1a")
const COL_EMPTY := Color("#c0392b")
const COL_LOCK := Color("#5a6a7e")
const COL_OUT := Color("#d63a2a")
## Kutudaki sprite yerleşimi: adet -> [dx, dy, boyut]
const ICON_POS := {
	1: [[0, 3, 33]],
	2: [[-11, 3, 31], [11, 1, 31]],
	3: [[-15, 5, 28], [15, 5, 28], [0, -3, 30]],
}

## Drag bölge protokolü
var zone_z: int = 5
var no_highlight: bool = true

var _bump: Dictionary = {}       # id -> zaman (sn)
var _low_warned: Dictionary = {}
var _hover: int = -1


func _ready() -> void:
	Drag.register(self)
	Game.inventory_changed.connect(_on_inventory_changed)


func _exit_tree() -> void:
	Drag.unregister(self)


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _level() -> int:
	# Seviye sistemi gelince Game.level okunur; şimdilik 1.
	var v: Variant = Game.get("level")
	return int(v) if v != null else 1


func _area() -> Rect2:
	return GameData.rect("bins")


func _cols() -> int:
	return int(GameData.layout.get("bins", {}).get("cols", 4))


func _rows() -> int:
	return int(GameData.layout.get("bins", {}).get("rows", 5))


func _bin_rect(i: int) -> Rect2:
	return Logic.bin_rect(_area(), i, _cols(), _rows())


func _id_at(pt: Vector2) -> String:
	var i := Logic.bin_index_at(_area(), pt, GameData.bin_order.size(), _cols(), _rows())
	return GameData.bin_order[i] if i >= 0 else ""


func _on_inventory_changed(_id: String, _count: int) -> void:
	queue_redraw()


# --- Bölge protokolü -------------------------------------------------------------

func zone_rect() -> Rect2:
	return _area()


func pick(pt: Vector2) -> Dictionary:
	var id := _id_at(pt)
	if id == "" or not Game.inv_take(id, 1):
		return {}
	_bump[id] = _now()
	var n := Game.inv_get(id)
	var r := _bin_rect(GameData.bin_order.find(id))
	var ing_name: String = GameData.ingredients[id].get("name", id)
	if n <= 0:
		Game.float_text.emit(Vector2(r.get_center().x, r.position.y + 10), ing_name + " bitti!", Game.COLOR_BAD)
	elif n <= Logic.LOW_STOCK and not _low_warned.has(id):
		_low_warned[id] = true
		Game.float_text.emit(Vector2(r.get_center().x, r.position.y + 10), "%s azalıyor: %d kaldı" % [ing_name, n], Game.COLOR_INFO)
	return Logic.make_ing(id)


func click(pt: Vector2) -> void:
	var id := _id_at(pt)
	if id != "" and Game.inv_get(id) <= 0:
		var r := _bin_rect(GameData.bin_order.find(id))
		Game.float_text.emit(Vector2(r.get_center().x, r.position.y + 10), GameData.ingredients[id].get("name", id) + " bitti!", Game.COLOR_BAD)


func return_item(item: Dictionary) -> void:
	if item.get("type", "") == "ing" and GameData.ingredients.has(item.get("id", "")):
		Game.inv_add(item.id, 1)


func can_drop(item: Dictionary) -> bool:
	return Logic.is_returnable_ing(item)


func drop(item: Dictionary, _pt: Vector2) -> bool:
	if not Logic.is_returnable_ing(item):
		return false
	Game.inv_add(item.id, 1)
	_bump[item.id] = _now()
	return true


func hover_text(pt: Vector2) -> String:
	var id := _id_at(pt)
	if id == "":
		return ""
	return Logic.bin_tooltip(id, Game.inv_get(id), _level())


# --- Çizim -----------------------------------------------------------------------

func _process(_dt: float) -> void:
	var m := get_viewport().get_mouse_position()
	_hover = Logic.bin_index_at(_area(), m, GameData.bin_order.size(), _cols(), _rows()) if not Drag.is_holding() else -1
	queue_redraw()


func _draw() -> void:
	var area := _area()
	# raf gövdesi: arka plandaki çelik panelin üstüne koyu iç hazne
	Draw.rr_grad(self, area.grow(-3), 12, [[0.0, Color(0.04, 0.055, 0.08, 0.38)], [1.0, Color(0.04, 0.055, 0.08, 0.16)]])
	var order: Array = GameData.bin_order
	for i in order.size():
		_draw_bin(i, order[i])
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_bin(i: int, id: String) -> void:
	var ing: Dictionary = GameData.ingredients.get(id, {})
	if ing.is_empty():
		return
	var r := _bin_rect(i)
	var w := r.size.x
	var h := r.size.y
	var n := Game.inv_get(id)
	var empty := n <= 0
	var low := n > 0 and n <= Logic.LOW_STOCK
	var hov := i == _hover
	var b := Logic.bump_scale(_bump.get(id, 0.0), _now(), 0.1)
	var now := _now()

	# hücre gölgesi (ışık sol üstten)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	Draw.rr(self, Rect2(r.position + Vector2(2, 4), r.size), 10, Color(0, 0, 0, 0.28))

	# hücre: merkez etrafında zıplama + hover'da hafif kalkma
	var c := r.size * 0.5
	var origin := r.position + c * (1.0 - b) + (Vector2(0, -2) if hov else Vector2.ZERO)
	draw_set_transform(origin, 0.0, Vector2(b, b))

	var fill := Logic.bin_fill(id, n)
	_draw_pan(id, ing, w, fill.icons, fill.heap, 0.5 if empty else 1.0)

	# isim şeridi
	var ly := PAN_H + 1.0
	var lh := h - PAN_H - 2.0
	Draw.rr(self, Rect2(1, ly, w - 2, lh), 6, Color(0.18, 0.23, 0.28, 0.95) if hov else Color(0.1, 0.125, 0.157, 0.9))
	var label := Logic.bin_label(id)
	var fs := Draw.fit_size(label, w - 8, 12, 8)
	Draw.text(self, label, Vector2(w * 0.5, ly + lh * 0.5), fs, Color("#9aa3ad") if empty else Color("#f3f1ea"))

	# stok rozeti
	var s := str(n)
	var bw := 12.0 + s.length() * 6.5
	var badge := Rect2(w - bw - 3, 3, bw, 15)
	var bcol := COL_EMPTY if empty else (COL_WARN if low else Color(0.12, 0.15, 0.19, 0.88))
	Draw.rr(self, badge, 7.5, bcol, 1.0, Color(1, 1, 1, 0.35))
	Draw.text(self, s, badge.get_center(), 11, Color.WHITE)

	if hov and not empty:
		Draw.rr(self, Rect2(Vector2.ZERO, r.size), 10, Color.TRANSPARENT, 2.0, Color(1, 1, 1, 0.65))

	# az stok uyarısı: turuncu nabız
	if low:
		var p := 0.5 + 0.5 * sin(now * 5.0 + i)
		var wc := COL_WARN
		wc.a = 0.45 + 0.4 * p
		Draw.rr(self, Rect2(-1, -1, w + 2, h + 2), 11, Color.TRANSPARENT, 2.5, wc)

	# bitti / kilit damgası
	if empty:
		var ul := Logic.ing_unlock_level(id)
		var locked := ul > _level()
		var col := COL_LOCK if locked else COL_OUT
		draw_set_transform(origin + Vector2(w * 0.5, 31) * b, -0.18, Vector2(b, b))
		Draw.rr(self, Rect2(-30, -10, 60, 20), 5, Color(1, 1, 1, 0.8), 2.0, col, 3.0, Color(0, 0, 0, 0.25), Vector2(1, 2))
		Draw.text(self, "Seviye %d" % ul if locked else "Bitti", Vector2(0, 0), 11 if locked else 13, col)


## Gastronom küvet: çelik kenar, koyu hazne, malzeme yığını ve sprite'lar.
func _draw_pan(id: String, ing: Dictionary, w: float, icons: int, heap: int, alpha: float) -> void:
	var col := Color(ing.get("color", "#cccccc"))
	var outer := Rect2(1, 1, w - 2, PAN_H - 4)
	# dış kenar
	Draw.rr(self, outer, 9, Color(0, 0, 0, 0.0), 0.0, Color.TRANSPARENT, 4.0, Color(0, 0, 0, 0.35 * alpha), Vector2(1, 2))
	Draw.rr_grad(self, outer, 9, [[0.0, Color("#f7f9fb")], [0.45, Color("#c9d0d7")], [1.0, Color("#8d97a1")]], alpha)
	Draw.rr(self, outer, 9, Color.TRANSPARENT, 1.0, Color(1, 1, 1, 0.7 * alpha))
	# iç hazne
	var inner := Rect2(6, 6, w - 12, PAN_H - 15)
	Draw.rr_grad(self, inner, 6, [[0.0, Color("#56606b")], [0.5, Color("#8893a0")], [1.0, Color("#bcc5cd")]], alpha)
	Draw.rr_grad(self, inner, 6, [[0.0, Color(0, 0, 0, 0.45)], [0.24, Color(0, 0, 0, 0.0)], [1.0, Color(0, 0, 0, 0.0)]], alpha)
	var bottom := inner.end.y
	var cx := w * 0.5
	var rng := RandomNumberGenerator.new()
	if heap > 0:
		# malzeme yığını
		var mh := 3.0 + heap * 3.4
		var rx := inner.size.x * 0.5 - 2.0
		var pts := Draw.ellipse_points(Vector2(cx, bottom), rx, mh + 2.0, PI, TAU, 24)
		var tex := Draw.grad([[0.0, Draw.shade(col, 0.25)], [0.6, col], [1.0, Draw.shade(col, 0.45 * -1.0)]], Vector2(0.38, 0.3), Vector2(1.05, 1.1), true)
		Draw.fill_grad(self, pts, Rect2(cx - rx, bottom - mh - 2.0, rx * 2.0, mh + 2.0), tex, alpha)
		# tanecikler
		rng.seed = GameData.bin_order.find(id) * 31 + heap
		for k in 10 + heap * 3:
			var a := PI + rng.randf() * PI
			var rr2 := rng.randf()
			var p := Vector2(cx + cos(a) * (rx - 4.0) * rr2, bottom - 1.0 + sin(a) * (mh - 1.0) * rr2)
			var sc := Draw.shade(col, 0.35) if rng.randf() < 0.5 else Draw.shade(col, -0.35)
			sc.a = 0.75 * alpha
			draw_circle(p, 1.0 + rng.randf() * 1.3, sc)
	else:
		# boş: birkaç kırıntı
		rng.seed = GameData.bin_order.find(id) * 7 + 3
		for k in 5:
			var cc := col
			cc.a = 0.55 * alpha
			draw_circle(Vector2(inner.position.x + 6 + rng.randf() * (inner.size.x - 12), bottom - 5 - rng.randf() * 8), 1.0 + rng.randf() * 1.4, cc)
	# malzeme sprite'ları
	var tex_ing := ItemView.tex("ing", id)
	if icons > 0 and tex_ing != null:
		var cy := inner.position.y + inner.size.y * 0.5 + 3.0
		for p in ICON_POS[icons]:
			var iw: float = p[2] * ICON_SCALE
			var ih := iw * tex_ing.get_height() / float(tex_ing.get_width())
			var pos := Vector2(cx + p[0], cy + p[1])
			Draw.ellipse(self, pos + Vector2(1.5, ih * 0.36), iw * 0.36, iw * 0.11, Color(0, 0, 0, 0.22))
			draw_texture_rect(tex_ing, Rect2(pos - Vector2(iw, ih) * 0.5, Vector2(iw, ih)), false, Color(1, 1, 1, alpha))
	# sol üstten parlama
	Draw.rr_grad(self, outer, 9, [[0.0, Color(1, 1, 1, 0.24)], [0.35, Color(1, 1, 1, 0.0)], [1.0, Color(1, 1, 1, 0.0)]], alpha, Vector2(0, 0), Vector2(1, 1))
