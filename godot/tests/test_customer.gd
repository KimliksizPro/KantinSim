extends TestCase
## Müşteri hesapları: sabır, teslim/ödeme, bahşiş (scripts/customers/customer_logic.gd).

const Logic := preload("res://scripts/customers/customer_logic.gd")
const GameScript := preload("res://scripts/game.gd")

const LINE := {"type": "recipe", "id": "kasarli_tost"}
const PRICE := 80


func _tost(toast: float) -> Dictionary:
	return {"uid": 1, "type": "dish", "id": "tost_ekmegi", "layers": [{"id": "kasar", "q": 1.0}], "toast": toast}


func test_patience_formula() -> void:
	# kaşarlı tost "Hızlı" (+6 sn); öğrenci çarpanı 1
	check_eq(Logic.patience_max([LINE], 1.0, 60.0), 66.0, "taban 60 + hızlı tarif")
	check_eq(Logic.patience_max([LINE], 1.2, 80.0), 86.0 * 1.2, "öğretmen çarpanı")
	check(Logic.patience_max([LINE], 1.0, 70.0, true) < Logic.patience_max([LINE], 1.0, 70.0), "kirli kantinde sabır azalır")
	var two := Logic.patience_max([LINE, {"type": "product", "id": "ayran"}], 1.0, 60.0)
	check(is_equal_approx(two, 66.0 * 1.12), "iki satırda %12 fazla sabır")


func test_perfect_toast_pays_full_and_tips() -> void:
	var r := Logic.settle(_tost(1.0), LINE, PRICE, 1.0, 1.0)
	check(r.ok, "mükemmel tost kabul edilmeli")
	check(r.quality >= 0.95, "mükemmel tost kalitesi yüksek olmalı")
	check_eq(r.total, PRICE, "tam fiyat")
	check_eq(r.tip, 16, "tam kalite + tam sabır = %20 bahşiş")
	check_eq(r.mood, "happy", "mutlu")
	check_eq(r.note, "", "kusursuzda uyarı yok")
	# öğrenci bahşiş çarpanı 0.6, sabrın yarısı kalmış
	check_eq(Logic.tip_for(PRICE, 1.0, 0.5, 0.6), roundi(80 * 0.2 * 0.7 * 0.6), "öğrenci bahşişi")
	check(Logic.tip_for(PRICE, 1.0, 0.0, 0.6) >= 0, "bahşiş negatif olamaz")


func test_burnt_toast_accepted_but_unhappy() -> void:
	var r := Logic.settle(_tost(1.8), LINE, PRICE, 1.0, 1.0)
	check(r.ok, "yanık tost yine de teslim edilebilir")
	check(r.quality < 0.4, "yanık tost düşük kalite")
	check_eq(r.total, PRICE, "fiyat yine alınır")
	check_eq(r.tip, 0, "yanık tosta bahşiş yok")
	check_eq(r.mood, "angry", "kızgın")
	check_eq(r.note, "Tost yanmış", "uyarı yazısı")
	check(r.satisfaction < 0.0, "memnuniyet negatif")


func test_unpressed_toast_note() -> void:
	var r := Logic.settle(_tost(0.0), LINE, PRICE, 1.0, 1.0)
	check(r.ok and r.quality < 0.4, "basılmamış tost düşük kalite")
	check_eq(r.note, "Tost basılmamış", "uyarı yazısı")


func test_wrong_item_rejected() -> void:
	check(not Logic.can_serve({"uid": 2, "type": "ing", "id": "kasar"}, LINE), "tek malzeme teslim edilemez")
	check(not Logic.can_serve({"uid": 3, "type": "dish", "id": "tost_ekmegi", "layers": [], "toast": 1.0}, LINE), "kaşarsız tost olmaz")
	check(not Logic.can_serve({"uid": 4, "type": "product", "id": "ayran"}, LINE), "yanlış ürün")
	check(not Logic.can_serve({}, LINE), "boş item")
	check(Logic.can_serve(_tost(1.0), LINE), "doğru tost teslim edilebilir")
	var r := Logic.settle({"uid": 2, "type": "ing", "id": "kasar"}, LINE, PRICE, 1.0)
	check(not r.ok and r.total == 0 and r.tip == 0, "yanlış item'da ödeme yok")


func test_tip_rate_and_reaction_thresholds() -> void:
	check_eq(Logic.tip_rate(0.5, 1.0), 0.0, "kalite 0.55 altı bahşiş yok")
	check(is_equal_approx(Logic.tip_rate(1.0, 1.0), 0.2), "en fazla %20")
	check(is_equal_approx(Logic.tip_rate(1.0, 0.0), 0.08), "sabır bitmişken %8")
	check_eq(Logic.reaction(0.95).text, "Mükemmel!", "tepki")
	check_eq(Logic.reaction(0.75).mood, "happy", "iyi = mutlu")
	check_eq(Logic.reaction(0.5).mood, "idle", "orta = nötr")
	check_eq(Logic.reaction(0.1).mood, "angry", "kötü = kızgın")
	check(Logic.patience_color(1.0).g > Logic.patience_color(1.0).r, "dolu çubuk yeşil")
	check(Logic.patience_color(0.0).r > Logic.patience_color(0.0).g, "boş çubuk kırmızı")


func test_payment_increases_money() -> void:
	var g: Node = GameScript.new()
	g.new_game()
	var before: int = g.money
	var r := Logic.settle(_tost(1.0), LINE, g.price_of(LINE), 0.8, 0.6)
	g.earn(r.total, "satis")
	g.earn(r.tip, "bahsis")
	g.record_sale(LINE.id, r.quality)
	check_eq(g.money, before + r.total + r.tip, "para arttı")
	check_eq(int(g.today.revenue), 80, "ciro")
	check_eq(int(g.today.tips), r.tip, "bahşiş toplamı")
	check_eq(int(g.today.served), 1, "servis sayısı")
	check_eq(int(g.today.perfect), 1, "mükemmel sayısı")
	g.free()
