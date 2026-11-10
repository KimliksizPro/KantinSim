extends Node
## Autoload "Game": tüm oyun durumu (para, envanter, saat, gün) tek yerde.
## Sahneler arası iletişim bu sinyallerle yapılır; başka sahnenin düğümlerine doğrudan erişmeyin.

signal money_changed(money: int)
## Para kazanıldı. pos == Vector2.INF ise ekranda uçan yazı gösterilmez.
signal earned(amount: int, kind: String, pos: Vector2)
signal spent(amount: int, category: String)
signal inventory_changed(id: String, count: int)
signal time_changed(minute: float)
signal phase_changed(phase: String)
## Ekranda uçan yazı isteği (FX katmanı dinler)
signal float_text(pos: Vector2, text: String, color: Color)
signal products_changed(id: String, count: int)
signal cleanliness_changed(value: float)
signal item_trashed(item: Dictionary)
signal upgrade_changed(id: String, level: int)
## Kısa bildirim (HUD/bildirim paneli dinler). kind: "info" | "good" | "bad" | "warn"
signal notified(msg: String, kind: String)

const SAVE_VERSION := 1
## Yazı renkleri
const COLOR_MONEY := Color("#7dff8a")
const COLOR_BAD := Color("#ff6a5a")
const COLOR_INFO := Color("#ffe08a")

var day: int = 1
var money: int = 0
var inventory: Dictionary = {}
## Oyun dakikası (480 = 08:00, 1020 = 17:00)
var time_min: float = 480.0
## "prep" | "open" | "closing" | "summary"
var phase: String = "open"
var paused: bool = false
var speed_mult: float = 1.0
## Bir oyun dakikası kaç gerçek saniye (web: periyodun speed alanı, varsayılan 0.6)
var sec_per_min: float = 0.6
var today: Dictionary = {}
## Hazır/paketli ürün stoğu (vitrin)
var products: Dictionary = {}
var level: int = 1
## Geliştirme seviyeleri {id: seviye (0 = başlangıç)}
var upgrades: Dictionary = {}
var staff: Dictionary = {}
## Temizlik 0..100
var cleanliness: float = 100.0
var power: bool = true


func _ready() -> void:
	new_game()


func open_min() -> float:
	return float(Recipes.data().get("OPEN_MIN", 480))


func close_min() -> float:
	return float(Recipes.data().get("CLOSE_MIN", 1020))


func new_game() -> void:
	var d := Recipes.data()
	day = 1
	money = int(d.get("costs", {}).get("startMoney", 3000))
	inventory.clear()
	var ings: Dictionary = d.get("ingredients", {})
	for id in ings:
		inventory[id] = int(ings[id].get("start", 0))
	products.clear()
	var prods: Dictionary = d.get("products", {})
	for id in prods:
		products[id] = int(prods[id].get("start", 0))
	level = 1
	upgrades.clear()
	staff.clear()
	cleanliness = 100.0
	power = true
	time_min = open_min()
	phase = "open"
	paused = false
	today = {"revenue": 0, "tips": 0, "served": 0, "lost": 0, "perfect": 0, "wasted": 0, "sales": {}}
	money_changed.emit(money)


## Oyun saniyesi bu karede kaç (duraklatma / kapalı gün = 0). İstasyonlar pişirmede bunu kullanır.
func game_dt(real_dt: float) -> float:
	if paused or not (phase == "open" or phase == "closing"):
		return 0.0
	return real_dt * speed_mult


func _process(dt: float) -> void:
	var gdt := game_dt(dt)
	if gdt <= 0.0 or phase != "open":
		return
	time_min = minf(close_min(), time_min + gdt / sec_per_min)
	time_changed.emit(time_min)
	if time_min >= close_min():
		set_phase("closing")


func set_phase(p: String) -> void:
	if phase == p:
		return
	phase = p
	phase_changed.emit(p)


## "08:00" biçiminde saat
static func fmt_time(minute: float) -> String:
	var m := int(minute)
	return "%02d:%02d" % [m / 60, m % 60]


static func fmt_money(tl: int) -> String:
	var s := str(absi(tl))
	var out := ""
	while s.length() > 3:
		out = "." + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if tl < 0 else "") + s + out + " ₺"


# --- Ekonomi -----------------------------------------------------------------

## kind: "satis" | "bahsis". pos verilirse uçan para yazısı çıkar.
func earn(amount: int, kind: String = "satis", pos: Vector2 = Vector2.INF) -> void:
	if amount <= 0:
		return
	money += amount
	if kind == "bahsis":
		today.tips = today.get("tips", 0) + amount
	else:
		today.revenue = today.get("revenue", 0) + amount
	money_changed.emit(money)
	earned.emit(amount, kind, pos)
	if pos != Vector2.INF:
		float_text.emit(pos, "+" + fmt_money(amount), COLOR_MONEY)


## Para yetmezse false döner (force ile eksiye düşebilir).
func spend(amount: int, category: String = "diger", force: bool = false) -> bool:
	if amount <= 0:
		return true
	if money < amount and not force:
		return false
	money -= amount
	money_changed.emit(money)
	spent.emit(amount, category)
	return true


# --- Envanter ------------------------------------------------------------------

func inv_get(id: String) -> int:
	return int(inventory.get(id, 0))


func inv_has(id: String, n: int = 1) -> bool:
	return inv_get(id) >= n


func inv_add(id: String, n: int = 1) -> void:
	inventory[id] = inv_get(id) + n
	inventory_changed.emit(id, inventory[id])


func inv_take(id: String, n: int = 1) -> bool:
	if not inv_has(id, n):
		return false
	inventory[id] = inv_get(id) - n
	inventory_changed.emit(id, inventory[id])
	return true


## Bir satışı istatistiğe yaz (müşteri teslimde çağırır).
func record_sale(recipe_or_product_id: String, quality: float) -> void:
	var sales: Dictionary = today.get("sales", {})
	sales[recipe_or_product_id] = sales.get(recipe_or_product_id, 0) + 1
	today.sales = sales
	today.served = today.get("served", 0) + 1
	if quality >= 0.95:
		today.perfect = today.get("perfect", 0) + 1


## Fiyat: şimdilik tarif/ürün verisindeki taban fiyat (menü & fiyat paneli gelince state'ten okunacak).
func price_of(line: Dictionary) -> int:
	var d := Recipes.data()
	var id: String = line.get("id", "")
	if line.get("type", "") == "product":
		return int(d.get("products", {}).get(id, {}).get("price", 0))
	return int(d.get("recipes", {}).get(id, {}).get("price", 0))


# --- Hazır ürünler (vitrin) ------------------------------------------------------

func prod_get(id: String) -> int:
	return int(products.get(id, 0))


func prod_has(id: String, n: int = 1) -> bool:
	return prod_get(id) >= n


func prod_add(id: String, n: int = 1) -> void:
	products[id] = prod_get(id) + n
	products_changed.emit(id, products[id])


func prod_take(id: String, n: int = 1) -> bool:
	if not prod_has(id, n):
		return false
	products[id] = prod_get(id) - n
	products_changed.emit(id, products[id])
	return true


# --- Geliştirmeler, personel, kilitler -----------------------------------------------

func upg(id: String) -> int:
	return int(upgrades.get(id, 0))


## Geliştirmenin şu anki seviyesindeki alan (ör. upg_val("izgara", "slots")). Yoksa fallback.
func upg_val(id: String, field: String, fallback: Variant = null) -> Variant:
	var u: Dictionary = Recipes.data().get("upgrades", {}).get(id, {})
	var levels: Array = u.get("levels", [])
	if levels.is_empty():
		return fallback
	var lv: Dictionary = levels[mini(upg(id), levels.size() - 1)]
	return lv.get(field, fallback)


func set_upgrade(id: String, lv: int) -> void:
	upgrades[id] = lv
	upgrade_changed.emit(id, lv)


func has_staff(id: String) -> bool:
	return bool(staff.get(id, false))


func is_recipe_unlocked(id: String) -> bool:
	return level >= int(Recipes.recipes().get(id, {}).get("unlock", 1))


func is_product_unlocked(id: String) -> bool:
	return level >= int(Recipes.data().get("products", {}).get(id, {}).get("unlock", 1))


func power_on() -> bool:
	return power


# --- Temizlik ----------------------------------------------------------------------

func add_dirt(amount: float) -> void:
	var mult := 0.5 if has_staff("temizlikci") else 1.0
	cleanliness = clampf(cleanliness - amount * mult, 0.0, 100.0)
	cleanliness_changed.emit(cleanliness)


func clean(amount: float) -> void:
	cleanliness = clampf(cleanliness + amount, 0.0, 100.0)
	cleanliness_changed.emit(cleanliness)


## Çöpe atılan item'ı bildir (istatistik / ses için).
func trash(item: Dictionary) -> void:
	item_trashed.emit(item)


func notify(msg: String, kind: String = "info") -> void:
	notified.emit(msg, kind)
