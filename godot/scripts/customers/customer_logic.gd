extends RefCounted
## Müşteri hesapları: sabır, memnuniyet, bahşiş, ödeme (web js/customers.js: computePatience, serve, finishPay).
## Sahneden ve autoload'lardan bağımsız saf statik fonksiyonlar; testlerde doğrudan kullanılır.
## Kullanım: const Logic := preload("res://scripts/customers/customer_logic.gd")

## Tarifin "time" alanına göre sabra eklenen saniye
const TIME_BONUS := {"Çok hızlı": 0.0, "Hızlı": 6.0, "Orta": 12.0, "Uzun": 20.0}
const TIME_BONUS_DEFAULT := 8.0
## Taban sabır aralığı (oyun saniyesi)
const PATIENCE_MIN := 60.0
const PATIENCE_MAX := 80.0
## Birden fazla satırlı siparişte satır başına sabır artışı
const PATIENCE_PER_EXTRA_LINE := 0.12
## Kantin kirliyken (temizlik < 50) sabır çarpanı
const DIRTY_MULT := 0.85

## Bahşiş: kalite bu eşiğin altındaysa hiç yok; en fazla toplamın TIP_MAX_RATE kadarı
const TIP_MIN_QUALITY := 0.55
const TIP_MAX_RATE := 0.2

## Tepki eşikleri
const Q_PERFECT := 0.9
const Q_GOOD := 0.7
const Q_OK := 0.4

const COLOR_PERFECT := Color("#7dff8f")
const COLOR_GOOD := Color("#c6f27a")
const COLOR_OK := Color("#ffd23f")
const COLOR_BAD := Color("#ff6b5b")
const COLOR_NOTE := Color("#ffe3c4")


## Sabır süresi (oyun saniyesi). base_roll: PATIENCE_MIN..PATIENCE_MAX arası zar (çağıran atar).
## lines: sipariş satırları [{type, id, ...}]; type_mult: müşteri tipinin "patience" çarpanı.
static func patience_max(lines: Array, type_mult: float, base_roll: float, dirty: bool = false) -> float:
	var base := base_roll
	for line in lines:
		if line.get("type", "") == "recipe":
			var r: Dictionary = Recipes.recipes().get(line.get("id", ""), {})
			base += float(TIME_BONUS.get(r.get("time", ""), TIME_BONUS_DEFAULT))
	base *= 1.0 + PATIENCE_PER_EXTRA_LINE * maxf(0.0, lines.size() - 1.0)
	base *= type_mult if type_mult > 0.0 else 1.0
	if dirty:
		base *= DIRTY_MULT
	return base


## Anlık memnuniyet (-0.36..+0.24): ortalama kaliteden
static func satisfaction(avg_quality: float) -> float:
	return (avg_quality - 0.6) * 0.6


## Bahşiş oranı: kalite 0.55'ten 1'e çıkarken 0 → %20; kalan sabır azsa %40'ına kadar düşer.
static func tip_rate(quality: float, patience_ratio: float) -> float:
	if quality < TIP_MIN_QUALITY:
		return 0.0
	var pr := clampf(patience_ratio, 0.0, 1.0)
	return TIP_MAX_RATE * ((quality - TIP_MIN_QUALITY) / (1.0 - TIP_MIN_QUALITY)) * (0.4 + 0.6 * pr)


static func tip_for(total: int, quality: float, patience_ratio: float, tip_mult: float = 1.0) -> int:
	var tip := roundi(total * tip_rate(quality, patience_ratio) * tip_mult)
	return tip if tip >= 1 else 0


## Teslim anındaki tepki: {text, color, mood} — mood: "happy" | "idle" | "angry" (sprite adı)
static func reaction(quality: float) -> Dictionary:
	if quality >= Q_PERFECT:
		return {"text": "Mükemmel!", "color": COLOR_PERFECT, "mood": "happy"}
	if quality >= Q_GOOD:
		return {"text": "Güzel", "color": COLOR_GOOD, "mood": "happy"}
	if quality >= Q_OK:
		return {"text": "İdare eder", "color": COLOR_OK, "mood": "idle"}
	return {"text": "Bu ne böyle?!", "color": COLOR_BAD, "mood": "angry"}


## Item bu sipariş satırını karşılıyor mu (bırakma ön kontrolü)?
static func can_serve(item: Dictionary, line: Dictionary) -> bool:
	if item.is_empty() or line.is_empty():
		return false
	return bool(Recipes.evaluate(item, line).get("ok", false))


## Teslim + ödeme hesabı. Dönen sözlük:
##   {ok, quality, total, tip, note, text, color, mood, satisfaction}
## ok=false ise diğer alanlar sıfırdır (müşteri bu item'ı kabul etmez).
static func settle(item: Dictionary, line: Dictionary, price: int, patience_ratio: float, tip_mult: float = 1.0) -> Dictionary:
	var ev := Recipes.evaluate(item, line)
	if not ev.get("ok", false):
		return {"ok": false, "quality": 0.0, "total": 0, "tip": 0, "note": "", "text": "", "color": COLOR_BAD, "mood": "idle", "satisfaction": 0.0}
	var q := clampf(float(ev.get("quality", 0.0)), 0.0, 1.0)
	var notes: Array = ev.get("notes", [])
	var re := reaction(q)
	return {
		"ok": true,
		"quality": q,
		"total": price,
		"tip": tip_for(price, q, patience_ratio, tip_mult),
		# web: not sadece kalite kusursuz değilse gösterilir
		"note": str(notes[0]) if notes.size() > 0 and q < 0.98 else "",
		"text": re.text,
		"color": re.color,
		"mood": re.mood,
		"satisfaction": satisfaction(q),
	}


## Sabır çubuğu rengi: 1 yeşil → 0.4 sarı → 0 kırmızı
static func patience_color(ratio: float) -> Color:
	var r := clampf(ratio, 0.0, 1.0)
	var red := Color("#e5483b")
	var yellow := Color("#f2b62b")
	var green := Color("#4cc764")
	if r < 0.4:
		return red.lerp(yellow, r / 0.4)
	return yellow.lerp(green, minf(1.0, (r - 0.4) / 0.35))
