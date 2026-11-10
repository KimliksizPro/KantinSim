extends TestCase
## Semaver / çay ocağı mantığı (scripts/stations/semaver_logic.gd).

const SemaverLogic := preload("res://scripts/stations/semaver_logic.gd")


## seconds kadar oyun zamanı ilerletir; olayları toplar.
func _run(m: SemaverLogic, seconds: float, step: float = 0.1, powered: bool = true, cirak: bool = false, leaf: bool = true) -> Array:
	var events: Array = []
	var n := int(round(seconds / step))
	for i in n:
		events.append_array(m.update(step, step, true, powered, cirak, leaf))
	return events


func _types(events: Array) -> Array:
	var out: Array = []
	for e: Dictionary in events:
		out.append(e.get("type", ""))
	return out


## Kaynamış su + hazır demlik
func _ready_pot() -> SemaverLogic:
	var m := SemaverLogic.new()
	_run(m, SemaverLogic.BOIL_TIME)
	m.brew(true)
	_run(m, m.brew_time + 0.05)
	return m


func test_water_boils_in_boil_time() -> void:
	var m := SemaverLogic.new()
	_run(m, 4.0)
	check(absf(m.water - 0.5) < 0.01, "4 sn sonra su ≈ %%50 (gelen %s)" % str(m.water))
	check(not m.is_boiling(), "henüz kaynamadı")
	_run(m, 4.1)
	check(m.is_boiling(), "8 sn sonra kaynamalı")
	_run(m, 10.0)
	check_eq(m.water, 1.0, "su 1'i aşmamalı")


func test_burner_off_cools_down() -> void:
	var m := SemaverLogic.new()
	_run(m, SemaverLogic.BOIL_TIME)
	m.burner_on = false
	_run(m, 20.0)
	check(absf(m.water - 0.5) < 0.01, "ocak kapalı 20 sn -> su ≈ 0.5 (gelen %s)" % str(m.water))
	_run(m, 40.0)
	check_eq(m.water, 0.0, "su 0'ın altına inmemeli")


func test_no_power_cools_like_burner_off() -> void:
	var m := SemaverLogic.new()
	m.water = 1.0
	_run(m, 4.0, 0.1, false)
	check(absf(m.water - 0.9) < 0.01, "elektrik yokken soğumalı (gelen %s)" % str(m.water))


func test_paused_does_nothing() -> void:
	var m := SemaverLogic.new()
	m.brew(true)
	for i in 100:
		m.update(0.0, 0.1, false, true)
	check_eq(m.water, 0.0, "gün akmıyorken su ısınmamalı")
	check_eq(m.brew_t, 0.0, "gün akmıyorken demlenmemeli")


func test_brew_needs_leaf_and_empty_pot() -> void:
	var m := SemaverLogic.new()
	check(not m.brew(false), "çay yaprağı yokken demlenmemeli")
	check_eq(m.state, "empty", "durum boş kalmalı")
	check(m.brew(true), "boş demlik demlenmeli")
	check_eq(m.state, "brewing", "demleniyor")
	check(not m.brew(true), "demlenirken ikinci demleme olmaz")
	check(not m.can_rebrew(), "demlenirken tazele olmaz")


func test_brew_waits_for_boiling_water() -> void:
	var m := SemaverLogic.new()
	m.brew(true)
	_run(m, 7.0)  # su ≈ 0.875 < 0.9
	check_eq(m.brew_t, 0.0, "su 0.9'a ulaşmadan demleme ilerlememeli")
	_run(m, 1.0)
	check(m.brew_t > 0.0, "su ısınınca demleme başlamalı")


func test_brew_time_and_glass_count() -> void:
	var m := SemaverLogic.new()
	m.brew_time = 25.0
	m.glasses_per_brew = 10
	_run(m, SemaverLogic.BOIL_TIME)
	m.brew(true)
	var ev := _run(m, 24.5)
	check_eq(m.state, "brewing", "25 sn dolmadan hazır olmamalı")
	check(_types(ev).is_empty(), "olay yok")
	ev = _run(m, 0.6)
	check_eq(m.state, "ready", "25 sn sonra hazır")
	check_eq(_types(ev), ["ready"], "hazır olayı bir kez")
	check_eq(m.glasses, 10, "10 bardak")
	check_eq(m.quality(), 1.0, "taze çay tam kalite")


func test_upgraded_glasses() -> void:
	var m := SemaverLogic.new()
	m.brew_time = 12.0
	m.glasses_per_brew = 35
	_run(m, SemaverLogic.BOIL_TIME)
	m.brew(true)
	_run(m, 12.1)
	check_eq(m.glasses, 35, "kazan 35 bardak")


func test_take_and_return() -> void:
	var m := _ready_pot()
	m.glasses = 2
	var q := m.take()
	check_eq(q, 1.0, "taze bardak kalitesi")
	check_eq(m.glasses, 1, "bir bardak azaldı")
	m.give_back()
	check_eq(m.glasses, 2, "iade geri ekler")
	m.take()
	m.take()
	check_eq(m.state, "empty", "son bardakla demlik boşalır")
	check_eq(m.take(), -1.0, "boş demlikten çay çıkmaz")
	m.give_back()
	check_eq(m.state, "ready", "boş demliğe iade hazır yapar")
	check_eq(m.glasses, 1, "iade edilen tek bardak")


func test_return_while_brewing_goes_to_spare() -> void:
	var m := _ready_pot()
	m.glasses = 1
	m.take()
	m.brew(true)
	m.give_back()
	check_eq(m.spare, 1, "demlenirken iade yedekte bekler")
	_run(m, m.brew_time + 0.1)
	check_eq(m.glasses, m.glasses_per_brew + 1, "yedek hazır bardaklara eklenir")
	check_eq(m.spare, 0, "yedek sıfırlanır")


func test_staleness_quality() -> void:
	check_eq(SemaverLogic.quality_at(0.0), 1.0, "taze")
	check_eq(SemaverLogic.quality_at(180.0), 1.0, "180 sn'ye kadar taze")
	check(absf(SemaverLogic.quality_at(300.0) - 0.75) < 0.001, "180+120 sn -> 0.75")
	check_eq(SemaverLogic.quality_at(420.0), 0.5, "180+240 sn -> 0.5")
	check_eq(SemaverLogic.quality_at(10000.0), SemaverLogic.TEA_MIN_Q, "en düşük kalite teaMinQ")


func test_stale_event_and_glass_quality() -> void:
	var m := _ready_pot()
	var ev := _run(m, 179.0, 0.5)
	check(not _types(ev).has("stale"), "180 sn dolmadan bayat uyarısı yok")
	ev = _run(m, 1.5, 0.5)
	check_eq(_types(ev), ["stale"], "bayat uyarısı bir kez")
	check(m.is_stale(), "bayat")
	_run(m, 120.0, 0.5)
	check(absf(m.take() - 0.75) < 0.01, "bayat çayın bardağı düşük kaliteli")
	ev = _run(m, 30.0, 0.5)
	check(not _types(ev).has("stale"), "uyarı tekrarlanmaz")


func test_rebrew_resets() -> void:
	var m := _ready_pot()
	_run(m, 200.0, 0.5)
	check(m.rebrew(true), "tazele")
	check_eq(m.state, "brewing", "tazele yeniden demler")
	check_eq(m.glasses, 0, "kalan çay dökülür")
	check_eq(m.age, 0.0, "yaş sıfırlanır")
	_run(m, m.brew_time + 0.1)
	check_eq(m.quality(), 1.0, "tazelenen çay taze")


func test_cirak_rebrews_empty_pot() -> void:
	var m := SemaverLogic.new()
	_run(m, SemaverLogic.BOIL_TIME)
	var ev := _run(m, 2.0, 0.1, true, true, true)
	check_eq(m.state, "empty", "çırak hemen demlemez")
	ev = _run(m, 0.6, 0.1, true, true, true)
	check_eq(_types(ev), ["cirak_brew"], "2.5 sn sonra çırak demler")
	check_eq(m.state, "brewing", "demleniyor")
	var m2 := SemaverLogic.new()
	ev = _run(m2, 5.0, 0.1, true, true, false)
	check_eq(m2.state, "empty", "çay yaprağı yoksa çırak demleyemez")
