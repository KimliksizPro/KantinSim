extends Node2D
## Servis penceresindeki tek müşteri slotu (web js/customers.js'in sadeleştirilmiş hali).
## Döngü: boş → müşteri yürüyerek gelir → balonda sipariş + sabır çubuğu → teslim/ödeme ya da sabır biter → ayrılır → yenisi.
## Drag bölgesidir: doğru yemek bırakılınca ödeme alınır. Hesaplar customer_logic.gd'de (saf fonksiyonlar).
##
## Demo (yalnız ekran görüntüsü/deneme için kullanıcı argümanı):
##   --serve-demo=perfect | burnt | raw   müşteri gelince 1 sn sonra otomatik teslim eder
##   --patience-demo=0.2                  sabrı bu orana düşürüp bekler (kırmızı çubuk/nabız kontrolü)

const Logic := preload("res://scripts/customers/customer_logic.gd")

## drawCustomer taban çizgisi = tezgah çizgisi + bu (bel altı tezgahın arkasında kalır)
const BODY_OFFSET := 40.0
## Sprite içindeki taban noktası (2x doku pikseli): 300x340 çizimde (150, 330)
const SPRITE_ANCHOR := Vector2(300, 660)
const BUBBLE_W := 252.0
const BUBBLE_H := 100.0
const BUBBLE_TOP := 64.0
const TAIL_H := 13.0
const ENTER_FROM := 330.0
const ENTER_TIME := 1.05
const LEAVE_TIME := 0.95
const LEAVE_HOLD := 1.0
const FIRST_DELAY := 0.8
const TYPE_COLORS := {"ogrenci": Color("#3d7be0"), "ogretmen": Color("#8e5bd0"), "hizmetli": Color("#2a9d8f"), "mudur": Color("#c98a12")}
const INK := Color("#3a2a1e")

@export var slot_index: int = 1
@export var type_id: String = "ogrenci"
@export var order_line: Dictionary = {"type": "recipe", "id": "kasarli_tost"}

## Drag önceliği: servis penceresi tezgah istasyonlarıyla çakışmaz; yine de üstte kalsın.
var zone_z: int = 5

## "empty" | "enter" | "wait" | "leave"
var state: String = "empty"
var patience: float = 1.0
var patience_max: float = 1.0
var line: Dictionary = {}

var _cx: float = 780.0
var _base_y: float = 352.0
var _rect := Rect2(645, 64, 270, 300)
var _gap: float = FIRST_DELAY
var _look: int = 0
var _t: float = 0.0
var _walking: bool = false
# Tween'lenen değerler
var _x_off: float = 0.0
var _alpha: float = 0.0
var _depth: float = 1.0
var _bubble_k: float = 0.0
var _tween: Tween
var _bubble_tween: Tween

var _figure: Sprite2D
var _bubble: Node2D
var _font: Font
var _box := StyleBoxFlat.new()
var _pulse_box := StyleBoxFlat.new()
var _rail := StyleBoxFlat.new()
var _fill := StyleBoxFlat.new()
var _pill := StyleBoxFlat.new()

var _demo_serve: String = ""
var _demo_patience: float = -1.0


func _ready() -> void:
	var slots: Array = GameData.layout.get("customerSlots", [])
	if slot_index >= 0 and slot_index < slots.size():
		var s: Dictionary = slots[slot_index]
		_cx = float(s.get("cx", _cx))
		_base_y = float(s.get("baseY", _base_y))
		var r: Dictionary = s.get("rect", {})
		_rect = Rect2(r.get("x", 645), r.get("y", 64), r.get("w", 270), r.get("h", 300))
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--serve-demo="):
			_demo_serve = a.trim_prefix("--serve-demo=")
		elif a.begins_with("--patience-demo="):
			_demo_patience = float(a.trim_prefix("--patience-demo="))
	_font = _make_font()
	_setup_styles()
	_figure = Sprite2D.new()
	_figure.name = "Figure"
	_figure.centered = false
	_figure.offset = -SPRITE_ANCHOR
	_figure.visible = false
	add_child(_figure)
	_bubble = Node2D.new()
	_bubble.name = "Bubble"
	_bubble.position = Vector2(_cx, BUBBLE_TOP + BUBBLE_H + TAIL_H)
	_bubble.draw.connect(_draw_bubble)
	add_child(_bubble)
	Drag.register(self)


func _exit_tree() -> void:
	Drag.unregister(self)


static func _make_font() -> Font:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Nunito", "Baloo 2", "Noto Sans", "DejaVu Sans", "sans-serif"])
	f.font_weight = 800
	return f


func _setup_styles() -> void:
	_box.bg_color = Color.WHITE
	_box.set_corner_radius_all(14)
	_box.set_border_width_all(2)
	_box.border_color = Color(0.45, 0.3, 0.16, 0.22)
	_box.shadow_color = Color(0.12, 0.06, 0.02, 0.3)
	_box.shadow_size = 12
	_box.shadow_offset = Vector2(0, 5)
	_box.anti_aliasing_size = 1.2
	_pulse_box.draw_center = false
	_pulse_box.set_corner_radius_all(14)
	_pulse_box.set_border_width_all(4)
	_rail.bg_color = Color(0.11, 0.07, 0.16, 0.62)
	_rail.set_corner_radius_all(5)
	_rail.set_border_width_all(1)
	_rail.border_color = Color(1, 1, 1, 0.35)
	_fill.set_corner_radius_all(3)
	_pill.set_corner_radius_all(9)


# --- Drag bölge protokolü ------------------------------------------------------

func zone_rect() -> Rect2:
	return _rect


func can_drop(item: Dictionary) -> bool:
	if state != "wait" and state != "enter":
		return false
	return Logic.can_serve(item, line)


func drop(item: Dictionary, _pt: Vector2) -> bool:
	if not can_drop(item):
		return false
	_serve(item)
	return true


func hover_text(_pt: Vector2) -> String:
	if state != "wait" and state != "enter":
		return ""
	return "%s — %s (%s)" % [_type().get("name", ""), Recipes.line_label(line), Game.fmt_money(Game.price_of(line))]


# --- Döngü ---------------------------------------------------------------------

func _type() -> Dictionary:
	return GameData.customer_types.get(type_id, {})


func _ratio() -> float:
	return clampf(patience / maxf(0.001, patience_max), 0.0, 1.0)


func _process(dt: float) -> void:
	_t += dt
	var gdt: float = Game.game_dt(dt)
	match state:
		"empty":
			if Game.phase == "open":
				_gap -= gdt
				if _gap <= 0.0:
					_spawn()
		"wait":
			patience -= gdt
			if patience <= 0.0:
				_give_up()
	_update_figure()
	queue_redraw()
	_bubble.queue_redraw()


func _spawn() -> void:
	_look = randi() % 4
	line = order_line.duplicate(true)
	patience_max = Logic.patience_max([line], float(_type().get("patience", 1.0)), randf_range(Logic.PATIENCE_MIN, Logic.PATIENCE_MAX))
	patience = patience_max
	_set_mood("idle")
	state = "enter"
	_walking = true
	_x_off = ENTER_FROM
	_alpha = 0.0
	_depth = 0.82
	_figure.visible = true
	_kill(_tween)
	_tween = create_tween().set_parallel(true)
	_tween.tween_property(self, "_x_off", 0.0, ENTER_TIME).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_tween.tween_property(self, "_depth", 1.0, ENTER_TIME).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_tween.tween_property(self, "_alpha", 1.0, 0.3)
	_tween.chain().tween_callback(_arrived)


func _arrived() -> void:
	_walking = false
	if state != "enter":
		return
	state = "wait"
	_show_bubble(true)
	if _demo_patience >= 0.0:
		patience = patience_max * _demo_patience
	if _demo_serve != "":
		get_tree().create_timer(1.0).timeout.connect(_demo_deliver)


func _show_bubble(on: bool) -> void:
	_kill(_bubble_tween)
	_bubble_tween = create_tween()
	if on:
		_bubble_tween.tween_property(self, "_bubble_k", 1.0, 0.32).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	else:
		_bubble_tween.tween_property(self, "_bubble_k", 0.0, 0.18).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)


## Teslim + ödeme (web serve + finishPay; bu dilimde ödeme anında alınır).
func _serve(item: Dictionary) -> void:
	var type := _type()
	var r: Dictionary = Logic.settle(item, line, Game.price_of(line), _ratio(), float(type.get("tipMult", 1.0)))
	if not r.ok:
		return
	Game.float_text.emit(Vector2(_cx, 214), r.text, r.color)
	if r.note != "":
		Game.float_text.emit(Vector2(_cx, 248), r.note, Logic.COLOR_NOTE)
	Game.earn(r.total, "satis", Vector2(_cx - 104, 296))
	if r.tip > 0:
		Game.earn(r.tip, "bahsis", Vector2(_cx + 104, 274))
	Game.record_sale(line.get("id", ""), r.quality)
	Game.add_dirt(0.5)  # her servis tezgahı biraz kirletir (web: customers.js)
	_set_mood(r.mood)
	if r.mood == "happy":
		_pop_icon("heart")
	elif r.mood == "angry":
		_pop_icon("angry")
	_leave(1.0 if r.mood == "angry" else -1.0)


## Sabır bitti: kızgın ayrılır, müşteri kaybedilir.
func _give_up() -> void:
	Game.today["lost"] = int(Game.today.get("lost", 0)) + 1
	Game.float_text.emit(Vector2(_cx, 236), "Beklemekten sıkıldı!", Game.COLOR_BAD)
	_set_mood("angry")
	_pop_icon("angry")
	_leave(1.0)


func _leave(dir: float) -> void:
	state = "leave"
	_show_bubble(false)
	_kill(_tween)
	_tween = create_tween()
	_tween.tween_interval(LEAVE_HOLD)
	_tween.tween_callback(func() -> void: _walking = true)
	_tween.tween_property(self, "_x_off", dir * ENTER_FROM, LEAVE_TIME).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
	_tween.parallel().tween_property(self, "_depth", 0.86, LEAVE_TIME)
	_tween.parallel().tween_property(self, "_alpha", 0.0, 0.3).set_delay(LEAVE_TIME - 0.3)
	_tween.tween_callback(_gone)


func _gone() -> void:
	state = "empty"
	_walking = false
	_figure.visible = false
	_gap = randf_range(1.6, 3.2)


func _demo_deliver() -> void:
	var toast := 1.0
	if _demo_serve == "burnt":
		toast = 1.8
	elif _demo_serve == "raw":
		toast = 0.0
	var item := Items.dish("tost_ekmegi", {"layers": [{"id": "kasar", "q": 1.0}], "toast": toast})
	if can_drop(item):
		drop(item, Vector2(_cx, 250))


static func _kill(tw: Tween) -> void:
	if tw != null and tw.is_valid():
		tw.kill()


func _set_mood(mood: String) -> void:
	var path := "res://assets/customers/%s_%d_%s.png" % [type_id, _look, mood]
	if ResourceLoader.exists(path):
		_figure.texture = load(path)


## Başın üstünde beliren kalp / kızgınlık simgesi
func _pop_icon(icon: String) -> void:
	var tex := load("res://assets/icons/%s.png" % icon) as Texture2D
	if tex == null:
		return
	var sp := Sprite2D.new()
	sp.texture = tex
	var s := 44.0 / tex.get_width()
	sp.position = Vector2(_cx + 112, 200)
	sp.scale = Vector2.ZERO
	add_child(sp)
	var tw := sp.create_tween()
	tw.tween_property(sp, "scale", Vector2(s, s), 0.28).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(sp, "position:y", 168.0, 1.1).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(sp, "rotation", 0.22, 1.1)
	tw.parallel().tween_property(sp, "modulate:a", 0.0, 0.35).set_delay(0.75)
	tw.tween_callback(sp.queue_free)


# --- Çizim ---------------------------------------------------------------------

func _update_figure() -> void:
	if not _figure.visible:
		return
	var s := 1.0 / GameData.sprite_scale
	var bob := 0.0
	var breath := 0.0
	var sway := 0.0
	if _walking:
		bob = -absf(sin(_t * 9.0)) * 6.0
		sway = sin(_t * 9.0) * 0.02
	else:
		breath = sin(_t * 2.1 + _look) * 0.008
		sway = sin(_t * 0.9 + _look * 1.7) * 0.008
		if state == "wait" and _ratio() < 0.25:
			sway += sin(_t * 7.0) * 0.012  # sabırsız kıpırdanma
	_figure.position = Vector2(_cx + _x_off, _base_y + BODY_OFFSET + bob)
	_figure.scale = Vector2(s * _depth * (1.0 - breath * 0.6), s * _depth * (1.0 + breath))
	_figure.rotation = sway
	_figure.modulate = Color(1, 1, 1, _alpha)


## Müşterinin tezgah kenarına düşen yumuşak gölgesi (figürden önce çizilir).
func _draw() -> void:
	if not _figure.visible:
		return
	var c := Vector2(_cx + _x_off + 10.0, _base_y - 4.0)
	for i in 5:
		var k := 1.0 - i / 5.0
		draw_set_transform(c, 0.0, Vector2(1.0, 0.16))
		draw_circle(Vector2.ZERO, (86.0 + 34.0 * k) * _depth, Color(0.08, 0.04, 0.02, 0.07 * _alpha))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _text(ci: CanvasItem, pos: Vector2, s: String, size: int, col: Color, align: HorizontalAlignment = HORIZONTAL_ALIGNMENT_LEFT, width: float = -1.0) -> void:
	ci.draw_string(_font, pos, s, align, width, size, col)


func _draw_bubble() -> void:
	var k := _bubble_k
	if k <= 0.01 or line.is_empty():
		return
	var ratio := _ratio()
	var waiting := state == "wait"
	var shake := sin(_t * 40.0) * 1.2 if waiting and ratio < 0.15 else 0.0
	var ci := _bubble
	ci.draw_set_transform(Vector2(shake, 0), 0.0, Vector2(k, k))
	ci.modulate = Color(1, 1, 1, minf(1.0, k * 1.6))
	var w := BUBBLE_W
	var h := BUBBLE_H
	var x := -w * 0.5
	var y := -(h + TAIL_H)
	var rid := ci.get_canvas_item()
	# gövde + kuyruk
	_box.draw(rid, Rect2(x, y, w, h))
	var tail := PackedVector2Array([Vector2(-12, -TAIL_H - 2.5), Vector2(12, -TAIL_H - 2.5), Vector2(0, 0)])
	ci.draw_colored_polygon(tail, Color.WHITE)
	ci.draw_line(Vector2(-11, -TAIL_H - 0.5), Vector2(0, 0), _box.border_color, 1.6, true)
	ci.draw_line(Vector2(11, -TAIL_H - 0.5), Vector2(0, 0), _box.border_color, 1.6, true)
	if waiting and ratio < 0.25:
		var pulse := 0.5 + 0.5 * sin(_t * 9.0)
		_pulse_box.border_color = Color(0.9, 0.2, 0.16, 0.45 + pulse * 0.5)
		_pulse_box.draw(rid, Rect2(x, y, w, h))
	# başlık: solda "SİPARİŞ", sağda tip rozeti
	_text(ci, Vector2(x + 14, y + 19), "SİPARİŞ", 11, Color(0.45, 0.33, 0.24, 0.75))
	var type_name: String = _type().get("name", "")
	var pw := _font.get_string_size(type_name, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x + 16.0
	_pill.bg_color = TYPE_COLORS.get(type_id, Color("#555555"))
	_pill.draw(rid, Rect2(x + w - pw - 10, y + 6, pw, 18))
	_text(ci, Vector2(x + w - pw - 10, y + 19), type_name, 11, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, pw)
	# sipariş satırı: yemek görseli + ad
	var ly := y + 50.0
	var tex: Texture2D = ItemView.tex("dish", line.get("id", "")) if line.get("type", "") == "recipe" else ItemView.tex("product", line.get("id", ""))
	if tex != null:
		ci.draw_texture_rect(tex, Rect2(x + 10, ly - 22, 44, 44), false)
	_text(ci, Vector2(x + 62, ly + 7), Recipes.line_label(line), 19, INK)
	# alt bilgi: saat + sabır çubuğu + fiyat
	var fy := y + h - 24.0
	var price := Game.fmt_money(Game.price_of(line))
	var tw := _font.get_string_size(price, HORIZONTAL_ALIGNMENT_LEFT, -1, 15).x
	_text(ci, Vector2(x + w - 12 - tw, fy + 11.5), price, 15, Color("#2f7a2f"))
	var col: Color = Logic.patience_color(ratio)
	_draw_clock(ci, Vector2(x + 21, fy + 6), 8.0, ratio, col)
	var bx := x + 36.0
	var bw := w - tw - 62.0
	var bh := 11.0
	_rail.draw(rid, Rect2(bx, fy + 0.5, bw, bh))
	if ratio > 0.001:
		var fw := maxf(bh - 4.0, (bw - 4.0) * ratio)
		_fill.bg_color = col
		_fill.draw(rid, Rect2(bx + 2, fy + 2.5, fw, bh - 4.0))
		ci.draw_rect(Rect2(bx + 5, fy + 3.5, maxf(0.0, fw - 6.0), 2.0), Color(1, 1, 1, 0.45))
	ci.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_clock(ci: CanvasItem, c: Vector2, r: float, ratio: float, col: Color) -> void:
	ci.draw_circle(c, r, col)
	ci.draw_circle(c, r - 2.0, Color.WHITE)
	var a := -PI / 2.0 + (1.0 - ratio) * TAU
	var hand := Color("#444444")
	ci.draw_line(c, c + Vector2(cos(a), sin(a)) * (r - 3.0), hand, 1.5, true)
	ci.draw_line(c, c + Vector2(0, -(r - 3.5)), hand, 1.5, true)
