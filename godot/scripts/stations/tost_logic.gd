extends RefCounted
## Tost makinesinin saf mantığı (web js/stations_cook.js "TOST MAKİNESİ" bölümünün karşılığı).
## Sahneden ve autoload'lardan bağımsızdır; testlerde preload ile doğrudan kullanılır.
## Tek makine: bir kapak + SLOT_COUNT yuva. Yuvadaki yemek (dish Dictionary) kapak tam kapalıyken pişer.

## Denge değerleri (web TUNE)
const TOAST_TIME := 9.0    # 0 -> 1.0 için oyun saniyesi
const TOAST_DONE := 0.9    # "Hazır!"
const TOAST_SMOKE := 1.25  # duman başlar
const TOAST_BURN := 1.5    # "Yandı!"
const TOAST_MAX := 2.0
## Bu değerin altındaki tost "ham" sayılır: kısa tık kapağı kapatır, sürükleme tostu alır.
const RAW_PICK := 0.3
const SLOT_COUNT := 2
## Kapak animasyon hızı (1/sn, gerçek zaman) ve ısıtmanın başladığı kapanma oranı
const LID_SPEED := 4.5
const LID_HEAT_T := 0.97
## Kapak bu orandan fazla kapanmışsa yuvadan yemek alınamaz
const LID_PICK_T := 0.25

## Kapak hedefi (true = kapalı) ve animasyon konumu (0 açık .. 1 kapalı)
var closed: bool = false
var lid_t: float = 0.0
## Her yuva: {dish: Dictionary ({} = boş), done: bool, smk: bool, burn: bool}
var slots: Array = []
## En son yemek alınan yuva (iade için), yoksa -1
var last_slot: int = -1


func _init() -> void:
	for i in SLOT_COUNT:
		slots.append({"dish": {}, "done": false, "smk": false, "burn": false})


## Yuvaya konabilir mi: yalnız tabak yemeği (kese / bardak hariç).
static func can_take(item: Dictionary) -> bool:
	if item.get("type", "") != "dish":
		return false
	var id: String = item.get("id", "")
	return id != "kese" and id != "bardak" and item.get("layers") is Array


func has_dish(j: int) -> bool:
	return j >= 0 and j < slots.size() and not (slots[j].dish as Dictionary).is_empty()


func dish(j: int) -> Dictionary:
	return slots[j].dish if has_dish(j) else {}


func toast_of(j: int) -> float:
	return float(dish(j).get("toast", 0.0))


func is_empty() -> bool:
	for j in slots.size():
		if has_dish(j):
			return false
	return true


func has_free_slot() -> bool:
	for j in slots.size():
		if not has_dish(j):
			return true
	return false


## Yeni yemek kabul eder mi: kapak açık (ya da makine boş) ve boş yuva var.
func accepts() -> bool:
	return (not closed or is_empty()) and has_free_slot()


## Kapak kapalı ve tam oturmuş mu (ısıtıyor mu)?
func is_heating() -> bool:
	return closed and lid_t > LID_HEAT_T


## Yuvadan yemek alınabilir mi (kapak açık ve yeterince kalkmış)?
func can_pick() -> bool:
	return not closed and lid_t <= LID_PICK_T


func toggle_lid() -> void:
	closed = not closed


## Eşik bayraklarını yemeğin şu anki değerine eşitler (olay üretmez).
func _sync_flags(j: int) -> void:
	var v := toast_of(j) if has_dish(j) else 0.0
	slots[j].done = v >= TOAST_DONE
	slots[j].smk = v >= TOAST_SMOKE
	slots[j].burn = v >= TOAST_BURN


## Yemeği boş bir yuvaya koyar. order: denenecek yuva sırası (boşsa 0,1,..). Konan yuvayı döndürür, yer yoksa -1.
## Kapak kapalıysa (boş makine) açılır.
func place(item: Dictionary, order: Array = []) -> int:
	if not accepts():
		return -1
	return _put(item, order)


## İade: kapak durumuna bakmadan boş bir yuvaya koyar (önce son alınan yuva). Yer yoksa -1.
func put_back(item: Dictionary) -> int:
	var order: Array = []
	if last_slot >= 0:
		order.append(last_slot)
	for j in slots.size():
		order.append(j)
	return _put(item, order)


func _put(item: Dictionary, order: Array) -> int:
	var try_order := order if not order.is_empty() else range(slots.size())
	for j: int in try_order:
		if j < 0 or j >= slots.size() or has_dish(j):
			continue
		if not item.has("toast"):
			item["toast"] = 0.0
		slots[j].dish = item
		_sync_flags(j)
		closed = false
		return j
	return -1


## Yuvadaki yemeği çıkarıp döndürür ({} = boş).
func take(j: int) -> Dictionary:
	if not has_dish(j):
		return {}
	var d: Dictionary = slots[j].dish
	slots[j].dish = {}
	_sync_flags(j)
	last_slot = j
	return d


## Bir kare ilerlet. game_dt: oyun saniyesi (duraklatınca 0), real_dt: gerçek saniye (kapak animasyonu).
## Dönen olaylar: [{slot: int, type: "done" | "burn"}] — her eşik yemek başına bir kez.
func update(game_dt: float, real_dt: float) -> Array:
	var events: Array = []
	var target := 1.0 if closed else 0.0
	lid_t += clampf(target - lid_t, -real_dt * LID_SPEED, real_dt * LID_SPEED)
	var heating := is_heating() and game_dt > 0.0
	for j in slots.size():
		if not has_dish(j):
			continue
		var d: Dictionary = slots[j].dish
		if heating:
			d["toast"] = minf(TOAST_MAX, float(d.get("toast", 0.0)) + game_dt / TOAST_TIME)
		var v := float(d.get("toast", 0.0))
		if not slots[j].done and v >= TOAST_DONE:
			slots[j].done = true
			if v < TOAST_BURN:
				events.append({"slot": j, "type": "done"})
		if not slots[j].smk and v >= TOAST_SMOKE:
			slots[j].smk = true
		if not slots[j].burn and v >= TOAST_BURN:
			slots[j].burn = true
			events.append({"slot": j, "type": "burn"})
	return events
