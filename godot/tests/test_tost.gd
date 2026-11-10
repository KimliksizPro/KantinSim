extends TestCase
## Tost makinesi pişme mantığı (scripts/stations/tost_logic.gd).

const TostLogic := preload("res://scripts/stations/tost_logic.gd")


func _dish() -> Dictionary:
	return {"uid": 1, "type": "dish", "id": "tost_ekmegi", "layers": [{"id": "kasar", "q": 1.0}], "toast": 0.0}


## Kapağı kapatıp tam oturmasını bekler (oyun zamanı ilerletmeden).
func _close(m: RefCounted) -> void:
	m.toggle_lid()
	m.update(0.0, 1.0)


func _run(m: RefCounted, seconds: float, step: float = 0.1) -> Array:
	var events: Array = []
	var n := int(round(seconds / step))
	for i in n:
		events.append_array(m.update(step, step))
	return events


func test_can_take() -> void:
	check(TostLogic.can_take(_dish()), "tabak yemeği kabul edilmeli")
	check(not TostLogic.can_take({"type": "ing", "id": "kasar"}), "tek malzeme kabul edilmemeli")
	check(not TostLogic.can_take({"type": "dish", "id": "kese", "layers": []}), "kese kabul edilmemeli")
	check(not TostLogic.can_take({"type": "dish", "id": "bardak", "layers": []}), "bardak kabul edilmemeli")
	check(not TostLogic.can_take({"type": "product", "id": "ayran"}), "ürün kabul edilmemeli")
	check(not TostLogic.can_take({}), "boş item kabul edilmemeli")


func test_nine_seconds_closed() -> void:
	var m := TostLogic.new()
	var d := _dish()
	check_eq(m.place(d), 0, "ilk boş yuva")
	_close(m)
	_run(m, 9.0)
	check(absf(float(d.toast) - 1.0) < 0.01, "9 sn kapalı -> toast ≈ 1.0 (gelen %s)" % str(d.toast))


func test_open_lid_does_not_cook() -> void:
	var m := TostLogic.new()
	var d := _dish()
	m.place(d)
	_run(m, 5.0)
	check_eq(float(d.toast), 0.0, "kapak açıkken pişmemeli")


func test_lid_must_settle_before_heating() -> void:
	var m := TostLogic.new()
	var d := _dish()
	m.place(d)
	m.toggle_lid()
	m.update(0.1, 0.1)  # kapak daha inmedi (0.45)
	check_eq(float(d.toast), 0.0, "kapak inerken pişmemeli")
	check(m.lid_t > 0.0 and m.lid_t < 1.0, "kapak animasyonu ara konumda")
	m.update(0.0, 1.0)
	check_eq(m.lid_t, 1.0, "kapak tam kapanmalı")
	check(m.is_heating(), "kapak oturunca ısıtmalı")


func test_paused_does_not_cook() -> void:
	var m := TostLogic.new()
	var d := _dish()
	m.place(d)
	_close(m)
	for i in 50:
		m.update(0.0, 0.1)
	check_eq(float(d.toast), 0.0, "oyun durmuşken (game_dt = 0) pişmemeli")


func test_max_is_capped() -> void:
	var m := TostLogic.new()
	var d := _dish()
	m.place(d)
	_close(m)
	_run(m, 60.0, 0.25)
	check_eq(float(d.toast), TostLogic.TOAST_MAX, "toastMax aşılmamalı")


func test_threshold_events_fire_once() -> void:
	var m := TostLogic.new()
	var d := _dish()
	m.place(d)
	_close(m)
	var ev := _run(m, 8.0)
	check_eq(ev.size(), 0, "0.9'dan önce olay yok")
	ev = _run(m, 0.5)
	check_eq(ev.size(), 1, "hazır olayı")
	check_eq(ev[0].get("type", ""), "done", "olay türü")
	check_eq(ev[0].get("slot", -1), 0, "olay yuvası")
	ev = _run(m, 2.5)  # ~1.22
	check_eq(ev.size(), 0, "hazır olayı tekrarlanmamalı")
	check(not m.slots[0].smk, "1.25'ten önce duman yok")
	ev = _run(m, 1.0)  # ~1.33
	check(m.slots[0].smk, "1.25'ten sonra duman")
	check_eq(ev.size(), 0, "duman olay üretmez")
	ev = _run(m, 20.0)
	check_eq(ev.size(), 1, "yanma olayı bir kez")
	check_eq(ev[0].get("type", ""), "burn", "yanma olay türü")
	check(m.slots[0].burn, "yanık bayrağı")


func test_placing_cooked_dish_gives_no_event() -> void:
	var m := TostLogic.new()
	var d := _dish()
	d.toast = 1.0
	m.place(d)
	check(m.slots[0].done, "hazır bayrağı eşitlenmeli")
	_close(m)
	var ev := _run(m, 1.0)
	check_eq(ev.size(), 0, "zaten basılmış tost için 'Hazır!' tekrar çıkmamalı")


func test_slots_and_lid_rules() -> void:
	var m := TostLogic.new()
	var a := _dish()
	var b := _dish()
	var c := _dish()
	check_eq(m.place(a, [1, 0]), 1, "tercih edilen yuva")
	check_eq(m.place(b, [1, 0]), 0, "dolu yuva atlanır")
	check_eq(m.place(c), -1, "yer yok")
	check(not m.accepts(), "dolu makine kabul etmez")
	_close(m)
	check(not m.can_pick(), "kapak kapalıyken alınamaz")
	check(m.take(1) == a, "take yemeği döndürür")
	check(not m.accepts(), "kapak kapalı ve içi doluyken bırakılamaz")
	check_eq(m.put_back(a), 1, "iade son alınan yuvaya")
	check(not m.closed, "iade kapağı açar")
	m.update(0.0, 1.0)
	check(m.can_pick(), "kapak açılınca alınabilir")
	m.take(0)
	m.take(1)
	check(m.is_empty(), "boşaldı")
	check(m.take(0).is_empty(), "boş yuvadan {} döner")


func test_two_slots_cook_independently() -> void:
	var m := TostLogic.new()
	var a := _dish()
	var b := _dish()
	b.toast = 0.5
	m.place(a)
	m.place(b)
	_close(m)
	var ev := _run(m, 4.5)
	check(absf(float(a.toast) - 0.5) < 0.01, "a ≈ 0.5")
	check(absf(float(b.toast) - 1.0) < 0.01, "b ≈ 1.0")
	check_eq(ev.size(), 1, "yalnız b hazır")
	check_eq(ev[0].get("slot", -1), 1, "hazır olan yuva 1")
