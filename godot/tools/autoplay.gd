extends Node
## Uçtan uca otomatik oynanış denemesi (Claude Code doğrulaması için): sahte fare olaylarıyla
## ekmek → tabak, kaşar → tabak, tabak → tost makinesi, kapak kapat, bekle, aç, tost → müşteri.
## Kullanım: godot --path godot -- --autoplay   (aşamalarda shots/auto_N.png kaydeder, sonucu yazdırıp kapanır)

const BIN_BREAD := Vector2(54, 470)
const BIN_KASAR := Vector2(54, 562)
const PLATE := Vector2(475, 760)
const TOAST_SLOT := Vector2(900, 560)
const LID := Vector2(1060, 446)
const CUSTOMER := Vector2(780, 250)
const COOK_WAIT := 9.4

var _n := 0


func _ready() -> void:
	get_window().content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
	_run.call_deferred()


func _run() -> void:
	await _wait(3.0)  # müşteri gelsin
	await _drag(BIN_BREAD, PLATE)
	await _drag(BIN_KASAR, PLATE)
	await _shot()
	await _drag(PLATE, TOAST_SLOT)
	await _shot()
	await _click(LID)
	await _wait(COOK_WAIT * 0.5)
	await _shot()
	await _wait(COOK_WAIT * 0.5)
	await _click(LID)
	await _wait(0.6)
	await _shot()
	await _mouse(true, TOAST_SLOT)
	await _move(TOAST_SLOT, CUSTOMER)
	await _shot()
	await _mouse(false, CUSTOMER)
	await _wait(0.5)
	await _shot()
	print("AUTOPLAY para=%d servis=%d gelir=%d bahşiş=%d elde=%s" % [
		Game.money, Game.today.get("served", 0), Game.today.get("revenue", 0), Game.today.get("tips", 0), str(Drag.held)])
	get_tree().quit(0 if Game.today.get("served", 0) == 1 else 1)


func _wait(sec: float) -> void:
	await get_tree().create_timer(sec).timeout


func _mouse(pressed: bool, pos: Vector2) -> void:
	var ev := InputEventMouseButton.new()
	ev.button_index = MOUSE_BUTTON_LEFT
	ev.pressed = pressed
	ev.position = pos
	ev.global_position = pos
	get_viewport().push_input(ev, true)
	await _wait(0.05)


func _move(from: Vector2, to: Vector2) -> void:
	for i in 8:
		var ev := InputEventMouseMotion.new()
		ev.position = from.lerp(to, (i + 1) / 8.0)
		ev.global_position = ev.position
		get_viewport().push_input(ev, true)
		await _wait(0.04)


func _drag(from: Vector2, to: Vector2) -> void:
	await _mouse(true, from)
	await _move(from, to)
	await _mouse(false, to)
	await _wait(0.15)


func _click(pos: Vector2) -> void:
	await _move(pos, pos)
	await _mouse(true, pos)
	await _wait(0.4)  # dokun-taşı eşiğinden uzun: düz tıklama
	await _mouse(false, pos)
	await _wait(0.3)


func _shot() -> void:
	_n += 1
	await RenderingServer.frame_post_draw
	var path := ProjectSettings.globalize_path("res://../shots/auto_%d.png" % _n)
	get_viewport().get_texture().get_image().save_png(path)
