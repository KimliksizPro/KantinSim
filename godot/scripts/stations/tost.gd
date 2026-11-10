extends Node2D
## Tost makinesi istasyonu (web js/stations_cook.js "TOST MAKİNESİ": tostZone, updateTost, drawTost*).
## Tek makine, iki yuva. Kapak tıklamayla açılır/kapanır; kapak kapalıyken yuvadaki yemeğin `toast` değeri artar.
## Saf mantık tost_logic.gd'de; bu script çizim, ışık, partikül ve Drag bölge protokolünü üstlenir.
##
## Demo kipi (yalnız ekran görüntüsü kontrolü için): `-- --tost-demo=1.3` → yuvalara 1.3 ve yarısı kadar
## basılmış kaşarlı tost koyar, kapağı kapatır. `--tost-demo=1.3,acik` → aynı ama kapak açık.

const TostLogic := preload("res://scripts/stations/tost_logic.gd")

## Drag önceliği (web tostZone.z)
var zone_z: int = 5

const LABEL := "Tost Makinesi"
## Yerleşim (web tostGeo; tek makine)
const MACHINE_W := 196.0
const HINGE_OFFSET_Y := 80.0
const PLATE_H := 76.0
const FACE_H := 30.0
const SLOT_GAP := 4.0
const SLOT_PAD := 7.0
## Kapak açıkken geriye yatma açısı (radyan) ve perspektif kısalması
const LID_OPEN_ANGLE := 1.75
const LID_TILT := 0.38
## Ham tostu sürükleyerek almak için gereken fare hareketi (px)
const PRESS_DRAG_DIST := 12.0
const ITEM_W := 82.0
## Isı parıltısının (PointLight2D) en yüksek enerjisi
const LIGHT_ENERGY := 1.0

const COL_HOVER := Color(1.0, 0.925, 0.627, 0.7)
const COL_HEAT := Color(1.0, 0.35, 0.12)
const COL_STEAM := Color(1.0, 1.0, 1.0, 0.4)
const COL_SMOKE := Color(0.6, 0.6, 0.62, 0.55)
const COL_DARK := Color(0.12, 0.1, 0.1, 0.7)
## Kenardan görünen tost rengi (web R_TOAST)
const TOAST_EDGE := [
	[0.0, Color("#f1e0b4")], [0.5, Color("#ecc77b")], [0.9, Color("#dc9d42")], [1.15, Color("#c07c2d")],
	[1.35, Color("#7e4b1b")], [1.55, Color("#35251b")], [2.0, Color("#141110")],
]

var logic: TostLogic = TostLogic.new()

# geometri (1600x900 mantıksal uzay)
var _r: Rect2
var _x: float
var _w: float
var _hinge_y: float
var _face_y: float
var _lid_len: float
var _slots: Array[Rect2] = []
var _hit: Rect2

# ham tosta basış takibi (kısa tık = kapak, sürükleme = al)
var _press_active := false
var _press_slot := -1
var _press_pos := Vector2.ZERO

var _heat := 0.0   # 0..1 yumuşatılmış ısı (parıltı için)
var _time := 0.0
var _mouse := Vector2(-1000, -1000)
var _font: Font
var _tex: Dictionary = {}
var _brush: PackedFloat32Array = PackedFloat32Array()
var _light: PointLight2D
var _steam: Array[GPUParticles2D] = []
var _smoke: Array[GPUParticles2D] = []


func _ready() -> void:
	_font = ThemeDB.fallback_font
	# Makinenin kendisi ışıktan etkilenmez (parlak çelik beyaza yanmasın); parıltı tezgaha düşer,
	# makinedeki ısı izleri _draw içinde elle çizilir.
	light_mask = 0
	_build_geometry()
	var rng := RandomNumberGenerator.new()
	rng.seed = 7411
	for i in int(_w / 1.5) + 2:
		_brush.append(rng.randf())
	_build_light()
	for j in _slots.size():
		_steam.append(_make_particles(COL_STEAM, 6, _slots[j].size.x))
		_smoke.append(_make_particles(COL_SMOKE, 20, _slots[j].size.x))
	Drag.register(self)
	_apply_demo_args()


func _exit_tree() -> void:
	Drag.unregister(self)


func _build_geometry() -> void:
	_r = GameData.rect("tost")
	_w = MACHINE_W
	_x = _r.position.x + (_r.size.x - _w) * 0.5
	_hinge_y = _r.position.y + HINGE_OFFSET_Y
	_face_y = _hinge_y + PLATE_H
	_lid_len = PLATE_H - 2.0
	var n: int = TostLogic.SLOT_COUNT
	var sw := (_w - SLOT_PAD * 2.0 - SLOT_GAP * (n - 1)) / n
	_slots.clear()
	for j in n:
		_slots.append(Rect2(_x + SLOT_PAD + j * (sw + SLOT_GAP), _hinge_y + 4.0, sw, PLATE_H - 8.0))
	_hit = Rect2(_x - 4.0, _r.position.y + 26.0, _w + 8.0, _face_y + 36.0 - (_r.position.y + 26.0))


func _apply_demo_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--tost-demo="):
			continue
		var parts := a.trim_prefix("--tost-demo=").split(",")
		var v := clampf(float(parts[0]), 0.0, TostLogic.TOAST_MAX)
		var open := parts.size() > 1 and parts[1] == "acik"
		logic.place(Items.dish("tost_ekmegi", {"layers": [{"id": "kasar", "q": 1.0}], "toast": v}))
		logic.place(Items.dish("tost_ekmegi", {"layers": [{"id": "kasar", "q": 1.0}], "toast": v * 0.5}))
		if not open:
			logic.closed = true
			logic.lid_t = 1.0
			_heat = 1.0
		for p in _steam + _smoke:
			p.preprocess = 1.2


# --- Drag bölge protokolü ------------------------------------------------------

func zone_rect() -> Rect2:
	return _r


func can_drop(item: Dictionary) -> bool:
	return TostLogic.can_take(item) and logic.accepts()


func drop(item: Dictionary, pt: Vector2) -> bool:
	if not can_drop(item):
		return false
	var order: Array = range(_slots.size())
	order.sort_custom(func(a: int, b: int) -> bool:
		return _slots[a].get_center().distance_squared_to(pt) < _slots[b].get_center().distance_squared_to(pt))
	return logic.place(item, order) >= 0


func return_item(item: Dictionary) -> void:
	if logic.put_back(item) < 0:
		push_warning("tost makinesi: iade için boş yuva yok")


## Kapak açıkken: basılmış tost doğrudan alınır; ham tostta basış beklemeye alınır
## (kısa tık → click ile kapak kapanır, sürüklenirse _process tostu ele verir).
func pick(pt: Vector2) -> Dictionary:
	_press_active = false
	if not logic.can_pick():
		return {}
	var j := _slot_at(pt)
	if j < 0:
		return {}
	if logic.toast_of(j) < TostLogic.RAW_PICK:
		_press_active = true
		_press_slot = j
		_press_pos = pt
		return {}
	return logic.take(j)


func click(_pt: Vector2) -> void:
	_press_active = false
	logic.toggle_lid()


func hover_text(pt: Vector2) -> String:
	if logic.closed:
		var parts: Array = []
		for j in _slots.size():
			if logic.has_dish(j):
				var d: Dictionary = logic.dish(j)
				parts.append("• %s: %s (%%%d)" % [Recipes.item_name(d), Recipes.cook_label(logic.toast_of(j)), roundi(logic.toast_of(j) * 100.0)])
		if parts.is_empty():
			return "Tost makinesi (kapak kapalı, boş)\nTıkla: kapağı aç"
		return "Tost basılıyor…\n" + "\n".join(parts) + "\nTıkla: kapağı aç"
	var j := _slot_at(pt)
	if j >= 0:
		var head := "%s — Tost: %s" % [Recipes.item_name(logic.dish(j)), Recipes.cook_label(logic.toast_of(j))]
		if logic.toast_of(j) < TostLogic.RAW_PICK:
			return head + "\nTıkla: kapağı kapat • Sürükle: al"
		return head + "\nTıkla/sürükle: al"
	if not logic.is_empty():
		return "Tost makinesi (kapak açık)\nTıkla: kapağı kapat ve bas"
	return "Tost makinesi (kapak açık)\nTabaktaki tostu bir yuvaya bırak, sonra kapağı kapat"


## pt'nin altındaki dolu yuva (yoksa -1)
func _slot_at(pt: Vector2) -> int:
	for j in _slots.size():
		if logic.has_dish(j) and _slots[j].grow_individual(3.0, 8.0, 3.0, 8.0).has_point(pt):
			return j
	return -1


# --- Güncelleme ----------------------------------------------------------------

func _process(dt: float) -> void:
	_time += dt
	_mouse = get_viewport().get_mouse_position()
	_update_press()
	var gdt := Game.game_dt(dt)
	var events: Array = logic.update(gdt, dt)
	var edge_y := _lid_edge(logic.lid_t)
	for ev: Dictionary in events:
		var pos := Vector2(_slots[int(ev.slot)].get_center().x, edge_y - 16.0)
		if ev.type == "done":
			Game.float_text.emit(pos, "Hazır!", Game.COLOR_MONEY)
		else:
			Game.float_text.emit(pos, "Yandı!", Game.COLOR_BAD)
	var running := gdt > 0.0
	var cooking := running and logic.is_heating() and not logic.is_empty()
	var target := 1.0 if cooking else (0.3 if running and logic.closed else 0.12 if running else 0.0)
	_heat = lerpf(_heat, target, 1.0 - exp(-dt * (2.2 if target > _heat else 1.2)))
	_light.energy = _heat * (LIGHT_ENERGY + 0.05 * sin(_time * 5.3) + 0.025 * sin(_time * 13.0))
	_light.visible = _heat > 0.02
	_update_particles(running, cooking, edge_y)
	queue_redraw()


## Ham tosta basılıyken fare yeterince hareket ederse tostu ele ver (web tostZone.onDrag).
func _update_press() -> void:
	if not _press_active:
		return
	if Drag.is_holding() or not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) or not logic.can_pick():
		_press_active = false
		return
	if _mouse.distance_to(_press_pos) < PRESS_DRAG_DIST:
		return
	_press_active = false
	var item: Dictionary = logic.take(_press_slot)
	if not item.is_empty():
		Drag.start_hold(item, self)


func _update_particles(running: bool, cooking: bool, edge_y: float) -> void:
	for j in _slots.size():
		var c := _slots[j].get_center()
		var pos := Vector2(c.x, edge_y + 5.0 if logic.lid_t > 0.5 else c.y - 4.0)
		var v := logic.toast_of(j)
		var has: bool = logic.has_dish(j)
		_steam[j].position = pos
		_steam[j].emitting = has and cooking and v < TostLogic.TOAST_BURN
		var smoking := has and running and v >= TostLogic.TOAST_SMOKE
		var burnt := v >= TostLogic.TOAST_BURN
		_smoke[j].position = pos
		_smoke[j].emitting = smoking
		_smoke[j].amount_ratio = 1.0 if burnt else 0.45
		(_smoke[j].process_material as ParticleProcessMaterial).color = COL_DARK if burnt else COL_SMOKE


## Kapağın ön kenarının ekran y'si (0 açık: menteşenin üstünde, 1 kapalı: plakanın önünde)
func _lid_edge(lid_t: float) -> float:
	var th := (1.0 - clampf(lid_t, 0.0, 1.0)) * LID_OPEN_ANGLE
	return _hinge_y + _lid_len * cos(th) - _lid_len * sin(th) * LID_TILT


# --- Işık ve partiküller -------------------------------------------------------

func _build_light() -> void:
	_light = PointLight2D.new()
	_light.texture = _blob_tex()
	_light.texture_scale = 2.2
	_light.color = Color(1.0, 0.52, 0.2)
	_light.energy = 0.0
	_light.blend_mode = Light2D.BLEND_MODE_ADD
	_light.position = Vector2(_x + _w * 0.5, _face_y + 8.0)
	add_child(_light)


func _make_particles(col: Color, amount: int, slot_w: float) -> GPUParticles2D:
	var p := GPUParticles2D.new()
	p.texture = _blob_tex()
	p.amount = amount
	p.lifetime = 1.9
	p.emitting = false
	p.local_coords = false
	p.light_mask = 0
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(slot_w * 0.4, 2.0, 0.0)
	m.direction = Vector3(0, -1, 0)
	m.spread = 14.0
	m.initial_velocity_min = 28.0
	m.initial_velocity_max = 52.0
	m.gravity = Vector3(0, -8, 0)
	m.lifetime_randomness = 0.3
	m.scale_min = 0.3
	m.scale_max = 0.48
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.45))
	curve.add_point(Vector2(1.0, 1.5))
	var ct := CurveTexture.new()
	ct.curve = curve
	m.scale_curve = ct
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.18, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 0), Color(1, 1, 1, 1), Color(1, 1, 1, 0)])
	var gt := GradientTexture1D.new()
	gt.gradient = g
	m.color_ramp = gt
	m.color = col
	p.process_material = m
	add_child(p)
	return p


## Yumuşak daire dokusu (ışık, gölge, parıltı ve partiküller için)
func _blob_tex() -> GradientTexture2D:
	if _tex.has("blob"):
		return _tex["blob"]
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.35, 0.7, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.62), Color(1, 1, 1, 0.16), Color(1, 1, 1, 0)])
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = 128
	t.height = 128
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	_tex["blob"] = t
	return t


## Dikey gradyan dokusu: stops = [[oran, Color], ...]
func _grad(key: String, stops: Array) -> GradientTexture2D:
	if _tex.has(key):
		return _tex[key]
	var g := Gradient.new()
	var offs := PackedFloat32Array()
	var cols := PackedColorArray()
	for s: Array in stops:
		offs.append(float(s[0]))
		cols.append(s[1] as Color)
	g.offsets = offs
	g.colors = cols
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = 4
	t.height = 128
	t.fill_from = Vector2(0, 0)
	t.fill_to = Vector2(0, 1)
	_tex[key] = t
	return t


# --- Çizim yardımcıları --------------------------------------------------------

static func _rr_points(r: Rect2, rad: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	rad = minf(rad, minf(r.size.x, r.size.y) * 0.5)
	if rad <= 0.5:
		return PackedVector2Array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)])
	var centers := [
		Vector2(r.end.x - rad, r.position.y + rad), Vector2(r.end.x - rad, r.end.y - rad),
		Vector2(r.position.x + rad, r.end.y - rad), Vector2(r.position.x + rad, r.position.y + rad),
	]
	for i in 4:
		var a0 := -PI * 0.5 + i * PI * 0.5
		for k in 6:
			var a := a0 + PI * 0.5 * k / 5.0
			pts.append(centers[i] + Vector2(cos(a), sin(a)) * rad)
	return pts


## Bozuk (üçgenlenemeyen, ör. kapak hareketinde incelen) çokgenleri sessizce atlar
func _cpoly(pts: PackedVector2Array, col: Color, uvs: PackedVector2Array = PackedVector2Array(), tex: Texture2D = null) -> void:
	if not Geometry2D.triangulate_polygon(pts).is_empty():
		draw_colored_polygon(pts, col, uvs, tex)


func _poly(pts: PackedVector2Array, cols: PackedColorArray, uvs: PackedVector2Array = PackedVector2Array(), tex: Texture2D = null) -> void:
	if not Geometry2D.triangulate_polygon(pts).is_empty():
		draw_polygon(pts, cols, uvs, tex)


func _rr(r: Rect2, rad: float, col: Color) -> void:
	_cpoly(_rr_points(r, rad), col)


## Dikey gradyanla doldurulmuş çokgen (gradyan y0..y1 arasına gerilir)
func _poly_grad(pts: PackedVector2Array, tex: Texture2D, y0: float, y1: float, mod: Color = Color.WHITE) -> void:
	var uvs := PackedVector2Array()
	var span := maxf(0.001, y1 - y0)
	for p in pts:
		uvs.append(Vector2(0.5, clampf((p.y - y0) / span, 0.004, 0.996)))
	_cpoly(pts, mod, uvs, tex)


func _rr_grad(r: Rect2, rad: float, tex: Texture2D) -> void:
	_poly_grad(_rr_points(r, rad), tex, r.position.y, r.end.y)


func _outline(pts: PackedVector2Array, col: Color, width: float) -> void:
	var closed := pts.duplicate()
	closed.append(pts[0])
	draw_polyline(closed, col, width, true)


func _rr_outline(r: Rect2, rad: float, col: Color, width: float = 1.0) -> void:
	_outline(_rr_points(r, rad), col, width)


## Yumuşak leke (gölge / parıltı): merkez ve yarı boyutlar
func _blob(center: Vector2, half: Vector2, col: Color) -> void:
	draw_texture_rect(_blob_tex(), Rect2(center - half, half * 2.0), false, col)


static func _ramp(stops: Array, v: float) -> Color:
	if v <= float(stops[0][0]):
		return stops[0][1]
	for i in range(1, stops.size()):
		if v <= float(stops[i][0]):
			var a: Array = stops[i - 1]
			var b: Array = stops[i]
			return (a[1] as Color).lerp(b[1], (v - float(a[0])) / (float(b[0]) - float(a[0])))
	return stops[-1][1]


static func _stage_color(v: float) -> Color:
	if v < Recipes.COOK_RAW:
		return Color("#a8bccf")
	if v < Recipes.COOK_GOOD:
		return Color("#ffcf4a")
	if v <= Recipes.COOK_OVER:
		return Color("#5fe07a")
	if v < Recipes.COOK_BURNT:
		return Color("#ff9d2e")
	return Color("#ff4a3a")


func _steel() -> GradientTexture2D:
	return _grad("steel", [
		[0.0, Color("#f2f5f7")], [0.22, Color("#c8ced4")], [0.5, Color("#9ea6ae")],
		[0.62, Color("#b8bfc6")], [0.85, Color("#8c949c")], [1.0, Color("#6c737b")],
	])


# --- Çizim -----------------------------------------------------------------------

func _draw() -> void:
	var lid_t: float = logic.lid_t
	var edge_y := _lid_edge(lid_t)
	var holding := Drag.is_holding()
	var hover_slot := -1
	if not holding and logic.can_pick():
		hover_slot = _slot_at(_mouse)
	_draw_shadows(edge_y)
	_draw_base()
	_draw_plate_heat()
	if lid_t < 0.985:
		_draw_dishes(hover_slot)
	_draw_lid(edge_y, not holding and hover_slot < 0 and _hit.has_point(_mouse))
	if lid_t > 0.9:
		_draw_closed_hints(edge_y, clampf((lid_t - 0.9) / 0.1, 0.0, 1.0))
	_draw_front_panel()
	_draw_label()


## Zemin gölgeleri: ışık sol üstten, gölge sağ alta düşer.
func _draw_shadows(edge_y: float) -> void:
	var cx := _x + _w * 0.5
	var bottom := _face_y + FACE_H + 6.0
	# geniş yumuşak gölge + ayak dibinde koyu temas gölgesi
	_blob(Vector2(cx + 12.0, bottom - 4.0), Vector2(_w * 0.62, 24.0), Color(0, 0, 0, 0.5))
	_blob(Vector2(cx + 4.0, bottom - 1.0), Vector2(_w * 0.52, 9.0), Color(0, 0, 0, 0.55))
	# gövdenin sağ yanına düşen gölge
	_blob(Vector2(_x + _w + 6.0, _hinge_y + PLATE_H * 0.6), Vector2(20.0, PLATE_H * 0.85), Color(0, 0, 0, 0.3))
	# açık kapağın arkaya / sağa düşen gölgesi
	if edge_y < _hinge_y - 4.0:
		var h := _hinge_y - edge_y
		_blob(Vector2(cx + 14.0, _hinge_y - h * 0.42 + 6.0), Vector2(_w * 0.56, h * 0.75), Color(0, 0, 0, 0.3))


func _draw_base() -> void:
	var ox := _x
	var oy := _hinge_y - 16.0
	var bh := PLATE_H + 52.0
	# gövde
	var body := Rect2(ox, oy, _w, bh - 4.0)
	_rr_grad(body, 10.0, _grad("body", [[0.0, Color("#5d646c")], [0.5, Color("#3e444b")], [1.0, Color("#272b30")]]))
	_rr_outline(body, 10.0, Color(0, 0, 0, 0.55), 1.5)
	# menteşe yuvası (arka)
	_rr_grad(Rect2(ox + 3.0, oy + 2.0, _w - 6.0, 14.0), 5.0, _steel())
	# plaka çukuru
	_rr(Rect2(ox + 4.0, oy + 16.0, _w - 8.0, PLATE_H), 4.0, Color("#1a1b1e"))
	var slot_tex := _grad("slot", [[0.0, Color("#4a4c52")], [1.0, Color("#2a2b2f")]])
	for s in _slots:
		_rr_grad(s, 4.0, slot_tex)
		# ızgara olukları
		var y := s.position.y + 5.0
		while y < s.end.y - 3.0:
			draw_rect(Rect2(s.position.x + 2.0, y, s.size.x - 4.0, 2.0), Color(0, 0, 0, 0.38))
			draw_rect(Rect2(s.position.x + 2.0, y + 2.0, s.size.x - 4.0, 1.0), Color(1, 1, 1, 0.10))
			y += 7.0
		# çukurun üst kenarından düşen iç gölge (derinlik)
		_poly(
			PackedVector2Array([s.position + Vector2(2, 1), Vector2(s.end.x - 2.0, s.position.y + 1.0), Vector2(s.end.x - 2.0, s.position.y + 13.0), s.position + Vector2(2, 13)]),
			PackedColorArray([Color(0, 0, 0, 0.45), Color(0, 0, 0, 0.45), Color(0, 0, 0, 0), Color(0, 0, 0, 0)]))
		_poly(
			PackedVector2Array([s.position + Vector2(1, 2), s.position + Vector2(11, 2), Vector2(s.position.x + 11.0, s.end.y - 2.0), Vector2(s.position.x + 1.0, s.end.y - 2.0)]),
			PackedColorArray([Color(0, 0, 0, 0.32), Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(0, 0, 0, 0.32)]))
		_rr_outline(s.grow(-0.5), 4.0, Color(1, 1, 1, 0.13))
	# ön panel (fırçalanmış çelik)
	var face := Rect2(ox + 1.0, _face_y, _w - 2.0, FACE_H)
	_rr_grad(face, 6.0, _grad("face", [[0.0, Color("#dfe4e8")], [0.35, Color("#b3bac1")], [1.0, Color("#868e96")]]))
	var i := 0
	var bx := face.position.x + 3.0
	while bx < face.end.x - 3.0:
		draw_rect(Rect2(bx, face.position.y + 2.0, 0.8, FACE_H - 4.0), Color(1, 1, 1, 0.12 * _brush[i % _brush.size()]))
		bx += 1.5
		i += 1
	# sol üstten gelen ışık: sağa doğru hafif kararma
	_poly(
		PackedVector2Array([face.position + Vector2(4, 1), Vector2(face.end.x - 4.0, face.position.y + 1.0), Vector2(face.end.x - 4.0, face.end.y - 1.0), Vector2(face.position.x + 4.0, face.end.y - 1.0)]),
		PackedColorArray([Color(1, 1, 1, 0.10), Color(0, 0, 0, 0.16), Color(0, 0, 0, 0.22), Color(0, 0, 0, 0.0)]))
	draw_rect(Rect2(ox + 6.0, _face_y + 1.0, _w - 12.0, 1.0), Color(1, 1, 1, 0.7))
	_rr_outline(face.grow(-0.5), 6.0, Color(0.118, 0.133, 0.157, 0.5))
	# ayaklar
	_rr(Rect2(ox + 8.0, oy + bh - 6.0, 18.0, 6.0), 2.0, Color("#16171a"))
	_rr(Rect2(ox + _w - 26.0, oy + bh - 6.0, 18.0, 6.0), 2.0, Color("#16171a"))


## Plakaların kızarması (ısı arttıkça belirginleşir)
func _draw_plate_heat() -> void:
	if _heat <= 0.01:
		return
	var a := (0.05 + 0.2 * _heat) * (0.85 + 0.15 * sin(_time * 3.0))
	for s in _slots:
		_rr(s, 4.0, Color(COL_HEAT, a))


func _draw_dishes(hover_slot: int) -> void:
	for j in _slots.size():
		if not logic.has_dish(j):
			continue
		var s := _slots[j]
		var c := s.get_center()
		_blob(c + Vector2(3, 7), Vector2(s.size.x * 0.5, s.size.y * 0.42), Color(0, 0, 0, 0.42))
		ItemView.draw_item(self, logic.dish(j), c, ITEM_W)
		if j == hover_slot:
			_rr_outline(s.grow(-1.0), 5.0, COL_HOVER, 2.0)


func _lid_quad(edge_y: float) -> PackedVector2Array:
	var k := (edge_y - _hinge_y) / _lid_len
	var ew := _w * (1.0 + 0.035 * k)
	var ex := _x - (ew - _w) * 0.5
	return PackedVector2Array([
		Vector2(_x + 2.0, _hinge_y), Vector2(_x + _w - 2.0, _hinge_y),
		Vector2(ex + ew - 2.0, edge_y), Vector2(ex + 2.0, edge_y),
	])


func _draw_lid(edge_y: float, hover: bool) -> void:
	var hy := _hinge_y
	var k := (edge_y - hy) / _lid_len
	var ew := _w * (1.0 + 0.035 * k)
	var ex := _x - (ew - _w) * 0.5
	var cx := _x + _w * 0.5
	var quad := _lid_quad(edge_y)
	if edge_y > hy + 4.0:
		_draw_lid_top(quad, edge_y, k, ew, ex, cx)
	elif edge_y < hy - 4.0:
		_draw_lid_under(quad, edge_y, ew, ex, cx)
	if hover and absf(edge_y - hy) > 4.0:
		_outline(quad, COL_HOVER, 2.0)
	# menteşe çubuğu
	_rr_grad(Rect2(_x + 5.0, hy - 4.0, _w - 10.0, 8.0), 4.0,
		_grad("hinge", [[0.0, Color("#f0f3f5")], [0.5, Color("#9aa2aa")], [1.0, Color("#565c63")]]))
	_rr(Rect2(_x + 5.0, hy - 4.5, 12.0, 9.0), 3.0, Color("#3a3f45"))
	_rr(Rect2(_x + _w - 17.0, hy - 4.5, 12.0, 9.0), 3.0, Color("#3a3f45"))
	draw_rect(Rect2(_x + 7.0, hy - 3.5, 8.0, 1.0), Color(1, 1, 1, 0.25))
	draw_rect(Rect2(_x + _w - 15.0, hy - 3.5, 8.0, 1.0), Color(1, 1, 1, 0.25))


## Kapağın üst yüzü (kapanırken / kapalı): parlak paslanmaz çelik
func _draw_lid_top(quad: PackedVector2Array, edge_y: float, k: float, ew: float, ex: float, cx: float) -> void:
	var hy := _hinge_y
	var kc := clampf(k, 0.0, 1.0)
	var th := 6.0 * kc
	var span := edge_y - hy
	# kapağın altına / önüne düşen gölge
	_blob(Vector2(cx + 5.0, edge_y + th + 3.0), Vector2(ew * 0.54, 9.0), Color(0, 0, 0, 0.5 * kc))
	_poly_grad(quad, _grad("lid_top", [[0.0, Color("#f3f6f8")], [0.3, Color("#cfd5db")], [0.72, Color("#a7afb7")], [1.0, Color("#8f979f")]]), hy, edge_y)
	# sağa doğru hafif kararma (ışık soldan)
	_poly(quad, PackedColorArray([Color(1, 1, 1, 0.08), Color(0, 0, 0, 0.10), Color(0, 0, 0, 0.16), Color(1, 1, 1, 0.0)]))
	# parlama şeritleri
	var gx := _x + _w * 0.64
	_cpoly(PackedVector2Array([Vector2(gx, hy), Vector2(gx + 20.0, hy), Vector2(gx - 8.0, edge_y), Vector2(gx - 28.0, edge_y)]), Color(1, 1, 1, 0.26))
	_cpoly(PackedVector2Array([Vector2(gx + 28.0, hy), Vector2(gx + 34.0, hy), Vector2(gx + 6.0, edge_y), Vector2(gx, edge_y)]), Color(1, 1, 1, 0.12))
	var lx := _x + _w * 0.14
	_cpoly(PackedVector2Array([Vector2(lx + 10.0, hy), Vector2(lx + 16.0, hy), Vector2(lx + 4.0, edge_y), Vector2(lx - 2.0, edge_y)]), Color(1, 1, 1, 0.14))
	if k > 0.3:
		# kabartma çerçeve + havalandırma yarıkları
		var py := hy + span * 0.1
		var ph := span * 0.7
		_rr_outline(Rect2(_x + 9.0, py + 1.0, _w - 18.0, ph), 6.0, Color(0, 0, 0, 0.16))
		_rr_outline(Rect2(_x + 9.0, py, _w - 18.0, ph), 6.0, Color(1, 1, 1, 0.45))
		for v in 4:
			_rr(Rect2(cx - 22.0 + v * 12.0, py + 5.0, 8.0, 2.2), 1.0, Color(0.118, 0.133, 0.157, 0.3))
	_outline(quad, Color(0.118, 0.133, 0.157, 0.55), 1.2)
	# ön kenar kalınlığı
	if th > 0.5:
		_rr_grad(Rect2(ex + 1.0, edge_y, ew - 2.0, th), 2.0, _grad("lid_rim", [[0.0, Color("#7d858d")], [1.0, Color("#4a5057")]]))
		draw_rect(Rect2(ex + 4.0, edge_y, ew - 8.0, 1.0), Color(1, 1, 1, 0.35))
	# tutamak (bakalit) + gölgesi
	var hw := ew * 0.56
	var hx := cx - hw * 0.5
	var hh := 4.0 + 5.0 * kc
	_rr(Rect2(hx + 2.0, edge_y, hw, hh + 1.5), 3.5, Color(0, 0, 0, 0.3 * kc))
	_rr_grad(Rect2(hx, edge_y - 2.0, hw, hh), 3.5, _grad("handle", [[0.0, Color("#3a3a40")], [0.45, Color("#1c1c20")], [1.0, Color("#0e0e11")]]))
	draw_rect(Rect2(hx + 5.0, edge_y - 1.0, hw - 10.0, 1.4), Color(1, 1, 1, 0.28))


## Kapağın alt yüzü (açık): oluklu üst plaka görünür
func _draw_lid_under(quad: PackedVector2Array, edge_y: float, ew: float, ex: float, cx: float) -> void:
	var hy := _hinge_y
	var span := hy - edge_y
	# kapak sacının kalınlığı: arkada parlak çelik kenar (sağa / aşağı kaymış → hacim hissi)
	var back := PackedVector2Array()
	for p in quad:
		back.append(p + Vector2(3.0, 0.0))
	_poly_grad(back, _steel(), edge_y, hy)
	_poly_grad(quad, _grad("lid_under", [[0.0, Color("#26272c")], [1.0, Color("#3b3d43")]]), edge_y, hy)
	# oluklar (yamuk içinde kalacak şekilde kenarlar ara değerle bulunur)
	var f := 0.12
	while f < 1.0:
		var y := edge_y + span * f
		var xl := lerpf(quad[3].x, quad[0].x, f) + 3.0
		var xr := lerpf(quad[2].x, quad[1].x, f) - 3.0
		draw_rect(Rect2(xl, y, xr - xl, 1.6), Color(0, 0, 0, 0.42))
		draw_rect(Rect2(xl, y + 1.6, xr - xl, 1.0), Color(1, 1, 1, 0.09))
		f += 0.11
	# üst plakadaki ısı
	if _heat > 0.01:
		_cpoly(quad, Color(COL_HEAT, 0.04 + 0.1 * _heat))
	# sol üstten gelen ışık: üstte hafif aydınlık, menteşeye doğru gölge
	_poly(quad, PackedColorArray([Color(0, 0, 0, 0.35), Color(0, 0, 0, 0.45), Color(0, 0, 0, 0.1), Color(1, 1, 1, 0.06)]))
	_outline(quad, Color("#9da5ad"), 3.0)
	# üst kenar (kapağın ön kenarı) + tutamak
	_rr_grad(Rect2(ex, edge_y - 6.0, ew, 6.0), 2.0, _grad("lid_edge", [[0.0, Color("#eef1f4")], [1.0, Color("#9ba3ab")]]))
	draw_rect(Rect2(ex + 3.0, edge_y - 5.5, ew - 6.0, 1.0), Color(1, 1, 1, 0.6))
	var hw := ew * 0.56
	_rr_grad(Rect2(cx - hw * 0.5, edge_y - 11.0, hw, 7.0), 3.0, _grad("handle", [[0.0, Color("#3a3a40")], [0.45, Color("#1c1c20")], [1.0, Color("#0e0e11")]]))
	draw_rect(Rect2(cx - hw * 0.5 + 5.0, edge_y - 10.0, hw - 10.0, 1.2), Color(1, 1, 1, 0.25))


## Kapak kapalıyken: aralıktan görünen tost kenarı, ısı sızıntısı ve pişme halkaları
func _draw_closed_hints(edge_y: float, alpha: float) -> void:
	# aralıktan sızan turuncu ısı
	if _heat > 0.2:
		_blob(Vector2(_x + _w * 0.5, edge_y + 3.0), Vector2(_w * 0.5, 7.0), Color(1.0, 0.45, 0.12, 0.35 * _heat * alpha))
	for j in _slots.size():
		if not logic.has_dish(j):
			continue
		var s := _slots[j]
		var v := logic.toast_of(j)
		var col := _ramp(TOAST_EDGE, v)
		var strip := Rect2(s.position.x + 4.0, edge_y + 5.0, s.size.x - 8.0, 3.0)
		var glow := Color(0, 0, 0, 0.6) if v >= TostLogic.TOAST_BURN else Color(col.lightened(0.2), 0.55)
		_blob(strip.get_center(), Vector2(strip.size.x * 0.56, 7.0), Color(glow, glow.a * alpha))
		_rr(strip, 1.5, Color(col, alpha))
		var ry := _hinge_y + (edge_y - _hinge_y) * 0.45
		_draw_ring(Vector2(s.get_center().x, ry), clampf(s.size.x * 0.24, 10.0, 15.0), v, alpha)


## İlerleme halkası: 1.0 = tam dolu; 1.2 üstünde turuncu/kırmızı ikinci tur
func _draw_ring(c: Vector2, r: float, v: float, alpha: float) -> void:
	draw_circle(c, r + 3.5, Color(0.063, 0.047, 0.078, 0.74 * alpha))
	var lw := maxf(2.4, r * 0.3)
	draw_arc(c, r, 0.0, TAU, 40, Color(1, 1, 1, 0.13 * alpha), lw, true)
	# ideal bölge işareti (0.85–1.0 arası yeşil iz)
	draw_arc(c, r, -PI * 0.5 + TAU * Recipes.COOK_GOOD, -PI * 0.5 + TAU, 12, Color(0.37, 0.88, 0.48, 0.28 * alpha), lw, true)
	var f := clampf(v, 0.0, 1.0)
	if f > 0.01:
		var col := Color("#5fe07a") if v >= Recipes.COOK_GOOD else Color("#ffcf4a")
		draw_arc(c, r, -PI * 0.5, -PI * 0.5 + TAU * f, 40, Color(col, alpha), lw, true)
	if v > Recipes.COOK_OVER:
		var o := clampf((v - Recipes.COOK_OVER) / (Recipes.COOK_BURNT - Recipes.COOK_OVER), 0.0, 1.0)
		var col2 := Color("#ff4a3a") if v >= Recipes.COOK_BURNT else Color("#ff9d2e")
		draw_arc(c, r, -PI * 0.5, -PI * 0.5 + TAU * o, 40, Color(col2, alpha), lw, true)
	var iw := maxf(1.6, r * 0.18)
	var s := r * 0.42
	if v >= Recipes.COOK_BURNT:
		var cc := Color(Color("#ff6a5a"), alpha)
		draw_line(c + Vector2(-s, -s), c + Vector2(s, s), cc, iw, true)
		draw_line(c + Vector2(s, -s), c + Vector2(-s, s), cc, iw, true)
	elif v >= Recipes.COOK_GOOD and v <= Recipes.COOK_OVER:
		draw_polyline(PackedVector2Array([c + Vector2(-s, 0), c + Vector2(-s * 0.25, s * 0.7), c + Vector2(s, -s * 0.7)]), Color(Color("#8dff9a"), alpha), iw, true)


func _draw_led(c: Vector2, r: float, col: Color, on: bool, dim: float) -> void:
	draw_circle(c, r + 1.4, Color("#17181b"))
	if on:
		_blob(c, Vector2(r * 4.5, r * 4.5), Color(col, 0.6))
		draw_circle(c, r, col.lightened(0.25))
	else:
		draw_circle(c, r, col.darkened(0.6))
		if dim > 0.0:
			draw_circle(c, r, Color(col, dim))
	draw_circle(c - Vector2(r, r) * 0.35, r * 0.35, Color(1, 1, 1, 0.7))


## Pişme çubuğu: yeşil bölge 0.85–1.2
func _draw_cook_bar(pos: Vector2, w: float, h: float, v: float) -> void:
	var vmax := 1.6
	_rr(Rect2(pos.x - 1.5, pos.y - 1.5, w + 3.0, h + 3.0), (h + 3.0) * 0.5, Color(0.047, 0.035, 0.063, 0.78))
	draw_rect(Rect2(pos.x + w * Recipes.COOK_GOOD / vmax, pos.y, w * (Recipes.COOK_OVER - Recipes.COOK_GOOD) / vmax, h), Color(0.37, 0.88, 0.48, 0.36))
	var f := clampf(v / vmax, 0.0, 1.0)
	if f > 0.005:
		_rr(Rect2(pos.x, pos.y, maxf(h, w * f), h), h * 0.5, _stage_color(v))
		draw_rect(Rect2(pos.x + 1.0, pos.y, maxf(0.0, w * f - 2.0), maxf(1.0, h * 0.3)), Color(1, 1, 1, 0.35))


## Ön panel: güç / hazır lambaları, yuva pişme çubukları
func _draw_front_panel() -> void:
	var running := Game.game_dt(1.0) > 0.0
	var has := not logic.is_empty()
	var all_ready := true
	var over := false
	var ok_ready := false
	for j in _slots.size():
		if not logic.has_dish(j):
			continue
		var v := logic.toast_of(j)
		if v < TostLogic.TOAST_DONE:
			all_ready = false
		if v >= TostLogic.TOAST_SMOKE:
			over = true
		if v >= TostLogic.TOAST_DONE and v < TostLogic.TOAST_BURN:
			ok_ready = true
	var red_on: bool = running and logic.closed and has and not all_ready
	var green_on := running and ok_ready and (not over or sin(_time * 12.0) > 0.0)
	_draw_led(Vector2(_x + 11.0, _face_y + 10.0), 3.4, Color("#ff3b30"), red_on, 0.18 if running else 0.0)
	_draw_led(Vector2(_x + 11.0, _face_y + 21.0), 3.4, Color("#34e05a"), green_on, 0.0)
	for j in _slots.size():
		if not logic.has_dish(j):
			continue
		var s := _slots[j]
		var bw := minf(s.size.x - 10.0, 64.0)
		var bx := clampf(s.get_center().x - bw * 0.5, _x + 22.0, _x + _w - 8.0 - bw)
		_draw_cook_bar(Vector2(bx, _face_y + 14.0), bw, 5.0, logic.toast_of(j))


## İstasyon köşesindeki küçük etiket
func _draw_label() -> void:
	var size := 13
	var tw := _font.get_string_size(LABEL, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var pill := Rect2(_r.position.x + 8.0, _r.position.y + 6.0, tw + 30.0, 22.0)
	_rr(pill, 11.0, Color(0.11, 0.09, 0.13, 0.78))
	_rr_outline(pill.grow(-0.5), 11.0, Color(1, 1, 1, 0.12))
	draw_circle(pill.position + Vector2(11.0, 11.0), 3.5, Color("#ffa53a"))
	var base := pill.position + Vector2(21.0, 11.0 + size * 0.36)
	draw_string(_font, base, LABEL, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color("#fff6e0"))
