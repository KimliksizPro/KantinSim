class_name ItemView
extends Node2D
## Herhangi bir item'ı (ing / dish / product) merkezde çizer. size = mantıksal genişlik (px).
## Kullanım: var v := ItemView.new(); v.item = Items.dish("tost_ekmegi"); v.size = 96; add_child(v)
## item değişince set_item() ya da queue_redraw() çağırın (toast gibi alanlar her kare değişebilir).

const TEX_DIRS := {
	"ing": "res://assets/ingredients/%s.png",
	"product": "res://assets/products/%s.png",
	"tool": "res://assets/tools/%s.png",
	"dish": "res://assets/dishes/%s.png",
}

## Tost rengi: basılmamış -> altın -> yanık
const TOAST_RAMP := [
	[0.0, Color(1.08, 1.06, 1.0)],
	[0.45, Color(1.05, 1.02, 0.95)],
	[1.0, Color(1, 1, 1)],
	[1.25, Color(0.78, 0.66, 0.55)],
	[1.5, Color(0.42, 0.32, 0.26)],
	[2.0, Color(0.22, 0.17, 0.15)],
]

static var _cache: Dictionary = {}

@export var size: float = 96.0
var item: Dictionary = {}:
	set(v):
		item = v
		queue_redraw()


func set_item(v: Dictionary) -> void:
	item = v


static func tex(kind: String, id: String) -> Texture2D:
	var path: String = TEX_DIRS.get(kind, "") % id
	if _cache.has(path):
		return _cache[path]
	var t: Texture2D = null
	if ResourceLoader.exists(path):
		t = load(path)
	_cache[path] = t
	return t


static func toast_color(v: float) -> Color:
	if v <= TOAST_RAMP[0][0]:
		return TOAST_RAMP[0][1]
	for i in range(1, TOAST_RAMP.size()):
		if v <= TOAST_RAMP[i][0]:
			var a: Array = TOAST_RAMP[i - 1]
			var b: Array = TOAST_RAMP[i]
			return (a[1] as Color).lerp(b[1], (v - a[0]) / (b[0] - a[0]))
	return TOAST_RAMP[-1][1]


func _draw() -> void:
	if item.is_empty():
		return
	draw_item(self, item, Vector2.ZERO, size)


## Başka bir CanvasItem'ın _draw()'ı içinden de kullanılabilir.
static func draw_item(ci: CanvasItem, it: Dictionary, center: Vector2, w: float, mod: Color = Color.WHITE) -> void:
	var type: String = it.get("type", "")
	var id: String = it.get("id", "")
	if type == "dish":
		_draw_dish(ci, it, center, w, mod)
		return
	var t: Texture2D = null
	if type == "ing" and (id == "kofte" or id == "patates"):
		# pişebilen malzemeler: çiğ / pişmiş / yanık görseli
		var c: float = it.get("cook", 0.0)
		if id == "kofte":
			c = (float(it.get("cookA", 0.0)) + float(it.get("cookB", 0.0))) * 0.5
		t = tex("ing", id + "_" + cook_suffix(c))
		if t != null:
			_blit(ci, t, center, w, mod)
			return
	t = tex(type, id)
	if t == null:
		ci.draw_circle(center, w * 0.3, Color(0.8, 0.3, 0.8) * mod)
		return
	var m := mod
	if it.has("cook"):
		m *= toast_color(float(it.cook))
	_blit(ci, t, center, w, m)


## Pişme değerine göre görsel eki: raw / cooked / burnt
static func cook_suffix(c: float) -> String:
	if c < Recipes.COOK_RAW:
		return "raw"
	if c < Recipes.COOK_BURNT:
		return "cooked"
	return "burnt"


static func _blit(ci: CanvasItem, t: Texture2D, center: Vector2, w: float, mod: Color) -> void:
	var h := w * float(t.get_height()) / float(t.get_width())
	ci.draw_texture_rect(t, Rect2(center - Vector2(w, h) * 0.5, Vector2(w, h)), false, mod)


static func _draw_dish(ci: CanvasItem, it: Dictionary, center: Vector2, w: float, mod: Color) -> void:
	var toast: float = it.get("toast", 0.0)
	var base_id: String = it.get("id", "")
	# Kese (patates) ve bardak (çay): boş / dolu hazır görseller
	if base_id == "kese" or base_id == "bardak":
		var layers0: Array = it.get("layers", [])
		var name0 := ("bos_kese" if base_id == "kese" else "bos_bardak")
		var m0 := mod
		if not layers0.is_empty():
			name0 = "patates" if base_id == "kese" else "cay"
			if layers0[0].has("cook"):
				m0 *= toast_color(float(layers0[0].cook))
		var t0 := tex("dish", name0)
		if t0 != null:
			_blit(ci, t0, center, w, m0)
		return
	var rid := Recipes.identify(it)
	# Basılmış ve tanınan yemek: hazır yemek görseli, tost rengine göre boyanır
	if rid != "" and toast >= Recipes.COOK_RAW:
		var dt := tex("dish", rid)
		if dt != null:
			_blit(ci, dt, center, w * 1.05, mod * toast_color(toast))
			return
	# Aksi halde: taban + üst üste katmanlar
	var tint := mod * toast_color(toast)
	var base := tex("ing", it.get("id", ""))
	if base != null:
		_blit(ci, base, center, w, tint)
	var layers: Array = it.get("layers", [])
	for i in layers.size():
		var l: Dictionary = layers[i]
		var lid: String = l.get("id", "")
		var lt := tex("ing", lid)
		if (lid == "kofte" or lid == "patates") and l.has("cook"):
			var ct := tex("ing", lid + "_" + cook_suffix(float(l.cook)))
			if ct != null:
				lt = ct
		if lt == null:
			continue
		var off := Vector2((i % 2) * 6.0 - 3.0, -w * 0.06 - i * w * 0.05)
		var lm := tint
		_blit(ci, lt, center + off, w * 0.72, lm)
