extends CanvasLayer
## Autoload "Drag": sürükle-bırak sistemi (web core.js zone mantığı).
##
## Bölge (zone) = herhangi bir Node; _ready'de Drag.register(self), _exit_tree'de Drag.unregister(self).
## Bölge şu metotları/özellikleri (isteğe bağlı) tanımlar — hepsi 1600x900 mantıksal koordinatta:
##   var zone_z: int                         öncelik (büyük olan önce denenir), yoksa 0
##   var no_highlight: bool                  true ise elde item varken yeşil çerçeve çizilmez
##   func zone_rect() -> Rect2               ZORUNLU: bölgenin dikdörtgeni
##   func pick(pt: Vector2) -> Dictionary    boş elle basınca; item dönerse ele alınır (bölge item'ı KENDİNDEN ÇIKARIR). {} = yok
##   func return_item(item: Dictionary) -> void   bırakma başarısız / iptal: item'ı geri koy
##   func can_drop(item: Dictionary) -> bool       vurgulama ve bırakma ön kontrolü
##   func drop(item: Dictionary, pt: Vector2) -> bool   bırakma; true = kabul edildi
##   func click(pt: Vector2) -> void         hiçbir pick item vermediyse, bas-bırak aynı bölgede ise
##   func hover_text(pt: Vector2) -> String  ipucu kutusu ("" = yok)
##
## Kısa dokunuş = "dokun-taşı": item ele yapışır, sonraki tıklamada bırakılır. Sağ tık / Esc = iptal (kaynağa döner).

signal picked(item: Dictionary, from: Node)
signal dropped(item: Dictionary, to: Node)
signal returned(item: Dictionary, to: Node)

const DRAG_THRESHOLD := 8.0
const TAP_TIME := 0.25
const HELD_SIZE := 96.0
const HIGHLIGHT := Color(0.45, 1.0, 0.55, 0.9)

var zones: Array[Node] = []
## Eldeki item ({} = boş el)
var held: Dictionary = {}
var held_from: Node = null
var _sticky := false
var _press_pos := Vector2.ZERO
var _press_t := 0.0
var _pressing := false
var _click_zone: Node = null
var _mouse := Vector2.ZERO

var _overlay: Node2D
var _view: ItemView
var _tip: Label


func _ready() -> void:
	layer = 50
	process_mode = Node.PROCESS_MODE_ALWAYS
	_overlay = Node2D.new()
	_overlay.draw.connect(_draw_overlay)
	add_child(_overlay)
	_view = ItemView.new()
	_view.size = HELD_SIZE
	_view.visible = false
	add_child(_view)
	_tip = Label.new()
	_tip.visible = false
	_tip.add_theme_font_size_override("font_size", 15)
	_tip.add_theme_color_override("font_color", Color("#fff6e0"))
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.12, 0.08, 0.05, 0.88)
	sb.set_corner_radius_all(8)
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	_tip.add_theme_stylebox_override("normal", sb)
	add_child(_tip)


func register(z: Node) -> void:
	if not zones.has(z):
		zones.append(z)


func unregister(z: Node) -> void:
	zones.erase(z)
	if held_from == z:
		held_from = null


func is_holding() -> bool:
	return not held.is_empty()


## Bölgenin kendisi bir item'ı ele vermek isterse (ör. özel tıklama mantığından sonra).
func start_hold(item: Dictionary, from: Node, sticky: bool = false) -> void:
	held = item
	held_from = from
	_sticky = sticky
	_view.item = item
	_view.visible = true
	picked.emit(item, from)


## pt'yi içeren bölgeler, z'ye göre büyükten küçüğe.
func zones_at(pt: Vector2) -> Array[Node]:
	var out: Array[Node] = []
	for z in zones:
		if is_instance_valid(z) and z.is_inside_tree() and z.call("zone_rect").has_point(pt):
			out.append(z)
	out.sort_custom(func(a: Node, b: Node) -> bool: return _z(a) > _z(b))
	return out


static func _z(n: Node) -> int:
	var v: Variant = n.get("zone_z")
	return int(v) if v != null else 0


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		_mouse = event.position
		return
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		if is_holding():
			cancel()
			get_viewport().set_input_as_handled()
		return
	if not (event is InputEventMouseButton):
		return
	var mb := event as InputEventMouseButton
	_mouse = mb.position
	if mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
		if is_holding():
			cancel()
			get_viewport().set_input_as_handled()
		return
	if mb.button_index != MOUSE_BUTTON_LEFT:
		return
	if mb.pressed:
		_on_press(mb.position)
	else:
		_on_release(mb.position)
	get_viewport().set_input_as_handled()


func _on_press(pt: Vector2) -> void:
	_pressing = true
	_press_pos = pt
	_press_t = Time.get_ticks_msec() / 1000.0
	_click_zone = null
	if is_holding():
		# yapışkan elle tıklama = bırak
		if _sticky:
			_sticky = false
			try_drop(pt)
			_pressing = false
		return
	var under := zones_at(pt)
	for z in under:
		if z.has_method("pick"):
			var it: Dictionary = z.call("pick", pt)
			if not it.is_empty():
				start_hold(it, z)
				return
	for z in under:
		if z.has_method("click"):
			_click_zone = z
			return


func _on_release(pt: Vector2) -> void:
	if not _pressing:
		return
	_pressing = false
	if is_holding():
		var moved := pt.distance_to(_press_pos) > DRAG_THRESHOLD
		var quick := Time.get_ticks_msec() / 1000.0 - _press_t < TAP_TIME
		if not moved and quick:
			_sticky = true  # dokun-taşı
		else:
			try_drop(pt)
		return
	if _click_zone != null and is_instance_valid(_click_zone) and _click_zone.call("zone_rect").has_point(pt):
		_click_zone.call("click", pt)
	_click_zone = null


## Eldeki item'ı pt'ye bırakmayı dener; olmazsa kaynağa döner.
func try_drop(pt: Vector2) -> bool:
	if not is_holding():
		return false
	var item := held
	for z in zones_at(pt):
		if not z.has_method("drop"):
			continue
		if z.has_method("can_drop") and not z.call("can_drop", item):
			continue
		if z.call("drop", item, pt):
			var to := z
			_clear()
			dropped.emit(item, to)
			return true
	cancel()
	return false


## İptal: item kaynağına döner.
func cancel() -> void:
	if not is_holding():
		return
	var item := held
	var from := held_from
	_clear()
	if from != null and is_instance_valid(from) and from.has_method("return_item"):
		from.call("return_item", item)
	returned.emit(item, from)


func _clear() -> void:
	held = {}
	held_from = null
	_sticky = false
	_view.visible = false
	_view.item = {}


func _process(_dt: float) -> void:
	_mouse = _overlay.get_viewport().get_mouse_position() if not _pressing else _mouse
	if is_holding():
		_view.position = _mouse
		_view.queue_redraw()
	_overlay.queue_redraw()
	_update_tip()


func _update_tip() -> void:
	var text := ""
	if not is_holding():
		for z in zones_at(_mouse):
			if z.has_method("hover_text"):
				text = z.call("hover_text", _mouse)
				if text != "":
					break
	else:
		text = Recipes.item_name(held)
	_tip.visible = text != ""
	if _tip.visible:
		_tip.text = text
		_tip.reset_size()
		var p := _mouse + Vector2(18, 22)
		if is_holding():
			p = _mouse + Vector2(-_tip.size.x * 0.5, HELD_SIZE * 0.5)
		var vp := Vector2(1600, 900)
		p.x = clampf(p.x, 4, vp.x - _tip.size.x - 4)
		p.y = clampf(p.y, 4, vp.y - _tip.size.y - 4)
		_tip.position = p


func _draw_overlay() -> void:
	if not is_holding():
		return
	var t := Time.get_ticks_msec() / 1000.0
	var col := HIGHLIGHT
	col.a = 0.55 + 0.35 * sin(t * 6.0)
	for z in zones:
		if not is_instance_valid(z) or not z.is_inside_tree():
			continue
		if z.get("no_highlight") == true:
			continue
		if z.has_method("can_drop") and z.call("can_drop", held):
			var r: Rect2 = z.call("zone_rect")
			_dashed_rect(r.grow(-3), col, 3.0, 12.0)


func _dashed_rect(r: Rect2, col: Color, width: float, dash: float) -> void:
	var pts := [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y), r.position]
	for i in 4:
		_overlay.draw_dashed_line(pts[i], pts[i + 1], col, width, dash)
