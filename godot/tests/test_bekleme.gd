extends TestCase
## Bekleme rafı / sıcak dolap mantığı (scripts/stations/bekleme_logic.gd; web stations_prep.js putInHold / updateHold).

const HoldLogic := preload("res://scripts/stations/bekleme_logic.gd")


func _tost(toast: float = 1.0) -> Dictionary:
	return Items.dish("tost_ekmegi", {"layers": [{"id": "kasar", "q": 1.0}], "toast": toast})


func test_accepts() -> void:
	check(HoldLogic.accepts(_tost()), "yemek kabul")
	check(HoldLogic.accepts(Items.ing("kofte", {"cookA": 1.0, "cookB": 1.0})), "pişmiş köfte kabul")
	check(HoldLogic.accepts(Items.product("ayran")), "ürün kabul")
	check(not HoldLogic.accepts({"uid": 1, "type": "tool", "id": "bez"}), "bez kabul edilmez")
	check(not HoldLogic.accepts({}), "boş item")


func test_put_take() -> void:
	var h := HoldLogic.new()
	check_eq(h.count, 2, "başlangıçta 2 yuva")
	check_eq(h.put(_tost()), 0, "ilk boş yuva")
	check_eq(h.put(_tost(), 0), 1, "dolu tercih → sıradaki")
	check_eq(h.put(_tost()), -1, "raf dolu")
	check_eq(h.free_slot(), -1, "boş yuva yok")
	var it := h.take(1)
	check_eq(it.type, "dish", "yemek alındı")
	check(not h.has(1), "yuva boşaldı")
	check(h.take(1).is_empty(), "boş yuvadan alınmaz")
	check_eq(h.put_back(it), 1, "iade aynı yuvaya")
	check(h.take(3).is_empty(), "olmayan yuva")


func test_cooling() -> void:
	var h := HoldLogic.new()
	var t := _tost(1.0)
	h.put(t)
	h.update(10.0)
	check(not h.is_cold(0), "10 sn: henüz sıcak")
	check(is_equal_approx(h.cold_in(0), 5.0), "5 sn kaldı")
	check_eq(t.layers[0].q, 1.0, "kalite düşmedi")
	h.update(10.0)
	check(h.is_cold(0), "20 sn: soğudu")
	check(t.layers[0].q < 1.0, "kalite düşüyor")
	for i in 400:
		h.update(1.0)
	check_eq(t.layers[0].q, HoldLogic.MIN_Q, "alt sınır")
	# basılmamış (soğuk servis) yemek soğumaz
	var cold := Items.dish("lavas", {"layers": [{"id": "cigkofte", "q": 1.0}]})
	var h2 := HoldLogic.new()
	h2.put(cold)
	h2.update(60.0)
	check(not h2.is_cold(0), "çiğ köfte dürüm soğumaz")
	check_eq(cold.layers[0].q, 1.0, "kalitesi aynı")


func test_keep_warm() -> void:
	var h := HoldLogic.new()
	h.keep_warm = true
	var t := _tost(1.0)
	h.put(t)
	h.update(100.0)
	check(not h.is_cold(0), "ısıtmalı dolapta soğumaz")
	check_eq(t.layers[0].q, 1.0, "kalite korunur")
	check(h.tooltip(0).contains("Sıcak tutuluyor"), "ısıtma ipucu")


func test_warmable() -> void:
	check(HoldLogic.warmable(_tost(1.0)), "basılmış tost")
	check(not HoldLogic.warmable(_tost(0.0)), "basılmamış tost")
	check(HoldLogic.warmable(Items.dish("kese", {"layers": [{"id": "patates", "q": 1.0, "cook": 1.0}]})), "patates")
	check(HoldLogic.warmable(Items.dish("bardak", {"layers": [{"id": "cay", "q": 1.0}]})), "çay")
	check(not HoldLogic.warmable(Items.product("ayran")), "ayran")


func test_slot_count_and_day_end() -> void:
	var h := HoldLogic.new()
	h.set_count(4)
	h.put(_tost())
	h.put(Items.product("ayran"))
	h.put(Items.ing("kasar"))
	h.put(_tost(), 3)
	var lost := h.set_count(2)
	check_eq(lost.size(), 2, "2 yuvaya inince 2 item sığmaz")
	h.set_count(4)
	h.put(Items.ing("kasar"), 2)
	h.put(Items.product("simit"), 3)
	# raf: tost, ayran (paketli), kaşar (kutulu malzeme), simit (hazır ürün)
	var r := h.day_end()
	check_eq(r.ings, ["kasar"], "kaşar stoğa döner")
	check_eq(r.products, ["ayran"], "paketli ayran vitrine döner")
	check_eq(r.spoiled, 2, "tost ve simit bozulur")
	check(h.is_empty(), "raf boşaldı")
	check(h.tooltip(0).begins_with("Boş raf"), "boş ipucu")
