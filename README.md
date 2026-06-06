# 🥗 Eviko

**Evdeki sebzelerle ne pişirsem?**

Eviko, evindeki sebze ve meyvelerin fotoğrafını çekmeni sağlar; bu malzemeleri
tanır ve onlarla yapabileceğin **birçok pratik yemek** önerir. Beğendiğin yemeğe
dokunduğunda adım adım tarifini gösterir.

Yapay zekâ tarafında **Claude'un görüntü (vision) yeteneği** kullanılır: fotoğraf
analiz edilir, malzemeler tespit edilir ve tariflere dönüştürülür.

---

## Nasıl çalışır?

1. 📸 **Fotoğraf çek** — Sebzeleri bir araya getir, telefonla fotoğrafını çek
   (veya bilgisayardan bir görsel seç).
2. 🔍 **Tanıma** — Eviko fotoğraftaki sebze ve meyveleri tanır.
3. 🍽️ **Öneriler** — Sana çorbadan ana yemeğe, salatadan kahvaltılığa birçok
   yemek seçeneği sunar.
4. 👩‍🍳 **Seç & pişir** — Birini seçersin, adım adım tarifi (malzemeler, süre,
   pişirme adımları, ipuçları) önüne gelir.

---

## Kurulum

Gereksinim: **Node.js 20+**

```bash
# 1) Bağımlılıkları kur
npm install

# 2) API anahtarını ayarla (opsiyonel ama önerilir)
cp .env.example .env
# .env dosyasını açıp ANTHROPIC_API_KEY değerini gir

# 3) Çalıştır
npm start
```

Ardından tarayıcıda **http://localhost:3000** adresini aç.

> 📱 Telefonda kamerayı denemek için bilgisayarın ve telefonun aynı ağda olması
> ve `http://<bilgisayar-ip>:3000` adresine girmen yeterlidir.

### API anahtarı

Gerçek fotoğraf analizi için bir **Anthropic API anahtarı** gerekir
([console.anthropic.com](https://console.anthropic.com) üzerinden alınır).

Anahtarı `.env` dosyasına ekle:

```
ANTHROPIC_API_KEY=sk-ant-...
```

**Anahtar olmadan da çalışır:** Eviko "demo modu"na geçer ve örnek veriler
gösterir; böylece arayüzü hemen deneyebilirsin.

---

## Teknik

| Katman      | Teknoloji                                            |
| ----------- | ---------------------------------------------------- |
| Sunucu      | Node.js + Express                                    |
| Yapay zekâ  | `@anthropic-ai/sdk` · Claude (vision + tarif üretimi) |
| Ön yüz      | Vanilla HTML / CSS / JS (mobil öncelikli)           |

### Proje yapısı

```
eviko/
├── server.js          # Express sunucusu ve API uçları
├── src/
│   ├── claude.js      # Claude entegrasyonu (analiz + tarif)
│   └── demo.js        # Anahtar yokken kullanılan örnek veriler
└── public/            # Ön yüz (arayüz)
    ├── index.html
    ├── styles.css
    └── app.js
```

### API uçları

- `GET  /api/health` → `{ ok, demo }` — ortam durumu
- `POST /api/analyze` → `{ image, mediaType }` gönderir; `{ detected, recipes }` döner
- `POST /api/recipe` → `{ title, detected }` gönderir; adım adım tarifi döner

---

## Notlar

- Görseller, hız ve maliyet için tarayıcıda küçültülerek (en uzun kenar ~1280px)
  gönderilir.
- Tarifler model tarafından üretilir; alerjen ve gıda güvenliği konusunda kendi
  muhakemeni kullan.
