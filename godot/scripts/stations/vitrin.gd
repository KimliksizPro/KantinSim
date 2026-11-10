extends Node2D
## Vitrin: hazır ve paketli ürünlerin camlı soğutmalı dolabı (web js/stations_prep.js "5) VİTRİN", zone prep_vitrin).
## Üst sıcak raf (turuncu ışık): simit, poğaça, dış sipariş ürünleri. Alttaki soğutmalı bölüm (mavi ışık): içecekler,
## atıştırmalıklar. Ürüne basınca stoktan bir tane ele alınır; ürün vitrine geri bırakılırsa stoğa döner.
## Saf yerleşim hesabı service_logic.gd'de.
##
## Demo (yalnız ekran görüntüsü için): `-- --vitrin-demo` → dış sipariş ürünlerinden birkaç tane stoğa ekler.

const Service := preload("res://scripts/stations/service_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")
const Logic := preload("res://scripts/stations/prep_logic.gd")

## Drag bölge protokolü (web prep_vitrin: z 5, noHighlight)
var zone_z: int = 5
var no_highlight: bool = true

const BASE_H := 56.0
const FRAME_CUT := 52.0
const PRODUCT_MAX := 54.0
## Ürün görseli, web çizim boyutuna göre bu kadar büyük çizilir (sprite'ın şeffaf kenar payı)
const SPRITE_K := 1.3
const COL_BADGE := Color(0.08, 0.1, 0.13, 0.85)
const COL_BADGE_LOW := Color("#ff8c1a")
const COL_BADGE_OUT := Color(0.59, 0.16, 0.12, 0.92)
const COL_PRICE := Color("#7a1a10")

var _area: Rect2
var _layout: Dictionary = {}
var _dirty := true
var _bump: Dictionary = {}
var _hover_id := ""
var _time := 0.0
var _light_hot: PointLight2D
var _light_cold: PointLight2D


func _ready() -> void:
	_area = GameData.rect("vitrin")
	# Vitrin kendi ışığından etkilenmez (iç ışık elle çizilir); ışıklar yalnız çevreye (duvar / tezgah) hafifçe vurur.
	light_mask = 0
	_build_lights()
	Drag.register(self)
	Game.products_changed.connect(_on_products_changed)
	_apply_demo_args()


func _exit_tree() -> void:
	Drag.unregister(self)


func _apply_demo_args() -> void:
	if OS.get_cmdline_user_args().has("--vitrin-demo"):
		Game.prod_add("et_doner", 2)
		Game.prod_add("tavuk_doner", 1)
		Game.prod_take("cips", Game.prod_get("cips") - 2)


func _on_products_changed(_id: String, _n: int) -> void:
	_dirty = true


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _level() -> int:
	var v: Variant = Game.get("level")
	return int(v) if v != null else 1


func _get_layout() -> Dictionary:
	if _dirty or _layout.is_empty():
		_layout = Service.vitrin_layout(_area, GameData.products, Game.products, _level())
		_dirty = false
	return _layout


func _price(id: String) -> int:
	return Game.price_of({"type": "product", "id": id})


# --- Bölge protokolü -------------------------------------------------------------

func zone_rect() -> Rect2:
	return _area


func pick(pt: Vector2) -> Dictionary:
	var c := Service.cell_at(_get_layout(), pt)
	if c.is_empty() or not Game.prod_take(c.id, 1):
		return {}
	_bump[c.id] = _now()
	return Items.product(c.id)


func click(pt: Vector2) -> void:
	var c := Service.cell_at(_get_layout(), pt)
	if not c.is_empty() and Game.prod_get(c.id) <= 0:
		var r: Rect2 = c.rect
		Game.float_text.emit(Vector2(r.get_center().x, r.position.y + 8.0), "Stok yok!", Game.COLOR_BAD)


func return_item(item: Dictionary) -> void:
	if item.get("type", "") == "product":
		Game.prod_add(item.id, 1)


func can_drop(item: Dictionary) -> bool:
	return Service.vitrin_accepts(item, GameData.products)


func drop(item: Dictionary, _pt: Vector2) -> bool:
	if not can_drop(item):
		return false
	Game.prod_add(item.id, 1)
	_bump[item.id] = _now()
	return true


func hover_text(pt: Vector2) -> String:
	var v := _get_layout()
	var c := Service.cell_at(v, pt)
	if c.is_empty():
		return "" if Service.any_stock(v, Game.products) else Service.VITRIN_EMPTY_TIP
	return Service.vitrin_tooltip(GameData.products.get(c.id, {}), Game.prod_get(c.id), _price(c.id))


# --- Güncelleme ------------------------------------------------------------------

func _process(dt: float) -> void:
	_time += dt
	var m := get_viewport().get_mouse_position()
	_hover_id = ""
	if not Drag.is_holding():
		var c := Service.cell_at(_get_layout(), m)
		if not c.is_empty() and Game.prod_get(c.id) > 0:
			_hover_id = c.id
	var v := _get_layout()
	var hot_on := false
	for c: Dictionary in v.cells:
		if c.group == "hazir" and Game.prod_get(c.id) > 0:
			hot_on = true
	_light_hot.energy = (0.42 if hot_on else 0.2) + 0.03 * sin(_time * 2.1)
	queue_redraw()


func _build_lights() -> void:
	var tex := Draw.grad([[0.0, Color(1, 1, 1, 1)], [0.5, Color(1, 1, 1, 0.35)], [1.0, Color(1, 1, 1, 0)]],
		Vector2(0.5, 0.5), Vector2(1.0, 0.5), true)
	_light_hot = PointLight2D.new()
	_light_hot.texture = tex
	_light_hot.texture_scale = 4.4
	_light_hot.color = Color(1.0, 0.62, 0.3)
	_light_hot.energy = 0.4
	_light_hot.position = Vector2(_area.end.x + 6.0, _area.position.y + 100.0)
	add_child(_light_hot)
	_light_cold = PointLight2D.new()
	_light_cold.texture = tex
	_light_cold.texture_scale = 4.0
	_light_cold.color = Color(0.45, 0.72, 1.0)
	_light_cold.energy = 0.3
	_light_cold.position = Vector2(_area.end.x + 6.0, _area.position.y + 230.0)
	add_child(_light_cold)


# --- Çizim -----------------------------------------------------------------------

func _cpoly(pts: PackedVector2Array, col: Color) -> void:
	if not Geometry2D.triangulate_polygon(pts).is_empty():
		draw_colored_polygon(pts, col)


func _draw() -> void:
	var L := _area
	var v := _get_layout()
	var gi: Rect2 = v.gi
	var frame := Rect2(L.position, Vector2(L.size.x, L.size.y - FRAME_CUT))
	# gölge (ışık sol üstten → sağ alta düşer)
	Draw.rr(self, Rect2(frame.position + Vector2(5, 7), frame.size), 16, Color(0, 0, 0, 0.0), 0.0, Color.TRANSPARENT,
		10.0, Color(0, 0, 0, 0.32), Vector2(3, 5))
	# çelik gövde
	Draw.rr_grad(self, frame, 16, [[0.0, Color("#8f99a3")], [0.06, Color("#e6ebef")], [0.5, Color("#b7c0c8")],
		[0.94, Color("#e6ebef")], [1.0, Color("#7f8a95")]], 1.0, Vector2(0, 0), Vector2(1, 0))
	Draw.rr_grad(self, frame, 16, [[0.0, Color(1, 1, 1, 0.22)], [0.3, Color(1, 1, 1, 0.0)], [0.85, Color(0, 0, 0, 0.0)], [1.0, Color(0, 0, 0, 0.18)]])
	Draw.rr(self, frame, 16, Color.TRANSPARENT, 1.5, Color(0.16, 0.19, 0.23, 0.7))
	_draw_sign(L)
	_draw_glass(v, gi)
	_draw_base(L)


func _draw_sign(L: Rect2) -> void:
	var hs := Rect2(L.position.x + 12, L.position.y + 5, L.size.x - 24, 22)
	Draw.rr(self, hs, 8, Color(0, 0, 0, 0), 0.0, Color.TRANSPARENT, 3.0, Color(0, 0, 0, 0.3), Vector2(0, 2))
	Draw.rr_grad(self, hs, 8, [[0.0, Color("#e2503c")], [0.5, Color("#c2321f")], [1.0, Color("#8a1a10")]])
	Draw.rr_grad(self, hs.grow(-1), 7, [[0.0, Color(1, 1, 1, 0.28)], [0.45, Color(1, 1, 1, 0.0)], [1.0, Color(1, 1, 1, 0.0)]])
	Draw.rr(self, hs, 8, Color.TRANSPARENT, 1.0, Color(1.0, 0.86, 0.7, 0.5))
	for k in 6:
		var on := int(floor(_time * 2.0 + k)) % 2 == 0
		var bx := hs.position.x + 10.0 + k * 12.0 if k < 3 else hs.end.x - 10.0 - (k - 3) * 12.0
		var c := Vector2(bx, hs.get_center().y)
		if on:
			Draw.ellipse(self, c, 6.0, 6.0, Color(1.0, 0.85, 0.4, 0.25))
		draw_circle(c, 3.0, Color("#ffe9a0") if on else Color("#b9873a"), true, -1.0, true)
	var title := "VİTRİN"
	Draw.text(self, title, hs.get_center() + Vector2(1, 2), 16, Color(0.35, 0.04, 0.02, 0.7))
	Draw.text(self, title, hs.get_center() + Vector2(0, 1), 16, Color("#fff6e0"))


func _draw_glass(v: Dictionary, gi: Rect2) -> void:
	var hr: Rect2 = v.hot_rect
	var cr: Rect2 = v.cold_rect
	var div_y: float = v.div_y
	# koyu iç
	Draw.rr(self, gi, 9, Color("#161a20"))
	# sıcak raf: turuncu iç ışık
	Draw.rr_grad(self, hr, 8, [[0.0, Color("#7a3d16")], [0.6, Color("#5a2a10")], [1.0, Color("#3e1c0b")]])
	var glow := Draw.grad([[0.0, Color(1.0, 0.67, 0.27, 0.5)], [1.0, Color(1.0, 0.47, 0.16, 0.0)]], Vector2(0.5, 0.0), Vector2(0.5, 1.0), true)
	draw_texture_rect(glow, Rect2(hr.position.x, hr.position.y - hr.size.y * 0.1, hr.size.x, hr.size.y * 1.6), false)
	Draw.rr_grad(self, Rect2(hr.position.x + 10, hr.position.y + 1, hr.size.x - 20, 4), 2, [[0.0, Color("#fff3c8")], [1.0, Color("#ff9a3a")]])
	# soğutmalı bölüm: mavi iç ışık
	Draw.rr_grad(self, cr, 8, [[0.0, Color("#1f5b80")], [1.0, Color("#0f2c42")]])
	var cglow := Draw.grad([[0.0, Color(0.6, 0.85, 1.0, 0.22)], [1.0, Color(0.4, 0.7, 1.0, 0.0)]], Vector2(0.5, 0.0), Vector2(0.5, 1.0), true)
	draw_texture_rect(cglow, Rect2(cr.position.x, cr.position.y, cr.size.x, cr.size.y * 1.2), false)
	Draw.rr_grad(self, Rect2(cr.position.x + 10, cr.position.y + 1, cr.size.x - 20, 2.5), 1, [[0.0, Color("#e8f6ff")], [1.0, Color("#7cc6ff")]])
	# bölüm ayıracı (parlak çelik çıta)
	Draw.rr_grad(self, Rect2(gi.position.x, div_y, gi.size.x, 6), 1, [[0.0, Color("#eef2f5")], [1.0, Color("#7c8792")]])
	draw_rect(Rect2(gi.position.x, div_y + 6, gi.size.x, 2), Color(0, 0, 0, 0.3))
	# raf camları
	var shelf_ys := {}
	for c: Dictionary in v.cells:
		shelf_ys[roundi((c.rect as Rect2).end.y)] = true
	for sy: int in shelf_ys:
		if absf(sy - div_y) < 3.0 or sy >= gi.end.y - 2.0:
			continue
		draw_rect(Rect2(gi.position.x, sy - 3, gi.size.x, 3), Color(0.78, 0.9, 1.0, 0.28))
		draw_rect(Rect2(gi.position.x, sy - 3, gi.size.x, 1), Color(1, 1, 1, 0.45))
		draw_rect(Rect2(gi.position.x, sy, gi.size.x, 2), Color(0, 0, 0, 0.18))
	# ürünler
	for c: Dictionary in v.cells:
		_draw_cell(c)
	# cam yansımaları
	var gx := gi.position.x
	var gy0 := gi.position.y
	var gy1 := gi.end.y
	_cpoly(PackedVector2Array([Vector2(gx + 30, gy1), Vector2(gx + 70, gy1), Vector2(gx + 170, gy0), Vector2(gx + 130, gy0)]), Color(1, 1, 1, 0.07))
	_cpoly(PackedVector2Array([Vector2(gx + 90, gy1), Vector2(gx + 102, gy1), Vector2(gx + 202, gy0), Vector2(gx + 190, gy0)]), Color(1, 1, 1, 0.05))
	draw_line(Vector2(gx + 6, gy0 + 6), Vector2(gx + 6, gy1 - 30), Color(1, 1, 1, 0.12), 2.0, true)
	# boş vitrin
	if not Service.any_stock(v, Game.products):
		Draw.rr(self, gi, 9, Color(0.04, 0.04, 0.06, 0.55))
		Draw.text(self, "Vitrin boş", gi.get_center() + Vector2(0, -12), 22, Color("#ffe08a"))
		Draw.text(self, "Telefon/Toptancı'dan sipariş ver", gi.get_center() + Vector2(0, 14), 13, Color("#f0ecf6"))
	# cam çerçeve
	Draw.rr(self, gi.grow(1.5), 10, Color.TRANSPARENT, 1.0, Color(0.12, 0.14, 0.17, 0.5))
	Draw.rr(self, gi, 9, Color.TRANSPARENT, 2.5, Color(0.9, 0.93, 0.95, 0.9))
	# sürgülü cam kapak tutamakları
	var hx := gi.get_center().x
	Draw.rr(self, Rect2(hx - 22, gi.end.y - 9, 16, 5), 2.5, Color("#e9edf1"), 0.0, Color.TRANSPARENT, 2.0, Color(0, 0, 0, 0.3), Vector2(0, 1))
	Draw.rr(self, Rect2(hx + 6, gi.end.y - 9, 16, 5), 2.5, Color("#e9edf1"), 0.0, Color.TRANSPARENT, 2.0, Color(0, 0, 0, 0.3), Vector2(0, 1))


func _draw_cell(c: Dictionary) -> void:
	var r: Rect2 = c.rect
	var id: String = c.id
	var stock := Game.prod_get(id)
	var cx := r.get_center().x
	var cy := r.position.y + r.size.y * 0.44
	var size := minf(minf(r.size.y * 0.66, r.size.x * 0.74), PRODUCT_MAX)
	var hov := id == _hover_id
	if hov:
		Draw.rr(self, Rect2(r.position.x + 2, r.position.y + 2, r.size.x - 4, r.size.y - 6), 8, Color(1, 1, 1, 0.16))
	# rafa düşen gölge
	Draw.ellipse(self, Vector2(cx + 2, r.end.y - 6), size * 0.36, 3.5, Color(0, 0, 0, 0.32))
	var b := Logic.bump_scale(_bump.get(id, 0.0), _now(), 0.15)
	var tex := ItemView.tex("product", id)
	var w := size * SPRITE_K * b
	var center := Vector2(cx, cy - (2.0 if hov else 0.0))
	if tex != null:
		draw_texture_rect(tex, Rect2(center - Vector2(w, w) * 0.5, Vector2(w, w)), false, Color(1, 1, 1, 1.0 if stock > 0 else 0.28))
	# sıcak ürün buharı
	if c.group == "hazir" and stock > 0:
		var ph := _time * 1.6 + r.position.x * 0.1
		var pts := PackedVector2Array()
		for k in 9:
			var f := k / 8.0
			pts.append(Vector2(cx - 3.0 + sin(ph + f * 4.0) * 4.0 * f, cy - size * (0.42 + 0.38 * f)))
		draw_polyline(pts, Color(1.0, 0.94, 0.86, 0.2), 1.8, true)
	# adet rozeti
	var s := str(stock)
	var bw := 13.0 + s.length() * 6.0
	var bx := minf(r.end.x - bw - 1.0, cx + size * 0.22)
	var badge := Rect2(bx, r.position.y + 3, bw, 15)
	var bcol := COL_BADGE_OUT if stock <= 0 else (COL_BADGE_LOW if stock <= Service.LOW_STOCK else COL_BADGE)
	Draw.rr(self, badge, 7.5, bcol, 1.0, Color(1, 1, 1, 0.35), 2.0, Color(0, 0, 0, 0.3), Vector2(0, 1))
	Draw.text(self, s, badge.get_center(), 11, Color.WHITE)
	# fiyat etiketi
	var ps := "%d₺" % _price(id)
	var pw := Draw.text_size(ps, 10).x + 10.0
	var pr := Rect2(cx - pw * 0.5, r.end.y - 16, pw, 13)
	Draw.rr(self, pr, 3, Color("#fffbe8") if stock > 0 else Color(1.0, 0.98, 0.91, 0.4), 0.0, Color.TRANSPARENT,
		2.0, Color(0, 0, 0, 0.25), Vector2(0, 1))
	Draw.text(self, ps, pr.get_center(), 10, COL_PRICE)


func _draw_base(L: Rect2) -> void:
	var base := Rect2(L.position.x + 4, L.end.y - 58, L.size.x - 8, BASE_H)
	Draw.rr(self, Rect2(base.position + Vector2(3, 5), base.size), 8, Color(0, 0, 0, 0.0), 0.0, Color.TRANSPARENT,
		8.0, Color(0, 0, 0, 0.35), Vector2(2, 4))
	Draw.rr_grad(self, base, 8, [[0.0, Color("#7c8792")], [0.12, Color("#d9dfe5")], [0.5, Color("#b1bac3")],
		[0.88, Color("#dde3e8")], [1.0, Color("#76818c")]], 1.0, Vector2(0, 0), Vector2(1, 0))
	Draw.rr_grad(self, base, 8, [[0.0, Color(1, 1, 1, 0.3)], [0.2, Color(1, 1, 1, 0.0)], [1.0, Color(0, 0, 0, 0.15)]])
	Draw.rr(self, base, 8, Color.TRANSPARENT, 1.5, Color(0.16, 0.19, 0.23, 0.6))
	# havalandırma ızgarası
	for k in 4:
		var vr := Rect2(base.position.x + 24, base.position.y + 12 + k * 8, base.size.x - 120, 4)
		Draw.rr(self, vr, 2, Color(0.12, 0.14, 0.17, 0.55))
		draw_rect(Rect2(vr.position.x + 2, vr.end.y, vr.size.x - 4, 1), Color(1, 1, 1, 0.35))
	# marka plakası
	var plate := Rect2(base.end.x - 86, base.position.y + 10, 72, 20)
	Draw.rr(self, plate, 5, Color("#2a3340"), 1.0, Color(1, 1, 1, 0.15))
	Draw.text(self, "SOĞUTMALI", plate.get_center(), 9, Color("#9fd3ff"))
	# termometre
	var led := Vector2(base.end.x - 76, base.position.y + 42)
	Draw.ellipse(self, led, 6.0, 6.0, Color(0.37, 0.88, 0.48, 0.25 + 0.1 * sin(_time * 3.0)))
	draw_circle(led, 3.0, Color("#5fe07a"), true, -1.0, true)
	Draw.text(self, "+4°C", Vector2(led.x + 8, led.y), 10, Color("#20303e"), false)
