extends RefCounted
## Semaverin / çay ocağının saf mantığı (web js/stations_cook.js "SEMAVER" bölümü: brew, rebrew, takeTea,
## semaverZone.onReturn, updateSemaver, teaQuality). Sahneden ve autoload'lardan bağımsızdır; testlerde
## preload ile doğrudan kullanılır. Envanter (çay yaprağı) ve elektrik bilgisi dışarıdan parametreyle gelir.
##
## Akış: ocak açıkken su ısınır (water 0..1). Demlik boşken tıklayınca (1 çay yaprağı) demleme başlar; su
## WATER_BREW_MIN'e ulaşmışsa brew_time sn sonra `glasses_per_brew` bardak çay hazır olur. Hazır çay
## TEA_STALE sn sonra bayatlamaya başlar; kalite TEA_STALE_SPAN sn içinde 1'den TEA_MIN_Q'ya düşer.

## Denge değerleri (web TUNE)
const BOIL_TIME := 8.0          # su 0 -> kaynama (oyun sn)
const BOIL_COOL := 40.0         # ocak kapalı / elektrik yok: kaynamadan soğumaya (oyun sn)
const TEA_STALE := 180.0        # bu yaştan sonra demi geçer
const TEA_STALE_SPAN := 240.0   # kalitenin TEA_MIN_Q'ya inme süresi
const TEA_MIN_Q := 0.5
const WATER_BREW_MIN := 0.9     # demleme bu su sıcaklığının üstünde ilerler
const CIRAK_DELAY := 2.5        # çırak Emre'nin tazelemeden önce beklediği süre
const CIRAK_BUSY := 3.5         # çırağın "Demliyorum!" balonu süresi (gerçek sn)

## "empty" | "brewing" | "ready"
var state: String = "empty"
## Ocak düğmesi (oyuncu tıklayarak açar/kapatır). Elektrikli kazanda ayrıca elektrik gerekir.
var burner_on: bool = true
## Su sıcaklığı 0 (soğuk) .. 1 (kaynıyor)
var water: float = 0.0
var brew_t: float = 0.0
var glasses: int = 0
## Demleme sırasında iade edilen bardaklar (hazır olunca eklenir)
var spare: int = 0
## Hazır çayın yaşı (oyun sn)
var age: float = 0.0
var last_age: float = 0.0
var stale_warned: bool = false
var empty_warned: bool = false
var cirak_t: float = 0.0
var cirak_busy: float = 0.0

## Geliştirme seviyesine göre (Game.upg_val) sahne ayarlar
var brew_time: float = 25.0
var glasses_per_brew: int = 10


## Şu anki çay kalitesi (1 = tavşan kanı, TEA_MIN_Q = demi geçmiş).
func quality() -> float:
	return quality_at(age)


static func quality_at(a: float) -> float:
	if a <= TEA_STALE:
		return 1.0
	return maxf(TEA_MIN_Q, 1.0 - (a - TEA_STALE) / TEA_STALE_SPAN * (1.0 - TEA_MIN_Q))


func is_stale() -> bool:
	return state == "ready" and age >= TEA_STALE


func is_boiling() -> bool:
	return water >= 1.0


## Demleme ilerlemesi 0..1
func brew_progress() -> float:
	return clampf(brew_t / maxf(1.0, brew_time), 0.0, 1.0)


func brew_left() -> float:
	return maxf(0.0, maxf(1.0, brew_time) - brew_t)


## Demlik boş mu (yeni demleme başlatılabilir mi)?
func can_brew() -> bool:
	return state == "empty"


## Demlemeyi başlatır. Çağıran 1 çay yaprağını envanterden düşmüş olmalı (has_leaf = true).
func brew(has_leaf: bool) -> bool:
	if state != "empty" or not has_leaf:
		return false
	state = "brewing"
	brew_t = 0.0
	glasses = 0
	age = 0.0
	stale_warned = false
	empty_warned = false
	return true


## Tazele: kalan çay dökülür, yeniden demlenir (demleme sürerken olmaz).
func can_rebrew() -> bool:
	return state != "brewing"


func rebrew(has_leaf: bool) -> bool:
	if not can_rebrew() or not has_leaf:
		return false
	glasses = 0
	state = "empty"
	return brew(true)


## Bir bardak çay doldurur: kaliteyi döndürür, çay yoksa -1. Son bardaksa demlik boşalır.
func take() -> float:
	if state != "ready" or glasses <= 0:
		return -1.0
	var q := quality()
	glasses -= 1
	last_age = age
	if glasses <= 0:
		state = "empty"
	return q


## İade (web semaverZone.onReturn): bardak geri eklenir; demlik boşaldıysa son yaşla tekrar hazır olur.
func give_back() -> void:
	if state == "ready":
		glasses += 1
	elif state == "empty":
		state = "ready"
		glasses = 1
		age = last_age
		empty_warned = false
	else:
		spare += 1


## Bir kare ilerlet. dt: oyun saniyesi, real_dt: gerçek saniye, run: gün akıyor mu,
## powered: ısıtıcıda enerji var mı (tüplü ocakta hep true), cirak: çırak işe alınmış mı,
## has_leaf: stokta çay yaprağı var mı. Olaylar: [{type: "ready" | "stale" | "cirak_brew"}].
## "cirak_brew" olayında çağıran 1 çay yaprağını envanterden düşer.
func update(dt: float, real_dt: float, run: bool, powered: bool, cirak: bool = false, has_leaf: bool = true) -> Array:
	var events: Array = []
	if run:
		if burner_on and powered:
			water = minf(1.0, water + dt / BOIL_TIME)
		else:
			water = maxf(0.0, water - dt / BOIL_COOL)
	if state == "brewing" and run and water >= WATER_BREW_MIN:
		brew_t += dt
		if brew_t >= maxf(1.0, brew_time):
			state = "ready"
			glasses = maxi(1, glasses_per_brew) + spare
			spare = 0
			age = 0.0
			stale_warned = false
			events.append({"type": "ready"})
	if state == "ready":
		if run:
			age += dt
		if glasses <= 0:
			state = "empty"
		elif not stale_warned and age >= TEA_STALE:
			stale_warned = true
			events.append({"type": "stale"})
	# Çırak Emre: boş ya da demi geçmiş demliği kendisi tazeler
	if cirak_busy > 0.0:
		cirak_busy = maxf(0.0, cirak_busy - real_dt)
	if cirak and run and has_leaf and (state == "empty" or is_stale()):
		cirak_t += dt
		if cirak_t >= CIRAK_DELAY:
			cirak_t = 0.0
			if state == "ready":
				glasses = 0
				state = "empty"
			if brew(true):
				cirak_busy = CIRAK_BUSY
				events.append({"type": "cirak_brew"})
	else:
		cirak_t = 0.0
	return events
