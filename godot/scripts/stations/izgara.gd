extends Node2D
## Izgara istasyonu (web js/stations_cook.js "IZGARA": izgaraZone, updateIzgara, drawIzgara).
## Gazlı kömür ızgarası (elektrik gerekmez), geliştirmeye göre 4/6/8 yuva. Köftenin alt yüzü (cookA) pişer;
## köfteye kısa tık = çevir (cookA ↔ cookB), sürükleme = al. Saf mantık izgara_logic.gd'de; bu script
## çizim, ışık, partikül ve Drag bölge protokolünü üstlenir.
##
## Çizim katmanları (alttan üste):
##   _back  (show_behind_parent): ızgara gövdesinin gölgesi, gövde, kömür yatağı — durağan
##   _glow  (show_behind_parent, toplamalı karışım): kor parıltısı, titreyen korlar, yağ damlayınca alev parlamaları
##   self   : gövde çerçevesi (parıltı taşmasını örter), ızgara telleri, köfteler, pişme çubukları, etiketler
##   partiküller: cızırtı kıvılcımları, buhar/duman, çevirme kıvılcım patlaması
##
## Demo kipi (yalnız ekran görüntüsü kontrolü için): `-- --izgara-demo=1.0` → dört yuvaya farklı pişmelerde
## köfteler koyar (değer alt yüz pişmelerini ölçekler), ikinci köfteyi çevirmeye başlar.

const IzgaraLogic := preload("res://scripts/stations/izgara_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

## Drag önceliği (web izgaraZone.z)
var zone_z: int = 5

const LABEL := "Izgara"
const UPG_ID := "izgara"
const MAX_SLOTS := 12
## Yerleşim (web grillGeo): gövde ve iç (kömür) bölgesi kenar boşlukları
const BOX_PAD_X := 10.0
const BOX_PAD_TOP := 28.0
const BOX_PAD_BOTTOM := 18.0
const INNER_PAD := 11.0
const BOX_RAD := 12.0
const INNER_RAD := 6.0
## Gövdenin ön yüz kalınlığı (2.5D derinlik)
const BODY_DEPTH := 7.0
const PATTY_R_MAX := 30.0
## Köfteye basış: bu yarıçap katı içinde sayılır; sürükleme eşiği (px)
const HIT_R_MULT := 1.3
const PRESS_DRAG_DIST := 12.0
## Çevirirken köftenin kalkma yüksekliği (px)
const FLIP_LIFT := 30.0
## Izgara telleri
const ROD_STEP := 12.0
const ROD_H := 6.0
## Yağ damlayınca alev parlaması: saniyede olasılık ve en çok sayı
const FLARE_RATE := 1.3
const FLARE_MAX := 30
const LIGHT_ENERGY := 0.85
## Izgara izlerinin eğimi (dy/dx): izler tellerle karışmasın diye çapraz
const MARK_TILT := 0.42

const COL_HOVER := Color(1.0, 0.925, 0.627, 0.8)
const COL_STEAM := Color(1.0, 1.0, 1.0, 0.3)
const COL_SMOKE := Color(0.62, 0.62, 0.64, 0.5)
const COL_DARK := Color(0.12, 0.1, 0.1, 0.7)
const COL_FLIP := Color("#8dff9a")
## Köfte rengi (web R_PATTY)
const PATTY_RAMP := [
	[0.0, Color("#d9716a")], [0.3, Color("#c86e57")], [0.65, Color("#a05a36")], [1.0, Color("#74401f")],
	[1.25, Color("#583017")], [1.5, Color("#2f1d12")], [2.0, Color("#161111")],
]
const BODY_STOPS := [[0.0, Color("#5b5f66")], [0.07, Color("#3b3e44")], [1.0, Color("#1b1c1f")]]
const ROD_STOPS := [[0.0, Color("#a3a9b0")], [0.35, Color("#5b6067")], [1.0, Color("#1e2024")]]
const ROCK_COLS := [Color("#2c2522"), Color("#3a302b"), Color("#221c1a"), Color("#332824")]

var logic: IzgaraLogic = IzgaraLogic.new()

# geometri (1600x900 mantıksal uzay)
var _r: Rect2
var _box: Rect2
var _inner: Rect2
## Yuva merkezleri ve köfte yarıçapı
var _centers: Array[Vector2] = []
var _pr: float = 26.0

# köfteye basış takibi (kısa tık = çevir, sürükleme = al)
var _press_active := false
var _press_slot := -1
var _press_pos := Vector2.ZERO

## Yuva başına görünüm: {uid, pts: PackedFloat32Array (kenar yarıçap katları), specks: Array, tilt: float, rot: float}
var _looks: Array = []
## Alev parlamaları: {pos: Vector2, h: float, t: float, life: float}
var _flares: Array[Dictionary] = []
## Durağan kor parıltı / kor noktaları (u, v: iç bölgede 0..1)
var _glows: Array[Dictionary] = []
var _embers: Array[Dictionary] = []
## Kömür taşları: {pts: PackedVector2Array, col: Color, rim: bool, hi: Vector2, hr: float}
var _rocks: Array[Dictionary] = []

var _heat := 0.5
var _time := 0.0
var _mouse := Vector2(-1000, -1000)
var _rng := RandomNumberGenerator.new()
var _tex: Dictionary = {}
var _back: Node2D
var _glow: Node2D
var _light: PointLight2D
var _sparks: Array[GPUParticles2D] = []
var _bursts: Array[GPUParticles2D] = []
var _smoke: Array[GPUParticles2D] = []


func _ready() -> void:
	# Izgara kendi ışığından etkilenmez (kor parıltısı elle çizilir); ışık çevredeki tezgaha düşer.
	light_mask = 0
	_rng.seed = 90210
	_r = GameData.rect("izgara")
	_box = Rect2(_r.position.x + BOX_PAD_X, _r.position.y + BOX_PAD_TOP,
		_r.size.x - BOX_PAD_X * 2.0, _r.size.y - BOX_PAD_TOP - BOX_PAD_BOTTOM)
	_inner = _box.grow(-INNER_PAD)
	_build_static()
	_back = Node2D.new()
	_back.show_behind_parent = true
	_back.light_mask = 0
	_back.draw.connect(_draw_back)
	add_child(_back)
	_glow = Node2D.new()
	_glow.show_behind_parent = true
	_glow.light_mask = 0
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	_glow.material = mat
	_glow.draw.connect(_draw_glow)
	add_child(_glow)
	_build_light()
	_sync_slots(true)
	Drag.register(self)
	_apply_demo_args()


func _exit_tree() -> void:
	Drag.unregister(self)


## Kor, parıltı ve kömür taşı konumları (web GLOW / EMBERS / drawGrillBox; sabit tohumla)
func _build_static() -> void:
	var g := RandomNumberGenerator.new()
	g.seed = 4242
	for i in 14:
		_glows.append({"u": 0.06 + g.randf() * 0.88, "v": 0.08 + g.randf() * 0.84, "r": 34.0 + g.randf() * 26.0,
			"s": 1.2 + g.randf() * 2.6, "ph": g.randf() * 6.0})
	g.seed = 999
	for i in 26:
		_embers.append({"u": 0.03 + g.randf() * 0.94, "v": 0.05 + g.randf() * 0.9, "r": 5.0 + g.randf() * 7.0,
			"s": 2.0 + g.randf() * 4.0, "ph": g.randf() * 6.0})
	g.seed = 77
	for i in 120:
		var rr := 5.0 + g.randf() * 8.0
		var c := Vector2(_inner.position.x + rr * 0.5 + g.randf() * (_inner.size.x - rr),
			_inner.position.y + rr * 0.5 + g.randf() * (_inner.size.y - rr))
		var pts := PackedVector2Array()
		for k in 6:
			var a := k / 6.0 * TAU + g.randf() * 0.4
			var d := rr * (0.7 + 0.3 * g.randf())
			pts.append(c + Vector2(cos(a) * d, sin(a) * d * 0.8))
		_rocks.append({"pts": pts, "col": ROCK_COLS[g.randi() % ROCK_COLS.size()], "rim": g.randf() < 0.5,
			"hi": c - Vector2(rr, rr) * 0.3, "hr": rr * 0.35})


## Yuva sayısını geliştirmeye eşitler; değişince yerleşimi ve partikülleri yeniden kurar.
func _sync_slots(force: bool = false) -> void:
	var n := clampi(int(round(float(Game.upg_val(UPG_ID, "slots", IzgaraLogic.DEFAULT_SLOTS)))), 1, MAX_SLOTS)
	if not force and n == logic.slots.size():
		return
	logic.set_slot_count(n)
	_build_geometry()
	for p in _sparks + _bursts + _smoke:
		p.queue_free()
	_sparks.clear()
	_bursts.clear()
	_smoke.clear()
	while _looks.size() < logic.slots.size():
		_looks.append({"uid": -1})
	_looks.resize(logic.slots.size())
	for i in logic.slots.size():
		_sparks.append(_make_sparks(false))
		_bursts.append(_make_sparks(true))
		_smoke.append(_make_smoke())
		_sparks[i].position = _centers[i]
		_bursts[i].position = _centers[i]


## web grillGeo: n <= 4 → 2 sütun, <= 6 → 3, değilse 4
func _build_geometry() -> void:
	var n := logic.slots.size()
	var cols := 2 if n <= 4 else (3 if n <= 6 else 4)
	var rows := int(ceil(float(n) / cols))
	var cw := _inner.size.x / cols
	var ch := _inner.size.y / rows
	_pr = minf(PATTY_R_MAX, minf(cw * 0.4, ch * 0.3))
	_centers.clear()
	for i in n:
		var c := i % cols
		var ri := i / cols
		_centers.append(Vector2(_inner.position.x + cw * (c + 0.5), _inner.position.y + ch * (ri + 0.5) + 8.0))


func _apply_demo_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--izgara-demo="):
			continue
		var v := clampf(float(a.trim_prefix("--izgara-demo=")), 0.0, IzgaraLogic.GRILL_MAX)
		var faces := [[0.84, 0.0], [1.0, 0.5], [1.25, 1.0], [1.48, 1.3]]
		for i in mini(faces.size(), logic.slots.size()):
			logic.place_at(i, Items.ing("kofte", {"cookA": float(faces[i][0]) * v, "cookB": float(faces[i][1])}))
		_flip(1)
		for p in _smoke + _sparks:
			p.preprocess = 1.2


# --- Drag bölge protokolü ------------------------------------------------------

func zone_rect() -> Rect2:
	return _r


func can_drop(item: Dictionary) -> bool:
	return logic.accepts(item)


## En yakın boş yuvaya bırakır (web izgaraZone.onDrop).
func drop(item: Dictionary, pt: Vector2) -> bool:
	if not can_drop(item):
		return false
	var i := _nearest(pt, false)
	if i < 0 or not logic.place_at(i, item):
		return false
	_new_look(i)
	if Game.game_dt(1.0) > 0.0:
		_bursts[i].restart()
	return true


func return_item(item: Dictionary) -> void:
	var i := logic.put_back(item)
	if i < 0:
		push_warning("ızgara: iade için boş yuva yok")
	else:
		_new_look(i)


## Köfteye basış beklemeye alınır: kısa tık → click ile çevrilir, sürüklenirse _process köfteyi ele verir.
func pick(pt: Vector2) -> Dictionary:
	_press_active = false
	var i := _patty_at(pt)
	if i >= 0 and not logic.is_flipping(i):
		_press_active = true
		_press_slot = i
		_press_pos = pt
	return {}


func click(_pt: Vector2) -> void:
	if not _press_active:
		return
	_press_active = false
	_flip(_press_slot)


func hover_text(pt: Vector2) -> String:
	var i := _patty_at(pt)
	if i >= 0:
		var a := logic.bottom_of(i)
		var b := logic.top_of(i)
		var s := "Köfte — %s\nAlt: %s (%%%d) • Üst: %s (%%%d)\nTıkla: çevir • Sürükle: al" % [
			Recipes.cook_label(IzgaraLogic.overall(a, b)),
			Recipes.cook_label(a).to_lower(), roundi(a * 100.0),
			Recipes.cook_label(b).to_lower(), roundi(b * 100.0)]
		if logic.wants_flip(i):
			s += "\n↻ Alt yüz pişti, çevir!"
		return s
	return "Izgara — %d/%d yer boş\nÇiğ köfteyi ızgaraya bırak; alt yüz pişince çevir." % [logic.free_count(), logic.slots.size()]


## pt'ye en yakın yuva. want_item: true = dolu, false = boş. Yoksa -1.
func _nearest(pt: Vector2, want_item: bool) -> int:
	var best := -1
	var bd := INF
	for i in _centers.size():
		if logic.has_item(i) != want_item:
			continue
		var d := pt.distance_to(_centers[i])
		if d < bd:
			bd = d
			best = i
	return best


## pt'nin altındaki köfte (yoksa -1)
func _patty_at(pt: Vector2) -> int:
	var i := _nearest(pt, true)
	if i >= 0 and pt.distance_to(_centers[i]) <= _pr * HIT_R_MULT:
		return i
	return -1


func _flip(i: int) -> void:
	if not logic.flip(i):
		return
	if not (_looks[i] as Dictionary).has("rot"):
		_new_look(i)
	_looks[i].rot = float(_looks[i].rot) + _rng.randf_range(-0.5, 0.5)
	_bursts[i].restart()


# --- Güncelleme ----------------------------------------------------------------

func _process(dt: float) -> void:
	_time += dt
	_mouse = get_viewport().get_mouse_position()
	_sync_slots()
	_update_press()
	var gdt := Game.game_dt(dt)
	var running := gdt > 0.0
	var speed := float(Game.upg_val(UPG_ID, "speed", 1.0))
	var events: Array = logic.update(gdt, dt, speed, Game.has_staff("sef"))
	for ev: Dictionary in events:
		var i := int(ev.slot)
		var pos := _centers[i] - Vector2(0.0, _pr + 14.0)
		match String(ev.type):
			"ready":
				Game.float_text.emit(pos, "↻ Çevir!", Game.COLOR_INFO)
			"burn":
				Game.float_text.emit(pos, "Yandı!", Game.COLOR_BAD)
			"chef_flip":
				Game.float_text.emit(pos, "Usta çevirdi", Game.COLOR_INFO)
				_looks[i].rot = float(_looks[i].get("rot", 0.0)) + _rng.randf_range(-0.5, 0.5)
				_bursts[i].restart()
	for i in logic.slots.size():
		if logic.has_item(i) and int(logic.item(i).get("uid", -2)) != int(_looks[i].get("uid", -1)):
			_new_look(i)
	_heat = lerpf(_heat, 1.0 if running else 0.5, 1.0 - exp(-dt * 1.5))
	_update_flares(dt, gdt, running)
	_update_particles(running)
	_light.energy = _heat * (LIGHT_ENERGY + 0.08 * sin(_time * 4.1) + 0.05 * sin(_time * 11.7 + 1.3))
	_glow.queue_redraw()
	queue_redraw()


## Köfteye basılıyken fare yeterince hareket ederse köfteyi ele ver (web izgaraZone.onDrag).
func _update_press() -> void:
	if not _press_active:
		return
	if Drag.is_holding() or not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		_press_active = false
		return
	if _mouse.distance_to(_press_pos) < PRESS_DRAG_DIST:
		return
	_press_active = false
	var item: Dictionary = logic.take(_press_slot)
	if not item.is_empty():
		Drag.start_hold(item, self)


func _update_flares(dt: float, gdt: float, running: bool) -> void:
	for k in range(_flares.size() - 1, -1, -1):
		_flares[k].t = float(_flares[k].t) + dt
		if float(_flares[k].t) >= float(_flares[k].life):
			_flares.remove_at(k)
	if not running:
		return
	for i in logic.slots.size():
		if not logic.has_item(i) or _flares.size() >= FLARE_MAX:
			continue
		if _rng.randf() < gdt * FLARE_RATE:
			var c := _centers[i]
			_flares.append({
				"pos": Vector2(c.x + _rng.randf_range(-_pr * 0.95, _pr * 0.95), c.y + _pr * 0.55 + _rng.randf_range(0.0, 6.0)),
				"h": _rng.randf_range(16.0, 32.0) * (_pr / 26.0), "t": 0.0, "life": _rng.randf_range(0.25, 0.5)})


func _update_particles(running: bool) -> void:
	for i in logic.slots.size():
		var has := logic.has_item(i)
		var a := logic.bottom_of(i)
		_sparks[i].emitting = has and running
		var burnt := a >= IzgaraLogic.GRILL_BURN
		var over := a >= IzgaraLogic.GRILL_SMOKE
		_smoke[i].position = _centers[i] - Vector2(0.0, _pr * 0.3)
		_smoke[i].emitting = has and running
		_smoke[i].amount_ratio = 1.0 if burnt else (0.6 if over else 0.25)
		var m := _smoke[i].process_material as ParticleProcessMaterial
		m.color = COL_DARK if burnt else (COL_SMOKE if over else COL_STEAM)


## Yeni konan köftenin biçimi (web pattyPoints): kenar pürüzü, kıyma benekleri, ızgara izi eğimi
func _new_look(i: int) -> void:
	var it := logic.item(i)
	var pts := PackedFloat32Array()
	for k in 14:
		pts.append(1.0 + (_rng.randf() - 0.5) * 0.13)
	var specks: Array = []
	for k in 20:
		var ang := _rng.randf() * TAU
		var d := sqrt(_rng.randf()) * 0.78
		specks.append({"p": Vector2(cos(ang), sin(ang)) * d, "s": 0.6 + _rng.randf() * 1.4, "fat": _rng.randf() < 0.45})
	_looks[i] = {"uid": int(it.get("uid", -1)), "pts": pts, "specks": specks,
		"tilt": -(MARK_TILT + (_rng.randf() - 0.5) * 0.25), "rot": _rng.randf() * TAU}


# --- Işık ve partiküller -------------------------------------------------------

func _build_light() -> void:
	_light = PointLight2D.new()
	_light.texture = _blob_tex()
	_light.texture_scale = 3.2
	_light.color = Color(1.0, 0.5, 0.18)
	_light.energy = 0.0
	_light.blend_mode = Light2D.BLEND_MODE_ADD
	_light.position = _inner.get_center()
	add_child(_light)


## Cızırtı kıvılcımları (burst = çevirince / bırakınca tek seferlik patlama)
func _make_sparks(burst: bool) -> GPUParticles2D:
	var p := GPUParticles2D.new()
	p.texture = _blob_tex()
	p.amount = 10 if burst else 3
	p.lifetime = 0.5
	p.one_shot = burst
	p.explosiveness = 0.95 if burst else 0.0
	p.emitting = false
	p.local_coords = false
	p.light_mask = 0
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	p.material = mat
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(_pr * (0.5 if burst else 0.9), _pr * 0.4, 0.0)
	m.direction = Vector3(0, -1, 0)
	m.spread = 35.0
	m.initial_velocity_min = 60.0
	m.initial_velocity_max = 170.0
	m.gravity = Vector3(0, 520, 0)
	m.lifetime_randomness = 0.5
	m.scale_min = 0.03
	m.scale_max = 0.055
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	g.colors = PackedColorArray([Color("#fff1b8"), Color("#ffb347"), Color(1.0, 0.35, 0.1, 0.0)])
	var gt := GradientTexture1D.new()
	gt.gradient = g
	m.color_ramp = gt
	p.process_material = m
	add_child(p)
	return p


## Buhar / duman (rengi pişmeye göre değişir)
func _make_smoke() -> GPUParticles2D:
	var p := GPUParticles2D.new()
	p.texture = _blob_tex()
	p.amount = 14
	p.lifetime = 1.6
	p.emitting = false
	p.local_coords = false
	p.light_mask = 0
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(_pr * 0.6, 3.0, 0.0)
	m.direction = Vector3(0, -1, 0)
	m.spread = 16.0
	m.initial_velocity_min = 22.0
	m.initial_velocity_max = 42.0
	m.gravity = Vector3(0, -8, 0)
	m.lifetime_randomness = 0.35
	m.scale_min = 0.12
	m.scale_max = 0.2
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.5))
	curve.add_point(Vector2(1.0, 1.6))
	var ct := CurveTexture.new()
	ct.curve = curve
	m.scale_curve = ct
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.2, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 0), Color(1, 1, 1, 1), Color(1, 1, 1, 0)])
	var gt := GradientTexture1D.new()
	gt.gradient = g
	m.color_ramp = gt
	m.color = COL_STEAM
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


# --- Çizim yardımcıları --------------------------------------------------------

## Bozuk (üçgenlenemeyen, ör. çevirmede incelen köfte) çokgenleri sessizce atlar
static func _cpoly(ci: CanvasItem, pts: PackedVector2Array, col: Color) -> void:
	if pts.size() >= 3 and not Geometry2D.triangulate_polygon(pts).is_empty():
		ci.draw_colored_polygon(pts, col)


static func _poly_grad(ci: CanvasItem, pts: PackedVector2Array, bbox: Rect2, tex: Texture2D) -> void:
	if pts.size() >= 3 and not Geometry2D.triangulate_polygon(pts).is_empty():
		Draw.fill_grad(ci, pts, bbox, tex)


static func _outline(ci: CanvasItem, pts: PackedVector2Array, col: Color, width: float) -> void:
	var closed := pts.duplicate()
	closed.append(pts[0])
	ci.draw_polyline(closed, col, width, true)


func _blob(ci: CanvasItem, center: Vector2, half: Vector2, col: Color) -> void:
	ci.draw_texture_rect(_blob_tex(), Rect2(center - half, half * 2.0), false, col)


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


## Sol-ortadan başlayıp saat yönünde dönen yumuşak köşeli dikdörtgen kenarı.
## İlk yarı (0..half) üst yarıyı, kalanı alt yarıyı verir: delikli çerçeveyi iki basit çokgene bölmek için.
static func _rr_path(r: Rect2, rad: float, seg: int = 6) -> Array:
	rad = minf(rad, minf(r.size.x, r.size.y) * 0.5 - 0.01)
	var top := PackedVector2Array([Vector2(r.position.x, r.get_center().y)])
	var bottom := PackedVector2Array([Vector2(r.end.x, r.get_center().y)])
	var arcs := [
		[Vector2(r.position.x + rad, r.position.y + rad), PI], [Vector2(r.end.x - rad, r.position.y + rad), PI * 1.5],
		[Vector2(r.end.x - rad, r.end.y - rad), 0.0], [Vector2(r.position.x + rad, r.end.y - rad), PI * 0.5],
	]
	for k in 4:
		var c: Vector2 = arcs[k][0]
		var a0: float = arcs[k][1]
		for s in seg + 1:
			var a := a0 + PI * 0.5 * s / seg
			var p := c + Vector2(cos(a), sin(a)) * rad
			if k < 2:
				top.append(p)
			else:
				bottom.append(p)
	top.append(Vector2(r.end.x, r.get_center().y))
	bottom.append(Vector2(r.position.x, r.get_center().y))
	return [top, bottom]


## Çerçeve halkası (outer - inner) iki basit çokgen olarak
static func _ring(outer: Rect2, orad: float, inner: Rect2, irad: float) -> Array[PackedVector2Array]:
	var o := _rr_path(outer, orad)
	var n := _rr_path(inner, irad)
	var out: Array[PackedVector2Array] = []
	for h in 2:
		var pts: PackedVector2Array = (o[h] as PackedVector2Array).duplicate()
		var ip: PackedVector2Array = n[h]
		for k in range(ip.size() - 1, -1, -1):
			pts.append(ip[k])
		out.append(pts)
	return out


# --- Çizim: arka katman (durağan) ---------------------------------------------------

func _draw_back() -> void:
	var c := _back
	var b := _box
	# zemin gölgesi: ışık sol üstten → sağ alta
	_blob(c, b.get_center() + Vector2(10.0, 12.0), b.size * 0.62, Color(0, 0, 0, 0.45))
	Draw.rr(c, Rect2(b.position + Vector2(4, 6), b.size + Vector2(2, 2)), BOX_RAD, Color(0, 0, 0, 0.35))
	# gövdenin ön yüzü (döküm kalınlığı)
	Draw.rr_grad(c, Rect2(b.position.x, b.position.y + BODY_DEPTH, b.size.x, b.size.y), BOX_RAD,
		[[0.0, Color("#2a2b2f")], [0.8, Color("#151618")], [1.0, Color("#0c0c0e")]])
	# gövde (üst yüz)
	Draw.rr_grad(c, b, BOX_RAD, BODY_STOPS)
	# kömür çukuru
	Draw.rr(c, _inner.grow(3.0), INNER_RAD + 2.0, Color("#0a0706"))
	Draw.fill_grad(c, Draw.rr_points(_inner, INNER_RAD), _inner,
		Draw.grad([[0.0, Color("#2e1810")], [1.0, Color("#0d0806")]], Vector2(0.5, 0.5), Vector2(1.15, 0.5), true))
	for rk: Dictionary in _rocks:
		var pts: PackedVector2Array = rk.pts
		_cpoly(c, pts, rk.col)
		if rk.rim:
			_outline(c, pts, Color(1.0, 0.35, 0.08, 0.22), 1.0)
		c.draw_circle(rk.hi, rk.hr, Color(1, 1, 1, 0.05))


# --- Çizim: kor parıltısı (toplamalı) -------------------------------------------------

func _draw_glow() -> void:
	var c := _glow
	var ins := _inner
	var heat := _heat
	for p: Dictionary in _glows:
		var fl := 0.55 + 0.25 * sin(_time * float(p.s) + float(p.ph)) + 0.12 * sin(_time * float(p.s) * 2.7 + float(p.ph) * 3.0)
		var pos := ins.position + Vector2(float(p.u) * ins.size.x, float(p.v) * ins.size.y)
		var r := _fit_r(pos, float(p.r) * (0.9 + 0.15 * fl))
		_blob(c, pos, Vector2(r, r), Color(1.0, 0.42, 0.12, clampf(fl * 0.5 * heat, 0.0, 1.0) * 0.7))
	for e: Dictionary in _embers:
		var fl := 0.5 + 0.5 * sin(_time * float(e.s) + float(e.ph))
		var pos := ins.position + Vector2(float(e.u) * ins.size.x, float(e.v) * ins.size.y)
		var r := _fit_r(pos, float(e.r) * (0.8 + 0.4 * fl))
		var a := clampf((0.25 + 0.6 * fl) * heat, 0.0, 1.0)
		_blob(c, pos, Vector2(r, r), Color(1.0, 0.55, 0.15, a))
		_blob(c, pos, Vector2(r, r) * 0.4, Color(1.0, 0.85, 0.5, a * 0.8))
	# alev parlamaları (yağ damlayınca)
	for f: Dictionary in _flares:
		var u := float(f.t) / float(f.life)
		var h := float(f.h) * sin(PI * minf(1.0, u * 1.15))
		if h < 1.0:
			continue
		var a := 0.9 * (1.0 - u * 0.4)
		var base: Vector2 = f.pos
		c.draw_texture_rect(_blob_tex(), Rect2(base.x - h * 0.3, base.y - h, h * 0.6, h * 1.1), false, Color(1.0, 0.45, 0.1, a))
		c.draw_texture_rect(_blob_tex(), Rect2(base.x - h * 0.15, base.y - h * 0.7, h * 0.3, h * 0.75), false, Color(1.0, 0.85, 0.45, a))


## Parıltı lekesi gövde dışına taşmasın: yarıçapı gövde kenarına olan uzaklıkla sınırla
func _fit_r(pos: Vector2, r: float) -> float:
	var d := minf(minf(pos.x - _box.position.x, _box.end.x - pos.x), minf(pos.y - _box.position.y, _box.end.y - pos.y))
	return clampf(r, 2.0, maxf(2.0, d))


# --- Çizim: ön katman -------------------------------------------------------------

func _draw() -> void:
	var holding := Drag.is_holding()
	var hover := -1 if holding else _patty_at(_mouse)
	_draw_frame()
	_draw_grate()
	for i in logic.slots.size():
		if logic.has_item(i):
			_draw_slot(i, i == hover)
	if holding and logic.accepts(Drag.held):
		_draw_free_marks()
	Draw.station_label(self, _r, LABEL)
	_draw_level_tag()


## Gövde çerçevesi: parıltı taşmasını örter, kenar çizgileri ve perçinler
func _draw_frame() -> void:
	var b := _box
	var ins := _inner.grow(3.0)
	var tex := Draw.grad(BODY_STOPS)
	for half in _ring(b, BOX_RAD, ins, INNER_RAD + 2.0):
		_poly_grad(self, half, b, tex)
	_outline(self, Draw.rr_points(b.grow(-1.0), BOX_RAD - 1.0), Color("#80868d"), 2.0)
	_outline(self, Draw.rr_points(b.grow(-0.5), BOX_RAD), Color(0, 0, 0, 0.6), 1.0)
	# iç kenarda kararan dudak (derinlik)
	_outline(self, Draw.rr_points(_inner.grow(-1.0), INNER_RAD), Color(0, 0, 0, 0.65), 4.0)
	_outline(self, Draw.rr_points(ins.grow(0.5), INNER_RAD + 2.0), Color(1, 1, 1, 0.08), 1.0)
	for p: Vector2 in [b.position + Vector2(6, 6), Vector2(b.end.x - 6.0, b.position.y + 6.0),
			Vector2(b.position.x + 6.0, b.end.y - 6.0), b.end - Vector2(6, 6)]:
		draw_circle(p + Vector2(0.6, 0.8), 2.8, Color(0, 0, 0, 0.5))
		draw_circle(p, 2.6, Color("#9aa0a7"))
		draw_circle(p - Vector2(0.7, 0.7), 1.0, Color.WHITE)


## Döküm ızgara: dikey taşıyıcılar + yatay teller (altlarına kor ışığı vurur)
func _draw_grate() -> void:
	var ins := _inner
	for f: float in [0.2, 0.5, 0.8]:
		var x := ins.position.x + ins.size.x * f
		draw_rect(Rect2(x - 3.0, ins.position.y - 4.0, 6.0, ins.size.y + 8.0), Color("#18191c"))
		draw_rect(Rect2(x - 3.0, ins.position.y - 4.0, 1.5, ins.size.y + 8.0), Color(1, 1, 1, 0.09))
	var glow_a := 0.12 + 0.14 * _heat
	var y := ins.position.y + 4.0
	while y < ins.end.y - 2.0:
		var rod := Rect2(ins.position.x - 6.0, y, ins.size.x + 12.0, ROD_H)
		# telin tezgaha (kömüre) düşen gölgesi
		draw_rect(Rect2(rod.position.x + 2.0, y + ROD_H, rod.size.x - 4.0, 2.0), Color(0, 0, 0, 0.35))
		Draw.rr_grad(self, rod, 3.0, ROD_STOPS)
		draw_rect(Rect2(rod.position.x + 2.0, y + ROD_H - 1.0, rod.size.x - 4.0, 1.2), Color(1.0, 0.47, 0.16, glow_a))
		y += ROD_STEP


func _draw_slot(i: int, hover: bool) -> void:
	var c := _centers[i]
	var sl: Dictionary = logic.slots[i]
	var a := logic.bottom_of(i)
	var b := logic.top_of(i)
	var lift := 0.0
	var sy := 1.0
	var top_v := b
	var bot_v := a
	if float(sl.flip_t) >= 0.0:
		var f := clampf(float(sl.flip_t), 0.0, 1.0)
		lift = sin(PI * f) * FLIP_LIFT
		sy = absf(cos(PI * f))
		if f < 0.5:
			top_v = a
			bot_v = b
	var r := _pr * (1.0 + float(sl.drop) * 0.14)
	# gölge (ışık sol üstten): köfte kalktıkça küçülür ve solar
	Draw.ellipse_shadow(self, c + Vector2(3.0 + lift * 0.15, r * 0.4 + 3.0), r * (1.0 - lift / 90.0), r * 0.36,
		Color(0, 0, 0, 0.5 * (1.0 - lift / 50.0)), 6.0, 4)
	_draw_patty(c - Vector2(0.0, lift), r, top_v, bot_v, _looks[i], sy)
	if hover:
		Draw.ellipse_line(self, c + Vector2(0, 2), r + 5.0, r * 0.8 + 6.0, COL_HOVER, 2.0)
	# iki yüz göstergesi: üst çubuk = üst yüz, alt çubuk = alt (ızgaradaki) yüz
	var bw := minf(r * 2.0, 46.0)
	var bp := Vector2(c.x - bw * 0.5, c.y - r * 0.8 - 17.0 - lift)
	_draw_cook_bar(bp, bw, 4.0, b)
	_draw_cook_bar(bp + Vector2(0, 6.5), bw, 4.0, a)
	if logic.wants_flip(i) and float(sl.flip_t) < 0.0:
		_draw_flip_icon(c + Vector2(r * 0.95, -r * 0.55), 6.0, 0.65 + 0.35 * sin(_time * 8.0))


func _patty_points(c: Vector2, r: float, look: Dictionary, ky: float) -> PackedVector2Array:
	var radii: PackedFloat32Array = look.pts
	var rot := float(look.rot)
	var n := radii.size()
	var out := PackedVector2Array()
	var steps := n * 3
	for k in steps:
		var t := float(k) / 3.0
		var i0 := int(t) % n
		var i1 := (i0 + 1) % n
		var w := t - floorf(t)
		w = w * w * (3.0 - 2.0 * w)
		var rr := r * lerpf(radii[i0], radii[i1], w)
		var ang := TAU * float(k) / steps + rot
		out.append(c + Vector2(cos(ang) * rr, sin(ang) * rr * ky))
	return out


## Köfte (web drawPatty): top = üst yüz pişmesi, bottom = alt yüz (kenar bandının rengi), sy = çevirme ölçeği
func _draw_patty(c: Vector2, r: float, top: float, bottom: float, look: Dictionary, sy: float) -> void:
	if not look.has("pts"):
		return
	var ky := 0.8 * maxf(0.06, sy)
	var tc := _ramp(PATTY_RAMP, top)
	var bc := _ramp(PATTY_RAMP, bottom)
	var thick := 5.0 * maxf(0.15, sy)
	# kenar (alt yüzün rengi görünür)
	var edge := _patty_points(c + Vector2(0, thick), r, look, ky)
	_cpoly(self, edge, Draw.shade(bc, -0.12))
	_outline(self, edge, Color(Draw.shade(bc, -0.5), 0.9), 1.2)
	# üst yüz
	var face := _patty_points(c, r, look, ky)
	_cpoly(self, face, Draw.shade(tc, -0.28))
	# sol üstten ışık: içteki daha küçük, sola-yukarı kaymış açık yüz → sağ altta koyu kenar kalır
	var inner_face := _patty_points(c - Vector2(r * 0.05, r * 0.06 * ky), r * 0.9, look, ky)
	_cpoly(self, inner_face, tc)
	# hacim: sol üst aydınlık, sağ alt koyu kenar
	_outline(self, face, Color(Draw.shade(tc, -0.32), 0.85), 2.4)
	_blob(self, c - Vector2(r * 0.3, r * 0.3 * ky), Vector2(r * 0.62, r * 0.62 * ky), Color(Draw.shade(tc, 0.25), 0.55))
	# kıyma dokusu
	var fat_a := 0.28 * (1.0 - clampf(top, 0.0, 1.2) * 0.5)
	for s: Dictionary in look.specks:
		var p: Vector2 = s.p
		var col := Color(1.0, 0.894, 0.804, fat_a) if s.fat else Color(0.157, 0.055, 0.016, 0.25)
		draw_circle(c + Vector2(p.x * r, p.y * r * ky), float(s.s) * (r / 24.0) * (0.5 + 0.5 * minf(1.0, ky / 0.8)), col)
	# ızgara izleri (bu yüz daha önce alttaydıysa): elips içinde kalan kirişler
	if top > 0.3:
		var ma := clampf((top - 0.3) / 0.7, 0.0, 0.8)
		var rx := r * 0.92
		var ry := r * ky * 0.92
		var tilt := float(look.tilt) * ky / 0.8
		var lw := maxf(1.0, r * 0.15 * minf(1.0, ky / 0.8))
		# eğik doğru y = dy + tilt·x ile elipsin kesişimi: (1/rx² + t²/ry²)x² + (2·dy·t/ry²)x + dy²/ry² − 1 = 0
		var qa := 1.0 / (rx * rx) + tilt * tilt / (ry * ry)
		for k: float in [-1.5, -0.5, 0.5, 1.5]:
			var dy: float = k * r * 0.36 * ky
			var qb := 2.0 * dy * tilt / (ry * ry)
			var qc := dy * dy / (ry * ry) - 1.0
			var disc := qb * qb - 4.0 * qa * qc
			if disc <= 0.0:
				continue
			var sq := sqrt(disc)
			var x0 := (-qb - sq) / (2.0 * qa)
			var x1 := (-qb + sq) / (2.0 * qa)
			var mid := (x0 + x1) * 0.5
			var half := (x1 - x0) * 0.5 * 0.82
			if half < lw:
				continue
			var p0 := c + Vector2(mid - half, dy + tilt * (mid - half))
			var p1 := c + Vector2(mid + half, dy + tilt * (mid + half))
			draw_line(p0, p1, Color(0.125, 0.055, 0.024, ma), lw, true)
			draw_line(p0 + Vector2(0, lw * 0.6), p1 + Vector2(0, lw * 0.6), Color(1.0, 0.8, 0.6, ma * 0.12), 1.0, true)
	if top > 1.4:
		var ba := clampf((top - 1.4) * 1.2, 0.0, 0.7)
		for k in 5:
			var p: Vector2 = look.specks[k].p
			Draw.ellipse(self, c + Vector2(p.x * r, p.y * r * ky), r * 0.28, maxf(0.5, r * 0.2 * ky), Color(0.04, 0.03, 0.03, ba))
	# ıslak parlaklık
	var ga := 0.28 * (1.0 - clampf(top, 0.0, 1.0) * 0.55)
	Draw.ellipse(self, c + Vector2(-r * 0.36, -r * 0.38 * ky), r * 0.3, maxf(0.6, r * 0.11 * maxf(0.3, ky)), Color(1, 1, 1, ga))


func _draw_flip_icon(c: Vector2, s: float, a: float) -> void:
	draw_circle(c + Vector2(1, 1.5), s + 4.0, Color(0, 0, 0, 0.3 * a))
	draw_circle(c, s + 4.0, Color(0.063, 0.118, 0.07, 0.85 * a))
	draw_arc(c, s, -2.7, 1.3, 16, Color(COL_FLIP, a), 2.0, true)
	var tip := c + Vector2(cos(1.3), sin(1.3)) * s
	draw_polyline(PackedVector2Array([tip + Vector2(-4, -1), tip, tip + Vector2(-1, -4.5)]), Color(COL_FLIP, a), 2.0, true)


## Pişme çubuğu: yeşil bölge 0.85–1.2
func _draw_cook_bar(pos: Vector2, w: float, h: float, v: float) -> void:
	var vmax := 1.6
	Draw.rr(self, Rect2(pos.x - 1.5, pos.y - 1.5, w + 3.0, h + 3.0), (h + 3.0) * 0.5, Color(0.047, 0.035, 0.063, 0.8))
	draw_rect(Rect2(pos.x + w * Recipes.COOK_GOOD / vmax, pos.y, w * (Recipes.COOK_OVER - Recipes.COOK_GOOD) / vmax, h), Color(0.37, 0.88, 0.48, 0.36))
	var f := clampf(v / vmax, 0.0, 1.0)
	if f > 0.005:
		Draw.rr(self, Rect2(pos.x, pos.y, maxf(h, w * f), h), h * 0.5, _stage_color(v))
		draw_rect(Rect2(pos.x + 1.0, pos.y, maxf(0.0, w * f - 2.0), maxf(1.0, h * 0.3)), Color(1, 1, 1, 0.35))


## Elde köfte varken boş yuvalara soluk halka
func _draw_free_marks() -> void:
	var a := 0.35 + 0.2 * sin(_time * 6.0)
	for i in _centers.size():
		if not logic.has_item(i):
			Draw.ellipse_line(self, _centers[i], _pr, _pr * 0.8, Color(1.0, 0.93, 0.7, a), 2.0)


## Sağ alt köşede geliştirme seviyesinin adı (web levelTag, ör. "Küçük Izgara")
func _draw_level_tag() -> void:
	var lvl := String(Game.upg_val(UPG_ID, "name", ""))
	if lvl == "":
		return
	var size := 11
	var w := Draw.text_size(lvl, size).x
	var pos := Vector2(_r.end.x - 10.0 - w, _r.end.y - 9.0)
	for o: Vector2 in [Vector2(-1, 0), Vector2(1, 0), Vector2(0, -1), Vector2(0, 1)]:
		Draw.text(self, lvl, pos + o, size, Color(0.08, 0.06, 0.12, 0.55), false)
	Draw.text(self, lvl, pos, size, Color(1.0, 0.97, 0.9, 0.85), false)
