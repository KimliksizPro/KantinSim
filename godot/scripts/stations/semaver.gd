extends Node2D
## Semaver / çay ocağı istasyonu (web js/stations_cook.js "SEMAVER": semaverZone, updateSemaver, drawSemaver).
## Ocak (tıkla: aç/kapa) suyu ısıtır; demlik boşken tıklayınca 1 çay yaprağıyla demleme başlar, su kaynayınca
## brewTime sn sonra `glasses` bardak çay hazır olur. Tepsiden / demlikten sürükleyerek (ya da tıklayarak)
## bardak doldurulur. Çay 180 sn sonra bayatlar; "Tazele" düğmesi demliği yeniler.
## Saf mantık semaver_logic.gd'de; bu script çizim, ışık, partikül ve Drag bölge protokolünü üstlenir.
##
## Katmanlar: _back (gölgeler, ocak gövdesi) → _flames (alev, toplamalı karışım) → bu düğümün _draw'ı
## (çaydanlık, demlik, tepsi, göstergeler) → buhar partikülleri.
##
## Demo kipi (yalnız ekran görüntüsü kontrolü için): `-- --semaver-demo=6` → ocak açık, su kaynıyor, 6 bardak
## taze çay hazır. Ek seçenekler virgülle: `bayat` (demi geçmiş, Tazele görünür), `demleniyor` (sayı yok
## sayılır, %60 demlenmiş), `kapali` (ocak kapalı, su ılık), `bos` (demlik boş), `lv1` / `lv2` (geliştirme seviyesi).

const SemaverLogic := preload("res://scripts/stations/semaver_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

## Drag önceliği (web semaverZone.z)
var zone_z: int = 5
## Bırakma yok: elde item varken yeşil çerçeve çizilmesin (web noHighlight)
var no_highlight: bool = true

const LABEL := "Çay Ocağı"
const UPG_ID := "semaver"
const LEAF_ID := "cay_yapragi"
## Tepside en çok bu kadar bardak çizilir (sayı rozetle gösterilir)
const TRAY_SHOW := 5
const TRAY_EMPTY_SHOW := 3
const GLASS_W := 40.0
const GLASS_STEP := 31.0
const RING_R := 40.0
## Alev parıltısının (PointLight2D) en yüksek enerjisi
const LIGHT_ENERGY := 0.9
const FLAME_COUNT := 14

const COL_HOVER := Color(1.0, 0.925, 0.627, 0.75)
const COL_STEAM := Color(1.0, 1.0, 1.0, 0.55)
const COL_TEXT := Color("#fff6e0")
const COL_PANEL := Color(0.086, 0.063, 0.118, 0.86)
## Çay rengi: demi geçmiş (0.5) → tavşan kanı (1.0) (web R_TEA)
const TEA_RAMP := [[0.5, Color("#3b1407")], [0.75, Color("#701f08")], [1.0, Color("#bd3a10")]]

var logic: SemaverLogic = SemaverLogic.new()

# geometri (web semGeo; seviyeye göre değişir)
var _r: Rect2
var _lv := 0
var _cx := 0.0
var _b := 0.0        # ocak (brülör) hizası
var _top := 0.0      # çaydanlık ağzı
var _bot := 0.0      # çaydanlık dibi
var _spout := Vector2.ZERO
var _d_base := 0.0   # demlik tabanı
var _d_top := 0.0
var _hit_demlik: Rect2
var _hit_tray: Rect2
var _tray_c := Vector2.ZERO
var _tray_rx := 112.0
var _tray_ry := 22.0
var _btn_burner: Rect2
var _btn_rebrew: Rect2
var _knob := Vector2.ZERO
var _pill: Rect2
var _thermo: Rect2

var _time := 0.0
var _run := false
var _mouse := Vector2(-1000, -1000)
var _flame := 0.0    # 0..1 yumuşatılmış alev gücü
var _back: Node2D
var _flames: Node2D
var _light: PointLight2D
var _steam_kettle: GPUParticles2D
var _steam_demlik: GPUParticles2D
var _blob: GradientTexture2D


func _ready() -> void:
	# İstasyon ışıktan etkilenmez (parlak çelik beyaza yanmasın); alev ışığı arka plana / tezgaha düşer.
	light_mask = 0
	_r = GameData.rect("semaver")
	_lv = clampi(Game.upg(UPG_ID), 0, 2)
	_build_geometry()
	_back = _layer(false)
	_back.draw.connect(_draw_back)
	_flames = _layer(true)
	_flames.draw.connect(_draw_flames)
	_build_light()
	_steam_kettle = _make_particles(10, 1.0, 6.0)
	_steam_demlik = _make_particles(5, 0.6, 3.0)
	_apply_upgrades()
	Drag.register(self)
	_apply_demo_args()


func _exit_tree() -> void:
	Drag.unregister(self)


## Ebeveynin _draw'ından önce çizilen alt katman (show_behind_parent)
func _layer(additive: bool) -> Node2D:
	var n := Node2D.new()
	n.show_behind_parent = true
	n.light_mask = 0
	if additive:
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		n.material = m
	add_child(n)
	return n


func _build_geometry() -> void:
	var rx := _r.position.x
	var ry := _r.position.y
	_cx = rx + 118.0
	_b = ry + 206.0
	_top = ry + [132.0, 114.0, 106.0][_lv]
	_bot = _b - 8.0 if _lv == 2 else _b - 14.0
	_d_base = _top + 6.0
	_d_top = _d_base - 46.0
	match _lv:
		0: _spout = Vector2(_cx + 96.0, _top - 6.0)
		1: _spout = Vector2(_cx + 32.0, _top - 2.0)
		_: _spout = Vector2(_cx + 36.0, _top - 2.0)
	_hit_demlik = Rect2(_cx - 58.0, _d_top - 14.0, 116.0, 68.0)
	_tray_c = Vector2(rx + 124.0, ry + 248.0)
	_hit_tray = Rect2(rx + 10.0, ry + 220.0, _r.size.x - 20.0, 58.0)
	_btn_burner = Rect2(rx + 8.0, ry + 36.0, 108.0, 22.0)
	_btn_rebrew = Rect2(rx + 8.0, ry + 63.0, 78.0, 22.0)
	_knob = Vector2(_cx + 32.0, _b + 10.0)
	_pill = Rect2(rx + 136.0, ry + 7.0, 104.0, 22.0)
	_thermo = Rect2(rx + 224.0, ry + 64.0, 12.0, 126.0)


func _apply_upgrades() -> void:
	logic.brew_time = float(Game.upg_val(UPG_ID, "brewTime", 25))
	logic.glasses_per_brew = maxi(1, roundi(float(Game.upg_val(UPG_ID, "glasses", 10))))


func _apply_demo_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--semaver-demo="):
			continue
		var parts := a.trim_prefix("--semaver-demo=").split(",")
		var opts := parts.slice(1)
		for o in opts:
			if o.begins_with("lv"):
				Game.set_upgrade(UPG_ID, clampi(int(o.trim_prefix("lv")), 0, 2))
				_lv = clampi(Game.upg(UPG_ID), 0, 2)
				_build_geometry()
				_light.position = Vector2(_cx, _b - 4.0)
				_apply_upgrades()
		logic.burner_on = not opts.has("kapali")
		logic.water = 1.0 if logic.burner_on else 0.35
		if opts.has("demleniyor"):
			logic.brew(true)
			logic.brew_t = logic.brew_time * 0.6
		elif not opts.has("bos"):
			logic.state = "ready"
			logic.glasses = maxi(1, int(parts[0]))
			logic.age = 300.0 if opts.has("bayat") else 0.0
			logic.stale_warned = opts.has("bayat")
		_flame = 1.0 if logic.burner_on else 0.0
		for p: GPUParticles2D in [_steam_kettle, _steam_demlik]:
			p.preprocess = 1.5


func _powered() -> bool:
	return _lv < 2 or Game.power_on()


func _leaves() -> int:
	return Game.inv_get(LEAF_ID)


func _rebrew_visible() -> bool:
	return logic.is_stale()


func _knob_hit(pt: Vector2) -> bool:
	return _lv < 2 and pt.distance_to(_knob) <= 12.0


# --- Drag bölge protokolü ------------------------------------------------------

func zone_rect() -> Rect2:
	return _r


func can_drop(_item: Dictionary) -> bool:
	return false


func drop(_item: Dictionary, _pt: Vector2) -> bool:
	return false


## Tepsiden ya da demlikten bir bardak çay (düğmelerin üstünde alınmaz → click)
func pick(pt: Vector2) -> Dictionary:
	if _btn_burner.has_point(pt) or _knob_hit(pt):
		return {}
	if _rebrew_visible() and _btn_rebrew.has_point(pt):
		return {}
	if not (_hit_tray.has_point(pt) or _hit_demlik.has_point(pt)):
		return {}
	var q := logic.take()
	if q < 0.0:
		return {}
	if logic.state == "empty" and not logic.empty_warned and not Game.has_staff("cirak"):
		logic.empty_warned = true
		if _leaves() > 0:
			Game.notify("Demlik boşaldı — yeniden demle!", "info")
		else:
			Game.notify("Demlik boşaldı ve çay yaprağı kalmadı!", "warn")
	return Items.dish("bardak", {"layers": [{"id": "cay", "q": q}]})


func return_item(_item: Dictionary) -> void:
	logic.give_back()


func click(pt: Vector2) -> void:
	if _btn_burner.has_point(pt) or _knob_hit(pt):
		logic.burner_on = not logic.burner_on
		var pos := _btn_burner.get_center() + Vector2(0, -16) if _btn_burner.has_point(pt) else _knob + Vector2(0, -18)
		Game.float_text.emit(pos, "Ocak açıldı" if logic.burner_on else "Ocak kapandı", Game.COLOR_INFO)
		return
	if _rebrew_visible() and _btn_rebrew.has_point(pt):
		if _leaves() <= 0 or not logic.can_rebrew():
			_no_leaf()
			return
		if Game.inv_take(LEAF_ID):
			logic.rebrew(true)
		return
	if (_hit_demlik.has_point(pt) or _hit_tray.has_point(pt)) and logic.can_brew():
		if Game.inv_take(LEAF_ID):
			logic.brew(true)
			Game.float_text.emit(Vector2(_cx, _d_top - 20.0), "Demleniyor…", Color("#ffd08a"))
		else:
			_no_leaf()


func _no_leaf() -> void:
	Game.notify("Çay yaprağı kalmadı! Toptancıdan sipariş et.", "warn")


func hover_text(pt: Vector2) -> String:
	var stock := _leaves()
	if _btn_burner.has_point(pt) or _knob_hit(pt):
		if logic.burner_on:
			return "Ocak açık — su %s\nTıkla: ocağı kapat (su yavaşça soğur)" % ("kaynıyor" if logic.is_boiling() else "ısınıyor")
		return "Ocak kapalı\nTıkla: ocağı yak"
	if _rebrew_visible() and _btn_rebrew.has_point(pt):
		return "Demliği tazele\nKalan çay dökülür, 1 çay yaprağı harcanır (stok: %d)" % stock
	if not (_hit_demlik.has_point(pt) or _hit_tray.has_point(pt)):
		if _thermo.grow(10.0).has_point(pt):
			return "Su sıcaklığı: %d°" % roundi(20.0 + 80.0 * logic.water)
		return ""
	var head: String
	if not _powered():
		head = "Elektrik yok — çay kazanı ısınmıyor!"
	elif not logic.burner_on:
		head = "Ocak kapalı" + (" — su soğuyor %%%d" % roundi(logic.water * 100.0) if logic.water > 0.0 else "")
	elif logic.water < 1.0:
		head = "Su ısınıyor… %%%d" % roundi(logic.water * 100.0)
	else:
		head = "Su kaynıyor"
	match logic.state:
		"empty":
			return "Demlik boş — %s\nTıkla: demle (1 çay yaprağı, stok: %d)" % [head, stock]
		"brewing":
			var pct := roundi(logic.brew_progress() * 100.0)
			if logic.water < SemaverLogic.WATER_BREW_MIN:
				return "Çay demleniyor… %%%d\n%s (demleme bekliyor)" % [pct, head]
			return "Çay demleniyor… %%%d\nKalan ~%d sn" % [pct, ceili(logic.brew_left())]
	var q := logic.quality()
	var taste := "tavşan kanı" if q >= 0.99 else ("demi geçiyor" if q > 0.75 else "demi geçmiş, koyu")
	var s := "Çay hazır — %d bardak (%s)\nSürükle/tıkla: bardak doldur" % [logic.glasses, taste]
	if q < 0.99:
		s += "\nTazelemek için \"Tazele\"ye bas"
	return s


# --- Güncelleme ----------------------------------------------------------------

func _process(dt: float) -> void:
	_time += dt
	_mouse = get_viewport().get_mouse_position()
	var lv := clampi(Game.upg(UPG_ID), 0, 2)
	if lv != _lv:
		_lv = lv
		_build_geometry()
		_light.position = Vector2(_cx, _b - 4.0)
	_apply_upgrades()
	var gdt := Game.game_dt(dt)
	_run = gdt > 0.0
	var cirak := Game.has_staff("cirak")
	var events: Array = logic.update(gdt, dt, _run, _powered(), cirak, _leaves() > 0)
	for ev: Dictionary in events:
		match ev.type:
			"ready":
				Game.float_text.emit(Vector2(_cx, _d_top - 18.0), "Çay hazır!", Color("#ffd08a"))
			"stale":
				if not cirak:
					Game.notify("Çayın demi geçti, koyulaşıyor. Demliği tazele!", "warn")
			"cirak_brew":
				Game.inv_take(LEAF_ID)
	var lit := logic.burner_on and _powered() and _lv < 2 and _run
	_flame = lerpf(_flame, 1.0 if lit else 0.0, 1.0 - exp(-dt * 6.0))
	_light.energy = _flame * (LIGHT_ENERGY * (0.8 + 0.2 * logic.water) + 0.06 * sin(_time * 11.0) + 0.04 * sin(_time * 23.0))
	_light.visible = _flame > 0.02
	_update_particles()
	queue_redraw()
	_back.queue_redraw()
	_flames.queue_redraw()


func _update_particles() -> void:
	var w := logic.water
	_steam_kettle.position = _spout
	_steam_kettle.emitting = _run and w > 0.35
	_steam_kettle.amount_ratio = clampf(w * w, 0.15, 1.0)
	_steam_demlik.position = Vector2(_cx - 51.0, _d_top + 5.0)
	_steam_demlik.emitting = _run and (logic.state == "brewing" or logic.state == "ready") and w > 0.5


# --- Işık ve partiküller -------------------------------------------------------

func _blob_tex() -> GradientTexture2D:
	if _blob != null:
		return _blob
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.35, 0.7, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.62), Color(1, 1, 1, 0.16), Color(1, 1, 1, 0)])
	_blob = GradientTexture2D.new()
	_blob.gradient = g
	_blob.width = 128
	_blob.height = 128
	_blob.fill = GradientTexture2D.FILL_RADIAL
	_blob.fill_from = Vector2(0.5, 0.5)
	_blob.fill_to = Vector2(1.0, 0.5)
	return _blob


func _build_light() -> void:
	_light = PointLight2D.new()
	_light.texture = _blob_tex()
	_light.texture_scale = 2.0
	_light.color = Color(1.0, 0.58, 0.25)
	_light.energy = 0.0
	_light.blend_mode = Light2D.BLEND_MODE_ADD
	_light.position = Vector2(_cx, _b - 4.0)
	add_child(_light)


func _make_particles(amount: int, size: float, drift: float) -> GPUParticles2D:
	var p := GPUParticles2D.new()
	p.texture = _blob_tex()
	p.amount = amount
	p.lifetime = 2.2
	p.emitting = false
	p.local_coords = false
	p.light_mask = 0
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	m.emission_sphere_radius = 2.0
	m.direction = Vector3(drift * 0.04, -1, 0)
	m.spread = 12.0
	m.initial_velocity_min = 22.0 * size + 8.0
	m.initial_velocity_max = 40.0 * size + 10.0
	m.gravity = Vector3(drift, -10, 0)
	m.damping_min = 4.0
	m.damping_max = 8.0
	m.lifetime_randomness = 0.35
	m.scale_min = 0.24 * size
	m.scale_max = 0.38 * size
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.4))
	curve.add_point(Vector2(1.0, 1.7))
	var ct := CurveTexture.new()
	ct.curve = curve
	m.scale_curve = ct
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.15, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 0), Color(1, 1, 1, 1), Color(1, 1, 1, 0)])
	var gt := GradientTexture1D.new()
	gt.gradient = g
	m.color_ramp = gt
	m.color = COL_STEAM
	p.process_material = m
	add_child(p)
	return p


# --- Çizim yardımcıları --------------------------------------------------------

## Kübik bezier noktalarını ekler (p0 hariç)
static func _bez3(out: PackedVector2Array, p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, n: int = 12) -> void:
	for i in range(1, n + 1):
		var t := float(i) / n
		var u := 1.0 - t
		out.append(p0 * u * u * u + p1 * 3.0 * u * u * t + p2 * 3.0 * u * t * t + p3 * t * t * t)


static func _bez2(out: PackedVector2Array, p0: Vector2, p1: Vector2, p2: Vector2, n: int = 10) -> void:
	for i in range(1, n + 1):
		var t := float(i) / n
		var u := 1.0 - t
		out.append(p0 * u * u + p1 * 2.0 * u * t + p2 * t * t)


static func _valid(pts: PackedVector2Array) -> bool:
	return pts.size() >= 3 and not Geometry2D.triangulate_polygon(pts).is_empty()


## Bozuk (üçgenlenemeyen) çokgenleri sessizce atlar
static func _cpoly(ci: CanvasItem, pts: PackedVector2Array, col: Color) -> void:
	if _valid(pts):
		ci.draw_colored_polygon(pts, col)


static func _poly(ci: CanvasItem, pts: PackedVector2Array, cols: PackedColorArray) -> void:
	if _valid(pts):
		ci.draw_polygon(pts, cols)


## Gradyan dokusuyla doldurulmuş çokgen; bbox gradyanın 0..1 uzayı
static func _poly_tex(ci: CanvasItem, pts: PackedVector2Array, bbox: Rect2, tex: Texture2D, mod: Color = Color.WHITE) -> void:
	if not _valid(pts):
		return
	var uvs := PackedVector2Array()
	for p in pts:
		uvs.append(((p - bbox.position) / bbox.size).clamp(Vector2(0.004, 0.004), Vector2(0.996, 0.996)))
	ci.draw_colored_polygon(pts, mod, uvs, tex)


static func _hgrad(stops: Array) -> GradientTexture2D:
	return Draw.grad(stops, Vector2(0, 0.5), Vector2(1, 0.5))


static func _vgrad(stops: Array) -> GradientTexture2D:
	return Draw.grad(stops, Vector2(0.5, 0), Vector2(0.5, 1))


static func _bbox(pts: PackedVector2Array) -> Rect2:
	var r := Rect2(pts[0], Vector2.ZERO)
	for p in pts:
		r = r.expand(p)
	return r


## clip içinde kalan kısmı çizer (Geometry2D ile kesişim)
static func _clipped(ci: CanvasItem, pts: PackedVector2Array, clip: PackedVector2Array, col: Color) -> void:
	for part: PackedVector2Array in Geometry2D.intersect_polygons(pts, clip):
		_cpoly(ci, part, col)


static func _outline(ci: CanvasItem, pts: PackedVector2Array, col: Color, width: float) -> void:
	var closed := pts.duplicate()
	closed.append(pts[0])
	ci.draw_polyline(closed, col, width, true)


func _soft(ci: CanvasItem, center: Vector2, half: Vector2, col: Color) -> void:
	ci.draw_texture_rect(_blob_tex(), Rect2(center - half, half * 2.0), false, col)


static func _ell(c: Vector2, rx: float, ry: float, a0: float = 0.0, a1: float = TAU, n: int = 40) -> PackedVector2Array:
	return Draw.ellipse_points(c, rx, ry, a0, a1, n)


## Kenarlı yazı (x ortalanmış ya da sol, y dikey orta)
static func _text(ci: CanvasItem, s: String, pos: Vector2, size: int, col: Color, centered: bool = true,
		outline: int = 0, outline_col: Color = Color(0.08, 0.06, 0.12, 0.65)) -> void:
	var f := Draw.font()
	var w := f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var p := Vector2(pos.x - w * 0.5 if centered else pos.x, pos.y + (f.get_ascent(size) - f.get_descent(size)) * 0.5)
	if outline > 0:
		ci.draw_string_outline(f, p, s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, outline, outline_col)
	ci.draw_string(f, p, s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)


static func _ramp(stops: Array, v: float) -> Color:
	if v <= float(stops[0][0]):
		return stops[0][1]
	for i in range(1, stops.size()):
		if v <= float(stops[i][0]):
			var a: Array = stops[i - 1]
			var b: Array = stops[i]
			return (a[1] as Color).lerp(b[1], (v - float(a[0])) / (float(b[0]) - float(a[0])))
	return stops[-1][1]


static func _steel_h() -> GradientTexture2D:
	return _hgrad([
		[0.0, Color("#5a6168")], [0.18, Color("#c8cfd5")], [0.3, Color("#f7f9fb")], [0.42, Color("#b9c0c7")],
		[0.72, Color("#7f878f")], [0.9, Color("#a6adb4")], [1.0, Color("#4e555c")],
	])


static func _brass_h() -> GradientTexture2D:
	return _hgrad([
		[0.0, Color("#6e4a14")], [0.18, Color("#d8a640")], [0.3, Color("#fff0b8")], [0.42, Color("#e2b04c")],
		[0.72, Color("#a8781f")], [0.9, Color("#c99a35")], [1.0, Color("#5e3e10")],
	])


# --- Arka katman: gölgeler + ocak -------------------------------------------------

func _draw_back() -> void:
	var c := _back
	# Işık sol üstten: gölgeler sağ alta düşer
	_soft(c, Vector2(_cx + 14.0, _b + 14.0), Vector2(88.0, 16.0), Color(0, 0, 0, 0.45))
	_soft(c, Vector2(_cx + 22.0, (_top + _bot) * 0.5 + 10.0), Vector2(84.0, 46.0), Color(0, 0, 0, 0.22))
	if _lv == 2:
		# elektrikli taban
		var base := Rect2(_cx - 68.0, _b - 10.0, 136.0, 22.0)
		Draw.rr_grad(c, base, 7.0, [[0.0, Color("#4a5058")], [1.0, Color("#22262b")]])
		Draw.rr(c, base, 7.0, Color.TRANSPARENT, 1.0, Color(1, 1, 1, 0.2))
		Draw.rr(c, Rect2(_cx - 22.0, _b - 6.0, 44.0, 13.0), 3.0, Color("#0b1410"))
		return
	# ocak gövdesi
	var body := Rect2(_cx - 48.0, _b + 1.0, 96.0, 19.0)
	Draw.rr_grad(c, body, 6.0, [[0.0, Color("#4a5058")], [0.5, Color("#2c3036")], [1.0, Color("#17191c")]])
	c.draw_rect(Rect2(body.position.x + 5.0, body.position.y + 1.0, body.size.x - 10.0, 1.0), Color(1, 1, 1, 0.22))
	# gaz borusu sağdan
	c.draw_polyline(PackedVector2Array([Vector2(body.end.x - 2.0, _b + 14.0), Vector2(body.end.x + 14.0, _b + 16.0),
		Vector2(body.end.x + 20.0, _b + 24.0)]), Color("#c0392b"), 3.0, true)
	# brülör tası
	Draw.ellipse_grad(c, Vector2(_cx, _b), 37.0, 7.5, _vgrad([[0.0, Color("#55595f")], [1.0, Color("#1f2125")]]))
	Draw.ellipse(c, Vector2(_cx, _b - 1.0), 28.0, 5.0, Color("#3d4148"))
	Draw.ellipse(c, Vector2(_cx, _b - 1.5), 18.0, 3.2, Color("#25272b"))
	# sacayak (çaydanlığın oturduğu demir çember + ayaklar)
	for s: float in [-1.0, 1.0]:
		c.draw_line(Vector2(_cx + s * 52.0, _b - 12.0), Vector2(_cx + s * 44.0, _b + 6.0), Color("#1a1b1e"), 3.0, true)
	Draw.ellipse_line(c, Vector2(_cx, _b - 13.0), 54.0, 9.0, Color("#1a1b1e"), 4.0)
	Draw.ellipse_line(c, Vector2(_cx, _b - 14.0), 54.0, 9.0, Color(1, 1, 1, 0.12), 1.0, PI * 1.05, PI * 1.6)


# --- Alev katmanı (toplamalı) ------------------------------------------------------

func _draw_flames() -> void:
	if _flame <= 0.01 or _lv == 2:
		return
	var c := _flames
	var a := _flame
	_soft(c, Vector2(_cx, _b - 6.0), Vector2(60.0, 20.0), Color(0.25, 0.45, 1.0, 0.35 * a))
	_soft(c, Vector2(_cx, _b - 10.0), Vector2(46.0, 14.0), Color(1.0, 0.55, 0.2, 0.22 * a))
	# arkadaki alevler önce (derinlik)
	var order: Array = range(FLAME_COUNT)
	order.sort_custom(func(i: int, j: int) -> bool: return sin(float(i) / FLAME_COUNT * TAU) < sin(float(j) / FLAME_COUNT * TAU))
	for k: int in order:
		var ang := float(k) / FLAME_COUNT * TAU
		var fl := 0.75 + 0.25 * sin(_time * 13.0 + k * 1.7) + 0.1 * sin(_time * 29.0 + k)
		var fx := _cx + cos(ang) * 27.0
		var fy := _b - 2.0 + sin(ang) * 5.0
		var fh := (10.0 + 5.0 * fl) * (0.7 + 0.3 * logic.water) * a
		var depth := 0.75 + 0.25 * sin(ang)
		_flame_tongue(c, Vector2(fx, fy), fh, fh * 0.42, sin(_time * 9.0 + k * 2.3) * 1.6, depth * a)


## Tek alev dili: dipte mavi, uçta turuncu / saydam
func _flame_tongue(c: CanvasItem, base: Vector2, h: float, w: float, sway: float, alpha: float) -> void:
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var n := 7
	for i in n + 1:   # sağ kenar: dipten uca
		var t := float(i) / n
		var hw := w * 0.5 * sin(PI * (0.15 + 0.85 * (1.0 - t))) * (1.0 - t * 0.35)
		pts.append(base + Vector2(hw + sway * t * t, -h * t))
		cols.append(_flame_col(t, alpha))
	for i in range(n - 1, 0, -1):   # sol kenar: uçtan dibe
		var t := float(i) / n
		var hw := w * 0.5 * sin(PI * (0.15 + 0.85 * (1.0 - t))) * (1.0 - t * 0.35)
		pts.append(base + Vector2(-hw + sway * t * t, -h * t))
		cols.append(_flame_col(t, alpha))
	_poly(c, pts, cols)


static func _flame_col(t: float, a: float) -> Color:
	if t < 0.45:
		return Color(0.25, 0.5, 1.0, 0.95 * a).lerp(Color(0.55, 0.75, 1.0, 0.85 * a), t / 0.45)
	return Color(0.55, 0.75, 1.0, 0.85 * a).lerp(Color(1.0, 0.62, 0.22, 0.0), (t - 0.45) / 0.55)


# --- Ana çizim -------------------------------------------------------------------

func _draw() -> void:
	var holding := Drag.is_holding()
	_draw_kettle()
	_draw_demlik(_cx, _d_base)
	_draw_kettle_rim_front()
	_draw_demlik_hints(not holding and _hit_demlik.has_point(_mouse) and not _hit_tray.has_point(_mouse))
	_draw_tray(not holding and _hit_tray.has_point(_mouse))
	_draw_thermo()
	if _lv == 2:
		_draw_kettle_panel()
	_draw_knob(not holding and _knob_hit(_mouse))
	_draw_status_pill()
	_draw_burner_button(not holding and _btn_burner.has_point(_mouse))
	if _rebrew_visible():
		_draw_rebrew_button(not holding and _btn_rebrew.has_point(_mouse))
	if Game.has_staff("cirak"):
		_draw_cirak_bubble()
	Draw.station_label(self, _r, LABEL)
	_draw_level_tag()


func _kettle_shape() -> PackedVector2Array:
	var cx := _cx
	var top := _top
	var bot := _bot
	var p := PackedVector2Array()
	match _lv:
		0:
			p.append(Vector2(cx - 44, top))
			_bez3(p, Vector2(cx - 44, top), Vector2(cx - 72, top + 8), Vector2(cx - 72, bot - 24), Vector2(cx - 60, bot - 3))
			_bez2(p, Vector2(cx - 60, bot - 3), Vector2(cx, bot + 6), Vector2(cx + 60, bot - 3))
			_bez3(p, Vector2(cx + 60, bot - 3), Vector2(cx + 72, bot - 24), Vector2(cx + 72, top + 8), Vector2(cx + 44, top))
		1:
			p.append(Vector2(cx - 34, top))
			_bez3(p, Vector2(cx - 34, top), Vector2(cx - 62, top + 18), Vector2(cx - 66, bot - 40), Vector2(cx - 40, bot - 16))
			p.append(Vector2(cx - 44, bot))
			p.append(Vector2(cx + 44, bot))
			p.append(Vector2(cx + 40, bot - 16))
			_bez3(p, Vector2(cx + 40, bot - 16), Vector2(cx + 66, bot - 40), Vector2(cx + 62, top + 18), Vector2(cx + 34, top))
		_:
			p = Draw.rr_points(Rect2(cx - 60, top, 120, bot - top), 14.0)
	return p


func _draw_kettle() -> void:
	var cx := _cx
	var top := _top
	var bot := _bot
	var metal := _brass_h() if _lv == 1 else _steel_h()
	# emzik (çaydanlık) / kulplar — gövdenin arkasında
	if _lv == 0:
		var sp := PackedVector2Array([Vector2(cx + 54, bot - 30)])
		_bez2(sp, Vector2(cx + 54, bot - 30), Vector2(cx + 82, bot - 30), Vector2(cx + 92, top - 8))
		sp.append(Vector2(cx + 100, top - 5))
		_bez2(sp, Vector2(cx + 100, top - 5), Vector2(cx + 88, bot - 12), Vector2(cx + 58, bot - 14))
		_poly_tex(self, sp, Rect2(cx + 50, top - 8, 52, bot - top), _hgrad([[0.0, Color("#e9edf0")], [0.5, Color("#a3abb3")], [1.0, Color("#5f666e")]]))
		_outline(self, sp, Color(0.118, 0.133, 0.157, 0.6), 1.0)
		# emzik ağzı
		self.draw_line(Vector2(cx + 91, top - 9), Vector2(cx + 100.5, top - 5), Color("#2b2f34"), 2.5, true)
		# arka kulp (bakalit)
		var hp := PackedVector2Array([Vector2(cx - 58, top + 10)])
		_bez3(hp, Vector2(cx - 58, top + 10), Vector2(cx - 92, top + 12), Vector2(cx - 92, bot - 26), Vector2(cx - 64, bot - 24), 16)
		draw_polyline(hp, Color("#121315"), 7.0, true)
		draw_polyline(hp, Color("#2f3136"), 4.5, true)
		var hl := PackedVector2Array()
		for i in range(2, 9):
			hl.append(hp[i] + Vector2(-0.8, -1.2))
		draw_polyline(hl, Color(1, 1, 1, 0.22), 1.2, true)
	elif _lv == 1:
		for s: float in [-1.0, 1.0]:
			var hp := PackedVector2Array([Vector2(cx + s * 50, top + 22)])
			_bez2(hp, Vector2(cx + s * 50, top + 22), Vector2(cx + s * 74, top + 30), Vector2(cx + s * 58, top + 46))
			draw_polyline(hp, Color("#7a5615"), 6.0, true)
			draw_polyline(hp, Color("#d9a640"), 3.5, true)
	var shape := _kettle_shape()
	var bb := _bbox(shape)
	_poly_tex(self, shape, Rect2(cx - 72, bb.position.y, 144, bb.size.y), metal)
	# hacim: üstte aydınlık, altta koyulaşan dikey karartma (ışık sol üstten)
	var shade_tex := _vgrad([[0.0, Color(1, 1, 1, 0.16)], [0.35, Color(1, 1, 1, 0.0)], [0.75, Color(0, 0, 0, 0.12)], [1.0, Color(0, 0, 0, 0.42)]])
	_poly_tex(self, shape, bb, shade_tex)
	# yansıma bantları (gövdeye kırpılmış)
	_clipped(self, PackedVector2Array([Vector2(cx - 42, top), Vector2(cx - 35, top), Vector2(cx - 33, bot), Vector2(cx - 40, bot)]), shape, Color(1, 1, 1, 0.38))
	_clipped(self, PackedVector2Array([Vector2(cx - 30, top), Vector2(cx - 27, top), Vector2(cx - 25, bot), Vector2(cx - 28, bot)]), shape, Color(1, 1, 1, 0.16))
	_clipped(self, PackedVector2Array([Vector2(cx + 46, top), Vector2(cx + 52, top), Vector2(cx + 56, bot), Vector2(cx + 50, bot)]), shape, Color(1, 1, 1, 0.12))
	if _lv == 0:
		# omuz çizgisi (preslenmiş kabartma)
		var sh := _ell(Vector2(cx, top + 12.0), 58.0, 7.0, 0.05 * PI, 0.95 * PI, 24)
		draw_polyline(sh, Color(0, 0, 0, 0.18), 1.6, true)
		var sh2 := PackedVector2Array()
		for q in sh:
			sh2.append(q + Vector2(0, 1.4))
		draw_polyline(sh2, Color(1, 1, 1, 0.3), 1.0, true)
	if _lv == 1:
		for y: float in [top + 8.0, bot - 20.0]:
			_clipped(self, PackedVector2Array([Vector2(cx - 80, y), Vector2(cx + 80, y), Vector2(cx + 80, y + 4), Vector2(cx - 80, y + 4)]), shape, Color(0.84, 0.65, 0.24, 0.85))
			_clipped(self, PackedVector2Array([Vector2(cx - 80, y), Vector2(cx + 80, y), Vector2(cx + 80, y + 1.2), Vector2(cx - 80, y + 1.2)]), shape, Color(1.0, 0.94, 0.75, 0.6))
	if _lv == 2:
		var i := 0
		var x := cx - 56.0
		while x < cx + 56.0:
			draw_rect(Rect2(x, top + 3.0, 0.8, bot - top - 6.0), Color(1, 1, 1, 0.05 + 0.05 * float((i * 7) % 3)))
			x += 2.0
			i += 1
	_outline(self, shape, Color(0.118, 0.133, 0.157, 0.6), 1.2)
	# alevin gövde dibine vuran sıcak yansıması
	if _flame > 0.02:
		var warm := _vgrad([[0.0, Color(1.0, 0.55, 0.2, 0.0)], [1.0, Color(1.0, 0.5, 0.15, 0.4)]])
		for part: PackedVector2Array in Geometry2D.intersect_polygons(_ell(Vector2(cx, bot + 4.0), 64.0, 20.0), shape):
			_poly_tex(self, part, _bbox(part), warm, Color(1, 1, 1, _flame))
	# üst ağız (demliğin oturduğu boşluk)
	var mouth_rx := 50.0 if _lv == 2 else 40.0
	Draw.ellipse(self, Vector2(cx, top + 2.0), mouth_rx + 1.5, 8.0, Color("#d7dce1"))
	Draw.ellipse_grad(self, Vector2(cx, top + 2.0), mouth_rx, 7.0, _vgrad([[0.0, Color("#0f1113")], [1.0, Color("#3a3f45")]]))
	# musluk (semaver / kazan)
	if _lv >= 1:
		var ty := bot - 34.0
		var col := Color("#d9a640") if _lv == 1 else Color("#2a2c30")
		Draw.rr(self, Rect2(cx - 5, ty - 5, 10, 22), 3.0, col)
		Draw.rr(self, Rect2(cx - 3, ty + 14, 6, 9), 2.0, col)
		draw_circle(Vector2(cx, ty - 8), 5.0, col, true, -1.0, true)
		draw_rect(Rect2(cx - 3, ty - 3, 1.5, 16), Color(1, 1, 1, 0.45))
	if _lv == 2:
		var g := Rect2(cx + 40, top + 18, 8, bot - top - 40)
		Draw.rr(self, g, 4.0, Color(0.08, 0.12, 0.16, 0.6), 1.0, Color("#d7dce1"))
		var lvl := 0.75
		draw_rect(Rect2(g.position.x + 1.0, g.position.y + g.size.y * (1.0 - lvl), 6.0, g.size.y * lvl - 1.0), Color(0.35, 0.67, 1.0, 0.55))


## Ağzın ön dudağı: demliğin dibini örter → demlik çaydanlığın içine oturmuş görünür
func _draw_kettle_rim_front() -> void:
	var rx := 50.0 if _lv == 2 else 40.0
	var c := Vector2(_cx, _top + 2.0)
	var band := _ell(c, rx + 1.5, 8.0, 0.0, PI, 20)
	var inner := _ell(c + Vector2(0, -2.5), rx - 1.5, 6.0, PI, 0.0, 20)
	band.append_array(inner)
	_poly_tex(self, band, Rect2(c.x - rx - 2.0, c.y, rx * 2.0 + 4.0, 8.0), _brass_h() if _lv == 1 else _steel_h())
	draw_polyline(_ell(c, rx + 1.5, 8.0, 0.1, PI - 0.1, 20), Color(0.118, 0.133, 0.157, 0.5), 1.0, true)
	draw_polyline(_ell(c + Vector2(0, -2.5), rx - 1.5, 6.0, 0.15, PI - 0.15, 20), Color(1, 1, 1, 0.55), 1.0, true)


## Porselen demlik (lale desenli), web drawDemlik
func _draw_demlik(cx: float, base: float) -> void:
	var top := base - 46.0
	var porcelain := _hgrad([[0.0, Color("#c9bfae")], [0.32, Color("#fffdf8")], [0.62, Color("#f0e9dd")], [1.0, Color("#b3a893")]])
	# emzik
	var sp := PackedVector2Array([Vector2(cx - 24, base - 14)])
	_bez2(sp, Vector2(cx - 24, base - 14), Vector2(cx - 44, base - 16), Vector2(cx - 54, top + 7))
	sp.append(Vector2(cx - 47, top + 5))
	_bez2(sp, Vector2(cx - 47, top + 5), Vector2(cx - 40, base - 26), Vector2(cx - 22, base - 28))
	_poly_tex(self, sp, Rect2(cx - 56, top + 4, 34, base - top - 16), porcelain)
	_outline(self, sp, Color(0.43, 0.35, 0.24, 0.55), 1.0)
	draw_line(Vector2(cx - 54.5, top + 7.0), Vector2(cx - 47.0, top + 5.0), Color("#d2a23a"), 1.6, true)
	# kulp
	var hp := PackedVector2Array([Vector2(cx + 26, top + 14)])
	_bez3(hp, Vector2(cx + 26, top + 14), Vector2(cx + 52, top + 10), Vector2(cx + 52, base - 10), Vector2(cx + 26, base - 9), 16)
	draw_polyline(hp, Color("#a8946e"), 7.0, true)
	draw_polyline(hp, Color("#f2ebde"), 4.5, true)
	# gövde
	var body := PackedVector2Array([Vector2(cx - 22, top + 8)])
	_bez3(body, Vector2(cx - 22, top + 8), Vector2(cx - 40, top + 14), Vector2(cx - 40, base - 4), Vector2(cx - 22, base))
	body.append(Vector2(cx + 22, base))
	_bez3(body, Vector2(cx + 22, base), Vector2(cx + 40, base - 4), Vector2(cx + 40, top + 14), Vector2(cx + 22, top + 8))
	_soft(self, Vector2(cx + 6.0, base - 2.0), Vector2(36.0, 7.0), Color(0, 0, 0, 0.35))
	_poly_tex(self, body, Rect2(cx - 38, top, 76, 46), porcelain)
	# alt yarıda hafif gölge (yuvarlak hacim)
	_poly_tex(self, body, _bbox(body), _vgrad([[0.0, Color(1, 1, 1, 0.0)], [0.6, Color(1, 1, 1, 0.0)], [1.0, Color(0.35, 0.25, 0.1, 0.22)]]))
	_outline(self, body, Color(0.47, 0.39, 0.27, 0.5), 1.0)
	# yaldız bantlar
	for e: Array in [[base - 4.0, 36.0, 4.0], [top + 12.0, 30.0, 4.0]]:
		var arc := _ell(Vector2(cx, e[0]), e[1], e[2], 0.0, PI, 24)
		var band := arc.duplicate()
		var inner := _ell(Vector2(cx, e[0] - 2.0), e[1], e[2], PI, 0.0, 24)
		band.append_array(inner)
		_clipped(self, band, body, Color("#d2a23a"))
	# parlama
	_clipped(self, _ell(Vector2(cx - 18.0, base - 26.0), 4.0, 9.0), body, Color(1, 1, 1, 0.55))
	# lale motifi
	var ly := base - 22.0
	var stem := PackedVector2Array([Vector2(cx, ly + 4)])
	_bez2(stem, Vector2(cx, ly + 4), Vector2(cx - 1, ly + 10), Vector2(cx, ly + 14), 6)
	draw_polyline(stem, Color("#3f8f3a"), 1.6, true)
	var leaf := PackedVector2Array([Vector2(cx, ly + 10)])
	_bez2(leaf, Vector2(cx, ly + 10), Vector2(cx - 7, ly + 9), Vector2(cx - 8, ly + 4), 6)
	_bez2(leaf, Vector2(cx - 8, ly + 4), Vector2(cx - 3, ly + 6), Vector2(cx, ly + 10), 6)
	_cpoly(self, leaf, Color("#3f8f3a"))
	var tulip := PackedVector2Array([Vector2(cx - 6, ly - 4)])
	_bez2(tulip, Vector2(cx - 6, ly - 4), Vector2(cx - 7, ly + 5), Vector2(cx, ly + 5), 6)
	_bez2(tulip, Vector2(cx, ly + 5), Vector2(cx + 7, ly + 5), Vector2(cx + 6, ly - 4), 6)
	tulip.append(Vector2(cx + 3, ly - 1))
	tulip.append(Vector2(cx, ly - 6))
	tulip.append(Vector2(cx - 3, ly - 1))
	_cpoly(self, tulip, Color("#c62f2f"))
	draw_line(Vector2(cx - 3.5, ly - 1.5), Vector2(cx - 3.0, ly + 3.0), Color(1, 0.7, 0.65, 0.6), 1.0, true)
	# kapak
	Draw.ellipse(self, Vector2(cx, top + 8), 22.0, 5.0, Color("#efe7da"))
	Draw.ellipse_line(self, Vector2(cx, top + 8), 22.0, 5.0, Color("#d2a23a"), 1.5)
	var dome := PackedVector2Array([Vector2(cx - 16, top + 7)])
	_bez2(dome, Vector2(cx - 16, top + 7), Vector2(cx, top - 6), Vector2(cx + 16, top + 7))
	_poly_tex(self, dome, Rect2(cx - 16, top, 32, 7), _hgrad([[0.0, Color("#ddd3c2")], [0.35, Color("#fffcf5")], [1.0, Color("#cfc4b0")]]))
	_outline(self, dome, Color(0.47, 0.39, 0.27, 0.45), 1.0)
	draw_circle(Vector2(cx, top - 2), 4.0, Color("#d9a640"), true, -1.0, true)
	draw_circle(Vector2(cx - 1.2, top - 3.2), 1.3, Color("#fff3c8"), true, -1.0, true)


## Demlik çevresi: tıklanabilir ipucu, demleme halkası, bayatlama halkası
func _draw_demlik_hints(hover: bool) -> void:
	var dc := Vector2(_cx, _d_base - 23.0)
	var invite := logic.state == "empty" and _run and logic.water >= SemaverLogic.WATER_BREW_MIN
	if hover or invite:
		var a := 0.7 if hover else 0.3 + 0.25 * sin(_time * 4.0)
		var segs := 22
		for i in segs:
			var a0 := float(i) / segs * TAU + _time * 0.45
			draw_polyline(_ell(dc, 46.0, 32.0, a0, a0 + TAU / segs * 0.55, 4), Color(1.0, 0.91, 0.63, a), 2.0, true)
	if logic.state == "brewing":
		var f := logic.brew_progress()
		var ok := logic.water >= SemaverLogic.WATER_BREW_MIN
		draw_arc(dc, RING_R, 0.0, TAU, 56, Color(0.063, 0.047, 0.078, 0.55), 5.0, true)
		if f > 0.005:
			draw_arc(dc, RING_R, -PI * 0.5, -PI * 0.5 + TAU * f, 56, Color("#ffb347") if ok else Color("#8a8f99"), 3.4, true)
			var tip := dc + Vector2(cos(-PI * 0.5 + TAU * f), sin(-PI * 0.5 + TAU * f)) * RING_R
			draw_circle(tip, 3.0, Color("#ffe0a8"), true, -1.0, true)
		_text(self, "%%%d" % roundi(f * 100.0), Vector2(_cx + 42.0, _d_top - 4.0), 12, Color("#ffe0a8"), true, 4)
	elif logic.state == "ready" and logic.age > SemaverLogic.TEA_STALE * 0.6:
		var q := logic.quality()
		var f := clampf((q - 0.5) / 0.5, 0.02, 1.0)
		draw_arc(dc, RING_R, -PI * 0.5, -PI * 0.5 + TAU * f, 56, Color(_ramp(TEA_RAMP, q).lightened(0.15), 0.9), 3.0, true)


func _draw_tray(hover: bool) -> void:
	var c := _tray_c
	var rx := _tray_rx
	var ry := _tray_ry
	_soft(self, c + Vector2(8.0, 9.0), Vector2(rx + 10.0, ry + 8.0), Color(0, 0, 0, 0.5))
	Draw.ellipse(self, c + Vector2(0, 3.0), rx, ry, Color("#6e4a14"))
	Draw.ellipse_grad(self, c, rx, ry, _hgrad([[0.0, Color("#a87a28")], [0.3, Color("#f4d27a")], [0.55, Color("#d8a640")], [1.0, Color("#8e6420")]]))
	Draw.ellipse_grad(self, c + Vector2(0, 1), rx - 8.0, ry - 5.0, _vgrad([[0.0, Color("#b4822c")], [1.0, Color("#e6bc5c")]]))
	Draw.ellipse_line(self, c + Vector2(0, 1), rx - 8.0, ry - 5.0, Color(0.43, 0.27, 0.06, 0.55), 1.0)
	Draw.ellipse_line(self, c + Vector2(0, 1), rx - 22.0, ry - 10.0, Color(1.0, 0.94, 0.75, 0.45), 1.0)
	Draw.ellipse_line(self, c, rx - 1.0, ry - 1.0, Color(1.0, 0.97, 0.84, 0.8), 1.5, PI * 1.05, PI * 1.9)
	# bardaklar
	var ready := logic.state == "ready"
	var n_full := mini(logic.glasses, TRAY_SHOW) if ready else 0
	var n := n_full if ready else TRAY_EMPTY_SHOW
	var full_tex := ItemView.tex("dish", "cay")
	var empty_tex := ItemView.tex("dish", "bos_bardak")
	var q := logic.quality()
	var tint := Color.WHITE.lerp(Color(0.62, 0.48, 0.42), clampf((1.0 - q) / 0.5, 0.0, 1.0))
	for k in n:
		var gx := c.x - 18.0 + (k - (n - 1) * 0.5) * GLASS_STEP
		var foot := Vector2(gx, c.y + 6.0)
		_soft(self, foot + Vector2(5.0, 2.0), Vector2(17.0, 5.0), Color(0, 0, 0, 0.35))
		var t: Texture2D = full_tex if k < n_full else empty_tex
		if t != null:
			var h := GLASS_W * float(t.get_height()) / float(t.get_width())
			# dokuda tabak ~%84 yükseklikte: ayak tepsiye otursun
			draw_texture_rect(t, Rect2(gx - GLASS_W * 0.5, foot.y - h * 0.84, GLASS_W, h), false, tint if k < n_full else Color(1, 1, 1, 0.9))
	if ready:
		var b := Rect2(c.x + rx - 42.0, c.y - 12.0, 40.0, 22.0)
		Draw.rr(self, b, 11.0, Color(0.078, 0.055, 0.1, 0.82), 1.0, Color(1.0, 0.86, 0.59, 0.6), 4.0, Color(0, 0, 0, 0.3), Vector2(1, 2))
		_text(self, "×%d" % logic.glasses, b.get_center(), 14, Color("#ffe3a0"))
	if hover and ready:
		Draw.ellipse_line(self, c, rx + 3.0, ry + 3.0, COL_HOVER, 2.0)


func _draw_thermo() -> void:
	var th := _thermo
	var w := logic.water
	var wc := Color(lerpf(80, 235, w) / 255.0, lerpf(150, 70, w) / 255.0, lerpf(255, 40, w) / 255.0)
	var bulb := Vector2(th.get_center().x, th.end.y + 6.0)
	_soft(self, bulb + Vector2(4, 6), Vector2(14, 8), Color(0, 0, 0, 0.35))
	Draw.rr(self, th.grow(2.0), 8.0, Color(0.078, 0.063, 0.1, 0.6), 0.0, Color.TRANSPARENT, 4.0, Color(0, 0, 0, 0.25), Vector2(2, 3))
	draw_circle(bulb, 10.0, Color(0.078, 0.063, 0.1, 0.6), true, -1.0, true)
	Draw.rr_grad(self, th, 6.0, [[0.0, Color(0.85, 0.89, 0.93, 0.9)], [0.5, Color(0.98, 0.99, 1.0, 0.95)], [1.0, Color(0.72, 0.77, 0.82, 0.9)]],
		1.0, Vector2(0, 0.5), Vector2(1, 0.5))
	var fh := (th.size.y - 6.0) * clampf(w, 0.04, 1.0)
	Draw.rr(self, Rect2(th.position.x + 3.0, th.end.y - 3.0 - fh, th.size.x - 6.0, fh + 4.0), 3.0, wc)
	draw_circle(bulb, 8.0, wc, true, -1.0, true)
	draw_circle(bulb, 8.0, Color(0.078, 0.063, 0.1, 0.6), false, 1.5, true)
	draw_circle(bulb + Vector2(-2.5, -2.5), 2.4, Color(1, 1, 1, 0.55), true, -1.0, true)
	for k in range(1, 5):
		draw_rect(Rect2(th.end.x - 4.0, th.position.y + k * th.size.y / 5.0, 4.0, 1.0), Color(0.16, 0.17, 0.2, 0.6))
	draw_rect(Rect2(th.position.x + 2.0, th.position.y + 5.0, 1.5, th.size.y - 10.0), Color(1, 1, 1, 0.6))
	_text(self, "100°", Vector2(th.get_center().x - 2.0, th.position.y - 10.0), 10, COL_TEXT, true, 4)


## Elektrikli kazanın dijital göstergesi
func _draw_kettle_panel() -> void:
	var on := _run and _powered() and logic.burner_on
	_text(self, ("%d°" % roundi(20.0 + 78.0 * logic.water)) if on else "--", Vector2(_cx, _b + 0.5), 10, Color("#53ff8a") if on else Color("#2c4a36"))
	var led := Vector2(_cx + 46.0, _b + 1.0)
	draw_circle(led, 4.0, Color("#17181b"), true, -1.0, true)
	draw_circle(led, 2.6, Color("#34e05a") if on else Color("#ff3b30"), true, -1.0, true)
	if not _powered():
		var b := Rect2(_cx - 62.0, _top + 30.0, 124.0, 24.0)
		var a := 0.75 + 0.25 * sin(_time * 6.0)
		Draw.rr(self, b, 12.0, Color(0.5, 0.08, 0.06, 0.88 * a), 1.0, Color(1, 0.6, 0.5, 0.6))
		_text(self, "Elektrik yok", b.get_center(), 12, Color("#fff0e8"))


## Ocak gövdesindeki gaz düğmesi (açıkken çentik sağa döner)
func _draw_knob(hover: bool) -> void:
	if _lv == 2:
		return
	var k := _knob
	_soft(self, k + Vector2(2.5, 3.5), Vector2(9.0, 8.0), Color(0, 0, 0, 0.5))
	draw_circle(k, 7.5, Color("#1b1d21"), true, -1.0, true)
	draw_circle(k, 6.5, Color("#d5dade"), true, -1.0, true)
	draw_circle(k + Vector2(-1.5, -1.5), 4.0, Color("#f4f6f8"), true, -1.0, true)
	var ang := -PI * 0.5 + (PI * 0.5 if logic.burner_on else 0.0)
	draw_line(k - Vector2(cos(ang), sin(ang)) * 5.0, k + Vector2(cos(ang), sin(ang)) * 5.0, Color("#2a2d31"), 2.4, true)
	draw_circle(k + Vector2(-11.0, 0.0), 2.0, Color("#ff8a2a") if logic.burner_on else Color("#4a3a30"), true, -1.0, true)
	if hover:
		draw_circle(k, 10.0, COL_HOVER, false, 2.0, true)


func _status() -> Array:
	if not _powered() and _run:
		return ["Elektrik yok", Color("#ff8a7a")]
	if not logic.burner_on:
		return ["Ocak kapalı", Color("#ffe08a")]
	match logic.state:
		"brewing":
			return ["Su bekleniyor", Color("#ffc46b")] if logic.water < SemaverLogic.WATER_BREW_MIN else ["Demleniyor", Color("#ffc46b")]
		"ready":
			return ["Çay hazır", Color("#7dff8a")] if logic.quality() >= 0.99 else ["Demi geçti", Color("#ffa45c")]
	if _run and logic.water < 1.0:
		return ["Su ısınıyor %%%d" % roundi(logic.water * 100.0), Color("#9fd0ff")]
	if _leaves() <= 0:
		return ["Çay yaprağı yok!", Color("#ff8a7a")]
	return ["Demlik boş" if _run else "Ocak açık", Color("#ffe08a")]


func _draw_status_pill() -> void:
	var st := _status()
	var label: String = st[0]
	var col: Color = st[1]
	var p := _pill
	Draw.rr(self, p, 11.0, COL_PANEL, 1.0, Color(1, 1, 1, 0.18), 4.0, Color(0, 0, 0, 0.3), Vector2(0, 2))
	draw_circle(p.position + Vector2(11.0, p.size.y * 0.5), 3.5, col, true, -1.0, true)
	var size := Draw.fit_size(label, p.size.x - 24.0, 12, 9)
	_text(self, label, p.position + Vector2(19.0, p.size.y * 0.5), size, col, false)


## "Ocak açık / kapalı" anahtarı
func _draw_burner_button(hover: bool) -> void:
	var b := _btn_burner
	var on := logic.burner_on
	Draw.rr(self, b, 11.0, COL_PANEL, 1.0, Color(1, 1, 1, 0.3) if hover else Color(1, 1, 1, 0.16), 4.0, Color(0, 0, 0, 0.3), Vector2(0, 2))
	var track := Rect2(b.position.x + 6.0, b.position.y + 5.0, 24.0, 12.0)
	Draw.rr(self, track, 6.0, Color("#e8742a") if on else Color("#4a4452"))
	var kx := track.end.x - 6.0 if on else track.position.x + 6.0
	draw_circle(Vector2(kx, track.get_center().y), 5.0, Color("#fff6e8"), true, -1.0, true)
	if on:
		# küçük alev simgesi
		var f := Vector2(track.position.x + 7.0, track.get_center().y)
		_cpoly(self, PackedVector2Array([f + Vector2(0, -4.5), f + Vector2(2.6, 0.5), f + Vector2(0, 3.0), f + Vector2(-2.6, 0.5)]), Color(1, 1, 1, 0.85))
	var label := "Ocak açık" if on else "Ocak kapalı"
	var fs := Draw.fit_size(label, b.end.x - track.end.x - 12.0, 12, 9)
	_text(self, label, Vector2(track.end.x + 6.0, b.get_center().y), fs, Color("#ffd9a8") if on else Color("#c9c2d4"), false)


func _draw_rebrew_button(hover: bool) -> void:
	var b := _btn_rebrew
	var pulse := 0.5 + 0.5 * sin(_time * 5.0)
	Draw.rr(self, b.grow(2.0 + pulse * 1.5), 13.0, Color(1.0, 0.6, 0.24, 0.18 + 0.15 * pulse))
	Draw.rr_grad(self, b, 11.0, [[0.0, Color("#ffb15a") if hover else Color("#ff9a3c")], [1.0, Color("#c4561d")]])
	Draw.rr(self, b, 11.0, Color.TRANSPARENT, 1.0, Color(1, 1, 1, 0.4))
	# yenile oku
	var ic := b.position + Vector2(13.0, b.size.y * 0.5)
	draw_arc(ic, 5.0, -PI * 0.2, PI * 1.4, 14, Color.WHITE, 1.8, true)
	var tip := ic + Vector2(cos(-PI * 0.2), sin(-PI * 0.2)) * 5.0
	_cpoly(self, PackedVector2Array([tip + Vector2(-3.2, -2.4), tip + Vector2(2.6, -2.8), tip + Vector2(0.6, 2.6)]), Color.WHITE)
	_text(self, "Tazele", Vector2(b.position.x + 24.0, b.get_center().y), 12, Color.WHITE, false)


## Çırak Emre işe alınmışsa: kısa konuşma balonu (karakter çizimi henüz yok)
func _draw_cirak_bubble() -> void:
	var msg := ""
	var col := Color("#3a2c52")
	if logic.cirak_busy > 0.0:
		msg = "Emre: Demliyorum!"
	elif logic.cirak_t > 0.0:
		msg = "Emre: Hemen tazeliyorum…"
	elif logic.state == "empty" and _run and _leaves() <= 0:
		msg = "Emre: Çay bitti abi!"
		col = Color("#c0392b")
	if msg == "":
		return
	var w := Draw.text_size(msg, 11).x + 16.0
	var b := Rect2(_r.position.x + 10.0, _r.position.y + 92.0, w, 20.0)
	Draw.rr(self, b, 9.0, Color("#fffdf6"), 0.0, Color.TRANSPARENT, 4.0, Color(0, 0, 0, 0.3), Vector2(1, 2))
	_text(self, msg, b.get_center(), 11, col)


func _draw_level_tag() -> void:
	var name: String = str(Game.upg_val(UPG_ID, "name", ""))
	if name == "":
		return
	var size := 11
	var w := Draw.text_size(name, size).x
	_text(self, name, Vector2(_r.end.x - 10.0 - w, _r.end.y - 9.0), size, Color(1.0, 0.97, 0.9, 0.85), false, 4, Color(0.08, 0.06, 0.12, 0.55))
