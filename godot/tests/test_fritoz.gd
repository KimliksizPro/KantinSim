extends TestCase
## Fritöz mantığı (scripts/stations/fritoz_logic.gd).

const FryLogic := preload("res://scripts/stations/fritoz_logic.gd")


func _raw() -> Dictionary:
	return {"uid": 1, "type": "ing", "id": "patates"}


## Sepeti indirip tam yağa oturmasını bekler (oyun zamanı ilerletmeden).
func _lower(m: RefCounted, i: int = 0) -> void:
	if not m.baskets[i].down:
		m.toggle(i)
	m.update(0.0, 1.0)


func _run(m: RefCounted, seconds: float, step: float = 0.1, power: bool = true) -> Array:
	var events: Array = []
	var n := int(round(seconds / step))
	for k in n:
		events.append_array(m.update(step, step, power))
	return events


func test_can_take() -> void:
	check(FryLogic.can_take(_raw()), "çiğ patates kabul edilmeli")
	check(FryLogic.can_take({"type": "dish", "id": "kese", "layers": [{"id": "patates", "cook": 0.5}]}), "patatesli kese geri kızartılabilir")
	check(not FryLogic.can_take({"type": "dish", "id": "kese", "layers": []}), "boş kese kabul edilmemeli")
	check(not FryLogic.can_take({"type": "ing", "id": "kasar"}), "başka malzeme kabul edilmemeli")
	check(not FryLogic.can_take({"type": "dish", "id": "tost_ekmegi", "layers": [{"id": "patates"}]}), "tabak kabul edilmemeli")
	check(not FryLogic.can_take({}), "boş item")


func test_nine_seconds_in_hot_oil() -> void:
	var m := FryLogic.new()
	check(m.place(0, _raw()), "boş sepete konur")
	_lower(m)
	_run(m, 9.0)
	check(absf(m.cook_of(0) - 1.0) < 0.01, "9 sn sıcak yağ -> cook ≈ 1.0 (gelen %s)" % str(m.cook_of(0)))


func test_raised_basket_does_not_fry() -> void:
	var m := FryLogic.new()
	m.place(0, _raw())
	_run(m, 5.0)
	check_eq(m.cook_of(0), 0.0, "sepet yukarıdayken kızarmamalı")
	m.toggle(0)
	m.update(0.1, 0.1)  # sepet daha inmedi
	check(not m.in_oil(0), "iniş animasyonu sürüyor")
	check_eq(m.cook_of(0), 0.0, "sepet inerken kızarmamalı")


func test_paused_does_not_fry() -> void:
	var m := FryLogic.new()
	m.place(0, _raw())
	_lower(m)
	for k in 50:
		m.update(0.0, 0.1)
	check_eq(m.cook_of(0), 0.0, "oyun durmuşken (game_dt = 0) kızarmamalı")


func test_heat_up_and_cool_down() -> void:
	var m := FryLogic.new()
	check_eq(m.temp, 1.0, "gün başında yağ sıcak")
	_run(m, 12.5, 0.1, false)
	check(absf(m.temp - 0.5) < 0.01, "elektrik yokken 25 sn'de soğur (12.5 sn -> 0.5, gelen %s)" % str(m.temp))
	_run(m, 30.0, 0.1, false)
	check_eq(m.temp, 0.0, "tamamen soğudu")
	check_eq(m.heat(), 0.0, "soğuk yağ kızartmaz")
	m.place(0, _raw())
	_lower(m)
	_run(m, 1.0, 0.1, false)
	check_eq(m.cook_of(0), 0.0, "soğuk yağda pişmez")
	_run(m, 3.0)
	check(absf(m.temp - 0.5) < 0.01, "elektrik gelince 6 sn'de ısınır (3 sn -> 0.5)")
	check(m.cook_of(0) > 0.0, "ısınırken pişmeye başlar")
	check(m.cook_of(0) < 3.0 / FryLogic.FRY_TIME, "ısınırken yavaş pişer")
	_run(m, 3.0)
	check_eq(m.temp, 1.0, "tam ısı")
	check_eq(m.heat(), 1.0, "tam güç")


func test_speed_multiplier() -> void:
	var m := FryLogic.new()
	m.place(0, _raw())
	_lower(m)
	for k in 30:
		m.update(0.1, 0.1, true, 1.5)
	check(absf(m.cook_of(0) - 0.5) < 0.01, "turbo fritöz 1.5x hızlı")


func test_max_is_capped() -> void:
	var m := FryLogic.new()
	m.place(0, _raw())
	_lower(m)
	_run(m, 60.0, 0.25)
	check_eq(m.cook_of(0), FryLogic.FRY_MAX, "fryMax aşılmamalı")


func test_threshold_events_fire_once() -> void:
	var m := FryLogic.new()
	m.place(0, _raw())
	_lower(m)
	var ev := _run(m, 8.0)
	check_eq(ev.size(), 0, "0.9'dan önce olay yok")
	ev = _run(m, 0.5)
	check_eq(ev.size(), 1, "hazır olayı")
	check_eq(ev[0].get("type", ""), "done", "olay türü")
	check_eq(ev[0].get("basket", -1), 0, "olay sepeti")
	ev = _run(m, 2.5)  # ~1.22
	check_eq(ev.size(), 0, "hazır olayı tekrarlanmamalı")
	check(not m.baskets[0].smk, "1.25'ten önce duman yok")
	ev = _run(m, 1.0)  # ~1.33
	check(m.baskets[0].smk, "1.25'ten sonra duman")
	check_eq(ev.size(), 0, "duman olay üretmez")
	ev = _run(m, 20.0)
	check_eq(ev.size(), 1, "yanma olayı bir kez")
	check_eq(ev[0].get("type", ""), "burn", "yanma olay türü")


func test_returned_cooked_fries_give_no_event() -> void:
	var m := FryLogic.new()
	var kese := FryLogic.make_kese({"cook": 1.0, "oil_mult": 1.0})
	check(m.place(0, kese), "kese geri konur")
	check(m.baskets[0].ready, "hazır bayrağı eşitlenmeli")
	check_eq(m.oil_life, FryLogic.OIL_MAX, "geri kızartma yağ harcamaz")
	_lower(m)
	check_eq(_run(m, 1.0).size(), 0, "zaten hazır patates için 'Hazır!' tekrar çıkmamalı")


func test_take_makes_kese() -> void:
	var m := FryLogic.new()
	m.place(0, _raw())
	_lower(m)
	_run(m, 9.0)
	var it: Dictionary = m.take(0)
	check_eq(it.get("type", ""), "dish", "dish döner")
	check_eq(it.get("id", ""), "kese", "kese")
	var l: Dictionary = it.layers[0]
	check_eq(l.get("id", ""), "patates", "katman patates")
	check(absf(float(l.cook) - 1.0) < 0.01, "cook taşınır")
	check(absf(float(l.q) - 1.0) < 0.001, "taze yağda tam kalite")
	check(not m.has_fries(0), "sepet boşaldı")
	check(not m.baskets[0].down, "alınca sepet kalkar")
	check(m.baskets[0].drip > 0.0, "yağdan alınca damlar")
	check_eq(m.last_basket, 0, "iade için son sepet")
	check(m.take(0).is_empty(), "boş sepetten {} döner")


func test_put_back() -> void:
	var m := FryLogic.new(2)
	m.place(1, _raw())
	var it: Dictionary = m.take(1)
	m.place(1, _raw())  # sepet başkası tarafından dolduruldu
	check_eq(m.put_back(it), 0, "son sepet doluysa ilk boşa")
	check(not m.baskets[0].down, "iade yukarıda bekler")
	check_eq(m.put_back(it), -1, "yer yoksa -1")


func test_drop_nearest_free_basket() -> void:
	var m := FryLogic.new(2)
	check_eq(m.drop(_raw(), [100.0, 200.0], 190.0), 1, "en yakın sepet")
	check(m.baskets[1].down, "bırakınca sepet iner")
	check_eq(m.drop(_raw(), [100.0, 200.0], 190.0), 0, "dolu sepet atlanır")
	check(not m.accepts(), "dolu fritöz kabul etmez")
	check_eq(m.drop(_raw(), [100.0, 200.0], 190.0), -1, "yer yok")


func test_oil_life_and_quality() -> void:
	var m := FryLogic.new()
	for k in FryLogic.OIL_MAX - FryLogic.OIL_OLD - 1:
		m.place(0, _raw())
		m.take(0)
	check_eq(m.oil_life, FryLogic.OIL_OLD + 1, "her çiğ patates 1 porsiyon eskitir")
	check_eq(m.oil_mult(), 1.0, "henüz taze")
	check(not m.pop_old_warning(), "uyarı yok")
	m.place(0, _raw())
	check_eq(m.oil_mult_of(0), 1.0, "konduğu andaki yağ çarpanı saklanır")
	check(m.is_oil_old(), "yağ eskidi")
	check(m.pop_old_warning(), "eski yağ uyarısı")
	check(not m.pop_old_warning(), "uyarı bir kez okunur")
	m.take(0)
	m.place(0, _raw())
	check_eq(m.oil_mult_of(0), FryLogic.OIL_OLD_MULT, "eski yağ çarpanı")
	check(not m.pop_old_warning(), "uyarı tekrarlanmaz")
	m.baskets[0].c.cook = 1.0
	var it: Dictionary = m.take(0)
	check(absf(float(it.layers[0].q) - FryLogic.OIL_OLD_MULT) < 0.001, "eski yağda kalite düşer")
	check_eq(float(it.get("oil_mult", 0.0)), FryLogic.OIL_OLD_MULT, "kese yağ çarpanını taşır")
	while m.oil_life > 0:
		m.place(0, _raw())
		m.take(0)
	check_eq(m.oil_mult(), FryLogic.OIL_DEAD_MULT, "bitmiş yağ çarpanı")
	m.place(0, _raw())
	check_eq(m.oil_life, 0, "ömür eksiye düşmez")


func test_change_oil() -> void:
	var m := FryLogic.new()
	check(not m.can_change_oil(), "taze yağ değiştirilmez")
	check(not m.change_oil(), "taze yağda change_oil false")
	m.oil_life = 3
	m.old_warned = true
	check(m.change_oil(), "eski yağ değişir")
	check_eq(m.oil_life, FryLogic.OIL_MAX, "yağ tazelendi")
	check(not m.old_warned, "uyarı sıfırlandı")
	check_eq(m.oil_mult(), 1.0, "taze çarpan")


func test_chef_lifts_basket() -> void:
	var m := FryLogic.new()
	m.place(0, _raw())
	_lower(m)
	var ev: Array = []
	for k in 100:
		ev.append_array(m.update(0.1, 0.1, true, 1.0, true))
	check(not m.baskets[0].down, "şef sepeti kaldırır")
	check(m.cook_of(0) >= FryLogic.CHEF_LIFT and m.cook_of(0) < 1.1, "tam kıvamda kalkar")
	var lifted := ev.filter(func(e: Dictionary) -> bool: return e.type == "chef_lift")
	check_eq(lifted.size(), 1, "bir kez kaldırır")


func test_basket_count() -> void:
	var m := FryLogic.new()
	check_eq(m.baskets.size(), 1, "başlangıçta 1 sepet")
	check_eq(m.set_basket_count(2), 0, "artırınca kayıp yok")
	m.place(1, _raw())
	check_eq(m.set_basket_count(1), 1, "dolu sepet kaybı sayılır")
	check_eq(m.set_basket_count(9), 0, "en çok 3")
	check_eq(m.baskets.size(), 3, "sınır")
