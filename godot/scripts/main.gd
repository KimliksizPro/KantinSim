extends Node2D
## Ana sahne: arka plan katmanlarını parallax ile dizer, aralarına müşteri / istasyon / efekt sahnelerini yerleştirir.
## Çizim sırası (web ile aynı): gökyüzü → koridor → çerçeve → MÜŞTERİLER → tezgah önü → çalışma yüzeyi → İSTASYONLAR → FX → HUD.
## Her istasyon kendi sahnesidir ve kökü (0,0)'da durur; kendi yerini GameData.rect(...) ile bulur.

## Katman adı -> parallax katsayısı (1 = farenin tam etkisi, 0 = sabit)
const BACK_LAYERS := [
	["sky_ogle", 1.6],
	["corridor", 1.0],
	["frame", 0.0],
]
const FRONT_LAYERS := [
	["counter", 0.0],
	["worktop", 0.0],
	["station_shadows", 0.0],
]
const CUSTOMER_SCENES := ["res://scenes/customers/customer_slot.tscn"]
const STATION_SCENES := [
	"res://scenes/stations/bins.tscn",
	"res://scenes/stations/tezgah.tscn",
	"res://scenes/stations/tost.tscn",
	"res://scenes/stations/yogurma.tscn",
	"res://scenes/stations/bekleme.tscn",
	"res://scenes/stations/izgara.tscn",
	"res://scenes/stations/fritoz.tscn",
	"res://scenes/stations/temizlik.tscn",
	"res://scenes/stations/semaver.tscn",
	"res://scenes/stations/cop.tscn",
	"res://scenes/stations/vitrin.tscn",
]
const TOP_SCENES := [
	"res://scenes/fx/fx_layer.tscn",
	"res://scenes/ui/hud.tscn",
]
const MAX_SHIFT := Vector2(9, 3)

var _nodes: Array = []  # [Sprite2D, taban konum, katsayı]
var _offset := Vector2.ZERO


func _ready() -> void:
	_add_layers(BACK_LAYERS)
	_add_scenes("Customers", CUSTOMER_SCENES)
	_add_layers(FRONT_LAYERS)
	_add_scenes("Stations", STATION_SCENES)
	_add_scenes("Top", TOP_SCENES)
	if OS.get_cmdline_user_args().has("--autoplay"):
		add_child(preload("res://tools/autoplay.gd").new())


func _add_layers(layers: Array) -> void:
	var s := 1.0 / GameData.sprite_scale
	for entry in layers:
		var layer_name: String = entry[0]
		var tex := load("res://assets/background/%s.png" % layer_name) as Texture2D
		var r: Dictionary = GameData.background_layers.get(layer_name, {})
		if tex == null or r.is_empty():
			push_warning("katman eksik: " + layer_name)
			continue
		var sp := Sprite2D.new()
		sp.name = layer_name
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


func _add_scenes(group_name: String, paths: Array) -> void:
	var group := Node2D.new()
	group.name = group_name
	add_child(group)
	for path in paths:
		if not ResourceLoader.exists(path):
			continue  # henüz yazılmamış sahne
		var ps := load(path) as PackedScene
		if ps != null:
			group.add_child(ps.instantiate())


func _process(dt: float) -> void:
	var vp := get_viewport_rect().size
	var m := get_viewport().get_mouse_position()
	var target := ((m - vp * 0.5) / (vp * 0.5)).clamp(Vector2(-1, -1), Vector2(1, 1)) * MAX_SHIFT
	_offset = _offset.lerp(target, 1.0 - exp(-dt * 3.2))
	for n in _nodes:
		n[0].position = n[1] + _offset * n[2]
