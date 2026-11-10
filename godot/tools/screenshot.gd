extends Node
## Otomatik ekran görüntüsü (Claude Code testleri için).
## Kullanım:
##   godot --path godot -- --shot=res://../shots/main.png --frames=90
##   (isteğe bağlı) --scene=res://scenes/main.tscn  --mouse=800,450
## Belirtilen kare sayısı kadar bekler, görüntüyü PNG kaydeder ve oyunu kapatır.
## Not: --headless ile çalışmaz (görüntü üretilmez); normal pencere ile çalıştırın.

var _shot := ""
var _frames := 60
var _count := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot = a.trim_prefix("--shot=")
		elif a.begins_with("--frames="):
			_frames = int(a.trim_prefix("--frames="))
		elif a.begins_with("--scene="):
			get_tree().change_scene_to_file.call_deferred(a.trim_prefix("--scene="))
		elif a.begins_with("--mouse="):
			var p := a.trim_prefix("--mouse=").split(",")
			if p.size() == 2:
				_fake_mouse.call_deferred(Vector2(float(p[0]), float(p[1])))
	set_process(_shot != "")
	if _shot != "":
		# Pencere yöneticisi pencereyi küçültse bile (döşemeli WM) görüntü tam 1600x900 çıksın
		get_window().content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT


func _fake_mouse(pos: Vector2) -> void:
	var ev := InputEventMouseMotion.new()
	ev.position = pos
	ev.global_position = pos
	# 1600x900 mantıksal koordinat (pencere boyutundan bağımsız)
	get_viewport().push_input(ev, true)


func _process(_dt: float) -> void:
	_count += 1
	if _count < _frames:
		return
	set_process(false)
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var path := _shot
	if path.begins_with("res://") or path.begins_with("user://"):
		path = ProjectSettings.globalize_path(path)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var err := img.save_png(path)
	print("SHOT ", path, " err=", err)
	get_tree().quit(0 if err == OK else 1)
