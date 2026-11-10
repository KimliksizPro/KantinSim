extends CanvasLayer
## Efekt katmanı: uçan yazılar (Game.float_text) ve para kazanınca fışkıran madeni paralar (Game.earned).
## Drag katmanının (50) altında, HUD'un üstünde durur. Girdi yutmaz.
##
## Demo (yalnız kullanıcı argümanı): --fx-demo  → her 1,2 sn'de örnek satış + bahşiş + uyarı yazısı üretir.

const LAYER := 40
const TEXT_LIFE := 1.35
const TEXT_RISE := 64.0
const MONEY_SIZE := 30
const TEXT_SIZE := 24
const OUTLINE := Color("#2a160c")
const COIN_SIZE := 24.0
const COIN_GRAVITY := 900.0
const COIN_LIFE := 0.95
const COIN_MAX := 14
const DEMO_POS := Vector2(780, 300)
const DEMO_PERIOD := 1.2

var _font: Font
var _coin_tex: Texture2D
var _texts: Control
var _coins: Node2D
## Her biri: {sp: Sprite2D, vel: Vector2, t: float, spin: float, floor: float}
var _live: Array[Dictionary] = []
var _demo: bool = false
var _demo_t: float = 0.6


func _ready() -> void:
	layer = LAYER
	_font = SystemFont.new()
	_font.font_names = PackedStringArray(["Nunito", "Baloo 2", "Noto Sans", "DejaVu Sans", "sans-serif"])
	_font.font_weight = 900
	_coin_tex = load("res://assets/icons/coin.png") as Texture2D
	_coins = Node2D.new()
	_coins.name = "Coins"
	add_child(_coins)
	_texts = Control.new()
	_texts.name = "Texts"
	_texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_texts)
	Game.float_text.connect(show_text)
	Game.earned.connect(_on_earned)
	_demo = OS.get_cmdline_user_args().has("--fx-demo")


## Yukarı süzülüp sönen, koyu konturlu kalın yazı.
func show_text(pos: Vector2, text: String, color: Color) -> void:
	var money := text.begins_with("+")
	var ls := LabelSettings.new()
	ls.font = _font
	ls.font_size = MONEY_SIZE if money else TEXT_SIZE
	ls.font_color = color
	ls.outline_size = 9 if money else 8
	ls.outline_color = OUTLINE
	ls.shadow_size = 4
	ls.shadow_color = Color(0, 0, 0, 0.35)
	ls.shadow_offset = Vector2(0, 3)
	var lb := Label.new()
	lb.label_settings = ls
	lb.text = text
	lb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_texts.add_child(lb)
	lb.reset_size()
	var sz := lb.get_minimum_size()
	lb.size = sz
	lb.pivot_offset = sz * 0.5
	# ekran dışına taşmasın
	var p := pos - sz * 0.5
	p.x = clampf(p.x, 6.0, 1600.0 - sz.x - 6.0)
	p.y = maxf(p.y, 60.0)
	lb.position = p
	lb.scale = Vector2(0.35, 0.35)
	var tw := lb.create_tween()
	tw.tween_property(lb, "scale", Vector2(1.18, 1.18), 0.14).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(lb, "scale", Vector2.ONE, 0.12).set_trans(Tween.TRANS_SINE)
	tw.parallel().tween_property(lb, "position:y", p.y - TEXT_RISE, TEXT_LIFE).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(lb, "modulate:a", 0.0, 0.4).set_delay(TEXT_LIFE - 0.52)
	tw.tween_callback(lb.queue_free)


func _on_earned(amount: int, kind: String, pos: Vector2) -> void:
	if pos == Vector2.INF:
		return
	# web: 4 + min(10, tutar/40) para; bahşişte birkaç tane
	var n := 2 if kind == "bahsis" else 4 + mini(10, roundi(amount / 40.0))
	burst_coins(pos + Vector2(0, 26), mini(n, COIN_MAX))


## Madeni paralar yukarı fışkırır, yerçekimiyle düşer, bir kez seker ve söner.
func burst_coins(pos: Vector2, count: int) -> void:
	if _coin_tex == null:
		return
	var s := COIN_SIZE / _coin_tex.get_width()
	for i in count:
		var sp := Sprite2D.new()
		sp.texture = _coin_tex
		sp.position = pos + Vector2(randf_range(-10, 10), randf_range(-4, 4))
		var k := randf_range(0.8, 1.15)
		sp.scale = Vector2(s, s) * k
		_coins.add_child(sp)
		_live.append({
			"sp": sp,
			"vel": Vector2(randf_range(-170, 170), randf_range(-430, -250)),
			"t": -i * 0.025,
			"spin": randf_range(5.0, 9.0),
			"phase": randf() * TAU,
			"base": s * k,
			"floor": pos.y + randf_range(36, 58),
			"bounced": false,
		})


func _process(dt: float) -> void:
	if _demo:
		_demo_t -= dt
		if _demo_t <= 0.0:
			_demo_t = DEMO_PERIOD
			Game.float_text.emit(DEMO_POS + Vector2(0, -86), "Mükemmel!", Color("#7dff8f"))
			Game.float_text.emit(DEMO_POS + Vector2(0, -52), "Domates unutulmuş", Color("#ffe3c4"))
			Game.earn(80, "satis", DEMO_POS + Vector2(-34, 0))
			Game.earn(6, "bahsis", DEMO_POS + Vector2(74, -24))
	var i := _live.size() - 1
	while i >= 0:
		var c: Dictionary = _live[i]
		var sp: Sprite2D = c.sp
		c.t += dt
		if c.t >= 0.0:
			c.vel.y += COIN_GRAVITY * dt
			sp.position += c.vel * dt
			if sp.position.y > c.floor and c.vel.y > 0.0:
				sp.position.y = c.floor
				if c.bounced:
					c.vel = Vector2.ZERO
				else:
					c.bounced = true
					c.vel = Vector2(c.vel.x * 0.45, -c.vel.y * 0.38)
			# dönen para: yatayda daralıp genişler
			sp.scale.x = c.base * (0.3 + 0.7 * absf(cos(c.t * c.spin + c.phase)))
			sp.modulate.a = clampf((COIN_LIFE - c.t) / 0.25, 0.0, 1.0)
		else:
			sp.modulate.a = 0.0
		if c.t >= COIN_LIFE:
			sp.queue_free()
			_live.remove_at(i)
		i -= 1
