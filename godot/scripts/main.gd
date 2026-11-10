extends Node2D
## Başlangıç sahnesi: web sürümünden aktarılan arka plan katmanlarını parallax ile dizer.
## Geçişin ilk adımı; istasyonlar/müşteriler sırayla ayrı sahneler olarak eklenecek (bkz. CLAUDE.md).

## Katman adı -> parallax katsayısı (1 = farenin tam etkisi, 0 = sabit)
const LAYERS := [
	["sky_ogle", 1.6],
	["corridor", 1.0],
	["frame", 0.0],
	["counter", 0.0],
	["worktop", 0.0],
	["station_shadows", 0.0],
]
const MAX_SHIFT := Vector2(9, 3)

var _nodes: Array = []  # [Sprite2D, taban konum, katsayı]
var _offset := Vector2.ZERO


func _ready() -> void:
	var s := 1.0 / GameData.sprite_scale
	for entry in LAYERS:
		var name: String = entry[0]
		var tex := load("res://assets/background/%s.png" % name) as Texture2D
		var r: Dictionary = GameData.background_layers.get(name, {})
		if tex == null or r.is_empty():
			push_warning("katman eksik: " + name)
			continue
		var sp := Sprite2D.new()
		sp.name = name
		sp.texture = tex
		sp.centered = false
		sp.scale = Vector2(s, s)
		var base := Vector2(r.get("x", 0), r.get("y", 0))
		# hareket eden katmanlar kenar açılmasın diye hafif büyütülür
		if entry[1] > 0.0:
			sp.scale *= 1.02
			base -= Vector2(r.get("w", 0), r.get("h", 0)) * 0.01
		sp.position = base
		add_child(sp)
		_nodes.append([sp, base, entry[1]])


func _process(dt: float) -> void:
	var vp := get_viewport_rect().size
	var m := get_viewport().get_mouse_position()
	var target := ((m - vp * 0.5) / (vp * 0.5)).clamp(Vector2(-1, -1), Vector2(1, 1)) * MAX_SHIFT
	_offset = _offset.lerp(target, 1.0 - exp(-dt * 3.2))
	for n in _nodes:
		n[0].position = n[1] + _offset * n[2]
