extends RefCounted
## Hazırlık istasyonlarının ortak çizim yardımcıları (gradyan, yumuşak köşe, gölge, elips, yazı).
## Hepsi statik; bir CanvasItem'ın _draw()'ı içinden çağrılır:
##   const Draw := preload("res://scripts/stations/prep_draw.gd")

const GRAD_SIZE := 64
const ARC_SEG := 6

static var _grads: Dictionary = {}
static var _boxes: Dictionary = {}
static var _font: Font = null


## Kalın yazı tipi (motorun varsayılan fontundan türetilir).
static func font() -> Font:
	if _font == null:
		var fv := FontVariation.new()
		fv.base_font = ThemeDB.fallback_font
		fv.variation_embolden = 0.7
		_font = fv
	return _font


## stops: [[0.0, Color], [1.0, Color]]; from/to: 0..1 uzayında yön. Önbelleklenir.
static func grad(stops: Array, from: Vector2 = Vector2(0, 0), to: Vector2 = Vector2(0, 1), radial: bool = false) -> GradientTexture2D:
	var key := str(stops) + str(from) + str(to) + str(radial)
	if _grads.has(key):
		return _grads[key]
	var g := Gradient.new()
	var offs := PackedFloat32Array()
	var cols := PackedColorArray()
	for s in stops:
		offs.append(float(s[0]))
		cols.append(s[1])
	g.offsets = offs
	g.colors = cols
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = GRAD_SIZE
	t.height = GRAD_SIZE
	t.fill = GradientTexture2D.FILL_RADIAL if radial else GradientTexture2D.FILL_LINEAR
	t.fill_from = from
	t.fill_to = to
	_grads[key] = t
	return t


## Yumuşak köşeli dikdörtgenin köşe noktaları.
static func rr_points(r: Rect2, radius: float) -> PackedVector2Array:
	var rad := minf(radius, minf(r.size.x, r.size.y) * 0.5 - 0.01)
	var pts := PackedVector2Array()
	var centers := [
		Vector2(r.end.x - rad, r.position.y + rad),
		Vector2(r.end.x - rad, r.end.y - rad),
		Vector2(r.position.x + rad, r.end.y - rad),
		Vector2(r.position.x + rad, r.position.y + rad),
	]
	for c in 4:
		var a0 := -PI * 0.5 + c * PI * 0.5
		for k in ARC_SEG + 1:
			var a := a0 + PI * 0.5 * k / ARC_SEG
			pts.append(centers[c] + Vector2(cos(a), sin(a)) * rad)
	return pts


static func ellipse_points(c: Vector2, rx: float, ry: float, a0: float = 0.0, a1: float = TAU, n: int = 40) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var full := is_equal_approx(a1 - a0, TAU)
	var count := n if full else n + 1
	for k in count:
		var a := a0 + (a1 - a0) * k / n
		pts.append(c + Vector2(cos(a) * rx, sin(a) * ry))
	return pts


## Çokgeni gradyan dokusuyla doldurur; bbox gradyanın 0..1 uzayıdır.
static func fill_grad(ci: CanvasItem, pts: PackedVector2Array, bbox: Rect2, tex: Texture2D, alpha: float = 1.0) -> void:
	var uvs := PackedVector2Array()
	for p in pts:
		uvs.append(((p - bbox.position) / bbox.size).clamp(Vector2.ZERO, Vector2.ONE))
	ci.draw_polygon(pts, PackedColorArray([Color(1, 1, 1, alpha)]), uvs, tex)


## Gradyanlı yumuşak köşeli dikdörtgen (varsayılan: yukarıdan aşağı).
static func rr_grad(ci: CanvasItem, r: Rect2, radius: float, stops: Array, alpha: float = 1.0,
		from: Vector2 = Vector2(0, 0), to: Vector2 = Vector2(0, 1)) -> void:
	fill_grad(ci, rr_points(r, radius), r, grad(stops, from, to), alpha)


## Düz renkli (kenar yumuşatmalı) yumuşak köşeli dikdörtgen; isteğe bağlı çerçeve ve gölge.
static func rr(ci: CanvasItem, r: Rect2, radius: float, col: Color, border: float = 0.0, border_col: Color = Color.TRANSPARENT,
		shadow: float = 0.0, shadow_col: Color = Color.TRANSPARENT, shadow_off: Vector2 = Vector2.ZERO) -> void:
	var key := [radius, col, border, border_col, shadow, shadow_col, shadow_off]
	var sb: StyleBoxFlat = _boxes.get(key)
	if sb == null:
		sb = StyleBoxFlat.new()
		sb.bg_color = col
		sb.draw_center = col.a > 0.0
		sb.set_corner_radius_all(int(round(radius)))
		sb.corner_detail = 6
		sb.anti_aliasing = true
		if border > 0.0:
			sb.set_border_width_all(int(ceil(border)))
			sb.border_color = border_col
		if shadow > 0.0:
			sb.shadow_size = int(shadow)
			sb.shadow_color = shadow_col
			sb.shadow_offset = shadow_off
		_boxes[key] = sb
	ci.draw_style_box(sb, r)


static func ellipse(ci: CanvasItem, c: Vector2, rx: float, ry: float, col: Color) -> void:
	ci.draw_colored_polygon(ellipse_points(c, rx, ry), col)


static func ellipse_grad(ci: CanvasItem, c: Vector2, rx: float, ry: float, tex: Texture2D, alpha: float = 1.0) -> void:
	fill_grad(ci, ellipse_points(c, rx, ry), Rect2(c - Vector2(rx, ry), Vector2(rx, ry) * 2.0), tex, alpha)


static func ellipse_line(ci: CanvasItem, c: Vector2, rx: float, ry: float, col: Color, width: float,
		a0: float = 0.0, a1: float = TAU) -> void:
	var pts := ellipse_points(c, rx, ry, a0, a1, 48)
	if is_equal_approx(a1 - a0, TAU):
		pts.append(pts[0])
	ci.draw_polyline(pts, col, width, true)


## Bulanık görünümlü elips gölge (üst üste büyüyen saydam katmanlar).
static func ellipse_shadow(ci: CanvasItem, c: Vector2, rx: float, ry: float, col: Color, blur: float = 6.0, steps: int = 5) -> void:
	var layer := col
	layer.a = col.a / steps * 1.6
	for k in steps:
		var g := blur * (float(k) / (steps - 1) - 0.5)
		ellipse(ci, c, rx + g, ry + g, layer)


static func text_size(text: String, size: int) -> Vector2:
	return font().get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size)


## En çok max_w genişliğe sığan yazı boyutu.
static func fit_size(text: String, max_w: float, size: int, min_size: int = 8) -> int:
	var s := size
	while s > min_size and text_size(text, s).x > max_w:
		s -= 1
	return s


## Yazıyı (x: sol/orta, y: dikey orta) konumuna çizer.
static func text(ci: CanvasItem, s: String, pos: Vector2, size: int, col: Color, centered: bool = true) -> void:
	var f := font()
	var w := f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var base_y := pos.y + (f.get_ascent(size) - f.get_descent(size)) * 0.5
	var x := pos.x - w * 0.5 if centered else pos.x
	ci.draw_string(f, Vector2(x, base_y), s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)


## İstasyon adı etiketi (sol üst köşe, web Art.stationLabel).
static func station_label(ci: CanvasItem, r: Rect2, label: String) -> void:
	var w := text_size(label, 14).x + 28.0
	var box := Rect2(r.position.x + 8, r.position.y + 7, w, 22)
	rr(ci, box, 11, Color(0.17, 0.13, 0.23, 0.94), 1.0, Color(1, 1, 1, 0.22), 5.0, Color(0, 0, 0, 0.3), Vector2(0, 2))
	rr_grad(ci, box.grow(-1), 10, [[0.0, Color(1, 1, 1, 0.1)], [1.0, Color(1, 1, 1, 0.0)]])
	ci.draw_circle(box.position + Vector2(11, 11), 3.4, Color("#ffcf4a"), true, -1.0, true)
	text(ci, label, box.position + Vector2(19, 11), 14, Color("#fff6e6"), false)


static func shade(c: Color, amt: float) -> Color:
	return c.lightened(amt) if amt >= 0.0 else c.darkened(-amt)
