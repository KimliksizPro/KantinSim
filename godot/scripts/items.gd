class_name Items
extends RefCounted
## Sürüklenen her şey bir Dictionary "item"dır (web CONTRACT.md "Item modeli" ile aynı alanlar):
##   {uid, type:"ing", id:"kasar"}                                  tek malzeme
##   {uid, type:"dish", id:"tost_ekmegi", layers:[{id,q,cook?}], toast:0.0}   tabak yemeği
##   {uid, type:"product", id:"ayran"}                              hazır ürün
## Tabağa malzeme eklerken her zaman Recipes.layer_from_ing(item) kullanın.

static var _next_uid: int = 1


static func uid() -> int:
	_next_uid += 1
	return _next_uid


static func ing(id: String, extra: Dictionary = {}) -> Dictionary:
	var it := {"uid": uid(), "type": "ing", "id": id}
	it.merge(extra, true)
	return it


static func dish(base_id: String, extra: Dictionary = {}) -> Dictionary:
	var it := {"uid": uid(), "type": "dish", "id": base_id, "layers": [], "toast": 0.0}
	it.merge(extra, true)
	return it


static func product(id: String) -> Dictionary:
	return {"uid": uid(), "type": "product", "id": id}


## Malzemenin türü (data.ingredients[id].kind): "base" (tost ekmeği gibi tabak tabanı), "topping" ...
static func ing_kind(id: String) -> String:
	var ings: Dictionary = Recipes.data().get("ingredients", {})
	return ings.get(id, {}).get("kind", "")


## Malzeme item'ı bir tabak yemeğinin tabanı mı (tabağa ilk konunca dish'e dönüşür)?
static func is_base(id: String) -> bool:
	return ing_kind(id) == "base"
