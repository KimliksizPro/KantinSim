extends Node2D
## Fritöz istasyonu (web js/stations_cook.js "FRİTÖZ": fryGeo, fritozZone, updateFritoz, drawFritoz).
## Çiğ patates sepete bırakılınca sepet yağa iner ve kızarır. Tıkla = sepeti kaldır/indir,
## sürükle = kızarmış patatesi kese olarak al. Yağ her porsiyonda eskir; "Yağı Değiştir" 1 Kızartma Yağı harcar.
## Saf mantık fritoz_logic.gd'de; bu script çizim, ışık, partikül ve Drag bölge protokolünü üstlenir.
##
## Demo kipi (yalnız ekran görüntüsü kontrolü için): `-- --fritoz-demo=0.7` → sepette 0.7 pişmiş patates, yağda, yağ sıcak.
## Ek seçenekler virgülle: `eski` (yağ ömrü 5/30), `kalk` (sepet yukarıda), `soguk` (elektrik yok, yağ soğuk).

const FryLogic := preload("res://scripts/stations/fritoz_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

## Drag önceliği (web fritozZone.z)
var zone_z: int = 5

const DEFAULT_LABEL := "Fritöz"
## Yerleşim (web fryGeo)
const BODY_PAD_X := 10.0
const BODY_TOP := 40.0
const BODY_BOTTOM_PAD := 16.0
const VAT_PAD := 12.0
const VAT_TOP := 14.0
const VAT_H := 92.0
const OIL_OFFSET := 28.0
const BASKET_H := 40.0
const BASKET_W_ONE := 116.0
const BASKET_W_MANY := 82.0
const BASKET_GAP := 12.0
const BASKET_RIM := 9.0
const BASKET_UP := 24.0     # sepet yukarıdayken hazne ağzının ne kadar üstünde
const BASKET_DOWN := 5.0    # sepet yağdayken yağ yüzeyinin ne kadar üstünde
const DIAL_R := 19.0
## Sepeti sürükleyerek almak için gereken fare hareketi (px)
const PRESS_DRAG_DIST := 12.0
const LIGHT_ENERGY := 0.75

const COL_HOVER := Color(1.0, 0.914, 0.627)
const COL_STEAM := Color(1.0, 1.0, 1.0, 0.32)
const COL_SMOKE := Color(0.6, 0.6, 0.62, 0.5)
const COL_DARK := Color(0.12, 0.1, 0.1, 0.7)
const COL_BUBBLE := Color(1.0, 0.97, 0.82, 0.75)
## Yağ rengi eskime oranına göre (web R_OIL)
const OIL_RAMP := [[0.0, Color("#f2c23c")], [0.45, Color("#d69222")], [0.75, Color("#8e5416")], [1.0, Color("#3f260d")]]
## Patates rengi pişmeye göre (web R_FRY)
const FRY_RAMP := [
	[0.0, Color("#f6ecc4")], [0.5, Color("#f3d982")], [0.9, Color("#ecba45")], [1.15, Color("#d89833")],
	[1.35, Color("#9e601f")], [1.6, Color("#402c17")], [2.0, Color("#1a1410")],
]

var logic: FryLogic = FryLogic.new()

# geometri (1600x900 mantıksal uzay)
var _r: Rect2
var _body: Rect2
var _vat: Rect2
var _oil_y: float
var _panel: Rect2
var _dial: Vector2
var _gauge: Rect2
var _btn: Rect2
## Her sepet: {x, w, cx, up_y, down_y}
var _bgeo: Array = []

# sepete basış takibi (kısa tık = kaldır/indir, sürükleme = al)
var _press_active := false
var _press_i := -1
var _press_pos := Vector2.ZERO

var _glow := 0.0   # 0..1 yumuşatılmış yağ parıltısı
## Demo kipinde sabit tutulan pişme değeri (-1 = demo yok); ekran görüntüsü kare süresinden etkilenmesin
var _demo_cook := -1.0
var _time := 0.0
var _mouse := Vector2(-1000, -1000)
var _font: Font
var _tex: Dictionary = {}
var _brush: PackedFloat32Array = PackedFloat32Array()
var _light: PointLight2D
var _steam: Array[GPUParticles2D] = []
var _smoke: Array[GPUParticles2D] = []
var _bubbles: Array[GPUParticles2D] = []
var _drips: Array[GPUParticles2D] = []
var _simmer: GPUParticles2D


func _ready() -> void:
	_font = ThemeDB.fallback_font
	# Fritözün kendisi ışıktan etkilenmez; sıcak yağ parıltısı çevreye düşer, yağdaki ışıltı elle çizilir.
	light_mask = 0
	var rng := RandomNumberGenerator.new()
	rng.seed = 5113
	for i in 200:
		_brush.append(rng.randf())
	_sync_baskets(true)
	_build_light()
	Drag.register(self)
	_apply_demo_args()


func _exit_tree() -> void:
	Drag.unregister(self)


func _build_geometry() -> void:
	_r = GameData.rect("fritoz")
	_body = Rect2(_r.position.x + BODY_PAD_X, _r.position.y + BODY_TOP, _r.size.x - BODY_PAD_X * 2.0, _r.size.y - BODY_TOP - BODY_BOTTOM_PAD)
	_vat = Rect2(_body.position.x + VAT_PAD, _body.position.y + VAT_TOP, _body.size.x - VAT_PAD * 2.0, VAT_H)
	_oil_y = _vat.position.y + OIL_OFFSET
	var py := _vat.end.y + 10.0
	_panel = Rect2(_body.position.x + 8.0, py, _body.size.x - 16.0, _body.end.y - py - 8.0)
	_dial = Vector2(_panel.position.x + 28.0, _panel.position.y + _panel.size.y * 0.5 + 1.0)
	_gauge = Rect2(_panel.position.x + 60.0, _panel.position.y + 20.0, _panel.size.x - 70.0, 7.0)
	_btn = Rect2(_panel.position.x + 60.0, _panel.position.y + 35.0, _panel.size.x - 70.0, 24.0)
	var n: int = logic.baskets.size()
	var bw := BASKET_W_ONE if n == 1 else BASKET_W_MANY
	bw = minf(bw, (_vat.size.x - 16.0 - BASKET_GAP * (n - 1)) / n)
	var tot := bw * n + BASKET_GAP * (n - 1)
	var bx0 := _vat.position.x + (_vat.size.x - tot) * 0.5
	_bgeo.clear()
	for i in n:
		var x := bx0 + i * (bw + BASKET_GAP)
		_bgeo.append({"x": x, "w": bw, "cx": x + bw * 0.5, "up_y": _vat.position.y - BASKET_UP, "down_y": _oil_y - BASKET_DOWN})


## Sepet sayısını geliştirme seviyesine eşitler; değiştiyse geometri ve partikülleri yeniden kurar.
func _sync_baskets(force: bool = false) -> void:
	var n := clampi(int(Game.upg_val("fritoz", "baskets", 1)), 1, FryLogic.MAX_BASKETS)
	if not force and n == logic.baskets.size():
		return
	var lost: int = logic.set_basket_count(n)
	if lost > 0:
		Game.notify("Fritöz değişti: %d sepetteki patates kayboldu." % lost, "warn")
	_build_geometry()
	for p in _steam + _smoke + _bubbles + _drips:
		p.queue_free()
	_steam.clear()
	_smoke.clear()
	_bubbles.clear()
	_drips.clear()
	for g: Dictionary in _bgeo:
		var w: float = g.w
		_bubbles.append(_make_bubbles(24, Vector3(w * 0.5 + 6.0, 5.0, 0.0), 0.7))
		_steam.append(_make_puffs(COL_STEAM, 8, w))
		_smoke.append(_make_puffs(COL_SMOKE, 18, w))
		_drips.append(_make_drips(w))
	if _simmer == null:
		_simmer = _make_bubbles(14, Vector3(_vat.size.x * 0.5 - 10.0, 22.0, 0.0), 1.2)
		_simmer.position = Vector2(_vat.get_center().x, _oil_y + 30.0)


func _apply_demo_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--fritoz-demo="):
			continue
		var parts := a.trim_prefix("--fritoz-demo=").split(",")
		var v := clampf(float(parts[0]), 0.0, FryLogic.FRY_MAX)
		logic.place(0, Items.ing("patates"))
		logic.baskets[0].c.cook = v
		_demo_cook = v
		logic.baskets[0].ready = v >= FryLogic.FRY_DONE
		logic.baskets[0].smk = v >= FryLogic.FRY_SMOKE
		logic.baskets[0].burn = v >= FryLogic.FRY_BURN
		var up := parts.has("kalk")
		logic.baskets[0].down = not up
		logic.baskets[0].down_t = 0.0 if up else 1.0
		if parts.has("eski"):
			logic.oil_life = 5
			logic.old_warned = true
		if parts.has("soguk"):
			Game.power = false
			logic.temp = 0.0
		_glow = logic.heat()
		for p in _steam + _smoke + _bubbles + [_simmer]:
			p.preprocess = 1.2


# --- Drag bölge protokolü ------------------------------------------------------

func zone_rect() -> Rect2:
	return _r


func can_drop(item: Dictionary) -> bool:
	return FryLogic.can_take(item) and logic.accepts()


func drop(item: Dictionary, pt: Vector2) -> bool:
	if not can_drop(item):
		return false
	var xs: Array = []
	for g: Dictionary in _bgeo:
		xs.append(g.cx)
	if logic.drop(item, xs, pt.x) < 0:
		return false
	if not Game.power_on():
		Game.notify("Elektrik yok — fritöz ısınmıyor!", "warn")
	if logic.pop_old_warning():
		Game.notify("Fritöz yağı eskidi — patatesler kötüleşiyor. \"Yağı Değiştir\"e bas!", "warn")
	return true


func return_item(item: Dictionary) -> void:
	if logic.put_back(item) < 0:
		push_warning("fritöz: iade için boş sepet yok")


## Yukarıdaki sepetten patates doğrudan alınır; yağdaki sepette basış beklemeye alınır
## (kısa tık → click ile sepet kalkar, sürüklenirse _process patatesi ele verir).
func pick(pt: Vector2) -> Dictionary:
	_press_active = false
	if _btn.has_point(pt):
		return {}
	var i := _basket_at(pt)
	if i < 0 or not logic.has_fries(i):
		return {}
	var b: Dictionary = logic.baskets[i]
	if not b.down and float(b.down_t) < FryLogic.PICK_UP_T:
		return logic.take(i)
	_press_active = true
	_press_i = i
	_press_pos = pt
	return {}


func click(pt: Vector2) -> void:
	if _btn.has_point(pt):
		_press_active = false
		_change_oil()
		return
	var i := _press_i if _press_active else _basket_at(pt)
	_press_active = false
	if i < 0:
		return
	if logic.toggle(i) and not Game.power_on():
		Game.notify("Elektrik yok — fritöz ısınmıyor!", "warn")


func hover_text(pt: Vector2) -> String:
	var warn := "" if Game.power_on() else "\nElektrik yok — fritöz ısınmıyor!"
	var oil: int = logic.oil_life
	if _btn.has_point(pt):
		return "Yağı Değiştir — 1 Kızartma Yağı harcar (stok: %d)\nYağ ömrü: %d/%d porsiyon" % [Game.inv_get("yag"), oil, FryLogic.OIL_MAX]
	var i := _basket_at(pt)
	if i >= 0:
		if logic.has_fries(i):
			var c: float = logic.cook_of(i)
			var head := "Patates — %s (%%%d)" % [Recipes.cook_label(c), roundi(c * 100.0)]
			var old := "\nEski yağda kızarıyor (kalite düşük)" if logic.oil_mult_of(i) < 1.0 else ""
			if logic.baskets[i].down:
				return head + "\nYağda kızarıyor • Tıkla: sepeti kaldır • Sürükle: keseye al" + old + warn
			return head + "\nSepet yukarıda • Tıkla/sürükle: keseye al" + old
		return "Fritöz sepeti (boş)\nÇiğ patatesi sepete bırak — sepet yağa iner" + warn
	return "Fritöz — yağ ömrü %d/%d%s\nÇiğ patatesi sepete bırak%s" % [oil, FryLogic.OIL_MAX, " (ESKİ!)" if logic.is_oil_old() else "", warn]


func _basket_y(i: int) -> float:
	var g: Dictionary = _bgeo[i]
	var t := clampf(float(logic.baskets[i].down_t), 0.0, 1.0)
	var e := t * t * (3.0 - 2.0 * t)
	return lerpf(g.up_y, g.down_y, e)


func _basket_hit(i: int) -> Rect2:
	var g: Dictionary = _bgeo[i]
	return Rect2(g.x - 6.0, _basket_y(i) - 12.0, g.w + 12.0, BASKET_H + 48.0)


## pt'nin altındaki sepet (yoksa -1). Haznenin üstünde en yakın sepet seçilir (web basketAt).
func _basket_at(pt: Vector2) -> int:
	for i in _bgeo.size():
		if _basket_hit(i).has_point(pt):
			return i
	if Rect2(_vat.position.x, _vat.position.y - 30.0, _vat.size.x, _vat.size.y + 30.0).has_point(pt):
		var best := -1
		var bd := INF
		for i in _bgeo.size():
			var d := absf(pt.x - float(_bgeo[i].cx))
			if d < bd:
				bd = d
				best = i
		return best
	return -1


func _change_oil() -> void:
	if not logic.can_change_oil():
		Game.notify("Fritöz yağı zaten taze.", "info")
		return
	if not Game.inv_take("yag"):
		Game.notify("Kızartma yağı kalmadı! Toptancıdan sipariş et.", "warn")
		return
	logic.change_oil()
	Game.float_text.emit(Vector2(_vat.get_center().x, _vat.position.y - 6.0), "Taze yağ!", Game.COLOR_INFO)
	Game.notify("Fritöz yağı değiştirildi.", "good")


# --- Güncelleme ----------------------------------------------------------------

func _process(dt: float) -> void:
	_time += dt
	_mouse = get_viewport().get_mouse_position()
	_sync_baskets()
	_update_press()
	var gdt := Game.game_dt(dt)
	var spd := float(Game.upg_val("fritoz", "speed", 1.0))
	var events: Array = logic.update(gdt, dt, Game.power_on(), spd, Game.has_staff("sef"))
	if _demo_cook >= 0.0 and logic.has_fries(0):
		logic.baskets[0].c.cook = _demo_cook
	for ev: Dictionary in events:
		var pos := Vector2(float(_bgeo[int(ev.basket)].cx), _oil_y - 24.0)
		match ev.type:
			"done":
				Game.float_text.emit(pos, "Hazır!", Game.COLOR_MONEY)
			"burn":
				Game.float_text.emit(pos, "Yandı!", Game.COLOR_BAD)
			"chef_lift":
				Game.float_text.emit(pos - Vector2(0, 16), "Şef kaldırdı", Game.COLOR_INFO)
	var running := gdt > 0.0
	var target: float = logic.heat() * (1.0 if Game.power_on() else 0.6)
	_glow = lerpf(_glow, target, 1.0 - exp(-dt * 1.5))
	_light.energy = _glow * (LIGHT_ENERGY + 0.06 * sin(_time * 4.1) + 0.03 * sin(_time * 11.0)) * (1.25 if logic.frying else 1.0)
	_light.visible = _glow > 0.02
	_update_particles(running)
	queue_redraw()


## Yağdaki sepete basılıyken fare yeterince hareket ederse patatesi ele ver (web fritozZone.onDrag).
func _update_press() -> void:
	if not _press_active:
		return
	if Drag.is_holding() or not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		_press_active = false
		return
	if _mouse.distance_to(_press_pos) < PRESS_DRAG_DIST:
		return
	_press_active = false
	var item: Dictionary = logic.take(_press_i)
	if not item.is_empty():
		Drag.start_hold(item, self)


func _update_particles(running: bool) -> void:
	var h: float = logic.heat()
	for i in _bgeo.size():
		var g: Dictionary = _bgeo[i]
		var b: Dictionary = logic.baskets[i]
		var has: bool = logic.has_fries(i)
		var c: float = logic.cook_of(i)
		var oil_in: bool = logic.in_oil(i)
		var by := _basket_y(i)
		# kabarcıklar: ıslak (çiğ) patates daha çok köpürtür
		var wet := 1.0 + maxf(0.0, 1.0 - c) * 1.4 if has else 0.0
		_bubbles[i].position = Vector2(g.cx, _oil_y + 5.0)
		_bubbles[i].emitting = running and oil_in and h > 0.05
		_bubbles[i].amount_ratio = clampf((0.12 + (0.32 * wet if has else 0.0)) * h + float(b.splash) * 0.5, 0.05, 1.0)
		_steam[i].position = Vector2(g.cx, _oil_y - 6.0)
		_steam[i].emitting = running and oil_in and has and h > 0.2 and c < FryLogic.FRY_BURN
		var smoking := running and has and c >= FryLogic.FRY_SMOKE
		var burnt := c >= FryLogic.FRY_BURN
		_smoke[i].position = Vector2(g.cx, by)
		_smoke[i].emitting = smoking
		_smoke[i].amount_ratio = 1.0 if burnt else 0.45
		(_smoke[i].process_material as ParticleProcessMaterial).color = COL_DARK if burnt else COL_SMOKE
		_drips[i].position = Vector2(g.cx, by + BASKET_H)
		_drips[i].emitting = float(b.drip) > 0.0 and float(b.down_t) < 0.3
		_drips[i].amount_ratio = clampf(float(b.drip) / FryLogic.DRIP_TIME + 0.15, 0.1, 1.0)
		(_drips[i].process_material as ParticleProcessMaterial).color = _oil_color().lightened(0.1)
	_simmer.emitting = running and h > 0.3
	_simmer.amount_ratio = clampf(h, 0.1, 1.0)


func _oil_color() -> Color:
	return _ramp(OIL_RAMP, logic.oil_wear())


# --- Işık ve partiküller -------------------------------------------------------

func _build_light() -> void:
	_light = PointLight2D.new()
	_light.texture = _blob_tex()
	_light.texture_scale = 2.4
	_light.color = Color(1.0, 0.72, 0.3)
	_light.energy = 0.0
	_light.blend_mode = Light2D.BLEND_MODE_ADD
	_light.position = Vector2(_vat.get_center().x, _oil_y + 20.0)
	add_child(_light)


func _particle_base(tex: Texture2D, amount: int, lifetime: float) -> GPUParticles2D:
	var p := GPUParticles2D.new()
	p.texture = tex
	p.amount = amount
	p.lifetime = lifetime
	p.emitting = false
	p.local_coords = false
	p.light_mask = 0
	add_child(p)
	return p


func _fade_ramp(peak: float) -> GradientTexture1D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, peak, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 0), Color(1, 1, 1, 1), Color(1, 1, 1, 0)])
	var gt := GradientTexture1D.new()
	gt.gradient = g
	return gt


func _scale_curve(a: float, b: float) -> CurveTexture:
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, a))
	curve.add_point(Vector2(1.0, b))
	var ct := CurveTexture.new()
	ct.curve = curve
	return ct


## Buhar / duman: yukarı süzülen, büyüyerek kaybolan yumuşak lekeler
func _make_puffs(col: Color, amount: int, w: float) -> GPUParticles2D:
	var p := _particle_base(_blob_tex(), amount, 1.8)
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(w * 0.4, 3.0, 0.0)
	m.direction = Vector3(0, -1, 0)
	m.spread = 16.0
	m.initial_velocity_min = 24.0
	m.initial_velocity_max = 46.0
	m.gravity = Vector3(4, -8, 0)
	m.lifetime_randomness = 0.3
	m.scale_min = 0.28
	m.scale_max = 0.46
	m.scale_curve = _scale_curve(0.45, 1.5)
	m.color_ramp = _fade_ramp(0.18)
	m.color = col
	p.process_material = m
	return p


## Yağ kabarcıkları: kısa ömürlü, hafifçe yükselen halkalar
func _make_bubbles(amount: int, extents: Vector3, lifetime: float) -> GPUParticles2D:
	var p := _particle_base(_ring_tex(), amount, lifetime)
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = extents
	m.direction = Vector3(0, -1, 0)
	m.spread = 30.0
	m.initial_velocity_min = 4.0
	m.initial_velocity_max = 14.0
	m.gravity = Vector3.ZERO
	m.lifetime_randomness = 0.6
	m.scale_min = 0.07
	m.scale_max = 0.16
	m.scale_curve = _scale_curve(0.5, 1.2)
	m.color_ramp = _fade_ramp(0.25)
	m.color = COL_BUBBLE
	p.process_material = m
	return p


## Kalkan sepetten yağa düşen damlalar
func _make_drips(w: float) -> GPUParticles2D:
	var p := _particle_base(_blob_tex(), 10, 0.3)
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(w * 0.4, 1.0, 0.0)
	m.direction = Vector3(0, 1, 0)
	m.spread = 2.0
	m.initial_velocity_min = 10.0
	m.initial_velocity_max = 30.0
	m.gravity = Vector3(0, 420, 0)
	m.scale_min = 0.03
	m.scale_max = 0.05
	m.color_ramp = _fade_ramp(0.1)
	m.color = Color("#f2c23c")
	p.process_material = m
	return p


## Yumuşak daire dokusu (ışık, gölge, parıltı ve partiküller için)
func _blob_tex() -> GradientTexture2D:
	if _tex.has("blob"):
		return _tex["blob"]
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.35, 0.7, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.62), Color(1, 1, 1, 0.16), Color(1, 1, 1, 0)])
	_tex["blob"] = _radial(g)
	return _tex["blob"]


## Kabarcık dokusu: içi saydam, kenarı parlak halka
func _ring_tex() -> GradientTexture2D:
	if _tex.has("ring"):
		return _tex["ring"]
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.55, 0.75, 0.88, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.25), Color(1, 1, 1, 1), Color(1, 1, 1, 0.5), Color(1, 1, 1, 0)])
	_tex["ring"] = _radial(g)
	return _tex["ring"]


func _radial(g: Gradient) -> GradientTexture2D:
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = 128
	t.height = 128
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	return t


# --- Çizim yardımcıları --------------------------------------------------------

## Bozuk (üçgenlenemeyen) çokgenleri sessizce atlar
func _cpoly(pts: PackedVector2Array, col: Color) -> void:
	if pts.size() >= 3 and not Geometry2D.triangulate_polygon(pts).is_empty():
		draw_colored_polygon(pts, col)


func _poly(pts: PackedVector2Array, cols: PackedColorArray) -> void:
	if pts.size() >= 3 and not Geometry2D.triangulate_polygon(pts).is_empty():
		draw_polygon(pts, cols)


## Dikey renk geçişli çokgen: her köşenin rengi y'sine göre stops'tan ([[y, Color], ...]) bulunur
func _poly_vgrad(pts: PackedVector2Array, stops: Array) -> void:
	var cols := PackedColorArray()
	for p in pts:
		cols.append(_ramp(stops, p.y))
	_poly(pts, cols)


func _rr(r: Rect2, rad: float, col: Color) -> void:
	if r.size.x > 0.5 and r.size.y > 0.5:
		_cpoly(Draw.rr_points(r, rad), col)


func _outline(pts: PackedVector2Array, col: Color, width: float) -> void:
	var closed := pts.duplicate()
	closed.append(pts[0])
	draw_polyline(closed, col, width, true)


func _rr_outline(r: Rect2, rad: float, col: Color, width: float = 1.0) -> void:
	_outline(Draw.rr_points(r, rad), col, width)


## Yalnız alt köşeleri yuvarlak dikdörtgen (yağ yüzeyi düz kalsın)
static func _bottom_round(r: Rect2, rad: float) -> PackedVector2Array:
	rad = minf(rad, minf(r.size.x * 0.5, r.size.y) - 0.01)
	var pts := PackedVector2Array([r.position, Vector2(r.end.x, r.position.y)])
	for k in 7:
		var a := PI * 0.5 * k / 6.0
		pts.append(Vector2(r.end.x - rad, r.end.y - rad) + Vector2(cos(a), sin(a)) * rad)
	for k in 7:
		var a := PI * 0.5 + PI * 0.5 * k / 6.0
		pts.append(Vector2(r.position.x + rad, r.end.y - rad) + Vector2(cos(a), sin(a)) * rad)
	return pts


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


static func _shade(c: Color, amt: float) -> Color:
	return c.lightened(amt) if amt >= 0.0 else c.darkened(-amt)


## Doğru parçasını dikdörtgene kırpar (Liang–Barsky). Dışta kalırsa boş dizi.
static func _clip_seg(a: Vector2, b: Vector2, r: Rect2) -> PackedVector2Array:
	var d := b - a
	var t0 := 0.0
	var t1 := 1.0
	var p := [-d.x, d.x, -d.y, d.y]
	var q := [a.x - r.position.x, r.end.x - a.x, a.y - r.position.y, r.end.y - a.y]
	for k in 4:
		if absf(p[k]) < 0.000001:
			if q[k] < 0.0:
				return PackedVector2Array()
			continue
		var t: float = q[k] / p[k]
		if p[k] < 0.0:
			t0 = maxf(t0, t)
		else:
			t1 = minf(t1, t)
	if t0 > t1:
		return PackedVector2Array()
	return PackedVector2Array([a + d * t0, a + d * t1])


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


# --- Çizim -----------------------------------------------------------------------

func _draw() -> void:
	var holding := Drag.is_holding()
	var running := Game.game_dt(1.0) > 0.0
	_draw_shadows()
	_draw_body()
	_draw_vat()
	_draw_oil()
	for i in _bgeo.size():
		var hov := not holding and _basket_at(_mouse) == i and not _btn.has_point(_mouse)
		_draw_basket(i, hov)
	_draw_vat_front()
	_draw_panel(running, holding)
	_draw_label()
	if not Game.power_on() and running:
		_draw_no_power(Vector2(_r.get_center().x, _oil_y + 8.0))


## Zemin gölgeleri: ışık sol üstten, gölge sağ alta düşer.
func _draw_shadows() -> void:
	var b := _body
	_blob(Vector2(b.get_center().x + 14.0, b.end.y + 2.0), Vector2(b.size.x * 0.6, 22.0), Color(0, 0, 0, 0.5))
	_blob(Vector2(b.end.x + 8.0, b.get_center().y + 14.0), Vector2(22.0, b.size.y * 0.55), Color(0, 0, 0, 0.32))
	_blob(Vector2(b.get_center().x + 4.0, b.end.y + 3.0), Vector2(b.size.x * 0.52, 7.0), Color(0, 0, 0, 0.55))


## Paslanmaz gövde: alt kalınlık + fırçalanmış ön yüz
func _draw_body() -> void:
	var b := _body
	# gövdenin alt / sağ kalınlığı (hacim hissi)
	Draw.rr_grad(self, Rect2(b.position + Vector2(2, 5), b.size), 12.0,
		[[0.0, Color("#59616a")], [1.0, Color("#2c3036")]])
	# ön yüz: soldan sağa ışık düşüşü
	Draw.rr_grad(self, b, 12.0, [
		[0.0, Color("#eef1f4")], [0.18, Color("#c9cfd5")], [0.5, Color("#a7afb7")],
		[0.78, Color("#bcc3ca")], [1.0, Color("#7d858d")]], 1.0, Vector2(0, 0), Vector2(1, 0))
	# üstten alta hafif kararma
	Draw.rr_grad(self, b, 12.0, [[0.0, Color(1, 1, 1, 0.12)], [0.4, Color(1, 1, 1, 0)], [1.0, Color(0, 0, 0, 0.22)]])
	# fırçalanmış çelik çizgileri (yatay)
	var y := b.position.y + 6.0
	var k := 0
	while y < b.end.y - 6.0:
		var a := 0.07 * _brush[k % _brush.size()]
		draw_rect(Rect2(b.position.x + 5.0, y, b.size.x - 10.0, 0.8), Color(1, 1, 1, a))
		y += 1.6
		k += 1
	draw_rect(Rect2(b.position.x + 12.0, b.position.y + 1.5, b.size.x - 24.0, 1.6), Color(1, 1, 1, 0.55))
	draw_rect(Rect2(b.position.x + 1.5, b.position.y + 12.0, 1.4, b.size.y - 24.0), Color(1, 1, 1, 0.35))
	_rr_outline(b.grow(-0.5), 12.0, Color(0.118, 0.133, 0.157, 0.6), 1.2)
	# ayaklar
	for fx: float in [b.position.x + 14.0, b.end.x - 32.0]:
		_rr(Rect2(fx, b.end.y + 2.0, 18.0, 6.0), 2.0, Color("#16171a"))


## Hazne ağzı, iç duvar ve sepet kancaları
func _draw_vat() -> void:
	var v := _vat
	# ağız çerçevesi (preslenmiş çelik)
	var rim := v.grow(6.0)
	_blob(rim.get_center() + Vector2(3, 4), rim.size * 0.56, Color(0, 0, 0, 0.25))
	Draw.rr_grad(self, rim, 13.0, [[0.0, Color("#f6f8fa")], [0.5, Color("#aab2ba")], [1.0, Color("#6c747c")]])
	_rr_outline(rim.grow(-0.5), 13.0, Color(0.1, 0.11, 0.13, 0.55), 1.0)
	draw_rect(Rect2(rim.position.x + 10.0, rim.position.y + 1.0, rim.size.x - 20.0, 1.0), Color(1, 1, 1, 0.85))
	_rr(v, 9.0, Color("#16171a"))
	# arka iç duvar (yağın üstünde görünen kısım)
	var wall := Rect2(v.position.x + 3.0, v.position.y + 3.0, v.size.x - 6.0, _oil_y - v.position.y + 2.0)
	Draw.rr_grad(self, wall, 7.0, [[0.0, Color("#24272c")], [0.55, Color("#3e4248")], [1.0, Color("#5b6067")]])
	# duvardaki dikey parlamalar (paslanmaz iç yüzey)
	for fx: float in [0.18, 0.62, 0.66]:
		var x := v.position.x + v.size.x * fx
		draw_rect(Rect2(x, wall.position.y + 4.0, 3.0 if fx < 0.5 else 1.5, wall.size.y - 6.0), Color(1, 1, 1, 0.06))
	# üst kenardan düşen iç gölge
	_poly(PackedVector2Array([wall.position, Vector2(wall.end.x, wall.position.y), Vector2(wall.end.x, wall.position.y + 10.0), Vector2(wall.position.x, wall.position.y + 10.0)]),
		PackedColorArray([Color(0, 0, 0, 0.5), Color(0, 0, 0, 0.5), Color(0, 0, 0, 0), Color(0, 0, 0, 0)]))
	# sepet askı kancaları
	for g: Dictionary in _bgeo:
		for sx: float in [-10.0, 10.0]:
			var x: float = g.cx + sx
			draw_line(Vector2(x + 1.0, v.position.y + 3.0), Vector2(x + 1.0, v.position.y - 7.0), Color(0, 0, 0, 0.35), 2.0)
			draw_line(Vector2(x, v.position.y + 2.0), Vector2(x, v.position.y - 8.0), Color("#c9ced3"), 2.0)
			draw_circle(Vector2(x, v.position.y - 8.0), 1.6, Color("#e6e9ec"))


## Altın sarısı yağ (eskidikçe koyulaşır): gradyan, yüzey parlaması, ısı ışıltısı
func _draw_oil() -> void:
	var v := _vat
	var oc := _oil_color()
	var top := _oil_y
	var inner := Rect2(v.position.x + 3.0, top, v.size.x - 6.0, v.end.y - 3.0 - top)
	var mid := top + inner.size.y * 0.35
	var stops := [[top, _shade(oc, 0.28)], [mid, oc], [inner.end.y, _shade(oc, -0.5)]]
	# üst bant düz dikdörtgen, alt kısım yuvarlak köşeli (orta durak korunsun diye iki parça)
	_poly_vgrad(PackedVector2Array([inner.position, Vector2(inner.end.x, top), Vector2(inner.end.x, mid), Vector2(inner.position.x, mid)]), stops)
	_poly_vgrad(_bottom_round(Rect2(inner.position.x, mid, inner.size.x, inner.end.y - mid), 8.0), stops)
	# kenarlardan kararan derinlik
	_poly(PackedVector2Array([inner.position, inner.position + Vector2(14, 0), Vector2(inner.position.x + 14.0, inner.end.y - 6.0), Vector2(inner.position.x, inner.end.y - 6.0)]),
		PackedColorArray([Color(0, 0, 0, 0.28), Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(0, 0, 0, 0.28)]))
	_poly(PackedVector2Array([Vector2(inner.end.x - 18.0, top), Vector2(inner.end.x, top), Vector2(inner.end.x, inner.end.y - 6.0), Vector2(inner.end.x - 18.0, inner.end.y - 6.0)]),
		PackedColorArray([Color(0, 0, 0, 0), Color(0, 0, 0, 0.34), Color(0, 0, 0, 0.34), Color(0, 0, 0, 0)]))
	# ısı ışıltısı (yağın ortasında sıcak parıltı)
	if _glow > 0.02:
		_blob(Vector2(inner.get_center().x, top + 22.0), Vector2(inner.size.x * 0.45, 22.0), Color(1.0, 0.85, 0.45, 0.22 * _glow))
	# pencere yansıması (eğik açık şerit)
	var rx := inner.position.x + inner.size.x * 0.22
	_cpoly(PackedVector2Array([Vector2(rx, top + 2.0), Vector2(rx + 26.0, top + 2.0), Vector2(rx + 8.0, inner.end.y - 4.0), Vector2(rx - 14.0, inner.end.y - 4.0)]),
		Color(1, 0.98, 0.88, 0.07))
	# yüzeyde kayan ışıltılar
	var shimmer := 0.16 + 0.06 * clampf((logic.temp - 0.3) / 0.7, 0.0, 1.0)
	for k in 4:
		var yy := top + 10.0 + k * 13.0 + sin(_time * 1.3 + k) * 2.0
		if yy > inner.end.y - 6.0:
			continue
		var w := inner.size.x
		var xx := inner.position.x + fposmod(_time * 14.0 * (1.0 if k % 2 else -1.0) + k * 53.0, w)
		var rw := 22.0 - k * 3.0
		var x0 := maxf(inner.position.x + 4.0, xx - rw)
		var x1 := minf(inner.end.x - 4.0, xx + rw)
		if x1 - x0 > 4.0:
			Draw.ellipse(self, Vector2((x0 + x1) * 0.5, yy), (x1 - x0) * 0.5, 1.5, Color(1.0, 0.97, 0.82, shimmer))
	# yüzey çizgisi (menisküs)
	draw_rect(Rect2(inner.position.x, top, inner.size.x, 1.5), Color(1.0, 0.98, 0.86, 0.45))
	draw_rect(Rect2(inner.position.x, top + 1.5, inner.size.x, 2.0), Color(_shade(oc, -0.3), 0.35))


## Haznenin ön kenarı (sepetin önünde kalan ince parlak dudak)
func _draw_vat_front() -> void:
	var v := _vat
	draw_rect(Rect2(v.position.x + 10.0, v.end.y + 3.0, v.size.x - 20.0, 1.2), Color(1, 1, 1, 0.5))


## Patates çubukları (web drawFries): tohumla sabit dağılım, renk pişmeye göre
func _draw_fries(r: Rect2, cook: float, seed: int) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var col := _ramp(FRY_RAMP, cook)
	var dark := _shade(col, -0.4)
	var light := _shade(col, 0.35)
	for k in 22:
		var fx := r.position.x + 6.0 + rng.randf() * (r.size.x - 12.0)
		var fy := r.position.y + r.size.y * 0.3 + rng.randf() * r.size.y * 0.3
		var ln := r.size.y * (0.5 + rng.randf() * 0.25)
		var ang := (rng.randf() - 0.5) * 1.1
		var fw := 6.0 + rng.randf() * 1.8
		var tint := _shade(col, (rng.randf() - 0.5) * 0.14)
		draw_set_transform(Vector2(fx, fy), ang, Vector2.ONE)
		var stick := Rect2(-fw * 0.5, -ln * 0.5, fw, ln)
		_rr(Rect2(stick.position + Vector2(1.2, 1.2), stick.size), 2.0, Color(0, 0, 0, 0.25))
		_rr(stick, 2.0, tint)
		_rr_outline(stick, 2.0, Color(dark, 0.75), 0.8)
		draw_rect(Rect2(-fw * 0.5 + 1.0, -ln * 0.5 + 2.0, 1.2, ln - 4.0), Color(light, 0.55))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


## Tel sepet: iç, patates, ön tel örgü, çerçeve, yağa batma, sap, pişme halkası
func _draw_basket(i: int, hov: bool) -> void:
	var g: Dictionary = _bgeo[i]
	var b: Dictionary = logic.baskets[i]
	var t := clampf(float(b.down_t), 0.0, 1.0)
	var e := t * t * (3.0 - 2.0 * t)
	var by := _basket_y(i)
	var bx: float = g.x
	var bw: float = g.w
	var bh := BASKET_H
	var box := Rect2(bx, by, bw, bh)
	var oc := _oil_color()
	# yağ yüzeyine düşen gölge (sepet yukarıdayken)
	if e < 0.92:
		Draw.ellipse(self, Vector2(float(g.cx) + 6.0, _oil_y + 12.0), bw * 0.46, 6.0, Color(0, 0, 0, 0.3 * (1.0 - e)))
	# iç
	_rr(box, 4.0, Color(0.11, 0.11, 0.12, 0.55))
	var has: bool = logic.has_fries(i)
	if has:
		_draw_fries(Rect2(bx + 3.0, by - 4.0, bw - 6.0, bh + 2.0), logic.cook_of(i), int(b.seed))
	# ön tel örgü (çapraz)
	var mesh := Rect2(bx, by + BASKET_RIM * 0.6, bw, bh - BASKET_RIM * 0.6)
	var x := bx - bh
	while x < bx + bw + bh:
		for seg: PackedVector2Array in [_clip_seg(Vector2(x, by), Vector2(x + bh, by + bh), mesh), _clip_seg(Vector2(x + bh, by), Vector2(x, by + bh), mesh)]:
			if seg.size() == 2:
				draw_line(seg[0], seg[1], Color(0.84, 0.86, 0.88, 0.6), 0.9, true)
		x += 6.0
	# gövde çerçevesi + üst kasnak
	_rr_outline(box, 4.0, Color("#d6dbe0"), 2.2)
	_rr_outline(box.grow(-1.6), 3.0, Color(0, 0, 0, 0.25), 0.8)
	var rim := Rect2(bx - 1.0, by - 1.0, bw + 2.0, BASKET_RIM)
	_rr_outline(rim, 3.0, COL_HOVER if hov else Color("#f1f4f6"), 3.0 if hov else 2.5)
	draw_line(rim.position + Vector2(4, 1.5), Vector2(rim.end.x - 4.0, rim.position.y + 1.5), Color(1, 1, 1, 0.8), 1.0)
	# yağa batma: yağ sepetin içini örter
	if e > 0.02:
		var inner_l := _vat.position.x + 3.0
		var inner_r := _vat.end.x - 3.0
		var bottom := minf(by + bh + 4.0, _vat.end.y - 3.0)
		var x0 := maxf(inner_l, bx - 4.0)
		var x1 := minf(inner_r, bx + bw + 4.0)
		if bottom > _oil_y + 0.5:
			var a := 0.72 * smoothstep(0.0, 0.6, e)
			_poly(PackedVector2Array([Vector2(x0, _oil_y), Vector2(x1, _oil_y), Vector2(x1, bottom), Vector2(x0, bottom)]),
				PackedColorArray([Color(_shade(oc, 0.2), a), Color(_shade(oc, 0.1), a), Color(_shade(oc, -0.3), a), Color(_shade(oc, -0.3), a)]))
			draw_rect(Rect2(x0, _oil_y, x1 - x0, 1.4), Color(1.0, 0.98, 0.86, 0.35 * e))
	# sap (öne doğru uzanır) + bakalit tutamak
	var hy := by + bh
	var cx: float = g.cx
	draw_line(Vector2(cx + 1.5, hy - 5.0), Vector2(cx + 1.5, hy + 17.0), Color(0, 0, 0, 0.3), 3.0)
	draw_line(Vector2(cx, hy - 6.0), Vector2(cx, hy + 16.0), Color("#c4c9ce"), 3.0)
	draw_line(Vector2(cx - 0.7, hy - 6.0), Vector2(cx - 0.7, hy + 16.0), Color(1, 1, 1, 0.5), 1.0)
	_rr(Rect2(cx - 4.0, hy + 14.0, 12.0, 24.0), 5.0, Color(0, 0, 0, 0.3))
	Draw.rr_grad(self, Rect2(cx - 6.0, hy + 12.0, 12.0, 24.0), 5.0,
		[[0.0, Color("#4a3c28") if hov else Color("#3a3a40")], [0.5, Color("#2a2218") if hov else Color("#1c1c20")], [1.0, Color("#0e0e11")]],
		1.0, Vector2(0, 0), Vector2(1, 0))
	draw_rect(Rect2(cx - 3.0, hy + 15.0, 1.5, 17.0), Color(1, 1, 1, 0.25))
	if has:
		_draw_ring(Vector2(bx + bw - 2.0, by + 4.0), 9.0, logic.cook_of(i))
		if logic.oil_mult_of(i) < 1.0:
			draw_circle(Vector2(bx + bw - 2.0, by + 17.0), 3.0, Color("#8e5416"))


## İlerleme halkası: 1.0 = tam dolu; 1.2 üstünde turuncu/kırmızı ikinci tur (tost.gd ile aynı)
func _draw_ring(c: Vector2, r: float, v: float) -> void:
	draw_circle(c, r + 3.5, Color(0.063, 0.047, 0.078, 0.78))
	var lw := maxf(2.4, r * 0.3)
	draw_arc(c, r, 0.0, TAU, 40, Color(1, 1, 1, 0.13), lw, true)
	draw_arc(c, r, -PI * 0.5 + TAU * Recipes.COOK_GOOD, -PI * 0.5 + TAU, 12, Color(0.37, 0.88, 0.48, 0.28), lw, true)
	var f := clampf(v, 0.0, 1.0)
	if f > 0.01:
		var col := Color("#5fe07a") if v >= Recipes.COOK_GOOD else Color("#ffcf4a")
		draw_arc(c, r, -PI * 0.5, -PI * 0.5 + TAU * f, 40, col, lw, true)
	if v > Recipes.COOK_OVER:
		var o := clampf((v - Recipes.COOK_OVER) / (Recipes.COOK_BURNT - Recipes.COOK_OVER), 0.0, 1.0)
		var col2 := Color("#ff4a3a") if v >= Recipes.COOK_BURNT else Color("#ff9d2e")
		draw_arc(c, r, -PI * 0.5, -PI * 0.5 + TAU * o, 40, col2, lw, true)
	var iw := maxf(1.6, r * 0.18)
	var s := r * 0.42
	if v >= Recipes.COOK_BURNT:
		draw_line(c + Vector2(-s, -s), c + Vector2(s, s), Color("#ff6a5a"), iw, true)
		draw_line(c + Vector2(s, -s), c + Vector2(-s, s), Color("#ff6a5a"), iw, true)
	elif v >= Recipes.COOK_GOOD and v <= Recipes.COOK_OVER:
		draw_polyline(PackedVector2Array([c + Vector2(-s, 0), c + Vector2(-s * 0.25, s * 0.7), c + Vector2(s, -s * 0.7)]), Color("#8dff9a"), iw, true)


func _draw_led(c: Vector2, r: float, col: Color, on: bool) -> void:
	draw_circle(c, r + 1.4, Color("#17181b"))
	if on:
		_blob(c, Vector2(r * 4.5, r * 4.5), Color(col, 0.6))
		draw_circle(c, r, col.lightened(0.25))
	else:
		draw_circle(c, r, col.darkened(0.6))
	draw_circle(c - Vector2(r, r) * 0.35, r * 0.35, Color(1, 1, 1, 0.7))


## Kontrol paneli: termostat kadranı + lamba, yağ ömrü çubuğu, "Yağı Değiştir" düğmesi
func _draw_panel(running: bool, holding: bool) -> void:
	var p := _panel
	Draw.rr(self, p, 8.0, Color.TRANSPARENT, 0.0, Color.TRANSPARENT, 4.0, Color(0, 0, 0, 0.35), Vector2(1, 2))
	Draw.rr_grad(self, p, 8.0, [[0.0, Color("#3a3f46")], [1.0, Color("#202328")]])
	_rr_outline(p.grow(-0.5), 8.0, Color(1, 1, 1, 0.2))
	draw_rect(Rect2(p.position.x + 8.0, p.end.y - 1.5, p.size.x - 16.0, 1.0), Color(1, 1, 1, 0.12))
	for s: Vector2 in [p.position + Vector2(6, 6), Vector2(p.end.x - 6.0, p.position.y + 6.0), Vector2(p.position.x + 6.0, p.end.y - 6.0), p.end - Vector2(6, 6)]:
		draw_circle(s, 2.0, Color("#9aa0a7"))
		draw_line(s - Vector2(1.2, 1.2), s + Vector2(1.2, 1.2), Color("#5d636a"), 0.8)
	_draw_dial()
	var pw := Game.power_on()
	var ready: bool = running and pw and logic.temp > 0.85
	_draw_led(Vector2(p.position.x + 50.0, p.position.y + 9.0), 3.0, Color("#34e05a") if ready else Color("#ff3b30"), running and pw)
	# yağ ömrü çubuğu
	var gg := _gauge
	var oil: int = logic.oil_life
	var life := clampf(float(oil) / FryLogic.OIL_MAX, 0.0, 1.0)
	var old: bool = logic.is_oil_old()
	var font := Draw.font()
	Draw.text(self, "Yağ", Vector2(gg.position.x, gg.position.y - 7.0), 11, Color("#e8e2d4"), false)
	var txt := "%d/%d%s" % [oil, FryLogic.OIL_MAX, " eski!" if old else ""]
	var tcol := (Color("#ff8a6a") if sin(_time * 6.0) > 0.0 else Color("#ffd08a")) if old else Color("#c9c3b6")
	var tw := font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 10).x
	Draw.text(self, txt, Vector2(gg.end.x - tw, gg.position.y - 7.0), 10, tcol, false)
	_rr(gg, 3.5, Color("#121316"))
	if life > 0.0:
		var fill := Rect2(gg.position.x + 1.0, gg.position.y + 1.0, maxf(5.0, (gg.size.x - 2.0) * life), gg.size.y - 2.0)
		var oc := _oil_color()
		_rr(fill, 2.5, oc)
		draw_rect(Rect2(fill.position.x + 2.0, fill.position.y + 0.5, fill.size.x - 4.0, 1.2), Color(_shade(oc, 0.45), 0.8))
	# düğme
	var bt := _btn
	var hov := not holding and bt.has_point(_mouse)
	var stock := Game.inv_get("yag")
	Draw.rr(self, bt, 8.0, Color.TRANSPARENT, 0.0, Color.TRANSPARENT, 4.0, Color(0, 0, 0, 0.4), Vector2(0, 2))
	if old:
		Draw.rr_grad(self, bt, 8.0, [[0.0, Color("#ffb15a") if hov else Color("#ff9a3c")], [1.0, Color("#c4561d")]])
	else:
		Draw.rr_grad(self, bt, 8.0, [[0.0, Color("#8d96a1") if hov else Color("#737c87")], [1.0, Color("#4c535c")]])
	_rr_outline(bt.grow(-0.5), 8.0, Color(1, 1, 1, 0.35))
	var dc := Vector2(bt.position.x + 12.0, bt.get_center().y)
	_draw_drop(dc, Color("#ffd34d"))
	Draw.text(self, "Yağı Değiştir", Vector2(bt.position.x + 23.0, dc.y + 1.0), 12, Color(0, 0, 0, 0.3), false)
	Draw.text(self, "Yağı Değiştir", Vector2(bt.position.x + 22.0, dc.y), 12, Color.WHITE, false)
	var st := "×%d" % stock
	var sw := font.get_string_size(st, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
	Draw.text(self, st, Vector2(bt.end.x - 7.0 - sw, dc.y), 11, Color("#fff3c4") if stock > 0 else Color("#ffb0a0"), false)


## Termostat kadranı: ibre yağ sıcaklığını gösterir
func _draw_dial() -> void:
	var d := _dial
	var r := DIAL_R
	_blob(d + Vector2(2, 3), Vector2(r + 6.0, r + 6.0), Color(0, 0, 0, 0.45))
	Draw.ellipse_grad(self, d, r + 3.0, r + 3.0, Draw.grad([[0.0, Color("#f2f5f7")], [0.5, Color("#a6aeb6")], [1.0, Color("#5f666e")]], Vector2(0, 0), Vector2(1, 1)))
	Draw.ellipse(self, d, r, r, Color("#f4f1e8"))
	Draw.ellipse_line(self, d, r, r, Color(0, 0, 0, 0.25), 1.0)
	for k in 9:
		var a := -PI * 1.15 + k / 8.0 * PI * 1.3
		var col := Color("#d0392b") if k >= 6 else Color("#3a3f46")
		draw_line(d + Vector2(cos(a), sin(a)) * r * 0.72, d + Vector2(cos(a), sin(a)) * r * 0.92, col, 1.4, true)
	Draw.text(self, "°C", d + Vector2(0, 10.0), 8, Color("#59606a"))
	var na := -PI * 1.15 + clampf(logic.temp, 0.0, 1.0) * PI * 1.3 * (6.5 / 8.0)
	var tip := d + Vector2(cos(na), sin(na)) * r * 0.78
	draw_line(d + Vector2(1, 1.5), tip + Vector2(1, 1.5), Color(0, 0, 0, 0.25), 2.0, true)
	draw_line(d, tip, Color("#c0392b"), 2.0, true)
	draw_circle(d, 3.0, Color("#2b2e33"))
	draw_circle(d - Vector2(0.8, 0.8), 1.0, Color(1, 1, 1, 0.5))
	# cam parlaması
	Draw.ellipse(self, d + Vector2(-r * 0.3, -r * 0.45), r * 0.45, r * 0.18, Color(1, 1, 1, 0.25))


## Yağ damlası ikonu
func _draw_drop(c: Vector2, col: Color) -> void:
	var pts := PackedVector2Array()
	pts.append(c + Vector2(0, -7.5))
	for k in 13:
		var a := -0.35 + (PI + 0.7) * k / 12.0
		pts.append(c + Vector2(0, 2.0) + Vector2(cos(a), sin(a)) * 4.4)
	var sh := PackedVector2Array()
	for q in pts:
		sh.append(q + Vector2(0.8, 1.0))
	_cpoly(sh, Color(0, 0, 0, 0.3))
	_cpoly(pts, col)
	draw_circle(c + Vector2(-1.5, 1.0), 1.2, Color(1, 1, 1, 0.7))


## Elektrik yok rozeti (şimşek + yazı)
func _draw_no_power(c: Vector2) -> void:
	var text := "Elektrik yok"
	var tw := Draw.text_size(text, 12).x
	var box := Rect2(c.x - (tw + 30.0) * 0.5, c.y - 12.0, tw + 30.0, 24.0)
	var a := 0.75 + 0.25 * sin(_time * 5.0)
	_rr(box, 12.0, Color(0.55, 0.08, 0.06, 0.88 * a))
	_rr_outline(box.grow(-0.5), 12.0, Color(1, 0.8, 0.5, 0.5))
	var bc := box.position + Vector2(12.0, 12.0)
	_cpoly(PackedVector2Array([bc + Vector2(1.5, -7), bc + Vector2(-4, 1), bc + Vector2(0, 1), bc + Vector2(-1.5, 7), bc + Vector2(4, -1), bc + Vector2(0, -1)]), Color("#ffd34d"))
	Draw.text(self, text, Vector2(box.position.x + 21.0, c.y), 12, Color("#fff6e0"), false)


## İstasyon köşesindeki küçük etiket (tost.gd ile aynı biçim; ad geliştirme seviyesinden)
func _draw_label() -> void:
	var label := str(Game.upg_val("fritoz", "name", DEFAULT_LABEL))
	var size := 13
	var tw := _font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var pill := Rect2(_r.position.x + 8.0, _r.position.y + 6.0, tw + 30.0, 22.0)
	_rr(pill, 11.0, Color(0.11, 0.09, 0.13, 0.78))
	_rr_outline(pill.grow(-0.5), 11.0, Color(1, 1, 1, 0.12))
	draw_circle(pill.position + Vector2(11.0, 11.0), 3.5, Color("#ffa53a"))
	var base := pill.position + Vector2(21.0, 11.0 + size * 0.36)
	draw_string(_font, base, label, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color("#fff6e0"))
