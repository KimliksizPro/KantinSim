extends Node2D
## Bekleme rafı / sıcak dolap (web js/stations_prep.js "4) SICAK DOLAP / BEKLEME": prep_bekleme_i bölgeleri).
## Hazır yemekler (ve alet dışındaki her item) rafa bırakılıp sonra alınır. Isıtmasız rafta pişmiş yemek
## 15 sn sonra soğumaya başlar ve sıcak katmanların kalitesi düşer; "Isıtmalı Sıcak Dolap" (keepWarm) bunu durdurur.
## Saf mantık bekleme_logic.gd'de; bu script çizim, ışık ve Drag bölge protokolünü üstlenir (raf tek bölge).
##
## Diğer sahneler için: put_item(item) -> bool  (ilk boş yuvaya koyar; yer yoksa false)
##
## Demo kipi (ekran görüntüsü için): `-- --bekleme-demo` → rafta basılmış kaşarlı tost;
## `--bekleme-demo=soguk` → tost soğumuş; `--bekleme-demo=sicak` → ısıtmalı dolap görünümü (4 yuva).

const HoldLogic := preload("res://scripts/stations/bekleme_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

## Drag önceliği (web prep_bekleme_i z:5)
var zone_z: int = 5

const STATION_ID := "bekleme"
const DAY_END_PHASE := "summary"
const ITEM_W_ONE_ROW := 70.0
const ITEM_W_TWO_ROWS := 46.0
const LAMP_H := 14.0
const COL_COLD := Color(0.235, 0.55, 0.86, 0.94)

var logic: HoldLogic = HoldLogic.new()
var _r: Rect2
var _time := 0.0
var _mouse := Vector2(-1000, -1000)
var _bump: Array[float] = [0.0, 0.0, 0.0, 0.0]
var _demo_warm := false
var _light: PointLight2D


func _ready() -> void:
	_r = GameData.rect(STATION_ID)
	light_mask = 0
	_build_light()
	Drag.register(self)
	add_to_group("item_shelf")  # tezgahta yer kalmayınca yemekler buraya gelir (put_item)
	Game.phase_changed.connect(_on_phase)
	_apply_demo_args()
	_sync_upgrades()


func _exit_tree() -> void:
	Drag.unregister(self)


func _apply_demo_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--bekleme-demo"):
			continue
		var v := a.trim_prefix("--bekleme-demo").trim_prefix("=")
		_demo_warm = v == "sicak"
		_sync_upgrades()
		var j := logic.put(Items.dish("tost_ekmegi", {"layers": [{"id": "kasar", "q": 1.0}], "toast": 1.0}))
		if v == "soguk" and j >= 0:
			logic.slots[j].t = HoldLogic.COLD_AFTER + 10.0
		if _demo_warm:
			logic.put(Items.dish("kese", {"layers": [{"id": "patates", "q": 1.0, "cook": 1.0}]}))
			logic.put(Items.product("ayran"))


func _sync_upgrades() -> void:
	logic.keep_warm = _demo_warm or bool(Game.upg_val(STATION_ID, "keepWarm", false))
	var n: int = 4 if _demo_warm else int(Game.upg_val(STATION_ID, "slots", HoldLogic.DEFAULT_SLOTS))
	if n != logic.count:
		for it in logic.set_count(n):
			push_warning("bekleme: yuva azaldı, item kayboldu: " + Recipes.item_name(it))


# --- Yerleşim (web holdInner / holdSlot) ------------------------------------------------

func _inner() -> Rect2:
	return Rect2(_r.position.x + 10, _r.position.y + 30, _r.size.x - 20, _r.size.y - 46)


func _rows() -> int:
	return 2 if logic.count > 2 else 1


## Yuvaların dizildiği alan (üstteki ısıtma lambası şeridinin altı)
func _slot_area() -> Rect2:
	var inner := _inner()
	return Rect2(inner.position.x, inner.position.y + LAMP_H + 6, inner.size.x, inner.size.y - LAMP_H - 6)


func slot_rect(i: int) -> Rect2:
	var n := logic.count
	var a := _slot_area()
	var rows := _rows()
	var cols := 1 if n == 1 else 2
	var cw := a.size.x / cols
	var ch := a.size.y / rows
	return Rect2(a.position.x + (i % cols) * cw, a.position.y + (i / cols) * ch, cw, ch)


func _slot_at(pt: Vector2) -> int:
	for i in logic.count:
		if slot_rect(i).has_point(pt):
			return i
	return -1


# --- Açık API ---------------------------------------------------------------------------

## İlk boş yuvaya koyar (ör. tezgahtan / başka istasyondan dönen yemek). Yer yoksa false.
func put_item(item: Dictionary) -> bool:
	var j := logic.put(item)
	if j < 0:
		return false
	_bump[j] = _time
	return true


# --- Drag bölge protokolü (tüm raf tek bölge) -------------------------------------------

func zone_rect() -> Rect2:
	return _inner()


func pick(pt: Vector2) -> Dictionary:
	return logic.take(_slot_at(pt))


func return_item(item: Dictionary) -> void:
	var j := logic.put_back(item)
	if j < 0:
		push_warning("bekleme: raf dolu, item geri konamadı")
		return
	_bump[j] = _time


func can_drop(item: Dictionary) -> bool:
	return HoldLogic.accepts(item) and logic.free_slot() >= 0


func drop(item: Dictionary, pt: Vector2) -> bool:
	var j := logic.put(item, _slot_at(pt), 0.0)
	if j < 0:
		return false
	_bump[j] = _time
	return true


func hover_text(pt: Vector2) -> String:
	var i := _slot_at(pt)
	return logic.tooltip(i if i >= 0 else logic.count)


func _on_phase(p: String) -> void:
	if p != DAY_END_PHASE:
		return
	var res := logic.day_end()
	for id in res.products:
		Game.prod_add(id, 1)
	for id in res.ings:
		Game.inv_add(id, 1)
	if int(res.spoiled) > 0:
		Game.notify("Gün sonu: rafta %d tabak yemek bozuldu." % int(res.spoiled), "warn")


# --- Güncelleme ---------------------------------------------------------------------------

func _process(dt: float) -> void:
	_time += dt
	_mouse = get_viewport().get_mouse_position()
	_sync_upgrades()
	logic.update(Game.game_dt(dt))
	_light.visible = logic.keep_warm
	_light.energy = 0.55 + 0.08 * sin(_time * 3.0)
	queue_redraw()


func _build_light() -> void:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.4, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.4), Color(1, 1, 1, 0)])
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = 128
	t.height = 128
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	_light = PointLight2D.new()
	_light.texture = t
	_light.texture_scale = 2.0
	_light.color = Color(1.0, 0.6, 0.25)
	_light.blend_mode = Light2D.BLEND_MODE_ADD
	_light.position = _inner().get_center() + Vector2(0, 10)
	_light.visible = false
	add_child(_light)


# --- Çizim ----------------------------------------------------------------------------------

func _draw() -> void:
	var inner := _inner()
	var warm := logic.keep_warm
	# dolap gövdesinin tezgaha düşen gölgesi ve iç oyuk
	Draw.rr(self, inner, 10, Color.TRANSPARENT, 0.0, Color.TRANSPARENT, 7.0, Color(0, 0, 0, 0.35), Vector2(3, 4))
	if warm:
		Draw.rr_grad(self, inner, 10, [[0.0, Color("#6a3214")], [0.5, Color("#45210f")], [1.0, Color("#2c160b")]])
	else:
		Draw.rr_grad(self, inner, 10, [[0.0, Color("#4a525c")], [1.0, Color("#262b33")]])
	_draw_back_wall(inner, warm)
	_draw_posts(inner)
	_draw_lamp(inner, warm)
	for r in _rows():
		_draw_shelf(r)
	for i in logic.count:
		_draw_slot(i, warm)
	if warm:
		_draw_glass(inner)
	# çelik çerçeve: üstte açık pah, altta koyu
	Draw.rr(self, inner, 10, Color.TRANSPARENT, 2.0, Color(0.85, 0.88, 0.92, 0.85))
	Draw.rr(self, inner.grow(-2), 8, Color.TRANSPARENT, 1.0, Color(0, 0, 0, 0.35))
	Draw.station_label(self, _r, String(Game.upg_val(STATION_ID, "name", "Bekleme Rafı")))
	if warm:
		var led := Vector2(_r.end.x - 16, _r.position.y + 18)
		draw_circle(led, 6.5, Color(1.0, 0.55, 0.12, 0.25), true, -1.0, true)
		draw_circle(led, 4.5, Color(1.0, 0.55, 0.12, 0.7 + 0.3 * sin(_time * 4.0)), true, -1.0, true)


## Arka duvar: delikli paslanmaz sac, ısıtmalıyken turuncu parıltı
func _draw_back_wall(inner: Rect2, warm: bool) -> void:
	var dot := Color(0, 0, 0, 0.22)
	var hi := Color(1, 1, 1, 0.06)
	var y := inner.position.y + LAMP_H + 12
	var row := 0
	while y < inner.end.y - 8:
		var x := inner.position.x + 12 + (6.0 if row % 2 == 1 else 0.0)
		while x < inner.end.x - 10:
			draw_circle(Vector2(x, y), 1.4, dot, true, -1.0, true)
			draw_circle(Vector2(x + 0.6, y + 0.8), 0.9, hi, true, -1.0, true)
			x += 12.0
		y += 10.0
		row += 1
	if warm:
		var p := 0.75 + 0.25 * sin(_time * 3.0)
		var glow := Draw.grad([[0.0, Color(1.0, 0.67, 0.24, 0.6)], [0.5, Color(1.0, 0.47, 0.12, 0.2)], [1.0, Color(1.0, 0.35, 0.08, 0.0)]], Vector2(0.5, 0.0), Vector2(0.5, 1.0), true)
		Draw.fill_grad(self, Draw.rr_points(inner, 10), Rect2(inner.position.x - inner.size.x * 0.25, inner.position.y - inner.size.y * 0.6, inner.size.x * 1.5, inner.size.y * 1.6), glow, p)
	else:
		Draw.rr_grad(self, Rect2(inner.position, Vector2(inner.size.x, 26)), 10, [[0.0, Color(1, 1, 1, 0.08)], [1.0, Color(1, 1, 1, 0.0)]])


## Yan dikmeler (paslanmaz boru)
func _draw_posts(inner: Rect2) -> void:
	for x in [inner.position.x + 4.0, inner.end.x - 10.0]:
		var r := Rect2(x, inner.position.y + 4, 6, inner.size.y - 8)
		Draw.rr_grad(self, r, 3, [[0.0, Color("#7d8791")], [0.45, Color("#eef2f5")], [1.0, Color("#6c7680")]], 1.0, Vector2(0, 0.5), Vector2(1, 0.5))


## Üstte ısıtma lambası gövdesi: kapalıyken soğuk cam, ısıtmalıyken akkor
func _draw_lamp(inner: Rect2, warm: bool) -> void:
	var r := Rect2(inner.position.x + 8, inner.position.y + 4, inner.size.x - 16, LAMP_H)
	Draw.rr(self, r, 6, Color.TRANSPARENT, 0.0, Color.TRANSPARENT, 4.0, Color(0, 0, 0, 0.35), Vector2(1, 3))
	Draw.rr_grad(self, r, 6, [[0.0, Color("#f4f7fa")], [0.5, Color("#b8c2cc")], [1.0, Color("#6c7680")]])
	var tube := Rect2(r.position.x + 8, r.end.y - 6, r.size.x - 16, 5)
	if warm:
		var p := 0.85 + 0.15 * sin(_time * 3.0)
		Draw.rr_grad(self, tube, 2.5, [[0.0, Color("#fff2c0")], [1.0, Color("#ff8a1f")]], p)
		Draw.rr(self, tube.grow(3), 5, Color(1.0, 0.6, 0.2, 0.18 * p))
	else:
		Draw.rr_grad(self, tube, 2.5, [[0.0, Color("#9aa4ae")], [1.0, Color("#56606b")]])
	# vida başları
	for x in [r.position.x + 5.0, r.end.x - 5.0]:
		draw_circle(Vector2(x, r.position.y + 5), 1.8, Color(0.3, 0.33, 0.38), true, -1.0, true)


## Tel raf: ön çubuk + derinlik telleri + gölge
func _draw_shelf(row: int) -> void:
	var a := _slot_area()
	var ch := a.size.y / _rows()
	var y := a.position.y + (row + 1) * ch - 8.0
	var x0 := a.position.x + 4
	var x1 := a.end.x - 4
	draw_rect(Rect2(x0, y + 4, x1 - x0, 4), Color(0, 0, 0, 0.3))
	var wire := Color(0.86, 0.89, 0.92, 0.45)
	for k in range(1, 12):
		var x := x0 + k * (x1 - x0) / 12.0
		draw_line(Vector2(x, y), Vector2(x - 5, y - 8), wire, 1.0, true)
	draw_line(Vector2(x0 + 2, y - 8), Vector2(x1 - 2, y - 8), Color(0.86, 0.89, 0.92, 0.3), 1.0, true)
	Draw.rr_grad(self, Rect2(x0, y, x1 - x0, 4), 2, [[0.0, Color("#eef2f5")], [1.0, Color("#8d97a1")]])


func _draw_slot(i: int, warm: bool) -> void:
	var s := slot_rect(i)
	var floor_y := s.end.y - 9.0
	var c := Vector2(s.get_center().x, floor_y)
	if not logic.has(i):
		var r := Rect2(s.position.x + 10, s.position.y + 6, s.size.x - 20, s.size.y - 18)
		var col := Color(1, 1, 1, 0.14)
		if Drag.is_holding() and can_drop(Drag.held) and s.has_point(_mouse):
			col = Color(0.6, 1.0, 0.65, 0.5)
		var pts := [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y), r.position]
		for k in 4:
			draw_dashed_line(pts[k], pts[k + 1], col, 1.5, 5.0, true)
		return
	var it := logic.item_at(i)
	var hov := s.has_point(_mouse) and not Drag.is_holding()
	var w := (ITEM_W_ONE_ROW if _rows() == 1 else ITEM_W_TWO_ROWS)
	var e := _time - _bump[i]
	var bump := 1.0 + (0.14 * sin(e / 0.32 * PI) * (1.0 - e / 0.32) if e >= 0.0 and e < 0.32 else 0.0)
	w *= bump
	var ic := Vector2(c.x, floor_y - w * 0.5 - (3.0 if hov else 0.0))
	Draw.ellipse_shadow(self, c + Vector2(3, -1), w * 0.4, 4.5, Color(0, 0, 0, 0.4), 4.0, 4)
	if hov:
		Draw.ellipse(self, c + Vector2(0, -2), w * 0.48, 7, Color(1, 1, 1, 0.12))
	ItemView.draw_item(self, it, ic, w)
	# sıcak yemekten buhar: ısıtmalıyken sürekli, değilse soğuyana kadar azalarak
	if HoldLogic.warmable(it) and not logic.is_cold(i):
		var k := 1.0 if warm else clampf(logic.cold_in(i) / HoldLogic.COLD_AFTER, 0.0, 1.0)
		_draw_steam(ic + Vector2(0, -w * 0.18), i, 0.25 * k + (0.05 if k > 0.0 else 0.0))
	if logic.is_cold(i):
		_draw_cold_tag(Vector2(c.x, s.position.y + 12))


func _draw_steam(base: Vector2, seed_i: int, alpha: float) -> void:
	if alpha <= 0.01:
		return
	for k in 2:
		var ph := _time * 2.0 + k * 2.0 + seed_i
		var x0 := base.x - 8.0 + k * 16.0
		var pts := PackedVector2Array()
		for s in 9:
			var t := s / 8.0
			pts.append(Vector2(x0 + sin(ph + t * 4.0) * 5.0 * t, base.y - t * 26.0))
		draw_polyline(pts, Color(1, 1, 1, alpha * (1.0 - 0.3 * sin(ph))), 2.0, true)


## "Soğumuş" etiketi (kar tanesi çizilir; yazı tipi emoji desteklemez)
func _draw_cold_tag(top: Vector2) -> void:
	var label := "Soğumuş"
	var tw := Draw.text_size(label, 10).x + 28.0
	var r := Rect2(top.x - tw * 0.5, top.y - 8, tw, 17)
	Draw.rr(self, r, 8.5, COL_COLD, 1.0, Color(1, 1, 1, 0.4), 3.0, Color(0, 0, 0, 0.3), Vector2(0, 2))
	var sc := r.position + Vector2(10, 8.5)
	for k in 3:
		var d := Vector2.from_angle(PI / 3.0 * k) * 4.5
		draw_line(sc - d, sc + d, Color.WHITE, 1.3, true)
	Draw.text(self, label, Vector2(r.position.x + 18, r.get_center().y), 10, Color.WHITE, false)


## Isıtmalı dolabın cam kapakları: yansıma şeritleri, orta kayıt ve kulplar
func _draw_glass(inner: Rect2) -> void:
	Draw.rr(self, inner, 10, Color(0.78, 0.88, 1.0, 0.06))
	for ox in [20.0, 112.0]:
		var pts := PackedVector2Array([
			Vector2(inner.position.x + ox, inner.end.y - 2), Vector2(inner.position.x + ox + 18, inner.end.y - 2),
			Vector2(inner.position.x + ox + 58, inner.position.y + 2), Vector2(inner.position.x + ox + 40, inner.position.y + 2)])
		var clipped := Geometry2D.intersect_polygons(pts, Draw.rr_points(inner.grow(-2), 8))
		for poly in clipped:
			if not Geometry2D.triangulate_polygon(poly).is_empty():
				draw_colored_polygon(poly, Color(1, 1, 1, 0.09))
	var mx := inner.get_center().x
	draw_line(Vector2(mx, inner.position.y), Vector2(mx, inner.end.y), Color(0.82, 0.85, 0.89, 0.9), 3.0, true)
	for dx in [-9.0, 5.0]:
		Draw.rr_grad(self, Rect2(mx + dx, inner.get_center().y - 14, 4, 28), 2, [[0.0, Color("#ffffff")], [1.0, Color("#aab3bc")]], 1.0, Vector2(0, 0.5), Vector2(1, 0.5))
