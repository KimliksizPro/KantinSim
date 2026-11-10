extends Node
## Oyun verileri: web sürümünden aktarılan res://data/game_data.json (tools/export_assets.js üretir).
## Kullanım: GameData.recipes["kasarli_tost"].price, GameData.layout.tost, GameData.ingredients ...

const DATA_PATH := "res://data/game_data.json"

var raw: Dictionary = {}
var ingredients: Dictionary = {}
var prepared: Dictionary = {}
var recipes: Dictionary = {}
var products: Dictionary = {}
var suppliers: Dictionary = {}
var upgrades: Dictionary = {}
var staff: Dictionary = {}
var customer_types: Dictionary = {}
var weathers: Dictionary = {}
var events: Dictionary = {}
var campaigns: Dictionary = {}
var loans: Dictionary = {}
var costs: Dictionary = {}
var periods: Array = []
var levels: Array = []
var bin_order: Array = []
var layout: Dictionary = {}
## Sprite'lar bu ölçekte dışa aktarıldı (2 = 2x); Sprite2D.scale = 1.0 / sprite_scale
var sprite_scale: float = 2.0
var background_layers: Dictionary = {}


func _init() -> void:
	load_data()


func load_data() -> bool:
	var f := FileAccess.open(DATA_PATH, FileAccess.READ)
	if f == null:
		push_error("GameData: %s açılamadı" % DATA_PATH)
		return false
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("GameData: JSON okunamadı")
		return false
	raw = parsed
	ingredients = raw.get("ingredients", {})
	prepared = raw.get("prepared", {})
	recipes = raw.get("recipes", {})
	products = raw.get("products", {})
	suppliers = raw.get("suppliers", {})
	upgrades = raw.get("upgrades", {})
	staff = raw.get("staff", {})
	customer_types = raw.get("customerTypes", {})
	weathers = raw.get("weathers", {})
	events = raw.get("events", {})
	campaigns = raw.get("campaigns", {})
	loans = raw.get("loans", {})
	costs = raw.get("costs", {})
	periods = raw.get("periods", [])
	levels = raw.get("levels", [])
	bin_order = raw.get("binOrder", [])
	layout = raw.get("layout", {})
	var meta: Dictionary = raw.get("_meta", {})
	sprite_scale = float(meta.get("sprite_scale", 2.0))
	background_layers = meta.get("background_layers", {})
	return true


## KS.layout dikdörtgenini Rect2'ye çevirir (1600x900 mantıksal uzay).
func rect(key: String) -> Rect2:
	var r: Dictionary = layout.get(key, {})
	return Rect2(r.get("x", 0), r.get("y", 0), r.get("w", 0), r.get("h", 0))
