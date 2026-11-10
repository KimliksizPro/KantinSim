extends TestCase
## Web sürümünden aktarılan verilerin doğru yüklendiğini kontrol eder.

var D = preload("res://scripts/game_data.gd").new()


func test_recipes_loaded() -> void:
	check_eq(D.recipes.size(), 9, "tarif sayısı")
	check_eq(int(D.recipes["kasarli_tost"]["price"]), 80, "kaşarlı tost fiyatı")
	check(D.recipes["kasarli_tost"]["toast"] == true, "kaşarlı tost basılmalı")


func test_bins_and_layout() -> void:
	check_eq(D.bin_order.size(), 20, "kutu sayısı")
	check_eq(D.rect("tost"), Rect2(818, 432, 262, 200), "tost makinesi yerleşimi")


func test_assets_exist() -> void:
	for id in D.bin_order:
		check(ResourceLoader.exists("res://assets/ingredients/%s.png" % id), "eksik sprite: " + id)
	for id in D.recipes.keys():
		check(ResourceLoader.exists("res://assets/dishes/%s.png" % id), "eksik yemek sprite: " + id)


func teardown() -> void:
	D.free()
