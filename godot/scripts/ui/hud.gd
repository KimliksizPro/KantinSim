extends CanvasLayer
## Mini HUD: üst şerit (y 0–56). Gün + saat, para, bugünkü servis sayısı.
## Tam HUD (paneller, itibar, hız düğmeleri) sonraki adımda; bu şerit girdi YUTMAZ (Drag çalışsın diye).

const LAYER := 30
const BAR_W := 1600.0
const BAR_H := 56.0
const DAY_NAMES := ["PAZARTESİ", "SALI", "ÇARŞAMBA", "PERŞEMBE", "CUMA"]
const PHASE_NAMES := {"prep": "Hazırlık", "open": "Açık", "closing": "Kapanış", "summary": "Gün sonu"}
const CREAM := Color("#fff3dc")
const GOLD := Color("#ffd65a")

var _font: Font
var _root: Control
var _day_label: Label
var _time_label: Label
var _phase_label: Label
var _money_pill: Panel
var _money_label: Label
var _served_label: Label
var _lost_label: Label
var _bounce: Tween

var _shown_money: int = -1
var _shown_minute: int = -1
var _shown_served: int = -1
var _shown_lost: int = -1
var _shown_day: int = -1
var _shown_phase: String = ""


func _ready() -> void:
	layer = LAYER
	_font = SystemFont.new()
	_font.font_names = PackedStringArray(["Nunito", "Baloo 2", "Noto Sans", "DejaVu Sans", "sans-serif"])
	_font.font_weight = 800
	_build()
	Game.money_changed.connect(_on_money_changed)
	Game.earned.connect(_on_earned)
	_refresh()


func _build() -> void:
	_root = Control.new()
	_root.name = "Bar"
	_root.size = Vector2(BAR_W, BAR_H + 12.0)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)

	# zemin: koyu ahşap gradyan
	var wood := Gradient.new()
	wood.offsets = PackedFloat32Array([0.0, 0.55, 1.0])
	wood.colors = PackedColorArray([Color("#5a3a26"), Color("#43281a"), Color("#2e1a10")])
	_root.add_child(_grad_rect(wood, Rect2(0, 0, BAR_W, BAR_H)))
	# üstte ince ışık çizgisi, altta koyu kenar + gölge
	_root.add_child(_color_rect(Color(1, 0.9, 0.75, 0.14), Rect2(0, 0, BAR_W, 1.5)))
	_root.add_child(_color_rect(Color("#1c0f08"), Rect2(0, BAR_H - 2.0, BAR_W, 2.0)))
	_root.add_child(_color_rect(Color(0.75, 0.5, 0.3, 0.35), Rect2(0, BAR_H - 3.0, BAR_W, 1.0)))
	var shade := Gradient.new()
	shade.colors = PackedColorArray([Color(0.06, 0.03, 0.01, 0.42), Color(0.06, 0.03, 0.01, 0.0)])
	_root.add_child(_grad_rect(shade, Rect2(0, BAR_H, BAR_W, 12.0)))

	# sol: gün + saat
	_day_label = _label("", 12, Color(1, 0.93, 0.82, 0.78), Vector2(12, 5))
	_time_label = _label("08:00", 25, Color.WHITE, Vector2(11, 19))
	_phase_label = _label("", 13, Color(1, 0.93, 0.82, 0.8), Vector2(86, 31))

	# para kutusu
	_money_pill = _pill(Rect2(268, 8, 152, 40), Color(0.13, 0.07, 0.04, 0.78), Color(0.83, 0.62, 0.2, 0.85))
	_money_pill.pivot_offset = _money_pill.size * 0.5
	_money_pill.add_child(_icon("coin", Rect2(6, 5, 30, 30)))
	_money_label = _label("", 20, GOLD, Vector2(44, 6), _money_pill)

	# bugünkü servis
	var served := _pill(Rect2(434, 8, 150, 40), Color(0.13, 0.07, 0.04, 0.55), Color(1, 0.9, 0.75, 0.16))
	served.add_child(_icon("check", Rect2(9, 9, 22, 22)))
	_served_label = _label("", 16, CREAM, Vector2(39, 9), served)
	# kaçan müşteri (sadece varsa görünür)
	var lost := _pill(Rect2(596, 8, 150, 40), Color(0.13, 0.07, 0.04, 0.55), Color(1, 0.5, 0.4, 0.3))
	lost.add_child(_icon("angry", Rect2(9, 9, 22, 22)))
	_lost_label = _label("", 16, Color("#ffb4a6"), Vector2(39, 9), lost)
	lost.visible = false


func _grad_rect(g: Gradient, r: Rect2) -> TextureRect:
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.width = 4
	gt.height = 64
	gt.fill_from = Vector2(0, 0)
	gt.fill_to = Vector2(0, 1)
	var tr := TextureRect.new()
	tr.texture = gt
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_SCALE
	tr.position = r.position
	tr.size = r.size
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tr


func _color_rect(c: Color, r: Rect2) -> ColorRect:
	var cr := ColorRect.new()
	cr.color = c
	cr.position = r.position
	cr.size = r.size
	cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return cr


func _pill(r: Rect2, bg: Color, border: Color) -> Panel:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(int(r.size.y * 0.5))
	sb.set_border_width_all(2)
	sb.border_color = border
	sb.shadow_color = Color(0, 0, 0, 0.25)
	sb.shadow_size = 3
	sb.shadow_offset = Vector2(0, 2)
	var p := Panel.new()
	p.add_theme_stylebox_override("panel", sb)
	p.position = r.position
	p.size = r.size
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(p)
	return p


func _icon(icon: String, r: Rect2) -> TextureRect:
	var tr := TextureRect.new()
	tr.texture = load("res://assets/icons/%s.png" % icon) as Texture2D
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.position = r.position
	tr.size = r.size
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tr


func _label(text: String, size: int, color: Color, pos: Vector2, parent: Control = null) -> Label:
	var ls := LabelSettings.new()
	ls.font = _font
	ls.font_size = size
	ls.font_color = color
	ls.shadow_color = Color(0, 0, 0, 0.45)
	ls.shadow_offset = Vector2(0, 2)
	ls.shadow_size = 2
	var lb := Label.new()
	lb.label_settings = ls
	lb.text = text
	lb.position = pos
	lb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	(parent if parent != null else _root).add_child(lb)
	return lb


func _process(_dt: float) -> void:
	_refresh()


## Sadece değişen alanları günceller.
func _refresh() -> void:
	if Game.day != _shown_day:
		_shown_day = Game.day
		_day_label.text = "GÜN %d · %s" % [Game.day, DAY_NAMES[(Game.day - 1) % DAY_NAMES.size()]]
	var minute := int(Game.time_min)
	if minute != _shown_minute:
		_shown_minute = minute
		_time_label.text = Game.fmt_time(Game.time_min)
	if Game.phase != _shown_phase:
		_shown_phase = Game.phase
		_phase_label.text = PHASE_NAMES.get(Game.phase, "")
	if Game.money != _shown_money:
		_shown_money = Game.money
		_money_label.text = Game.fmt_money(Game.money)
	var served := int(Game.today.get("served", 0))
	if served != _shown_served:
		_shown_served = served
		_served_label.text = "%d servis" % served
	var lost := int(Game.today.get("lost", 0))
	if lost != _shown_lost:
		_shown_lost = lost
		_lost_label.text = "%d kaçtı" % lost
		(_lost_label.get_parent() as Control).visible = lost > 0


func _on_money_changed(_money: int) -> void:
	_refresh()


## Para kazanınca kutu küçük bir zıplama yapar ve yazı yeşile çalar.
func _on_earned(_amount: int, _kind: String, _pos: Vector2) -> void:
	if _bounce != null and _bounce.is_valid():
		_bounce.kill()
	_money_pill.scale = Vector2.ONE
	_money_label.modulate = Color(0.6, 1.0, 0.6)
	_bounce = create_tween()
	_bounce.tween_property(_money_pill, "scale", Vector2(1.14, 1.14), 0.09).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_bounce.tween_property(_money_pill, "scale", Vector2.ONE, 0.22).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_bounce.parallel().tween_property(_money_label, "modulate", Color.WHITE, 0.45)
