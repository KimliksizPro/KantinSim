extends RefCounted
## Çiğ köfte leğeninin SAF mantığı (web js/stations_prep.js "3) ÇİĞ KÖFTE LEĞENİ": addRaw, kneadAdd,
## finishKnead, takeCigkofte, returnCigkofte, yogTooltip). Autoload kullanmaz; sahne ve testler preload ile kullanır:
##   const YogLogic := preload("res://scripts/stations/yogurma_logic.gd")
## Stok (envanter) kontrolü sahnenin işidir: check_add() → Game.inv_take() → mark_added().

## Leğene konan hammaddeler (her biri bir parti için 1 adet)
const RAW: Array[String] = ["bulgur", "isot", "salca"]
const RAW_LABEL := {"bulgur": "Bulgur", "isot": "İsot", "salca": "Salça"}
## Bir tıklamanın yoğurma katkısı (web onClick → kneadAdd(0.045))
const CLICK_KNEAD := 0.045
## Basılı sürüklemede: katkı = mesafe / DRAG_DIV; DRAG_MAX'tan büyük sıçramalar sayılmaz
const DRAG_DIV := 2200.0
const DRAG_MAX := 200.0
## effort çarpanının alt sınırı (sıfıra bölmeye karşı)
const MIN_EFFORT := 0.05
const DEFAULT_BATCH := 8
## Parti bitince düşen kir (web KS.addDirt(0.5))
const DIRT_ON_FINISH := 0.5

var added: Dictionary = {"bulgur": false, "isot": false, "salca": false}
## 0..1 yoğurma ilerlemesi
var progress: float = 0.0
## Hazır porsiyon sayısı (0 = parti yok)
var portions: int = 0
## Hazır partinin kalitesi (geri konan düşük kaliteli porsiyon partiyi düşürür)
var q: float = 1.0
## Animasyon: yoğururken 1'e çıkar, sönümlenir
var squish: float = 0.0
## Animasyon: yoğurma kıvrımlarının fazı
var phase: float = 0.0
## Animasyon: parti bitince parlama
var flash: float = 0.0

## Geliştirmeden gelen değerler (sahne Game.upg_val ile doldurur)
var batch: int = DEFAULT_BATCH
var effort: float = 1.0
## Çiğ Köfte Dürüm tarifi açık mı (sahne Game.is_recipe_unlocked ile doldurur)
var unlocked: bool = true


func reset(keep_squish: bool = false) -> void:
	var s := squish
	added = {"bulgur": false, "isot": false, "salca": false}
	progress = 0.0
	portions = 0
	q = 1.0
	phase = 0.0
	flash = 0.0
	squish = s if keep_squish else 0.0


func all_added() -> bool:
	return added.bulgur and added.isot and added.salca


func any_added() -> bool:
	return added.bulgur or added.isot or added.salca


func added_count() -> int:
	var n := 0
	for k in RAW:
		if added[k]:
			n += 1
	return n


func missing() -> Array[String]:
	var out: Array[String] = []
	for k in RAW:
		if not added[k]:
			out.append(k)
	return out


## Yoğurulabilir mi (malzemeler tam, parti henüz bitmemiş)?
func can_knead() -> bool:
	return unlocked and portions <= 0 and all_added()


## Hammadde eklenebilir mi? "" = evet, değilse uyarı metni (stok kontrolü hariç).
func check_add(id: String) -> String:
	if not RAW.has(id):
		return "Bu leğene girmez"
	if not unlocked:
		return "Seviye 3'te açılır"
	if portions > 0:
		return "Önce leğendekini bitir"
	if added[id]:
		return "Zaten eklendi"
	return ""


## Stok düşüldükten sonra çağrılır. Üçü de tamamlandıysa true ("Yoğur!").
func mark_added(id: String) -> bool:
	if check_add(id) != "":
		return false
	added[id] = true
	return all_added()


## Yoğurma emeği ekler; parti bu çağrıda bittiyse true.
func knead(amount: float) -> bool:
	if not can_knead() or amount <= 0.0:
		return false
	var eff := maxf(MIN_EFFORT, effort)
	progress = clampf(progress + amount / eff, 0.0, 1.0)
	squish = 1.0
	phase += amount / eff * 40.0
	if progress >= 1.0:
		_finish()
		return true
	return false


## Tıklama ile yoğurma.
func knead_click() -> bool:
	return knead(CLICK_KNEAD)


## Basılı sürükleme ile yoğurma: önceki ve şimdiki fare konumu.
func knead_drag(prev: Vector2, cur: Vector2) -> bool:
	var d := prev.distance_to(cur)
	if d >= DRAG_MAX:
		return false
	return knead(d / DRAG_DIV)


func _finish() -> void:
	portions = maxi(1, batch)
	q = 1.0
	progress = 1.0
	flash = 1.0


## Bir porsiyon çiğ köfte alır ({} = yok). Son porsiyonla leğen sıfırlanır.
func take() -> Dictionary:
	if portions <= 0 or not unlocked:
		return {}
	portions -= 1
	var it := Items.ing("cigkofte", {"q": q})
	if portions <= 0:
		reset(true)
	return it


## Leğene geri konabilir mi (parti varken ya da leğen tamamen boşken)?
func can_accept(item: Dictionary) -> bool:
	return item.get("type", "") == "ing" and item.get("id", "") == "cigkofte" and unlocked \
		and (portions > 0 or not any_added())


## Porsiyonu geri koyar (iptal / bırakma). Kalite partinin en düşüğüne iner.
func put_back(item: Dictionary) -> void:
	if portions <= 0:
		reset(true)
		for k in RAW:
			added[k] = true
		progress = 1.0
	portions += 1
	if item.has("q"):
		q = minf(q, float(item.q))


## Gerçek zamanla animasyon sönümü.
func tick(real_dt: float) -> void:
	var rd := minf(0.1, maxf(0.0, real_dt))
	squish = maxf(0.0, squish - rd * 4.0)
	flash = maxf(0.0, flash - rd * 1.5)


## Gün sonu: kalan porsiyonlar bozulur. Bozulan porsiyon sayısını döner.
func day_end() -> int:
	var n := portions
	reset()
	return n


## Leğenin ipucu metni (web yogTooltip).
func tooltip() -> String:
	if not unlocked:
		return "Çiğ Köfte Leğeni\nSeviye 3'te açılır (Çiğ Köfte Dürüm)"
	if portions > 0:
		return "Çiğ köfte: %d porsiyon\nSürükleyip tabaktaki lavaşa koy\nGün sonunda kalanlar bozulur!" % portions
	if not all_added():
		var miss: Array[String] = []
		for k in missing():
			miss.append(String(RAW_LABEL[k]).to_lower())
		return "Çiğ Köfte Leğeni\nEksik: " + ", ".join(miss) + "\nSağdaki paketlere tıkla"
	return "Yoğur! (%%%d)\nBasılı tutup sürükle ya da hızlı tıkla" % roundi(progress * 100.0)


## Paket ipucu (web packet tooltip). name = malzemenin tam adı, stock = envanter.
func packet_tooltip(id: String, ing_name: String, stock: int) -> String:
	if not unlocked:
		return ing_name + "\nSeviye 3'te açılır"
	var s := ing_name + "\nStok: %d" % stock
	s += "\nLeğene eklendi ✓" if added.get(id, false) else "\nTıkla: leğene ekle"
	if stock <= 0 and not added.get(id, false):
		s += "\nToptancıdan sipariş et"
	return s


## Durum satırı: {text, kind} kind: "done" | "knead" | "add" | "" (kilitli)
func status() -> Dictionary:
	if not unlocked:
		return {"text": "", "kind": ""}
	if portions > 0:
		return {"text": "Sürükle → lavaşa", "kind": "done"}
	if all_added():
		return {"text": "YOĞUR!", "kind": "knead"}
	return {"text": "Malzeme ekle →", "kind": "add"}
