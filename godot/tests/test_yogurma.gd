extends TestCase
## Çiğ köfte leğeni mantığı (scripts/stations/yogurma_logic.gd; web stations_prep.js addRaw / kneadAdd / takeCigkofte).

const YogLogic := preload("res://scripts/stations/yogurma_logic.gd")


func _full() -> YogLogic:
	var y := YogLogic.new()
	for k in YogLogic.RAW:
		y.mark_added(k)
	return y


func test_add_rules() -> void:
	var y := YogLogic.new()
	check_eq(y.check_add("bulgur"), "", "boş leğene bulgur eklenir")
	check_eq(y.check_add("kasar"), "Bu leğene girmez", "kaşar leğene girmez")
	check(not y.mark_added("bulgur"), "tek malzemeyle tamamlanmaz")
	check_eq(y.check_add("bulgur"), "Zaten eklendi", "aynı malzeme iki kez eklenmez")
	check(y.any_added() and not y.all_added(), "kısmen dolu")
	check_eq(y.added_count(), 1, "1/3 malzeme")
	check_eq(y.missing(), ["isot", "salca"] as Array[String], "eksikler")
	y.mark_added("isot")
	check(y.mark_added("salca"), "üçüncü malzemeyle tamam")
	check(y.can_knead(), "yoğrulabilir")
	var l := YogLogic.new()
	l.unlocked = false
	check_eq(l.check_add("bulgur"), "Seviye 3'te açılır", "kilitliyken eklenmez")
	check(not l.mark_added("bulgur"), "kilitliyken işaretlenmez")


func test_knead_requires_all() -> void:
	var y := YogLogic.new()
	y.mark_added("bulgur")
	check(not y.knead_click(), "eksik malzemeyle yoğrulmaz")
	check_eq(y.progress, 0.0, "ilerleme yok")


func test_knead_progress_and_effort() -> void:
	var y := _full()
	y.knead_click()
	check(is_equal_approx(y.progress, YogLogic.CLICK_KNEAD), "tık katkısı")
	check_eq(y.squish, 1.0, "yoğururken sıkışma")
	var m := _full()
	m.effort = 0.5
	m.knead_click()
	check(is_equal_approx(m.progress, YogLogic.CLICK_KNEAD * 2.0), "effort 0.5 iki kat hızlı")
	var d := _full()
	d.knead_drag(Vector2(0, 0), Vector2(110, 0))
	check(is_equal_approx(d.progress, 110.0 / YogLogic.DRAG_DIV), "sürükleme mesafeye göre")
	d.knead_drag(Vector2(0, 0), Vector2(500, 0))
	check(is_equal_approx(d.progress, 110.0 / YogLogic.DRAG_DIV), "büyük sıçrama sayılmaz")
	y.tick(0.1)
	check(y.squish < 1.0, "sıkışma sönümlenir")


func test_finish_batch() -> void:
	var y := _full()
	y.batch = 8
	var done := false
	var clicks := 0
	while not done and clicks < 100:
		done = y.knead_click()
		clicks += 1
	check(done, "parti bitti")
	check_eq(clicks, ceili(1.0 / YogLogic.CLICK_KNEAD), "tık sayısı")
	check_eq(y.portions, 8, "8 porsiyon")
	check_eq(y.q, 1.0, "kalite tam")
	check_eq(y.flash, 1.0, "parlama")
	check(not y.can_knead(), "parti varken yoğrulmaz")
	check_eq(y.check_add("bulgur"), "Önce leğendekini bitir", "parti varken malzeme eklenmez")
	check_eq(y.status().kind, "done", "durum: hazır")


func test_take_and_return() -> void:
	var y := _full()
	y.knead(1.0)
	check_eq(y.portions, 8, "hazır")
	var it := y.take()
	check_eq(it.type, "ing", "malzeme item")
	check_eq(it.id, "cigkofte", "çiğ köfte")
	check_eq(it.q, 1.0, "kalite taşınır")
	check_eq(y.portions, 7, "porsiyon azaldı")
	check(y.can_accept(it), "parti varken geri konur")
	y.put_back(Items.ing("cigkofte", {"q": 0.6}))
	check_eq(y.portions, 8, "geri kondu")
	check_eq(y.q, 0.6, "kalite en düşüğe iner")
	check(not y.can_accept(Items.ing("kasar")), "başka malzeme konmaz")
	# son porsiyon: leğen sıfırlanır
	for i in 7:
		y.take()
	var last := y.take()
	check(not last.is_empty(), "son porsiyon alındı")
	check_eq(y.portions, 0, "porsiyon kalmadı")
	check(not y.any_added(), "leğen boşaldı")
	check(y.take().is_empty(), "boş leğenden alınmaz")
	check(y.can_accept(last), "boş leğene geri konur")
	y.put_back(last)
	check_eq(y.portions, 1, "iade ile parti geri geldi")
	check(y.all_added() and y.progress == 1.0, "iade edilen parti yoğrulmuş sayılır")


func test_cannot_return_into_unfinished() -> void:
	var y := YogLogic.new()
	y.mark_added("bulgur")
	check(not y.can_accept(Items.ing("cigkofte", {"q": 1.0})), "yarım leğene çiğ köfte konmaz")


func test_day_end_and_tooltip() -> void:
	var y := _full()
	check(y.tooltip().begins_with("Yoğur!"), "yoğur ipucu")
	y.knead(1.0)
	check(y.tooltip().contains("8 porsiyon"), "porsiyon ipucu")
	check_eq(y.day_end(), 8, "gün sonu bozulan")
	check(not y.any_added() and y.portions == 0, "gün sonu sıfırlandı")
	check(y.tooltip().contains("Eksik: bulgur, isot, salça"), "eksik ipucu")
	check(y.packet_tooltip("bulgur", "Bulgur", 0).contains("Toptancıdan"), "stok yok ipucu")
	var l := YogLogic.new()
	l.unlocked = false
	check(l.tooltip().contains("Seviye 3"), "kilit ipucu")
	check_eq(l.status().text, "", "kilitliyken durum yok")
