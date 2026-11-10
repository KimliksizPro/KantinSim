extends TestCase
## Malzeme kutuları ve hazırlık tezgahı mantığı (web js/stations_prep.js: binRect, plateCheck, dropOnPlate).

const Logic := preload("res://scripts/stations/prep_logic.gd")
const BINS := Rect2(12, 432, 340, 458)


func test_bin_grid() -> void:
	check_eq(Logic.bin_rect(BINS, 0), Rect2(16, 436, 77, 458.0 / 5 - 8), "ilk kutu")
	check_eq(Logic.bin_index_at(BINS, Vector2(60, 480), 20), 0, "tost ekmeği kutusu")
	check_eq(Logic.bin_index_at(BINS, Vector2(60, 570), 20), 4, "kaşar kutusu (2. satır)")
	check_eq(Logic.bin_index_at(BINS, Vector2(340, 880), 20), 19, "son kutu")
	check_eq(Logic.bin_index_at(BINS, Vector2(13, 433), 20), -1, "kutu arası boşluk")
	check_eq(Logic.bin_index_at(BINS, Vector2(500, 500), 20), -1, "alan dışı")
	check_eq(Logic.bin_order()[4], "kasar", "kutu sırası")


func test_returnable_ing() -> void:
	check(Logic.is_returnable_ing(Items.ing("kasar")), "pişmemiş kaşar geri konur")
	check(Logic.is_returnable_ing(Logic.make_ing("kofte")), "çiğ köfte geri konur")
	check(not Logic.is_returnable_ing(Items.ing("kofte", {"cookA": 0.5, "cookB": 0.0})), "pişmeye başlamış köfte konmaz")
	check(not Logic.is_returnable_ing(Items.ing("patates", {"cook": 0.0})), "fritöze girmiş patates konmaz")
	check(not Logic.is_returnable_ing(Items.ing("bulgur")), "kutusu olmayan hammadde konmaz")
	check(not Logic.is_returnable_ing(Items.dish("tost_ekmegi")), "yemek kutuya konmaz")
	check(not Logic.is_returnable_ing(Items.product("ayran")), "ürün kutuya konmaz")


func test_bin_info() -> void:
	check_eq(Logic.ing_unlock_level("kasar"), 1, "kaşar 1. seviyede")
	check(Logic.ing_unlock_level("hamburger_ekmegi") > 1, "hamburger ekmeği sonradan açılır")
	check_eq(Logic.bin_fill("kasar", 0), {"icons": 0, "heap": 0}, "boş kutu")
	check_eq(Logic.bin_fill("kasar", 20), {"icons": 3, "heap": 4}, "dolu kutu")
	check_eq(Logic.bin_fill("kasar", 2).icons, 1, "az stok tek sprite")
	check(Logic.bin_tooltip("tost_ekmegi", 5, 1).contains("Tezgahtaki boş tabağa koy"), "taban ipucu")
	check(Logic.bin_tooltip("kasar", 0, 1).contains("Bitti!"), "biten stok ipucu")
	check(Logic.bin_tooltip("kasar", 2, 1).contains("Az kaldı"), "az stok ipucu")


func test_empty_plate_rules() -> void:
	var plates := Logic.new_plates()
	check_eq(plates.size(), 2, "başlangıçta 2 tabak")
	check(Logic.plate_check(plates, 0, Items.ing("tost_ekmegi")).ok, "boş tabağa ekmek")
	check_eq(Logic.plate_check(plates, 0, Items.ing("kasar")).msg, "Önce tabağa ekmek koy", "boş tabağa kaşar olmaz")
	check_eq(Logic.plate_check(plates, 0, Items.ing("patates")).msg, "Çiğ patates önce fritöze!", "çiğ patates")
	check(Logic.plate_check(plates, 1, Items.dish("tost_ekmegi")).ok, "boş tabağa yemek")
	check(not Logic.plate_check(plates, 0, Items.product("ayran")).ok, "ürün tabağa konmaz")
	check(not Logic.plate_check(plates, 2, Items.ing("tost_ekmegi")).ok, "olmayan tabak")
	check(not Logic.plate_check(plates, 0, {}).ok, "boş item")


func test_build_kasarli_tost() -> void:
	var plates := Logic.new_plates()
	var r := Logic.drop_on_plate(plates, 0, Items.ing("tost_ekmegi"))
	check(r.ok and r.added == "dish", "ekmek tabağa yemek olarak kondu")
	check_eq(plates[0].type, "dish", "tabakta dish var")
	check_eq(plates[0].id, "tost_ekmegi", "taban tost ekmeği")
	r = Logic.drop_on_plate(plates, 0, Items.ing("kasar"))
	check(r.ok and r.added == "layer", "kaşar katman olarak eklendi")
	check_eq(plates[0].layers.size(), 1, "tek katman")
	check_eq(plates[0].layers[0].id, "kasar", "katman kaşar")
	check_eq(Recipes.identify(plates[0]), "kasarli_tost", "tarif tanındı")
	check(Logic.needs_toast(plates[0]), "tost makinesi gerekiyor")
	plates[0].toast = 1.0
	check(not Logic.needs_toast(plates[0]), "basılınca gerekmez")
	check(plates[1] == null, "diğer tabak boş")


func test_filled_plate_rules() -> void:
	var plates := Logic.new_plates()
	Logic.drop_on_plate(plates, 0, Items.ing("tost_ekmegi"))
	check_eq(Logic.plate_check(plates, 0, Items.ing("tost_ekmegi")).msg, "Ekmek üstüne ekmek olmaz", "ikinci taban")
	check_eq(Logic.plate_check(plates, 0, Items.ing("bulgur")).msg, "Bu hammadde tabağa konmaz", "hammadde")
	check(Logic.plate_check(plates, 0, Items.ing("ketcap")).ok, "sos eklenir")
	check(Logic.plate_check(plates, 0, Items.ing("patates", {"cook": 1.0})).ok, "kızarmış patates eklenir")
	var r := Logic.drop_on_plate(plates, 0, Items.ing("kofte", {"cookA": 0.1, "cookB": 0.2}))
	check(r.ok and r.warn == "Köfte çiğ!", "çiğ köfte uyarısı")
	check(plates[0].layers[0].has("cook"), "köfte katmanı pişme bilgisi taşır")
	for k in Logic.MAX_LAYERS - 1:
		check(Logic.drop_on_plate(plates, 0, Items.ing("kasar")).ok, "katman %d" % k)
	check_eq(plates[0].layers.size(), Logic.MAX_LAYERS, "katman sınırı doldu")
	check_eq(Logic.drop_on_plate(plates, 0, Items.ing("kasar")).msg, "Tabak taşıyor!", "sınır aşılmaz")
	check_eq(plates[0].layers.size(), Logic.MAX_LAYERS, "sayı değişmedi")


func test_dish_drop_and_redirect() -> void:
	var plates := Logic.new_plates()
	Logic.drop_on_plate(plates, 0, Items.ing("tost_ekmegi"))
	var tost := Items.dish("tost_ekmegi", {"toast": 1.0})
	check_eq(Logic.plate_check(plates, 0, tost).msg, "Bu tabak dolu", "yönlendirme kapalıyken dolu tabak")
	var r := Logic.drop_on_plate(plates, 0, tost)
	check(r.ok and r.index == 1, "dolu tabağa bırakılan yemek boş tabağa gider")
	check_eq(plates[1].uid, tost.uid, "aynı yemek nesnesi")
	check(not Logic.drop_on_plate(plates, 0, Items.dish("lavas")).ok, "iki tabak da doluysa olmaz")


func test_take_and_return() -> void:
	var plates := Logic.new_plates()
	check(Logic.take_plate(plates, 0).is_empty(), "boş tabaktan bir şey alınmaz")
	Logic.drop_on_plate(plates, 1, Items.ing("lavas"))
	var d := Logic.take_plate(plates, 1)
	check_eq(d.get("id", ""), "lavas", "yemeğin tamamı alındı")
	check(plates[1] == null, "tabak boşaldı")
	check_eq(Logic.place_dish_back(plates, d, 1), 1, "aynı tabağa geri döner")
	var d2 := Items.dish("tost_ekmegi")
	check_eq(Logic.place_dish_back(plates, d2, 1), 0, "tercih doluysa ilk boş tabak")
	check_eq(Logic.place_dish_back(plates, Items.dish("lavas"), 0), -1, "yer yoksa -1")
	check_eq(Logic.free_plate(plates), -1, "boş tabak kalmadı")


func test_tooltip_and_bump() -> void:
	check(Logic.plate_tooltip(null).begins_with("Boş tabak"), "boş tabak ipucu")
	var plates := Logic.new_plates()
	Logic.drop_on_plate(plates, 0, Items.ing("tost_ekmegi"))
	Logic.drop_on_plate(plates, 0, Items.ing("kasar"))
	Logic.drop_on_plate(plates, 0, Items.ing("kasar"))
	var tip := Logic.plate_tooltip(plates[0])
	check(tip.begins_with("Kaşarlı Tost"), "ipucu tarif adıyla başlar")
	check(tip.contains("İçindekiler: Tost Ekmeği, Kaşar x2"), "içindekiler: " + tip)
	check(tip.contains("Tost makinesine götür"), "tost yönlendirmesi")
	check_eq(Logic.contents_text(Items.dish("lavas")), "", "katmansız yemek")
	check_eq(Logic.bump_scale(0.0, 5.0), 1.0, "zıplama yok")
	check(Logic.bump_scale(5.0, 5.16) > 1.0, "zıplama ortası")
	check_eq(Logic.bump_scale(5.0, 6.0), 1.0, "zıplama bitti")
