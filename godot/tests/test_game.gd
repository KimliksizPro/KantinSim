extends TestCase
## Game autoload'unun ekonomi, envanter ve saat mantığı.

var G: Node = preload("res://scripts/game.gd").new()


func test_new_game() -> void:
	G.new_game()
	check_eq(G.money, 3000, "başlangıç parası")
	check_eq(G.inv_get("tost_ekmegi"), 30, "başlangıç tost ekmeği")
	check_eq(G.time_min, 480.0, "08:00")


func test_earn_spend() -> void:
	G.new_game()
	G.earn(80, "satis")
	G.earn(10, "bahsis")
	check_eq(G.money, 3090, "kazanç")
	check_eq(G.today.revenue, 80, "ciro")
	check_eq(G.today.tips, 10, "bahşiş")
	check(G.spend(90, "malzeme"), "harcama")
	check_eq(G.money, 3000)
	check(not G.spend(99999, "malzeme"), "para yetmez")
	check_eq(G.money, 3000, "yetmeyen harcama parayı değiştirmez")
	check(G.spend(3500, "kira", true), "zorunlu harcama")
	check_eq(G.money, -500, "eksiye düşer")


func test_inventory() -> void:
	G.new_game()
	check(G.inv_take("kasar"), "kaşar al")
	check_eq(G.inv_get("kasar"), 29)
	G.inv_add("kasar", 2)
	check_eq(G.inv_get("kasar"), 31)
	check(not G.inv_take("kasar", 100), "olmayan stok alınamaz")
	check(not G.inv_take("yok_boyle_sey"), "bilinmeyen malzeme")


func test_time() -> void:
	G.new_game()
	G._process(6.0)  # 6 sn / 0.6 = 10 oyun dakikası
	check(is_equal_approx(G.time_min, 490.0), "saat ilerler")
	G.paused = true
	G._process(6.0)
	check(is_equal_approx(G.time_min, 490.0), "duraklatınca durur")
	G.paused = false
	G._process(100000.0)
	check_eq(G.time_min, 1020.0, "17:00'de durur")
	check_eq(G.phase, "closing", "kapanış")
	check_eq(G.game_dt(1.0), 1.0, "kapanışta istasyonlar çalışmaya devam eder")


func test_format_and_price() -> void:
	check_eq(G.fmt_time(480.0), "08:00")
	check_eq(G.fmt_time(1019.9), "16:59")
	check_eq(G.fmt_money(3000), "3.000 ₺")
	check_eq(G.fmt_money(80), "80 ₺")
	check_eq(G.price_of({"type": "recipe", "id": "kasarli_tost"}), 80)


func test_record_sale() -> void:
	G.new_game()
	G.record_sale("kasarli_tost", 1.0)
	G.record_sale("kasarli_tost", 0.5)
	check_eq(G.today.served, 2)
	check_eq(G.today.perfect, 1)
	check_eq(G.today.sales["kasarli_tost"], 2)


func teardown() -> void:
	G.free()
