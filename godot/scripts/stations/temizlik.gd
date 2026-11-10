extends Node2D
## Temizlik istasyonu: lavabo, askıdaki bez, kirlilik göstergesi ve tezgahtaki kir lekeleri
## (web js/stations_prep.js "6) TEMİZLİK", zone prep_bez / prep_lavabo / prep_temizlik, updateWipe, drawDirt).
##
## Kirlenme: dükkan açıkken her oyun saniyesi Game.add_dirt(0.05) (web'de bu da hazırlık modülündeydi, burada yapılır).
## Diğerleri: çöpe atma +0,3 (cop.gd); müşteriye servis +0,5 ve çiğ köfte yoğurma bitişi +0,5 kendi istasyonlarınca çağrılmalı.
## Lekeler Game.cleanliness eşiklerine göre (service_logic DIRT_T) sabit yerlerde belirir; bez eldeyken fare lekenin
## üzerinden geçtikçe Game.clean(...) çağrılır ve eşik geçilince leke kaybolur.
## Lekeler ve parıltılar diğer istasyonların üstünde görünsün diye z_index'li ayrı bir alt düğümde çizilir.
##
## Demo (yalnız ekran görüntüsü için): `-- --dirt-demo=40` → temizlik %40 (lekeler görünür);
## `--dirt-demo=40,yika` → ayrıca lavaboda el yıkama animasyonu; `--dirt-demo=40,bez` → bez askıda değil (elde).

const Service := preload("res://scripts/stations/service_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

## Drag bölge protokolü (web prep_temizlik z 5; bez z 7 ve lavabo z 6 alt bölgeleri pt ile ayrılır)
var zone_z: int = 5

const LABEL := "Temizlik"
const DIRT_Z := 20
const WASH_TIME := 1.6
const WASH_DECAY := 0.7
const SPARK_LIFE := 0.8
const BEZ_W := 52.0
const BEZ_H := 58.0
const COL_SKIN := Color("#f1c27d")

var _area: Rect2
var _g: Dictionary
var _bez_home := true
var _order: Array = Service.new_dirt_order()
var _last_wipe := Vector2.INF
var _wipe_fx_t := 0.0
var _wash := 0.0
var _time := 0.0
var _demo_hold := false
## Parıltılar: {pos, t, big}
var _sparks: Array[Dictionary] = []
var _dirt_node: Node2D
var _sparkle_tex: Texture2D
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_area = GameData.rect("temizlik")
	_g = Service.tz_geom(_area)
	_sparkle_tex = load("res://assets/icons/sparkle.png") as Texture2D
	_dirt_node = Node2D.new()
	_dirt_node.name = "Dirt"
	_dirt_node.z_index = DIRT_Z
	_dirt_node.draw.connect(_draw_dirt)
	add_child(_dirt_node)
	Drag.register(self)
	Game.cleanliness_changed.connect(func(_v: float) -> void: queue_redraw())
	_apply_demo_args()


func _exit_tree() -> void:
	Drag.unregister(self)


func _apply_demo_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--dirt-demo="):
			continue
		var parts := a.trim_prefix("--dirt-demo=").split(",")
		Game.clean(clampf(float(parts[0]), 0.0, 100.0) - Game.cleanliness)
		if parts.has("yika"):
			_wash = 1000.0
		if parts.has("bez"):
			_bez_home = false
			_demo_hold = true


# --- Bölge protokolü -------------------------------------------------------------

func zone_rect() -> Rect2:
	return _area


func pick(pt: Vector2) -> Dictionary:
	if not _bez_home or not (_g.bez as Rect2).has_point(pt):
		return {}
	_bez_home = false
	_last_wipe = Vector2.INF
	return {"uid": Items.uid(), "type": "tool", "id": "bez"}


func click(pt: Vector2) -> void:
	if not (_g.sink as Rect2).has_point(pt) or _wash > 0.2:
		return
	_wash = WASH_TIME
	var tp: Vector2 = _g.tap
	Game.float_text.emit(Vector2(tp.x - 30.0, tp.y + 6.0), "El yıkama", Color("#bfe6ff"))


func return_item(item: Dictionary) -> void:
	if Service.is_bez(item):
		_bez_home = true


func can_drop(item: Dictionary) -> bool:
	return Service.is_bez(item)


func drop(item: Dictionary, _pt: Vector2) -> bool:
	if not Service.is_bez(item):
		return false
	_bez_home = true
	return true


func hover_text(pt: Vector2) -> String:
	if (_g.bez as Rect2).has_point(pt):
		if _bez_home:
			return "Temizlik bezi\nAl ve lekelerin üzerinde gezdir"
	elif (_g.sink as Rect2).has_point(pt):
		return "Lavabo\nTıkla: el yıkama"
	return Service.temizlik_tooltip(Game.cleanliness)


# --- Güncelleme ------------------------------------------------------------------

func _process(dt: float) -> void:
	_time += dt
	var rd := minf(0.1, dt)
	var gdt := Game.game_dt(dt)
	if Game.phase == "open" and gdt > 0.0:
		Game.add_dirt(gdt * Service.DIRT_PER_SEC)
	var holding_bez := Service.is_bez(Drag.held)
	# bez kaybolduysa (ör. başka bir yere kabul edildiyse) askıya geri döner
	if not _bez_home and not holding_bez and not _demo_hold:
		_bez_home = true
	_update_wipe(holding_bez)
	if _wash > 0.0:
		_wash = maxf(0.0, _wash - rd * WASH_DECAY)
	for s: Dictionary in _sparks:
		s.t += rd
	_sparks = _sparks.filter(func(s: Dictionary) -> bool: return s.t < SPARK_LIFE)
	queue_redraw()
	_dirt_node.queue_redraw()


func _update_wipe(holding_bez: bool) -> void:
	if not holding_bez:
		_last_wipe = Vector2.INF
		return
	var p := get_viewport().get_mouse_position()
	if _last_wipe == Vector2.INF:
		_last_wipe = p
		return
	var before := Service.visible_dirt_count(Game.cleanliness)
	var res := Service.wipe(_order, Game.cleanliness, p, _last_wipe)
	_last_wipe = p
	if res.clean > 0.0:
		Game.clean(res.clean)
	if res.hit and _time - _wipe_fx_t > 0.12:
		_wipe_fx_t = _time
		_sparks.append({"pos": p + Vector2(_rng.randf_range(-10, 10), _rng.randf_range(-8, 8)), "t": 0.0, "big": false})
	var after := Service.visible_dirt_count(Game.cleanliness)
	for k in range(after, before):
		var sp: Dictionary = Service.DIRT_SPOTS[_order[k]]
		_sparks.append({"pos": sp.pos, "t": 0.0, "big": true})


# --- Çizim yardımcıları ---------------------------------------------------------------

func _cpoly(ci: CanvasItem, pts: PackedVector2Array, col: Color) -> void:
	if not Geometry2D.triangulate_polygon(pts).is_empty():
		ci.draw_colored_polygon(pts, col)


static func _rot_ellipse(c: Vector2, rx: float, ry: float, rot: float, n: int = 20) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for k in n:
		var a := TAU * k / n
		pts.append(c + Vector2(cos(a) * rx, sin(a) * ry).rotated(rot))
	return pts


static func _quad(p0: Vector2, p1: Vector2, p2: Vector2, f: float) -> Vector2:
	return p0.lerp(p1, f).lerp(p1.lerp(p2, f), f)


# --- Çizim: istasyon -----------------------------------------------------------------

func _draw() -> void:
	var L := _area
	_draw_tiles(L)
	_draw_sink()
	_draw_tap()
	if _wash > 0.0:
		_draw_wash()
	_draw_soap()
	_draw_bez_rail()
	_draw_gauge()
	Draw.station_label(self, L, LABEL)


func _draw_tiles(L: Rect2) -> void:
	var r := Rect2(L.position.x + 6, L.position.y + 6, L.size.x - 12, 122)
	Draw.rr_grad(self, r, 10, [[0.0, Color("#e8f3f6")], [1.0, Color("#cfe2e7")]])
	var line := Color(0.47, 0.63, 0.69, 0.35)
	var x := r.position.x + 22.0
	while x < r.end.x - 1.0:
		draw_line(Vector2(x, r.position.y + 1), Vector2(x, r.end.y - 1), line, 1.0)
		x += 22.0
	var y := r.position.y + 22.0
	while y < r.end.y - 1.0:
		draw_line(Vector2(r.position.x + 1, y), Vector2(r.end.x - 1, y), line, 1.0)
		y += 22.0
	# sol üstten ışık, alta doğru gölgelenme
	Draw.rr_grad(self, r, 10, [[0.0, Color(1, 1, 1, 0.25)], [0.4, Color(1, 1, 1, 0.0)], [1.0, Color(0, 0, 0, 0.12)]], 1.0, Vector2(0, 0), Vector2(1, 1))
	Draw.rr(self, r, 10, Color.TRANSPARENT, 1.0, Color(0.3, 0.38, 0.42, 0.35))


func _draw_sink() -> void:
	var sk: Rect2 = _g.sink
	var bs: Rect2 = _g.basin
	Draw.rr(self, Rect2(sk.position + Vector2(3, 5), sk.size), 12, Color(0, 0, 0, 0.0), 0.0, Color.TRANSPARENT,
		7.0, Color(0, 0, 0, 0.35), Vector2(2, 3))
	Draw.rr_grad(self, sk, 12, [[0.0, Color("#f4f7fa")], [1.0, Color("#a9b3bd")]])
	Draw.rr(self, sk, 12, Color.TRANSPARENT, 1.2, Color(0.24, 0.27, 0.32, 0.5))
	# çelik tekne: üstte koyu (iç duvar gölgesi), dipte açık
	Draw.rr_grad(self, bs, 14, [[0.0, Color("#5d6772")], [0.35, Color("#8e99a4")], [1.0, Color("#d3dae0")]])
	Draw.rr_grad(self, bs, 14, [[0.0, Color(0, 0, 0, 0.25)], [0.25, Color(0, 0, 0, 0.0)], [1.0, Color(0, 0, 0, 0.0)]], 1.0, Vector2(0, 0), Vector2(1, 0))
	# fırçalanmış çelik çizgileri
	for k in 6:
		var yy := bs.position.y + 18.0 + k * 9.0
		draw_line(Vector2(bs.position.x + 10, yy), Vector2(bs.end.x - 10, yy), Color(1, 1, 1, 0.06), 1.0)
	Draw.rr(self, bs.grow(-0.5), 14, Color.TRANSPARENT, 1.5, Color(1, 1, 1, 0.7))
	# gider
	var d := Vector2(bs.get_center().x, bs.end.y - 18.0)
	Draw.ellipse(self, d + Vector2(0, 1), 10.0, 5.0, Color(1, 1, 1, 0.35))
	Draw.ellipse(self, d, 8.0, 4.0, Color("#4a535d"))
	draw_line(d - Vector2(6, 0), d + Vector2(6, 0), Color("#a9b3bd"), 1.0)
	draw_line(d - Vector2(0, 3), d + Vector2(0, 3), Color("#a9b3bd"), 1.0)
	# ıslaklık
	if _wash > 0.0:
		Draw.ellipse(self, d + Vector2(0, -6), 26.0, 9.0, Color(0.6, 0.82, 1.0, 0.25 * clampf(_wash, 0.0, 1.0)))


func _draw_tap() -> void:
	var tp: Vector2 = _g.tap
	var pts := PackedVector2Array([tp + Vector2(0, 8), tp + Vector2(0, -10)])
	for k in range(1, 7):
		pts.append(_quad(tp + Vector2(0, -10), tp + Vector2(0, -20), tp + Vector2(-12, -20), k / 6.0))
	pts.append(tp + Vector2(-20, -20))
	for k in range(1, 7):
		pts.append(_quad(tp + Vector2(-20, -20), tp + Vector2(-28, -20), tp + Vector2(-28, -10), k / 6.0))
	# gölge, gövde, parlama
	var sh := PackedVector2Array()
	for p in pts:
		sh.append(p + Vector2(3, 4))
	draw_polyline(sh, Color(0, 0, 0, 0.18), 7.0, true)
	draw_polyline(pts, Color("#8d97a1"), 7.0, true)
	var hi := PackedVector2Array()
	for p in pts:
		hi.append(p + Vector2(-1.2, -1.2))
	draw_polyline(hi, Color("#eef2f5"), 3.0, true)
	draw_circle(tp + Vector2(0, 8), 4.0, Color("#7d8791"), true, -1.0, true)
	# ağız
	Draw.rr(self, Rect2(tp.x - 32, tp.y - 11, 8, 4), 2, Color("#5a636d"))
	# sıcak / soğuk kollar
	Draw.rr(self, Rect2(tp.x + 4, tp.y - 6, 12, 5), 2.5, Color("#d63a2a"), 0.0, Color.TRANSPARENT, 2.0, Color(0, 0, 0, 0.3), Vector2(1, 1))
	Draw.rr(self, Rect2(tp.x - 16, tp.y - 6, 12, 5), 2.5, Color("#2f6fd6"), 0.0, Color.TRANSPARENT, 2.0, Color(0, 0, 0, 0.3), Vector2(1, 1))


func _draw_wash() -> void:
	var tp: Vector2 = _g.tap
	var a := clampf(_wash, 0.0, 1.0)
	var wx := tp.x - 28.0
	# su akışı
	var left := PackedVector2Array()
	var right := PackedVector2Array()
	for k in 9:
		var y := tp.y - 8.0 + k * 6.0
		left.append(Vector2(wx - 2.5 + sin(_time * 30.0 + k) * 0.8, y))
		right.append(Vector2(wx + 2.5 + sin(_time * 30.0 + k + 1.5) * 0.8, y))
	right.reverse()
	_cpoly(self, left + right, Color(0.59, 0.82, 1.0, 0.55 * a))
	draw_line(Vector2(wx - 0.5, tp.y - 6), Vector2(wx - 0.5, tp.y + 38), Color(1, 1, 1, 0.45 * a), 1.0)
	# köpükler
	var rng := RandomNumberGenerator.new()
	rng.seed = int(floor(_time * 8.0))
	for k in 7:
		var c := Vector2(wx + (rng.randf() - 0.5) * 50.0, tp.y + 36.0 + (rng.randf() - 0.5) * 18.0)
		draw_circle(c, 2.0 + rng.randf() * 3.5, Color(1, 1, 1, 0.75 * a), true, -1.0, true)
	# eller (ovuşturma)
	var hx := wx + sin(_time * 12.0) * 6.0
	var skin := Color(COL_SKIN, a)
	_cpoly(self, _rot_ellipse(Vector2(hx - 9, tp.y + 34), 9, 6, 0.4), skin)
	_cpoly(self, _rot_ellipse(Vector2(hx + 9, tp.y + 34), 9, 6, -0.4), skin)
	draw_circle(Vector2(hx - 2, tp.y + 31), 3.0, Color(1, 1, 1, 0.8 * a), true, -1.0, true)


func _draw_soap() -> void:
	var sk: Rect2 = _g.sink
	var r := Rect2(sk.end.x - 22, sk.end.y - 34, 14, 26)
	Draw.rr(self, Rect2(r.position + Vector2(2, 3), r.size), 4, Color(0, 0, 0, 0.25))
	Draw.rr_grad(self, r, 4, [[0.0, Color("#7fe08f")], [1.0, Color("#2a9c48")]])
	Draw.rr_grad(self, r, 4, [[0.0, Color(1, 1, 1, 0.4)], [0.35, Color(1, 1, 1, 0.0)], [1.0, Color(0, 0, 0, 0.15)]], 1.0, Vector2(0, 0), Vector2(1, 0))
	draw_rect(Rect2(sk.end.x - 18, sk.end.y - 40, 6, 7), Color("#e9edf1"))
	draw_rect(Rect2(sk.end.x - 18, sk.end.y - 42, 9, 3), Color("#c9d0d7"))


func _draw_bez_rail() -> void:
	var bz: Rect2 = _g.bez
	var rail := Rect2(bz.position.x + 6, bz.position.y + 2, bz.size.x - 12, 6)
	Draw.rr(self, Rect2(rail.position + Vector2(2, 3), rail.size), 3, Color(0, 0, 0, 0.2))
	Draw.rr_grad(self, rail, 3, [[0.0, Color("#f4f7fa")], [1.0, Color("#8d97a1")]])
	if _bez_home:
		var hov := not Drag.is_holding() and bz.has_point(get_viewport().get_mouse_position())
		var c := Vector2(bz.get_center().x, bz.position.y + 40.0 - (2.0 if hov else 0.0))
		_draw_bez(c, hov)
		if hov:
			Draw.rr(self, Rect2(bz.position.x + 4, bz.position.y + 6, bz.size.x - 8, bz.size.y - 6), 8, Color.TRANSPARENT, 2.0, Color(1, 1, 1, 0.7))
	else:
		var r := Rect2(bz.position.x + 12, bz.position.y + 12, bz.size.x - 24, bz.size.y - 22)
		var pts := Draw.rr_points(r, 6)
		pts.append(pts[0])
		for i in pts.size() - 1:
			draw_dashed_line(pts[i], pts[i + 1], Color(0.24, 0.27, 0.32, 0.45), 1.5, 4.0)
		Draw.text(self, "Bez", r.get_center(), 12, Color(0.24, 0.27, 0.32, 0.6))


## Askıdaki sarı mikrofiber bez (web drawBezShape, hang = true)
func _draw_bez(c: Vector2, _hov: bool) -> void:
	var w := BEZ_W
	var h := BEZ_H
	var pts := PackedVector2Array()
	var tl := c + Vector2(-w * 0.5, -h * 0.5 + 4)
	var tr := c + Vector2(w * 0.5, -h * 0.5 + 4)
	for k in 9:
		pts.append(_quad(tl, c + Vector2(0, -h * 0.5 - 2), tr, k / 8.0))
	pts.append(c + Vector2(w * 0.5, h * 0.5 - 4))
	# dalgalı alt kenar
	var prev := c + Vector2(w * 0.5, h * 0.5 - 4)
	for k in 5:
		var ctrl := c + Vector2(w * 0.5 - (k + 0.5) * w / 5.0, h * 0.5 + (3.0 if k % 2 == 1 else -2.0))
		var to := c + Vector2(w * 0.5 - (k + 1) * w / 5.0, h * 0.5 - 2.0)
		for j in range(1, 5):
			pts.append(_quad(prev, ctrl, to, j / 4.0))
		prev = to
	# gölge (sağ alta)
	var sh := PackedVector2Array()
	for p in pts:
		sh.append(p + Vector2(3, 4))
	_cpoly(self, sh, Color(0, 0, 0, 0.25))
	if not Geometry2D.triangulate_polygon(pts).is_empty():
		var bbox := Rect2(c - Vector2(w, h) * 0.5 - Vector2(0, 2), Vector2(w, h + 6))
		Draw.fill_grad(self, pts, bbox, Draw.grad([[0.0, Color("#e2b52c")], [0.5, Color("#ffd84d")], [1.0, Color("#d9a822")]], Vector2(0, 0), Vector2(1, 0)))
	var outl := pts.duplicate()
	outl.append(pts[0])
	draw_polyline(outl, Color(0.55, 0.39, 0.04, 0.6), 1.2, true)
	# mavi dikiş
	var st := Draw.rr_points(Rect2(c.x - w * 0.5 + 5, c.y - h * 0.5 + 6, w - 10, h - 13), 4)
	st.append(st[0])
	for i in st.size() - 1:
		draw_dashed_line(st[i], st[i + 1], Color("#2f6fd6"), 1.4, 3.0)
	# kıvrımlar
	var fold := Color(0.63, 0.43, 0.04, 0.4)
	var f1 := PackedVector2Array()
	var f2 := PackedVector2Array()
	for k in 7:
		var f := k / 6.0
		f1.append(_quad(c + Vector2(-w / 4.0, -h * 0.5 + 8), c + Vector2(-w / 6.0, 0), c + Vector2(-w / 4.0, h * 0.5 - 6), f))
		f2.append(_quad(c + Vector2(w / 5.0, -h * 0.5 + 8), c + Vector2(w / 4.0, 0), c + Vector2(w / 6.0, h * 0.5 - 6), f))
	draw_polyline(f1, fold, 1.5, true)
	draw_polyline(f2, fold, 1.5, true)
	# mikrofiber dokusu
	for i in range(-2, 3):
		for j in range(-2, 3):
			draw_circle(c + Vector2(i * 8.0, j * h / 6.0), 1.0, Color(1, 1, 1, 0.18))
	# sol üstten parlama
	_cpoly(self, PackedVector2Array([c + Vector2(-w * 0.5 + 3, -h * 0.5 + 6), c + Vector2(-w * 0.5 + 14, -h * 0.5 + 4),
		c + Vector2(-w * 0.5 + 6, h * 0.5 - 8), c + Vector2(-w * 0.5 + 2, h * 0.5 - 8)]), Color(1, 1, 1, 0.16))


func _draw_gauge() -> void:
	var g: Rect2 = _g.gauge
	var c := clampf(Game.cleanliness, 0.0, 100.0)
	var col := Service.clean_color(c)
	Draw.rr(self, g, 12, Color(0.08, 0.1, 0.13, 0.85), 1.0, Color(1, 1, 1, 0.08), 6.0, Color(0, 0, 0, 0.3), Vector2(1, 3))
	Draw.rr_grad(self, g.grow(-1), 11, [[0.0, Color(1, 1, 1, 0.08)], [0.5, Color(1, 1, 1, 0.0)]])
	# parıltı yıldızı
	var sc := 1.0 + (0.1 * sin(_time * 4.0) if c >= 70.0 else 0.0)
	var star := PackedVector2Array()
	for k in 8:
		var a := k * PI / 4.0
		var r := (3.5 if k % 2 == 1 else 10.0) * sc
		star.append(g.position + Vector2(18, 24) + Vector2(cos(a), sin(a)) * r)
	_cpoly(self, star, col)
	Draw.text(self, "Temizlik", Vector2(g.position.x + 34, g.position.y + 13), 12, Color("#e8e4f0"), false)
	var pct := "%" + str(roundi(c))
	Draw.text(self, pct, Vector2(g.end.x - 10 - Draw.text_size(pct, 13).x, g.position.y + 13), 13, col, false)
	var bar := Rect2(g.position.x + 34, g.position.y + 25, g.size.x - 44, 13)
	Draw.rr(self, bar, 6.5, Color(1, 1, 1, 0.1))
	var fw := bar.size.x * c / 100.0
	if fw > 2.0:
		var fill := Rect2(bar.position, Vector2(maxf(fw, 13.0), bar.size.y))
		var tex := Draw.grad([[0.0, Color("#ff5a4f")], [0.4, Color("#ffc93c")], [0.75, Color("#43d17a")], [1.0, Color("#5fe0b0")]], Vector2(0, 0), Vector2(1, 0))
		Draw.fill_grad(self, Draw.rr_points(fill, 6.5), bar, tex)
		Draw.rr_grad(self, fill, 6.5, [[0.0, Color(1, 1, 1, 0.3)], [0.45, Color(1, 1, 1, 0.0)], [1.0, Color(0, 0, 0, 0.12)]])
		# köpük kabarcıkları
		for k in 6:
			var bx := bar.position.x + fmod(k * 37.0 + _time * 18.0, maxf(1.0, fw - 4.0)) + 2.0
			draw_circle(Vector2(bx, bar.position.y + 4.0 + (k % 2) * 4.0), 2.0 + (k % 3), Color(1, 1, 1, 0.35), true, -1.0, true)
	if c < 40.0:
		var p := 0.5 + 0.5 * sin(_time * 6.0)
		Draw.rr(self, g, 12, Color.TRANSPARENT, 2.0, Color(1.0, 0.35, 0.31, 0.4 + 0.5 * p))
		Draw.text(self, "Kirli! Bezle sil", Vector2(g.get_center().x + 14, g.position.y + 13), 10, Color("#ffb0a8"))


# --- Çizim: kir lekeleri (üst katman) ---------------------------------------------------

func _draw_dirt() -> void:
	var ci := _dirt_node
	for v: Dictionary in Service.visible_spots(Game.cleanliness, _order):
		_draw_spot(ci, v.spot, v.alpha)
	for s: Dictionary in _sparks:
		var f := clampf(s.t / SPARK_LIFE, 0.0, 1.0)
		var size := (30.0 if s.big else 14.0) * (0.6 + 0.6 * sin(f * PI))
		var pos: Vector2 = s.pos + Vector2(0, -f * (26.0 if s.big else 10.0))
		var a := 1.0 - f
		if s.big:
			ci.draw_circle(s.pos, 10.0 + f * 26.0, Color(0.75, 0.95, 1.0, 0.5 * a), false, 2.0, true)
		if _sparkle_tex != null:
			ci.draw_texture_rect(_sparkle_tex, Rect2(pos - Vector2(size, size) * 0.5, Vector2(size, size)), false, Color(1, 1, 1, a))


func _draw_spot(ci: CanvasItem, sp: Dictionary, alpha: float) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = int(sp.seed)
	var c: Vector2 = sp.pos
	var r: float = sp.r
	match String(sp.type):
		"stain":
			for k in 3:
				var off := Vector2((rng.randf() - 0.5) * r * 0.6, (rng.randf() - 0.5) * r * 0.5)
				var col := Color(0.45, 0.31, 0.16, (0.28 + rng.randf() * 0.15) * alpha)
				var rx := r * (0.55 + rng.randf() * 0.4)
				var ry := r * (0.4 + rng.randf() * 0.3)
				_cpoly(ci, _rot_ellipse(c + off, rx, ry, rng.randf() * 3.0), col)
			var arc := PackedVector2Array()
			var rot := rng.randf()
			for k in 13:
				var a := 0.3 + (PI * 1.7 - 0.3) * k / 12.0
				arc.append(c + Vector2(cos(a) * r * 0.8, sin(a) * r * 0.6).rotated(rot))
			ci.draw_polyline(arc, Color(0.33, 0.22, 0.1, 0.45 * alpha), 1.6, true)
		"sauce":
			var red := Color(0.67, 0.13, 0.08, 0.85 * alpha)
			_cpoly(ci, _rot_ellipse(c, r * 0.55, r * 0.42, rng.randf()), red)
			for k in 5:
				var a := rng.randf() * TAU
				var d := r * (0.6 + rng.randf() * 0.4)
				ci.draw_circle(c + Vector2(cos(a) * d, sin(a) * d * 0.7), 1.2 + rng.randf() * 2.2, red, true, -1.0, true)
			_cpoly(ci, _rot_ellipse(c - Vector2(r * 0.2, r * 0.15), r * 0.18, r * 0.08, -0.4, 12), Color(1.0, 0.78, 0.75, 0.55 * alpha))
		"crumbs":
			for k in 16:
				var a := rng.randf() * TAU
				var d := r * sqrt(rng.randf())
				var col := Color(0.78, 0.59, 0.31, 0.9 * alpha) if rng.randf() < 0.5 else Color(0.59, 0.39, 0.2, 0.9 * alpha)
				var p := c + Vector2(cos(a) * d, sin(a) * d * 0.7)
				var rot := rng.randf() * 3.0
				var s := 1.2 + rng.randf() * 2.3
				var q := PackedVector2Array([Vector2(-s, -s * 0.5), Vector2(s * 0.8, -s), Vector2(s, s * 0.6), Vector2(-s * 0.4, s)])
				for i in q.size():
					q[i] = p + q[i].rotated(rot)
				_cpoly(ci, q, col)
				# kırıntının küçük gölgesi
				ci.draw_circle(p + Vector2(1, 1.5), s * 0.5, Color(0, 0, 0, 0.12 * alpha))
		_:
			# yağ lekesi
			_cpoly(ci, _rot_ellipse(c, r * 0.95, r * 0.6, rng.randf(), 24), Color(0.84, 0.67, 0.24, 0.32 * alpha))
			_cpoly(ci, _rot_ellipse(c + Vector2(r * 0.3, r * 0.2), r * 0.5, r * 0.35, rng.randf()), Color(0.84, 0.67, 0.24, 0.25 * alpha))
			var arc := PackedVector2Array()
			for k in 7:
				var a := PI * 1.1 + PI * 0.5 * k / 6.0
				arc.append(c + Vector2(-r * 0.1, -r * 0.05) + Vector2(cos(a) * r * 0.5, sin(a) * r * 0.25).rotated(-0.2))
			ci.draw_polyline(arc, Color(1, 1, 1, 0.6 * alpha), 1.4, true)
