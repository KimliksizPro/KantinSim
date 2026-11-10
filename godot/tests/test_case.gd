class_name TestCase
extends RefCounted
## Test dosyalarının taban sınıfı. Örnek: tests/test_data.gd

var errors: Array = []


func check(cond: bool, msg: String) -> void:
	if not cond:
		errors.append(msg)


func check_eq(a: Variant, b: Variant, msg: String = "") -> void:
	if a != b:
		errors.append("%s beklenen=%s gelen=%s" % [msg, str(b), str(a)])
