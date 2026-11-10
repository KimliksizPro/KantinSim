extends TestCase
## Tarif tanıma ve kalite değerlendirme (web js/recipes.js ile aynı sonuçlar).

const LINE := {"type": "recipe", "id": "kasarli_tost"}


func _tost(toast: float, layer_ids: Array = ["kasar"]) -> Dictionary:
	var d := Items.dish("tost_ekmegi", {"toast": toast})
	for id in layer_ids:
		d.layers.append(Recipes.layer_from_ing(Items.ing(id)))
	return d


func test_cook_quality() -> void:
	check_eq(Recipes.cook_quality(0.0), 0.05, "çiğ")
	check_eq(Recipes.cook_quality(0.85), 1.0, "mükemmel alt sınır")
	check_eq(Recipes.cook_quality(1.2), 1.0, "mükemmel üst sınır")
	check_eq(Recipes.cook_quality(1.6), 0.08, "yanık")
	check(Recipes.cook_quality(0.65) > 0.3 and Recipes.cook_quality(0.65) < 1.0, "az pişmiş ara değer")
	check(Recipes.cook_quality(1.35) > 0.35 and Recipes.cook_quality(1.35) < 1.0, "fazla pişmiş ara değer")


func test_cook_label_and_stage() -> void:
	check_eq(Recipes.cook_label(0.1), "Çiğ")
	check_eq(Recipes.cook_label(1.0), "Tam kıvamında")
	check_eq(Recipes.cook_label(1.7), "Yanmış")
	check_eq(Recipes.cook_stage(0.1), 0)
	check_eq(Recipes.cook_stage(1.0), 1)
	check_eq(Recipes.cook_stage(1.4), 2)


func test_identify() -> void:
	check_eq(Recipes.identify(_tost(0.0)), "kasarli_tost", "kaşarlı tost")
	check_eq(Recipes.identify(_tost(0.0, ["kasar", "sucuk"])), "karisik_tost", "karışık tost daha özgül")
	check_eq(Recipes.identify(_tost(0.0, [])), "", "sadece ekmek tarif değil")
	check_eq(Recipes.identify(Items.ing("kasar")), "", "malzeme tarif değil")


func test_evaluate_perfect() -> void:
	var e := Recipes.evaluate(_tost(1.0), LINE)
	check(e.ok, "kabul edilmeli")
	check_eq(e.quality, 1.0, "mükemmel kalite")
	check_eq(e.notes.size(), 0, "not olmamalı")


func test_evaluate_raw_and_burnt() -> void:
	var raw := Recipes.evaluate(_tost(0.0), LINE)
	check(raw.ok and raw.quality < 0.1, "basılmamış tost düşük kalite")
	check(raw.notes.has("Tost basılmamış"), "basılmamış notu")
	var burnt := Recipes.evaluate(_tost(1.8), LINE)
	check(burnt.ok and burnt.quality < 0.1, "yanık tost düşük kalite")
	check(burnt.notes.has("Tost yanmış"), "yanmış notu")


func test_evaluate_wrong() -> void:
	check(not Recipes.evaluate(_tost(1.0, []), LINE).ok, "kaşar eksik → reddedilir")
	check(not Recipes.evaluate(Items.ing("kasar"), LINE).ok, "malzeme yemek değil")
	check(not Recipes.evaluate(Items.dish("yarim_ekmek"), LINE).ok, "yanlış taban")
	var extra := Recipes.evaluate(_tost(1.0, ["kasar", "domates"]), LINE)
	check(extra.ok and is_equal_approx(extra.quality, 0.75), "istenmeyen domates -0.25")
	var alien := Recipes.evaluate(_tost(1.0, ["kasar", "marul"]), LINE)
	check(alien.ok and is_equal_approx(alien.quality, 0.65), "tarife uymayan malzeme -0.35")


func test_labels() -> void:
	check_eq(Recipes.line_label(LINE), "Kaşarlı Tost")
	check_eq(Recipes.suffix_siz("Soğan"), "soğansız")
	check_eq(Recipes.suffix_siz("Domates"), "domatessiz")
	check_eq(Recipes.suffix_siz("Turşu"), "turşusuz")
	check_eq(Recipes.item_name(_tost(1.0)), "Kaşarlı Tost")
	check_eq(Recipes.item_name(Items.ing("kasar")), "Kaşar")


func test_layer_from_ing() -> void:
	var l := Recipes.layer_from_ing(Items.ing("kofte", {"cookA": 1.0, "cookB": 0.2}))
	check_eq(l.cook, 0.6, "köfte ortalama pişme")
	check_eq(l.q, 0.05, "en kötü yüz belirler")
	check_eq(Recipes.layer_from_ing(Items.ing("kasar")).q, 1.0, "pişmeyen malzeme q=1")
