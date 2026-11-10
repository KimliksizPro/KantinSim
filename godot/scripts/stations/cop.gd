extends Node2D
## Çöp kutusu (web js/stations_prep.js "7) ÇÖP KUTUSU", zone prep_cop, trash()).
## Bez hariç her item buraya bırakılabilir: Game.trash(item), tezgah biraz kirlenir (+0,3), maliyet günün israfına yazılır.
## Elde item varken fare üstüne gelince kapak aralanır, atınca pedala basılmış gibi tam açılıp kapanır; küçük bir toz "puf"u çıkar.
##
## Demo (yalnız ekran görüntüsü için): `-- --cop-demo` → kapak açık, israf yazısı ve puf görünür.

const Service := preload("res://scripts/stations/service_logic.gd")
const Draw := preload("res://scripts/stations/prep_draw.gd")

## Drag bölge protokolü (web prep_cop: z 5; vurgulama açık)
var zone_z: int = 5

const LABEL := "Çöp"
const LID_HOVER := 0.55
const LID_SPEED := 14.0
## Kapağın tam açık dönüş açısı (radyan; sağdaki menteşe etrafında sol ucu yukarı kalkar)
const LID_MAX_ANGLE := 0.75
const KICK_DECAY := 2.4
const PUFF_LIFE := 0.7
const COL_WASTE := Color("#ff9b8a")

var _area: Rect2
var _g: Dictionary
var _lid := 0.0
var _kick := 0.0
var _demo := false
## Puf parçacıkları: {pos, vel, t, r}
var _puffs: Array[Dictionary] = []
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_area = GameData.rect("cop")
	_g = Service.cop_geom(_area)
	_rng.seed = 4242
	Drag.register(self)
	_demo = OS.get_cmdline_user_args().has("--cop-demo")
	if _demo:
		_add_wasted(12.0)
		_spawn_puff()


func _exit_tree() -> void:
	Drag.unregister(self)


func _wasted() -> float:
	return float(Game.today.get("wasted", 0.0))


func _add_wasted(v: float) -> void:
	Game.today["wasted"] = _wasted() + v


# --- Bölge protokolü -------------------------------------------------------------

func zone_rect() -> Rect2:
	return _area


func can_drop(item: Dictionary) -> bool:
	return Service.can_trash(item)


func drop(item: Dictionary, _pt: Vector2) -> bool:
	if not Service.can_trash(item):
		return false
	var cost := Service.item_cost(item, Recipes.data(), int(Game.upg_val("yogurma", "batch", 8)), int(Game.upg_val("semaver", "glasses", 10)))
	_add_wasted(cost)
	Game.add_dirt(Service.TRASH_DIRT)
	Game.trash(item)
	_kick = 1.0
	_spawn_puff()
	if roundi(cost) > 0:
		Game.float_text.emit(Vector2(_g.cx, _area.position.y + 30.0), "−%s israf" % Service.fmt_money(roundi(cost)), COL_WASTE)
	return true


func hover_text(_pt: Vector2) -> String:
	return Service.cop_tooltip(_wasted())


# --- Güncelleme ------------------------------------------------------------------

func _spawn_puff() -> void:
	for k in 9:
		var a := -PI * 0.5 + _rng.randf_range(-1.1, 1.1)
		var sp := _rng.randf_range(30.0, 75.0)
		_puffs.append({
			"pos": Vector2(_g.cx + _rng.randf_range(-24.0, 24.0), _g.top - 2.0),
			"vel": Vector2(cos(a), sin(a)) * sp,
			"t": 0.0,
			"r": _rng.randf_range(4.0, 8.0),
		})


func _process(dt: float) -> void:
	var rd := minf(0.1, dt)
	var target := 0.0
	var held: Dictionary = Drag.held
	if not held.is_empty() and Service.can_trash(held) and _area.has_point(get_viewport().get_mouse_position()):
		target = LID_HOVER
	if _kick > 0.0:
		_kick = maxf(0.0, _kick - rd * KICK_DECAY)
		if _kick > 0.35:
			target = 1.0
	if _demo:
		target = 0.8
	_lid += (target - _lid) * minf(1.0, rd * LID_SPEED)
	for p: Dictionary in _puffs:
		p.t += rd
		p.pos += p.vel * rd
		p.vel *= 1.0 - minf(1.0, rd * 3.0)
	_puffs = _puffs.filter(func(p: Dictionary) -> bool: return p.t < PUFF_LIFE or _demo)
	queue_redraw()


# --- Çizim -----------------------------------------------------------------------

func _cpoly(pts: PackedVector2Array, col: Color) -> void:
	if not Geometry2D.triangulate_polygon(pts).is_empty():
		draw_colored_polygon(pts, col)


func _cpoly_grad(pts: PackedVector2Array, bbox: Rect2, tex: Texture2D) -> void:
	if not Geometry2D.triangulate_polygon(pts).is_empty():
		Draw.fill_grad(self, pts, bbox, tex)


func _draw() -> void:
	var cx: float = _g.cx
	var top: float = _g.top
	var bottom: float = _g.bottom
	var tw: float = _g.tw
	var bw: float = _g.bw
	var a := clampf(_lid, 0.0, 1.0)
	# zemin paspası + kovanın gölgesi (ışık sol üstten → sağa kayık)
	Draw.rr(self, Rect2(cx - 74, bottom - 6, 148, 16), 8, Color(0.08, 0.09, 0.1, 0.55))
	Draw.ellipse_shadow(self, Vector2(cx + 8, bottom + 1), 54, 7, Color(0, 0, 0, 0.45), 6.0)
	# gövde (aşağı doğru daralan kova)
	var body := PackedVector2Array([Vector2(cx - tw, top), Vector2(cx + tw, top), Vector2(cx + bw, bottom), Vector2(cx - bw, bottom)])
	var bbox := Rect2(cx - tw, top, tw * 2.0, bottom - top)
	_cpoly_grad(body, bbox, Draw.grad([[0.0, Color("#6d7680")], [0.25, Color("#e9eef2")], [0.45, Color("#c3cbd3")],
		[0.8, Color("#9aa4ae")], [1.0, Color("#5e6670")]], Vector2(0, 0), Vector2(1, 0)))
	_cpoly_grad(body, bbox, Draw.grad([[0.0, Color(0, 0, 0, 0.18)], [0.15, Color(0, 0, 0, 0.0)], [0.85, Color(0, 0, 0, 0.0)], [1.0, Color(0, 0, 0, 0.25)]]))
	var outline := body.duplicate()
	outline.append(body[0])
	draw_polyline(outline, Color(0.12, 0.14, 0.17, 0.6), 1.2, true)
	# kaburgalar
	for k in range(-3, 4):
		draw_line(Vector2(cx + k * 12.0, top + 10.0), Vector2(cx + k * 10.5, bottom - 8.0), Color(1, 1, 1, 0.18), 1.0, true)
		draw_line(Vector2(cx + k * 12.0 + 1.5, top + 10.0), Vector2(cx + k * 10.5 + 1.5, bottom - 8.0), Color(0, 0, 0, 0.07), 1.0, true)
	# alt bilezik
	Draw.rr_grad(self, Rect2(cx - bw - 1, bottom - 6, bw * 2.0 + 2, 6), 2, [[0.0, Color("#aab3bb")], [1.0, Color("#5e6670")]])
	# amblem: çöp kutusu simgesi
	var e := Vector2(cx, top + 46.0)
	Draw.rr(self, Rect2(e.x - 13, e.y - 14, 26, 30), 10, Color(0.16, 0.19, 0.23, 0.55))
	var ic := Color("#e9eef2")
	draw_polyline(PackedVector2Array([e + Vector2(-7, -5), e + Vector2(-5.5, 9), e + Vector2(5.5, 9), e + Vector2(7, -5)]), ic, 2.0, true)
	draw_line(e + Vector2(-9, -7), e + Vector2(9, -7), ic, 2.0, true)
	draw_line(e + Vector2(-3, -10), e + Vector2(3, -10), ic, 2.0, true)
	draw_line(e + Vector2(-2, -2), e + Vector2(-2, 6), ic, 2.0, true)
	draw_line(e + Vector2(2, -2), e + Vector2(2, 6), ic, 2.0, true)
	# pedal (kapak açıldıkça basılı)
	var pd := a * 3.0
	Draw.rr_grad(self, Rect2(cx - 18, bottom - 7 + pd, 36, 9), 3, [[0.0, Color("#4a535d")], [1.0, Color("#22282f")]])
	draw_rect(Rect2(cx - 15, bottom - 6 + pd, 30, 1), Color(1, 1, 1, 0.2))
	# açık ağız
	if a > 0.02:
		Draw.ellipse(self, Vector2(cx, top), tw - 3.0, 7.0, Color("#121418"))
		Draw.ellipse_line(self, Vector2(cx, top + 1.0), tw - 4.0, 6.0, Color("#2a2f36"), 3.0, PI, TAU)
	# kapak (sağ arkadan menteşeli; açıldıkça sol ucu yukarı kalkar)
	var hinge: Vector2 = _g.hinge + Vector2(0, 2)
	var ang := a * LID_MAX_ANGLE
	var lid := PackedVector2Array()
	lid.append(Vector2(cx - 50, top + 2))
	lid.append(Vector2(cx - 50, top - 4))
	for k in range(1, 12):
		var f := k / 12.0
		var p0 := Vector2(cx - 50, top - 4)
		var p1 := Vector2(cx, top - 24)
		var p2 := Vector2(cx + 50, top - 4)
		lid.append(p0.lerp(p1, f).lerp(p1.lerp(p2, f), f))
	lid.append(Vector2(cx + 50, top - 4))
	lid.append(Vector2(cx + 50, top + 2))
	var rl := PackedVector2Array()
	for p in lid:
		rl.append(hinge + (p - hinge).rotated(ang))
	if a < 0.05:
		# kapalı kapağın gövdeye düşen gölgesi
		Draw.rr(self, Rect2(cx - tw + 2, top + 1, tw * 2.0 - 4, 5), 2, Color(0, 0, 0, 0.25))
	var lb := Rect2(cx - 50, top - 24, 100, 26)
	var mn := Vector2(INF, INF)
	var mx := Vector2(-INF, -INF)
	for p in rl:
		mn = mn.min(p)
		mx = mx.max(p)
	var rb := Rect2(mn, mx - mn)
	_cpoly_grad(rl, rb if a > 0.02 else lb, Draw.grad([[0.0, Color("#f4f7fa")], [0.6, Color("#b9c2ca")], [1.0, Color("#7d8791")]]))
	var lo := rl.duplicate()
	lo.append(rl[0])
	draw_polyline(lo, Color(0.12, 0.14, 0.17, 0.6), 1.2, true)
	# kapak parlaması
	var hl := PackedVector2Array()
	for k in 9:
		var f := k / 8.0
		var p := Vector2(cx - 38, top - 7).lerp(Vector2(cx - 10, top - 18), f).lerp(Vector2(cx - 10, top - 18).lerp(Vector2(cx + 10, top - 15), f), f)
		hl.append(hinge + (p - hinge).rotated(ang))
	draw_polyline(hl, Color(1, 1, 1, 0.7), 1.5, true)
	# puf
	for p: Dictionary in _puffs:
		var f := clampf(p.t / PUFF_LIFE, 0.0, 1.0)
		if _demo:
			f = 0.35
		var col := Color(0.62, 0.64, 0.67, 0.55 * (1.0 - f))
		Draw.ellipse(self, p.pos, p.r * (0.8 + f), p.r * (0.8 + f), col)
	# israf bilgisi
	var w := roundi(_wasted())
	if w > 0:
		var s := "İsraf: " + Service.fmt_money(w)
		var tw2 := Draw.text_size(s, 11).x
		Draw.text(self, s, Vector2(_area.end.x - 12.0 - tw2, _area.position.y + 18.0), 11, Color("#ffb0a0"), false)
	Draw.station_label(self, _area, LABEL)
