extends Node2D
## Çiğ köfte leğeni (web js/stations_prep.js "3) ÇİĞ KÖFTE LEĞENİ": prep_yogurma + prep_yogurma_<hammadde> bölgeleri).
## Sağdaki paketlere tıklayınca bulgur / isot / salça envanterden leğene girer; sonra leğenin içinde fareyle
## basılı tutup sürükleyerek (ya da hızlı tıklayarak) yoğrulur. Bitince bir parti (batch) porsiyon çiğ köfte olur;
## leğenden sürüklenen her porsiyon Items.ing("cigkofte", {"q": q}) item'ıdır.
## Saf mantık yogurma_logic.gd'de; bu script çizim, girdi, efekt ve Drag bölge protokolünü üstlenir.
##
## Drag protokolünde basılı sürükleme olayı yok: yoğurma hareketi _input() ile dinlenir (olay tüketilmez).
##
## Demo kipi (ekran görüntüsü için): `-- --yogurma-demo=0.6` → malzemeler eklenmiş, %60 yoğrulmuş;
## `--yogurma-demo=done` → porsiyonlar hazır; `--yogurma-demo=0` → malzemeler eklenmiş, yoğrulmamış.
## Demo kipinde tarif kilidi yok sayılır.

const YogLogic := preload("res://scripts/stations/yogurma_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

## Drag önceliği (web prep_yogurma z:5, paketler z:6)
var zone_z: int = 5
const PACKET_Z := 6

const RECIPE_ID := "cigkofte_durum"
const STATION_ID := "yogurma"
## Basılıyken bu kadar sürüklenen hareket tıklama sayılmaz
const CLICK_TRAVEL := 8.0
const GRAVITY := 420.0
const RAW_COLOR := {"bulgur": Color("#d3ac68"), "isot": Color("#8a2414"), "salca": Color("#c22e1c")}
const COL_DOUGH_RAW := Color("#cfa868")
const COL_DOUGH := Color("#8c2a1a")
const COL_GOLD := Color("#ffd23f")
const COL_STATUS := {"done": Color("#bfffd0"), "knead": Color("#ffd23f"), "add": Color("#ffe9c2")}
## Leğen tonları (seviye 0 alüminyum, 1 dövme bakır, 2 makine çeliği) — soldan sağa yatay gradyan
const BOWL_TONES := [
	[Color("#5f6873"), Color("#aeb6bf"), Color("#eef2f5"), Color("#98a1aa"), Color("#545c66")],
	[Color("#6b3013"), Color("#c46d39"), Color("#f2b07a"), Color("#b35b28"), Color("#5c2810")],
	[Color("#56606b"), Color("#b8c2cc"), Color("#f4f7fa"), Color("#a3adb7"), Color("#4c5560")],
]
const WOOD := [[0.0, Color("#d9a86c")], [0.5, Color("#c08a4f")], [1.0, Color("#a06c38")]]
## Gün sonu bildirimi bu fazda
const DAY_END_PHASE := "summary"


## Hammadde paketi bölgesi: tıklama leğene ekler.
class PacketZone:
	extends Node
	var zone_z: int = 6
	var raw_id: String = ""
	var station: Node2D

	func _ready() -> void:
		Drag.register(self)

	func _exit_tree() -> void:
		Drag.unregister(self)

	func zone_rect() -> Rect2:
		return station.call("packet_rect", YogLogic.RAW.find(raw_id))

	func click(_pt: Vector2) -> void:
		station.call("add_raw", raw_id)

	func hover_text(_pt: Vector2) -> String:
		return station.call("packet_tooltip", raw_id)


var logic: YogLogic = YogLogic.new()
var _demo_unlock := false
var _r: Rect2
var _time := 0.0
var _mouse := Vector2(-1000, -1000)
var _bump := {}  # paket id -> zaman

# yoğurma girdisi
var _knead_active := false
var _last_pt := Vector2.INF
var _travel := 0.0
var _crumb_acc := 0.0

# basit parçacıklar: {p, v, life, max, col, r}
var _parts: Array[Dictionary] = []
var _rng := RandomNumberGenerator.new()
var _shade_tex: GradientTexture2D


func _ready() -> void:
	_r = GameData.rect(STATION_ID)
	_rng.seed = 2207
	_shade_tex = Draw.grad([[0.0, Color(1, 1, 1)], [0.55, Color(0.86, 0.86, 0.86)], [1.0, Color(0.58, 0.58, 0.58)]], Vector2(0.38, 0.3), Vector2(1.0, 0.9), true)
	for id in YogLogic.RAW:
		var z := PacketZone.new()
		z.raw_id = id
		z.zone_z = PACKET_Z
		z.station = self
		z.name = "Paket_" + id
		add_child(z)
	Drag.register(self)
	Game.phase_changed.connect(_on_phase)
	_sync_upgrades()
	_apply_demo_args()


func _exit_tree() -> void:
	Drag.unregister(self)


func _sync_upgrades() -> void:
	logic.batch = int(Game.upg_val(STATION_ID, "batch", YogLogic.DEFAULT_BATCH))
	logic.effort = float(Game.upg_val(STATION_ID, "effort", 1.0))
	logic.unlocked = _demo_unlock or Game.is_recipe_unlocked(RECIPE_ID)


func _apply_demo_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--yogurma-demo"):
			continue
		var v := a.trim_prefix("--yogurma-demo").trim_prefix("=")
		_demo_unlock = true
		_sync_upgrades()
		for k in YogLogic.RAW:
			logic.mark_added(k)
		if v == "done":
			logic.knead(1.0 * maxf(YogLogic.MIN_EFFORT, logic.effort))
			logic.flash = 0.0
		elif v != "":
			var p := clampf(float(v), 0.0, 0.99)
			logic.progress = p
			logic.phase = p * 40.0


# --- Geometri (web basin / yogMainRect / packetRect / progressRect) -----------------

func main_rect() -> Rect2:
	return Rect2(_r.position.x + 4, _r.position.y + 28, 162, _r.size.y - 32)


func packet_rect(k: int) -> Rect2:
	return Rect2(_r.position.x + 170, _r.position.y + 32 + k * 50, 44, 48)


func _progress_rect() -> Rect2:
	return Rect2(_r.position.x + 12, _r.position.y + 168, 150, 13)


## Leğen: ağız elipsinin merkezi, yarıçapları ve derinliği
func _basin() -> Dictionary:
	return {"c": Vector2(_r.position.x + 86, _r.position.y + 112), "rx": 72.0, "ry": 24.0, "depth": 42.0}


# --- Drag bölge protokolü (ana leğen) ------------------------------------------------

func zone_rect() -> Rect2:
	return main_rect()


func pick(_pt: Vector2) -> Dictionary:
	return logic.take()


func return_item(item: Dictionary) -> void:
	if item.get("id", "") == "cigkofte":
		logic.put_back(item)


func can_drop(item: Dictionary) -> bool:
	return logic.can_accept(item)


func drop(item: Dictionary, _pt: Vector2) -> bool:
	if not logic.can_accept(item):
		return false
	logic.put_back(item)
	return true


func click(_pt: Vector2) -> void:
	if _travel > CLICK_TRAVEL:
		return  # basılı sürükleyerek yoğruldu; bırakma tıklama sayılmaz
	var b := _basin()
	var c: Vector2 = b.c
	if not logic.unlocked:
		_say(c + Vector2(0, -30), "Seviye 3'te açılır", Game.COLOR_BAD)
		return
	if logic.portions > 0:
		return
	if not logic.all_added():
		_say(c + Vector2(0, -40), "Önce bulgur, isot, salça!", Game.COLOR_INFO)
		return
	_after_knead(logic.knead_click(), c + Vector2(_rng.randf_range(-30, 30), -4))
	_burst(c + Vector2(0, -4), _dough_color(), 4, 0.5)


func hover_text(_pt: Vector2) -> String:
	return logic.tooltip()


# --- Paketler ----------------------------------------------------------------------

func add_raw(id: String) -> void:
	var pr := packet_rect(YogLogic.RAW.find(id))
	var top := Vector2(pr.get_center().x, pr.position.y)
	var msg := logic.check_add(id)
	if msg != "":
		_say(top + Vector2(-40, 0), msg, Game.COLOR_INFO if msg == "Zaten eklendi" else Game.COLOR_BAD)
		return
	if not Game.inv_take(id):
		_say(top + Vector2(-40, 10), "%s yok!" % YogLogic.RAW_LABEL[id], Game.COLOR_BAD)
		Game.notify("%s kalmadı! Toptancıdan sipariş et." % _ing_name(id), "warn")
		return
	var ready := logic.mark_added(id)
	_bump[id] = _time
	var c: Vector2 = _basin().c
	_burst(c + Vector2(0, -6), RAW_COLOR[id], 10, 0.8)
	if ready:
		_say(c + Vector2(0, -50), "Yoğur!", COL_GOLD)


func packet_tooltip(id: String) -> String:
	return logic.packet_tooltip(id, _ing_name(id), Game.inv_get(id))


func _ing_name(id: String) -> String:
	return String(Recipes.data().get("ingredients", {}).get(id, {}).get("name", YogLogic.RAW_LABEL.get(id, id)))


# --- Yoğurma girdisi -------------------------------------------------------------------

## Fare basılı + hareket: leğenin içinde sürükledikçe yoğrulur (web onDrag). Olay tüketilmez;
## Drag basışı ayrıca görür (pick {} döner, bırakınca click gelir — _travel ile elenir).
func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		var mb := event as InputEventMouseButton
		if mb.pressed:
			_travel = 0.0
			_knead_active = not Drag.is_holding() and logic.can_knead() and main_rect().has_point(mb.position)
			_last_pt = mb.position if _knead_active else Vector2.INF
		else:
			_knead_active = false
			_last_pt = Vector2.INF
		return
	if not (event is InputEventMouseMotion) or not _knead_active:
		return
	var mm := event as InputEventMouseMotion
	if (mm.button_mask & MOUSE_BUTTON_MASK_LEFT) == 0 or Drag.is_holding() or not logic.can_knead():
		_knead_active = false
		return
	if not main_rect().has_point(mm.position):
		_last_pt = Vector2.INF
		return
	if _last_pt != Vector2.INF:
		var d := _last_pt.distance_to(mm.position)
		_travel += d
		_after_knead(logic.knead_drag(_last_pt, mm.position), mm.position)
		_crumb_acc += d
		if _crumb_acc > 26.0:
			_crumb_acc = 0.0
			_burst(_basin().c + Vector2(_rng.randf_range(-36, 36), _rng.randf_range(-4, 6)), _dough_color(), 2, 0.45)
	_last_pt = mm.position


func _after_knead(done: bool, _pos: Vector2) -> void:
	if not done:
		return
	var c: Vector2 = _basin().c
	_burst(c + Vector2(0, -10), COL_GOLD, 16, 1.0)
	_say(c + Vector2(0, -56), "Çiğ köfte hazır! ×%d" % logic.portions, Game.COLOR_MONEY)
	Game.add_dirt(YogLogic.DIRT_ON_FINISH)


func _say(pos: Vector2, text: String, col: Color) -> void:
	Game.float_text.emit(pos, text, col)


func _on_phase(p: String) -> void:
	if p != DAY_END_PHASE:
		return
	var n := logic.day_end()
	if n > 0:
		Game.notify("Gün sonu: %d porsiyon çiğ köfte bozuldu." % n, "warn")


# --- Güncelleme ve parçacıklar ----------------------------------------------------------

func _process(dt: float) -> void:
	_time += dt
	_mouse = get_viewport().get_mouse_position()
	_sync_upgrades()
	logic.tick(dt)
	var rd := minf(dt, 0.1)
	for i in range(_parts.size() - 1, -1, -1):
		var p := _parts[i]
		p.life = float(p.life) - rd
		if p.life <= 0.0:
			_parts.remove_at(i)
			continue
		p.v = (p.v as Vector2) + Vector2(0, GRAVITY * rd)
		p.p = (p.p as Vector2) + (p.v as Vector2) * rd
	queue_redraw()


func _burst(at: Vector2, col: Color, n: int, power: float) -> void:
	for k in n:
		var a := _rng.randf_range(-PI * 0.85, -PI * 0.15)
		var sp := _rng.randf_range(60.0, 170.0) * power
		var life := _rng.randf_range(0.35, 0.7)
		_parts.append({"p": at + Vector2(_rng.randf_range(-8, 8), 0), "v": Vector2(cos(a), sin(a)) * sp,
			"life": life, "max": life, "col": col.lightened(_rng.randf_range(-0.15, 0.2)), "r": _rng.randf_range(1.2, 2.6)})


func _dough_color() -> Color:
	var p := logic.progress
	return COL_DOUGH_RAW.lerp(COL_DOUGH, p * p * (3.0 - 2.0 * p))


# --- Çizim -------------------------------------------------------------------------------

func _draw() -> void:
	var b := _basin()
	var c: Vector2 = b.c
	var rx: float = b.rx
	var depth: float = b.depth
	var lv := clampi(Game.upg(STATION_ID), 0, 2)
	# sağdaki paket rafı (gömme oyuk)
	var shelf := Rect2(_r.position.x + 166, _r.position.y + 26, 52, 162)
	Draw.rr_grad(self, shelf, 10, [[0.0, Color(0.1, 0.12, 0.15, 0.32)], [1.0, Color(0.1, 0.12, 0.15, 0.14)]])
	Draw.rr(self, shelf, 10, Color.TRANSPARENT, 1.0, Color(1, 1, 1, 0.18))
	_draw_board(Rect2(_r.position.x + 10, _r.position.y + 96, 152, 64))
	# leğenin tahtaya düşen gölgesi (ışık sol üstten)
	Draw.ellipse_shadow(self, c + Vector2(6, depth + 3), rx * 0.82, 8.0, Color(0.2, 0.09, 0.02, 0.45), 7.0)
	if lv >= 2:
		_draw_mixer(b, false)
	# yoğururken hafif ezilme + sallanma (taban noktası etrafında)
	var sq := logic.squish
	var pivot := c + Vector2(0, depth)
	var rot := sin(logic.phase * 0.9) * 0.03 * sq
	var xf := Transform2D(rot, Vector2(1.0 + 0.03 * sq, 1.0 - 0.04 * sq), 0.0, pivot) * Transform2D(0.0, -pivot)
	draw_set_transform_matrix(xf)
	_draw_bowl_body(b, lv)
	_draw_contents(b)
	# ön ağız parlaması
	Draw.ellipse_line(self, c, rx - 2.5, b.ry - 1.5, Color(1, 1, 1, 0.45), 2.5, PI * 0.08, PI * 0.92)
	if logic.flash > 0.0:
		Draw.ellipse(self, c, rx + 6, b.ry + 10, Color(1.0, 0.94, 0.67, logic.flash * 0.45))
	draw_set_transform_matrix(Transform2D.IDENTITY)
	if lv >= 2:
		_draw_mixer(b, true)
	for p in _parts:
		var col: Color = p.col
		col.a = clampf(float(p.life) / float(p.max) * 1.4, 0.0, 1.0)
		draw_circle(p.p, p.r, col, true, -1.0, true)
	for k in YogLogic.RAW.size():
		_draw_packet(k, YogLogic.RAW[k])
	_draw_progress()
	_draw_status(c)
	Draw.station_label(self, _r, String(Game.upg_val(STATION_ID, "name", "Çiğ Köfte Leğeni")))
	if not logic.unlocked:
		_draw_lock()


## Ahşap altlık: leğen üstünde durur (web woodPanel).
func _draw_board(r: Rect2) -> void:
	Draw.rr(self, r, 12, Color("#7a4d26"), 0.0, Color.TRANSPARENT, 8.0, Color(0, 0, 0, 0.4), Vector2(3, 4))
	Draw.rr_grad(self, r, 12, WOOD)
	Draw.rr_grad(self, r, 12, [[0.0, Color(1.0, 0.92, 0.76, 0.3)], [0.55, Color(1.0, 0.92, 0.76, 0.0)], [1.0, Color(0.3, 0.16, 0.06, 0.2)]], 1.0, Vector2(0, 0), Vector2(1, 1))
	var rng := RandomNumberGenerator.new()
	rng.seed = 5151
	for k in 6:
		var yy := r.position.y + 8 + rng.randf() * (r.size.y - 16)
		var pts := PackedVector2Array()
		var amp := (rng.randf() - 0.5) * 6.0
		var ph := rng.randf() * TAU
		for s in 11:
			var t := s / 10.0
			pts.append(Vector2(r.position.x + 6 + t * (r.size.x - 12), yy + sin(t * 3.0 + ph) * amp))
		draw_polyline(pts, Color(0.43, 0.24, 0.1, 0.22), 1.0, true)
	Draw.rr(self, r, 12, Color.TRANSPARENT, 1.5, Color(0.27, 0.15, 0.055, 0.6))
	Draw.rr(self, r.grow(-1.5), 10.5, Color.TRANSPARENT, 1.0, Color(1.0, 0.9, 0.72, 0.22))


static func _cubic(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
	var u := 1.0 - t
	return p0 * u * u * u + p1 * 3.0 * u * u * t + p2 * 3.0 * u * t * t + p3 * t * t * t


## Bozuk (üçgenlenemeyen) çokgenleri sessizce atlar (bkz. tost.gd _cpoly)
func _poly_tex(pts: PackedVector2Array, bbox: Rect2, tex: Texture2D, mod: Color = Color.WHITE) -> void:
	if pts.size() < 3 or Geometry2D.triangulate_polygon(pts).is_empty():
		return
	var uvs := PackedVector2Array()
	for p in pts:
		uvs.append(((p - bbox.position) / bbox.size).clamp(Vector2.ZERO, Vector2.ONE))
	draw_polygon(pts, PackedColorArray([mod]), uvs, tex)


func _cpoly(pts: PackedVector2Array, col: Color) -> void:
	if pts.size() >= 3 and not Geometry2D.triangulate_polygon(pts).is_empty():
		draw_colored_polygon(pts, col)


## Döndürülmüş elips noktaları
static func _rot_ellipse(c: Vector2, rx: float, ry: float, rot: float, n: int = 20) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for k in n:
		var a := TAU * k / n
		pts.append(c + Vector2(cos(a) * rx, sin(a) * ry).rotated(rot))
	return pts


func _draw_bowl_body(b: Dictionary, lv: int) -> void:
	var tone: Array = BOWL_TONES[lv]
	var c: Vector2 = b.c
	var rx: float = b.rx
	var ry: float = b.ry
	var depth: float = b.depth
	# gövde: sol ağızdan dibe, dipten sağ ağza iki kübik eğri + üst yarım elips
	var pts := PackedVector2Array()
	var l0 := c + Vector2(-rx, 0)
	var bot := c + Vector2(0, depth)
	var r0 := c + Vector2(rx, 0)
	for s in 13:
		pts.append(_cubic(l0, c + Vector2(-rx, depth * 0.9), c + Vector2(-rx * 0.55, depth), bot, s / 12.0))
	for s in range(1, 13):
		pts.append(_cubic(bot, c + Vector2(rx * 0.55, depth), c + Vector2(rx, depth * 0.9), r0, s / 12.0))
	for s in range(1, 20):
		var a := -PI * s / 20.0
		pts.append(c + Vector2(cos(a) * rx, sin(a) * ry))
	var bbox := Rect2(c.x - rx, c.y - ry, rx * 2.0, ry + depth)
	var stops: Array = []
	for i in tone.size():
		stops.append([float(i) / (tone.size() - 1), tone[i]])
	_poly_tex(pts, bbox, Draw.grad(stops, Vector2(0, 0.5), Vector2(1, 0.5)))
	# dibe doğru koyulaşma (yuvarlak hacim)
	_poly_tex(pts, bbox, Draw.grad([[0.0, Color(0, 0, 0, 0)], [0.55, Color(0, 0, 0, 0.0)], [1.0, Color(0, 0, 0, 0.32)]]))
	# sol üst ışıktan gelen dikey parıltı şeridi
	var sheen := PackedVector2Array()
	for s in 9:
		sheen.append(_cubic(c + Vector2(-rx * 0.62, ry * 0.5), c + Vector2(-rx * 0.6, depth * 0.75), c + Vector2(-rx * 0.38, depth * 0.95), c + Vector2(-rx * 0.2, depth * 0.98), s / 8.0))
	draw_polyline(sheen, Color(1, 1, 1, 0.35), 4.0, true)
	draw_polyline(sheen, Color(1, 1, 1, 0.5), 1.5, true)
	# dövme bakır benekleri
	if lv == 1:
		var rng := RandomNumberGenerator.new()
		rng.seed = 5
		for k in 18:
			var p := c + Vector2((rng.randf() - 0.5) * rx * 1.5, 10.0 + rng.randf() * (depth - 18.0))
			draw_circle(p, 2.2, Color(1.0, 0.86, 0.7, 0.18), true, -1.0, true)
	# ağız kenarı (dudak)
	var rim := Draw.grad([[0.0, tone[0]], [0.35, tone[2]], [0.7, tone[1]], [1.0, tone[4]]], Vector2(0, 0.5), Vector2(1, 0.5))
	Draw.ellipse_grad(self, c, rx, ry, rim)
	Draw.ellipse_line(self, c, rx, ry, Draw.shade(tone[4], -0.3), 1.0)
	# iç yüzey: üstte (arka duvar) koyu, önde açık
	var inner := Draw.grad([[0.0, Draw.shade(tone[0], -0.35)], [0.6, tone[1]], [1.0, tone[2]]])
	Draw.ellipse_grad(self, c + Vector2(0, 1), rx - 6, ry - 4, inner)
	# iç gölge: arka iç duvarın üst kenarı
	Draw.ellipse_line(self, c + Vector2(0, 2), rx - 7, ry - 5, Color(0, 0, 0, 0.28), 3.0, PI * 1.05, PI * 1.95)


func _draw_contents(b: Dictionary) -> void:
	var c: Vector2 = b.c
	if logic.portions > 0:
		_draw_fingers(c)
	elif logic.all_added() and logic.progress > 0.0:
		_draw_dough(c)
	else:
		_draw_raw(c)


## Parmak izli sıkım çiğ köfteler (iki sıra)
func _draw_fingers(c: Vector2) -> void:
	var n := mini(logic.portions, 10)
	var row0 := mini(n, 5)
	var row1 := n - row0
	# arka sıra önce
	for j in row0:
		_draw_finger(c + Vector2(-40 + j * 20, -3), -0.25 + (j % 2) * 0.4)
	for j in row1:
		_draw_finger(c + Vector2(-36 + j * 18, 8), 0.2 - (j % 2) * 0.4)
	if logic.portions > 10:
		var s := "×%d" % logic.portions
		var r := Rect2(c.x + 44, c.y - 20, Draw.text_size(s, 11).x + 12, 16)
		Draw.rr(self, r, 8, Color(0.36, 0.09, 0.04, 0.92), 1.0, Color(1, 1, 1, 0.35))
		Draw.text(self, s, r.get_center(), 11, Color.WHITE)


func _draw_finger(p: Vector2, rot: float) -> void:
	_cpoly(_rot_ellipse(p + Vector2(1.5, 3.0), 12.5, 5.0, rot), Color(0.18, 0.04, 0.02, 0.35))
	var pts := _rot_ellipse(p, 12.0, 5.5, rot)
	_poly_tex(pts, Rect2(p - Vector2(12, 12), Vector2(24, 24)), _shade_tex, Color("#b8432a"))
	# parmak izi oyukları
	for j in [-1, 0, 1]:
		var a := p + Vector2(j * 4.0, -4.3).rotated(rot)
		var m := p + Vector2(j * 4.0 + 1.6, 0.0).rotated(rot)
		var e := p + Vector2(j * 4.0, 4.3).rotated(rot)
		draw_polyline(PackedVector2Array([a, m, e]), Color(0.16, 0.03, 0.015, 0.55), 1.0, true)
	_cpoly(_rot_ellipse(p + Vector2(-3, -2.2).rotated(rot), 5.0, 1.4, rot, 12), Color(1.0, 0.8, 0.67, 0.35))


## Yoğrulan hamur: bulgur renginden koyu kırmızıya döner, tanecikler kaybolur
func _draw_dough(c: Vector2) -> void:
	var p := logic.progress
	var sq := logic.squish
	var col := _dough_color()
	var mrx := 46.0 * (1.0 + 0.12 * sq)
	var mry := (12.0 + 6.0 * minf(1.0, p * 2.0)) * (1.0 - 0.25 * sq)
	var my := c.y + 4.0 - mry * 0.35
	var mc := Vector2(c.x, my)
	_cpoly(_rot_ellipse(mc + Vector2(2, mry * 0.45), mrx + 2, mry * 0.7, 0.0, 28), Color(0.1, 0.03, 0.01, 0.3))
	_poly_tex(_rot_ellipse(mc, mrx, mry, 0.0, 36), Rect2(mc - Vector2(mrx, mry), Vector2(mrx, mry) * 2.0), _shade_tex, col.lightened(0.12))
	# yoğurma kıvrımları
	var fold := Color(0.23, 0.04, 0.015, 0.25 + 0.2 * p)
	for k in 4:
		var a := logic.phase * 0.15 + k * 1.6
		var fc := mc + Vector2(cos(a) * mrx * 0.45, sin(a) * mry * 0.35)
		var arc := PackedVector2Array()
		for s in 9:
			var t := PI * (0.1 + 0.8 * s / 8.0)
			arc.append(fc + Vector2(cos(t) * mrx * 0.28, sin(t) * mry * 0.3).rotated(a * 0.3))
		draw_polyline(arc, fold, 1.6, true)
	# karışmamış tanecikler
	var rng := RandomNumberGenerator.new()
	rng.seed = 19
	for k in 26:
		var a := rng.randf() * TAU
		var d := sqrt(rng.randf()) * 0.85
		var gp := mc + Vector2(cos(a) * mrx * d, sin(a) * mry * d)
		var light := rng.randf() < 0.5
		var gc := Color(0.925, 0.82, 0.6, 0.8 * (1.0 - p)) if light else Color(0.35, 0.07, 0.03, 0.7 * (1.0 - p * 0.6))
		if gc.a > 0.02:
			draw_circle(gp, 1.3, gc, true, -1.0, true)
	# ıslak parlaklık
	_cpoly(_rot_ellipse(mc + Vector2(-mrx * 0.3, -mry * 0.45), mrx * 0.3, mry * 0.16, -0.1, 14), Color(1, 0.92, 0.85, 0.18 + 0.12 * p))


## Henüz yoğrulmamış hammaddeler: bulgur yığını, salça, isot pulları
func _draw_raw(c: Vector2) -> void:
	if not logic.any_added():
		Draw.ellipse(self, c + Vector2(-10, 4), 34, 7, Color(1, 1, 1, 0.12))
		return
	var rng := RandomNumberGenerator.new()
	if logic.added.bulgur:
		var bc := c + Vector2(-12, 2)
		_poly_tex(_rot_ellipse(bc, 38, 12, 0.0, 32), Rect2(bc - Vector2(38, 12), Vector2(76, 24)), _shade_tex, Color("#f0d79f"))
		rng.seed = 7
		for k in 40:
			var a := rng.randf() * TAU
			var d := sqrt(rng.randf()) * 0.95
			draw_circle(bc + Vector2(cos(a) * 36 * d, sin(a) * 11 * d), 0.9, Color("#b98f4f") if rng.randf() < 0.5 else Color("#f2dcab"), true, -1.0, true)
	if logic.added.salca:
		var sc := c + Vector2(22, 0)
		_poly_tex(_rot_ellipse(sc, 17, 7, -0.1, 24), Rect2(sc - Vector2(17, 7), Vector2(34, 14)), _shade_tex, Color("#e0402c"))
		_cpoly(_rot_ellipse(sc + Vector2(-5, -3), 5, 1.6, -0.2, 12), Color(1, 1, 1, 0.5))
	if logic.added.isot:
		rng.seed = 13
		for k in 26:
			var p := c + Vector2(-4 + (rng.randf() - 0.5) * 70, 1 + (rng.randf() - 0.5) * 16)
			var r := rng.randf() * PI
			var col := Color("#6e1a0e") if rng.randf() < 0.5 else Color("#a3301a")
			_cpoly(PackedVector2Array([p + Vector2(-1.8, -1).rotated(r), p + Vector2(1.8, -1).rotated(r), p + Vector2(1.8, 1).rotated(r), p + Vector2(-1.8, 1).rotated(r)]), col)


## Seviye 3 yoğurma makinesi: arkada kolon + kafa, önde dönen spiral kanca
func _draw_mixer(b: Dictionary, front: bool) -> void:
	var c: Vector2 = b.c
	var top := _r.position.y + 36
	var running := logic.squish > 0.05
	if not front:
		var col := Rect2(_r.position.x + 8, top, 16, c.y + b.depth - top + 6)
		Draw.rr_grad(self, col, 4, [[0.0, Color("#6c7680")], [0.5, Color("#e6ebef")], [1.0, Color("#7d8791")]], 1.0, Vector2(0, 0.5), Vector2(1, 0.5))
		var arm := Rect2(_r.position.x + 8, top - 2, c.x - _r.position.x + 18, 24)
		Draw.rr(self, arm, 9, Color.TRANSPARENT, 0.0, Color.TRANSPARENT, 5.0, Color(0, 0, 0, 0.3), Vector2(2, 3))
		Draw.rr_grad(self, arm, 9, [[0.0, Color("#f2f5f8")], [1.0, Color("#8d97a1")]])
		draw_circle(Vector2(_r.position.x + 30, top + 10), 4.0, Color("#d63a2a"), true, -1.0, true)
		draw_circle(Vector2(_r.position.x + 42, top + 10), 3.5, Color("#5fe07a") if running else Color("#2e5e3a"), true, -1.0, true)
		return
	var spin := _time * (14.0 if running else 0.0) + logic.phase * 0.2
	var pts := PackedVector2Array()
	var y0 := top + 22
	var y1: float = c.y - 2
	for k in 15:
		pts.append(Vector2(c.x + sin(spin + k * 0.9) * 6.0, y0 + k * (y1 - y0) / 14.0))
	draw_polyline(pts, Color("#c9d0d7"), 3.0, true)


func _draw_packet(k: int, id: String) -> void:
	var r := packet_rect(k)
	var added: bool = logic.added[id]
	var stock := Game.inv_get(id)
	var hov := r.has_point(_mouse) and logic.unlocked and not Drag.is_holding()
	var lift := -2.0 if hov else 0.0
	var e := _time - float(_bump.get(id, -10.0))
	var bump := 1.0 + (0.15 * sin(e / 0.3 * PI) * (1.0 - e / 0.3) if e < 0.3 else 0.0)
	var alpha := 0.45 if added else (0.62 if stock <= 0 else 1.0)
	var cx := r.get_center().x
	# gölge (sağ alta)
	Draw.ellipse_shadow(self, Vector2(cx + 3, r.end.y - 9), 16, 4, Color(0, 0, 0, 0.32 * alpha), 4.0, 4)
	var t := ItemView.tex("ing", id)
	var sz := 42.0 * bump
	if t != null:
		draw_texture_rect(t, Rect2(Vector2(cx - sz * 0.5, r.position.y + 1 + lift + (42.0 - sz)), Vector2(sz, sz)), false, Color(1, 1, 1, alpha))
	_otext(YogLogic.RAW_LABEL[id], Vector2(cx, r.end.y - 4 + lift), 10, Color(1, 1, 1, maxf(alpha, 0.7)), Color(0, 0, 0, 0.55), 3)
	if added:
		var cc := Vector2(cx, r.position.y + 20)
		draw_circle(cc, 10.0, Color("#2fae5a"), true, -1.0, true)
		draw_circle(cc, 10.0, Color(1, 1, 1, 0.5), false, 1.2, true)
		draw_polyline(PackedVector2Array([cc + Vector2(-5, 0), cc + Vector2(-1, 4), cc + Vector2(6, -5)]), Color.WHITE, 2.6, true)
		return
	# stok rozeti
	var s := str(stock)
	var bw := 10.0 + s.length() * 6.0
	var br := Rect2(r.end.x - bw + 4, r.position.y - 4, bw, 14)
	Draw.rr(self, br, 7, Color("#c0392b") if stock <= 0 else Color(0.12, 0.15, 0.19, 0.92), 1.0, Color(1, 1, 1, 0.3))
	Draw.text(self, s, br.get_center(), 10, Color.WHITE)
	# eklenmeyi bekleyen paketi nabız gibi vurgula
	if logic.unlocked and logic.portions <= 0 and not logic.all_added() and stock > 0:
		var pulse := 0.5 + 0.5 * sin(_time * 4.0 + k)
		Draw.rr(self, Rect2(r.position.x + 1, r.position.y + 2 + lift, r.size.x - 2, r.size.y - 4), 7, Color.TRANSPARENT, 2.0, Color(1.0, 0.86, 0.47, 0.25 + 0.4 * pulse))


func _draw_progress() -> void:
	var pr := _progress_rect()
	Draw.rr(self, pr, 6.5, Color(0.12, 0.08, 0.05, 0.62), 1.0, Color(1, 1, 1, 0.12))
	if not logic.unlocked:
		return
	var inner := pr.grow(-1.5)
	if logic.portions > 0:
		Draw.rr_grad(self, inner, 5, [[0.0, Color("#2fae5a")], [1.0, Color("#6be08a")]], 1.0, Vector2(0, 0.5), Vector2(1, 0.5))
		_otext("%d porsiyon hazır" % logic.portions, pr.get_center(), 10, Color.WHITE, Color(0, 0, 0, 0.35), 3)
	elif logic.all_added():
		var w := inner.size.x * logic.progress
		if w > 1.0:
			var fr := Rect2(inner.position, Vector2(maxf(10.0, w), inner.size.y))
			Draw.rr_grad(self, fr, 5, [[0.0, Color("#d3ac68")], [1.0, Color("#a32a16")]], 1.0, Vector2(0, 0.5), Vector2(1, 0.5))
			Draw.rr_grad(self, Rect2(fr.position, Vector2(fr.size.x, fr.size.y * 0.5)), 4, [[0.0, Color(1, 1, 1, 0.3)], [1.0, Color(1, 1, 1, 0.05)]])
		_otext("%%%d" % roundi(logic.progress * 100.0), pr.get_center(), 10, Color.WHITE, Color(0, 0, 0, 0.4), 3)
	else:
		Draw.text(self, "%d/3 malzeme" % logic.added_count(), pr.get_center(), 10, Color("#f3e6d0"))


func _draw_status(c: Vector2) -> void:
	var st := logic.status()
	if st.text == "":
		return
	var knead: bool = st.kind == "knead"
	var pos := Vector2(c.x, _r.position.y + 48)
	var s := 1.0 + 0.08 * sin(_time * 7.0) if knead else 1.0
	draw_set_transform(pos, 0.0, Vector2(s, s))
	_otext(st.text, Vector2.ZERO, 19 if knead else 13, COL_STATUS.get(st.kind, Color.WHITE), Color(0.16, 0.08, 0.03, 0.78), 5)
	draw_set_transform_matrix(Transform2D.IDENTITY)


func _draw_lock() -> void:
	Draw.rr(self, _r, 14, Color(0.06, 0.05, 0.08, 0.62))
	var c := _r.get_center() + Vector2(0, -22)
	# asma kilit
	var arc := Draw.ellipse_points(c + Vector2(0, -10), 13, 13, PI, TAU, 16)
	arc.insert(0, c + Vector2(-13, 0))
	arc.append(c + Vector2(13, 0))
	draw_polyline(arc, Color("#d9dde3"), 6.0, true)
	var body := Rect2(c + Vector2(-20, -2), Vector2(40, 30))
	Draw.rr(self, body, 7, Color.TRANSPARENT, 0.0, Color.TRANSPARENT, 5.0, Color(0, 0, 0, 0.35), Vector2(2, 3))
	Draw.rr_grad(self, body, 7, [[0.0, Color("#ffd34d")], [1.0, Color("#c58a12")]])
	draw_circle(c + Vector2(0, 10), 4.5, Color("#5a3d06"), true, -1.0, true)
	draw_rect(Rect2(c + Vector2(-1.5, 10), Vector2(3, 9)), Color("#5a3d06"))
	_otext("Seviye 3", _r.get_center() + Vector2(0, 30), 20, Color("#ffd34d"), Color(0, 0, 0, 0.5), 4)
	Draw.text(self, "Çiğ Köfte Dürüm", _r.get_center() + Vector2(0, 52), 13, Color("#e6e1ee"))


## Kenar çizgili, ortalanmış yazı
func _otext(s: String, pos: Vector2, size: int, col: Color, outline_col: Color, outline: int) -> void:
	var f := Draw.font()
	var w := f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var base := Vector2(pos.x - w * 0.5, pos.y + (f.get_ascent(size) - f.get_descent(size)) * 0.5)
	draw_string_outline(f, base, s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, outline, outline_col)
	draw_string(f, base, s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)
