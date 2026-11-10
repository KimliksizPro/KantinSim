extends TestCase
## Izgara (iki yüzlü köfte) mantığı (scripts/stations/izgara_logic.gd).

const IzgaraLogic := preload("res://scripts/stations/izgara_logic.gd")


func _kofte(a: float = 0.0, b: float = 0.0) -> Dictionary:
	return {"uid": 1, "type": "ing", "id": "kofte", "cookA": a, "cookB": b}


func _run(g: RefCounted, seconds: float, step: float = 0.1, speed: float = 1.0, chef: bool = false) -> Array:
	var events: Array = []
	for i in int(round(seconds / step)):
		events.append_array(g.update(step, step, speed, chef))
	return events


func _types(events: Array) -> Array:
	var out: Array = []
	for e: Dictionary in events:
		out.append(e.get("type", ""))
	return out


func test_can_take() -> void:
	check(IzgaraLogic.can_take(_kofte()), "köfte kabul edilmeli")
	check(not IzgaraLogic.can_take({"type": "ing", "id": "sucuk"}), "sucuk kabul edilmemeli")
	check(not IzgaraLogic.can_take({"type": "dish", "id": "kofte", "layers": []}), "tabak kabul edilmemeli")
	check(not IzgaraLogic.can_take({}), "boş item kabul edilmemeli")


func test_default_four_slots() -> void:
	var g := IzgaraLogic.new()
	check_eq(g.slots.size(), 4, "varsayılan 4 yuva")
	for i in 4:
		check(g.place(_kofte()) == i, "sırayla dolar (%d)" % i)
	check_eq(g.place(_kofte()), -1, "yer yok")
	check(not g.accepts(_kofte()), "dolu ızgara kabul etmez")


func test_bottom_cooks_top_waits() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte()
	g.place(k)
	_run(g, 7.0)
	check(absf(float(k.cookA) - 1.0) < 0.01, "7 sn -> alt yüz ≈ 1.0 (gelen %s)" % str(k.cookA))
	check_eq(float(k.cookB), 0.0, "üst yüz pişmemeli")


func test_speed_upgrade() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte()
	g.place(k)
	_run(g, 3.5, 0.1, 2.0)
	check(absf(float(k.cookA) - 1.0) < 0.01, "hız 2 -> 3,5 sn'de ≈ 1.0")


func test_paused_does_not_cook() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte()
	g.place(k)
	for i in 50:
		g.update(0.0, 0.1)
	check_eq(float(k.cookA), 0.0, "oyun durmuşken pişmemeli")


func test_flip_swaps_faces() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte()
	g.place(k)
	_run(g, 6.3)  # ≈ 0.9
	check(g.wants_flip(0), "alt yüz pişti -> çevir ipucu")
	var a := float(k.cookA)
	check(g.flip(0), "çevrildi")
	check_eq(float(k.cookB), a, "eski alt yüz üste geçer")
	check_eq(float(k.cookA), 0.0, "eski üst yüz alta geçer")
	check(not g.wants_flip(0), "çevirince ipucu kalkar")
	check(g.is_flipping(0), "çevirme animasyonu başlar")
	check(not g.flip(0), "animasyon sürerken tekrar çevrilemez")
	_run(g, 0.5)
	check(not g.is_flipping(0), "animasyon biter")
	check(g.flip(0), "sonra tekrar çevrilebilir")
	check(not g.flip(1), "boş yuva çevrilemez")


func test_cooks_while_flipping() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte(0.0, 0.5)
	g.place(k)
	g.flip(0)
	g.update(0.2, 0.2)
	check(g.is_flipping(0), "hâlâ çevriliyor")
	check(float(k.cookA) > 0.5, "çevirme sırasında da alt yüz pişer (web gibi dinlenme yok)")


func test_max_is_capped() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte()
	g.place(k)
	_run(g, 60.0, 0.25)
	check_eq(float(k.cookA), IzgaraLogic.GRILL_MAX, "grillMax aşılmamalı")
	var k2 := _kofte(5.0, -1.0)
	g.place(k2)
	check_eq(float(k2.cookA), IzgaraLogic.GRILL_MAX, "konurken üstten sıkıştırılır")
	check_eq(float(k2.cookB), 0.0, "konurken alttan sıkıştırılır")


func test_threshold_events_fire_once() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte()
	g.place(k)
	var ev := _run(g, 5.8)  # ≈ 0.83
	check_eq(ev.size(), 0, "0.85'ten önce olay yok")
	ev = _run(g, 0.3)  # ≈ 0.87
	check_eq(_types(ev), ["ready"], "hazır (çevir) olayı")
	check_eq(int(ev[0].get("slot", -1)), 0, "olay yuvası")
	ev = _run(g, 2.0)  # ≈ 1.157
	check_eq(ev.size(), 0, "hazır olayı tekrarlanmamalı")
	check(not g.slots[0].smk, "1.2'den önce duman yok")
	ev = _run(g, 0.7)  # ≈ 1.257
	check(g.slots[0].smk, "1.2'den sonra duman")
	check_eq(ev.size(), 0, "duman olay üretmez")
	ev = _run(g, 20.0)
	check_eq(_types(ev), ["burn"], "yanma olayı bir kez")
	check(g.slots[0].burn, "yanık bayrağı")


func test_no_ready_event_when_top_already_cooked() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte(0.8, 0.9)
	g.place(k)
	var ev := _run(g, 0.5)
	check_eq(ev.size(), 0, "üst yüz pişmişse 'çevir' ipucu olayı yok")
	check(g.slots[0].ready, "ama hazır bayrağı kalkar")


func test_flip_resyncs_flags() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte(1.0, 0.0)
	g.place(k)
	check(g.slots[0].ready, "konurken bayrak eşitlenir")
	check_eq(_run(g, 0.1).size(), 0, "zaten pişmiş yüz için olay yok")
	g.flip(0)
	check(not g.slots[0].ready, "çevirince yeni alt yüze göre")
	var ev := _run(g, 6.0)  # yeni alt yüz ≈ 0.857, üst 1.0+ -> ipucu yok
	check(g.slots[0].ready, "yeni alt yüz pişti")
	check_eq(ev.size(), 0, "iki yüz de pişmiş: çevir olayı yok")


func test_take_and_put_back() -> void:
	var g := IzgaraLogic.new()
	var a := _kofte(0.3, 0.1)
	var b := _kofte()
	check_eq(g.place(a, [2, 0]), 2, "tercih edilen yuva")
	g.flip(2)
	var got: Dictionary = g.take(2)
	check(got == a, "take köfteyi döndürür")
	check_eq(float(got.cookA), 0.1, "çevrilmiş değerler korunur")
	check(not g.is_flipping(2), "alınınca animasyon iptal")
	check(g.take(2).is_empty(), "boş yuvadan {} döner")
	check_eq(g.put_back(got), 2, "iade son alınan yuvaya")
	g.take(2)
	g.place(b, [2])
	check_eq(g.put_back(got), 0, "son yuva doluysa ilk boş yuvaya")


func test_chef_flips_and_rests() -> void:
	var g := IzgaraLogic.new()
	var k := _kofte()
	g.place(k)
	var ev := _run(g, 7.1, 0.1, 1.0, true)
	check(_types(ev).has("chef_flip"), "usta 1.0'da çevirir")
	check(float(k.cookB) >= 1.0, "pişen yüz üste geçti")
	_run(g, 7.5, 0.1, 1.0, true)
	var a := float(k.cookA)
	check(a >= 1.0, "ikinci yüz de pişti")
	_run(g, 10.0, 0.1, 1.0, true)
	check_eq(float(k.cookA), a, "iki yüz pişince usta kenara çeker, pişme durur")
	check(not g.slots[0].burn, "usta varken yanmaz")


func test_slot_count_change() -> void:
	var g := IzgaraLogic.new()
	g.set_slot_count(6)
	check_eq(g.slots.size(), 6, "geliştirme yuva ekler")
	g.place(_kofte(), [5])
	g.set_slot_count(4)
	check_eq(g.slots.size(), 6, "dolu son yuva silinmez")
	g.take(5)
	g.set_slot_count(4)
	check_eq(g.slots.size(), 4, "boşalınca küçülür")
