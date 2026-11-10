extends SceneTree
## Bağımlılıksız basit test çalıştırıcı.
## Kullanım: godot --headless --path godot -s res://tests/run_tests.gd
## tests/ klasöründeki test_*.gd dosyalarını yükler, içlerindeki test_* fonksiyonlarını çalıştırır.
## Her test dosyası RefCounted'dan türer; check(cond, msg) ile doğrulama yapar (aşağıdaki TestCase).

var failed := 0
var passed := 0


func _initialize() -> void:
	var dir := DirAccess.open("res://tests")
	var files: Array[String] = []
	for f in dir.get_files():
		if f.begins_with("test_") and f.ends_with(".gd"):
			files.append(f)
	files.sort()
	for f in files:
		var script: GDScript = load("res://tests/" + f)
		if script == null:
			print("FAIL  %s yüklenemedi" % f)
			failed += 1
			continue
		var inst: Object = script.new()
		for m in inst.get_method_list():
			var n: String = m["name"]
			if not n.begins_with("test_"):
				continue
			inst.set("errors", [])
			inst.call(n)
			var errs: Array = inst.get("errors")
			if errs.is_empty():
				passed += 1
				print("ok    %s::%s" % [f, n])
			else:
				failed += 1
				print("FAIL  %s::%s\n      %s" % [f, n, "\n      ".join(errs)])
		if inst.has_method("teardown"):
			inst.call("teardown")
	print("\n%d geçti, %d başarısız" % [passed, failed])
	quit(1 if failed > 0 else 0)
