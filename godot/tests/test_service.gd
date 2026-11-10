extends TestCase
## Vitrin, temizlik ve çöp mantığı (web js/stations_prep.js: vitrinLayout, trash/itemCost, DIRT_SPOTS, updateWipe).

const Service := preload("res://scripts/stations/service_logic.gd")
const VITRIN := Rect2(14, 66, 300, 338)


func _products() -> Dictionary:
	return Recipes.data().get("products", {})


func _start_stock() -> Dictionary:
	var s := {}
	var prods := _products()
	for id: String in prods:
		s[id] = int(prods[id].get("start", 0))
	return s


func _ids(layout: Dictionary, group: String) -> Array:
	var out: Array = []
	for c: Dictionary in layout.cells:
		if c.group == group:
			out.append(c.id)
	return out


func test_vitrin_layout_start() -> void:
	var v := Service.vitrin_layout(VITRIN, _products(), _start_stock(), 1)
	check_eq(v.gi, Rect2(22, 98, 284, 248), "cam iç alanı")
	check_eq(v.hr, 1, "sıcak raf tek satır")
	check_eq(v.cr, 2, "soğutmalı bölüm iki satır")
	var hot := _ids(v, "hazir")
	check_eq(hot.slice(0, 2), ["simit", "pogaca"], "stokta olan sıcak ürünler önde")
	check_eq(hot.size(), 4, "sıcak rafta boş hücreler stoksuz ürünlerle (soluk) dolar")
	var cold := _ids(v, "paketli")
	check_eq(cold.slice(0, 4), ["ayran", "su", "kola", "meyve_suyu"], "orta raf içecekler")
	check(cold.has("cips") and cold.has("cikolata"), "alt raf atıştırmalık")
	check(not cold.has("gofret"), "kilitli ürün görünmez (seviye 2)")
	check(not hot.has("lahmacun"), "kilitli dış sipariş görünmez")
	# hücreler cam içinde ve üst üste binmiyor
	for c: Dictionary in v.cells:
		check(v.gi.grow(0.5).encloses(c.rect), "hücre camın içinde: " + c.id)
	var r0: Rect2 = v.cells[0].rect
	check(not r0.intersects((v.cells[1].rect as Rect2).grow(-0.5)), "komşu hücreler çakışmaz")
	check(v.div_y > v.hot_rect.position.y and v.div_y < v.cold_rect.position.y, "ayıraç bölümlerin arasında")


func test_vitrin_layout_levels_and_stock() -> void:
	var stock := _start_stock()
	stock["simit"] = 0
	stock["et_doner"] = 2
	var v := Service.vitrin_layout(VITRIN, _products(), stock, 1)
	check_eq(_ids(v, "hazir")[0], "pogaca", "stoklu ürünler öne geçer")
	check_eq(_ids(v, "hazir")[1], "et_doner", "dış sipariş stoğu gelince öne")
	var v5 := Service.vitrin_layout(VITRIN, _products(), stock, 5)
	check(_ids(v5, "hazir").size() <= 4, "satır sayısı stoka göre; fazla stoksuz ürün gizlenir")
	var empty := {}
	var ve := Service.vitrin_layout(VITRIN, _products(), empty, 1)
	check(not Service.any_stock(ve, empty), "boş vitrin")
	check_eq(ve.hr + ve.cr, 2, "boş vitrinde her bölüm bir satır")


func test_vitrin_cell_at_and_accepts() -> void:
	var v := Service.vitrin_layout(VITRIN, _products(), _start_stock(), 1)
	var c0: Dictionary = v.cells[0]
	check_eq(Service.cell_at(v, (c0.rect as Rect2).get_center()).get("id", ""), c0.id, "hücre bulma")
	check(Service.cell_at(v, Vector2(16, 70)).is_empty(), "çerçeve hücre değil")
	check(Service.vitrin_accepts(Items.product("ayran"), _products()), "ürün vitrine döner")
	check(not Service.vitrin_accepts(Items.product("yok_boyle"), _products()), "bilinmeyen ürün")
	check(not Service.vitrin_accepts(Items.ing("kasar"), _products()), "malzeme vitrine girmez")
	check(Service.vitrin_tooltip(_products()["simit"], 0, 20).contains("Telefonla"), "stoksuz sıcak ürün ipucu")
	check(Service.vitrin_tooltip(_products()["simit"], 4, 20).contains("bozulur"), "sıcak ürün bozulur")
	check(Service.vitrin_tooltip(_products()["kola"], 0, 45).contains("Toptancı"), "stoksuz paketli ürün ipucu")


func test_trash_rules() -> void:
	check(Service.can_trash(Items.ing("kasar")), "malzeme çöpe")
	check(Service.can_trash(Items.dish("tost_ekmegi")), "yemek çöpe")
	check(Service.can_trash(Items.product("ayran")), "ürün çöpe")
	check(not Service.can_trash({"uid": 1, "type": "tool", "id": "bez"}), "bez çöpe atılmaz")
	check(not Service.can_trash({}), "boş el")
	var d := Recipes.data()
	check_eq(Service.item_cost(Items.product("ayran"), d), 12.0, "ürün israfı = alış fiyatı")
	var kasar := float(d.ingredients.kasar.cost)
	var ekmek := float(d.ingredients.tost_ekmegi.cost)
	var tost := Items.dish("tost_ekmegi", {"layers": [{"id": "kasar", "q": 1.0}]})
	check(is_equal_approx(Service.item_cost(tost, d), roundf((kasar + ekmek) * 10.0) / 10.0), "tost israfı = ekmek + kaşar")
	check(Service.item_cost(Items.ing("cigkofte"), d, 8) > 0.0, "çiğ köfte porsiyon maliyeti")
	check(Service.cop_tooltip(25.0).contains("25 ₺"), "israf ipucu")
	check(not Service.cop_tooltip(0.0).contains("israf"), "israf yoksa yazılmaz")


func test_dirt_visibility() -> void:
	check_eq(Service.visible_dirt_count(100.0), 0, "temizken leke yok")
	check_eq(Service.visible_dirt_count(84.0), 1, "%85 altında ilk leke")
	check_eq(Service.visible_dirt_count(40.0), 5, "%40'ta beş leke")
	check_eq(Service.visible_dirt_count(0.0), Service.DIRT_SPOTS.size(), "tam kirli")
	var order := Service.new_dirt_order()
	var vs := Service.visible_spots(40.0, order)
	check_eq(vs.size(), 5, "görünen leke listesi")
	check_eq(vs[0].spot.seed, 11, "ilk leke sırası (web DIRT_ORDER0)")
	check(vs[4].alpha < vs[0].alpha, "yeni beliren leke daha soluk")
	check_eq(Service.visible_spots(44.5, order)[4].alpha, 0.2, "yeni beliren leke en az 0.2 opak")


func test_wipe_cleans_spot() -> void:
	var order := Service.new_dirt_order()
	var c := 40.0
	var sp: Dictionary = Service.DIRT_SPOTS[order[0]]
	# ilk lekenin üzerinden geçiş: ovulan leke en sona alınır
	var r := Service.wipe(order, c, sp.pos + Vector2(4, 0), sp.pos - Vector2(4, 0))
	check(r.hit, "lekeye değdi")
	check(is_equal_approx(r.clean, 8.0 * Service.WIPE_SPOT), "hareket mesafesiyle orantılı temizlik")
	check_eq(order[Service.visible_dirt_count(c) - 1], 0, "ovulan leke silinecek sıraya alındı")
	# boş yüzeyde az temizlik, duvar/müşteri alanında hiç
	var r2 := Service.wipe(order, c, Vector2(1000, 500), Vector2(1010, 500))
	check(not r2.hit and is_equal_approx(r2.clean, 10.0 * Service.WIPE_SURFACE), "boş yüzey")
	check_eq(Service.wipe(order, c, Vector2(1000, 200), Vector2(1010, 200)).clean, 0.0, "duvar silinmez")
	check_eq(Service.wipe(order, c, Vector2(1000, 500), Vector2(1000, 500)).clean, 0.0, "hareketsiz bez")
	check_eq(Service.wipe(order, c, Vector2(1000, 500), Vector2(400, 500)).clean, 0.0, "ışınlanma sayılmaz")
	# ovalaya ovalaya leke kaybolur
	var before := Service.visible_dirt_count(c)
	var p: Vector2 = sp.pos
	var guard := 0
	while Service.visible_dirt_count(c) == before and guard < 500:
		var q: Vector2 = p + Vector2(6 if guard % 2 == 0 else -6, 0)
		c = minf(100.0, c + Service.wipe(order, c, q, p).clean)
		p = q
		guard += 1
	check_eq(Service.visible_dirt_count(c), before - 1, "bir leke silindi")
	check(c >= Service.DIRT_T[before - 1], "temizlik eşiği geçti")


func test_misc() -> void:
	check(Service.is_bez({"type": "tool", "id": "bez"}), "bez tanınır")
	check(not Service.is_bez(Items.product("ayran")), "ürün bez değil")
	check_eq(Service.clean_color(80.0), Color("#43d17a"), "yeşil")
	check_eq(Service.clean_color(50.0), Color("#ffc93c"), "sarı")
	check_eq(Service.clean_color(10.0), Color("#ff5a4f"), "kırmızı")
	check(Service.temizlik_tooltip(30.0).contains("müfettiş"), "kirli uyarısı")
	check(Service.temizlik_tooltip(95.0).contains("tertemiz"), "temiz")
	check_eq(Service.fmt_money(1500), "1.500 ₺", "para biçimi")
