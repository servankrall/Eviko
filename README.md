# 🥗 Eviko

**Evdeki sebzelerle ne pişsem?**

Evdeki sebze ve meyvelerin fotoğrafını çek; Eviko onları tanır ve yapabileceğin
**birçok pratik yemek** önerir. Bir tarifi seçince adım adım gösterir. Ayrıca
hazır bir yemeğin fotoğrafından **kalorisini** tahmin eder.

<p align="center"><img src="public/icons/cover.png" width="140" alt="Eviko"></p>

## 📥 Android APK — doğrudan indir

**[➡️ eviko.apk indir](https://github.com/servankrall/Eviko/releases/latest/download/eviko.apk)**

> Bu link her zaman en güncel sürüme gider. Telefonda Ayarlar → "bilinmeyen
> kaynaklara izin ver" açıp dosyayı kur. İlk açılışta uygulamadaki ⚙️ **Ayarlar**'dan
> ücretsiz **Gemini API anahtarını** gir
> ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) — analiz
> doğrudan cihazından çalışır, **sunucu gerekmez**. (Dilersen "Gelişmiş" bölümünden
> kendi sunucunu da kullanabilirsin.)

---

## ✨ Özellikler

- 📸 **Malzeme tanıma + yemek önerileri** — çorbadan salataya 6-8 çeşitli yemek
- 👩‍🍳 **Adım adım tarif** — malzemeler, süre, adımlar, ipuçları
- 🍽️ **Porsiyon ayarlama** — miktarlar kişi sayısına göre ölçeklenir
- 🔥 **Kalori sayımı** — hazır yemeğin fotoğrafından tahmini kalori + makrolar
- ⭐ **Favori tarifler** ve 🛒 **alışveriş listesi** (eksik malzemeler)
- 📱 **PWA** (telefona kurulabilir) + **Android APK**

---

## 🚀 Kurulum

Gereksinim: **Node.js 20+** (APK derlemesi için 22+)

```bash
npm install
cp .env.example .env     # anahtar ekle (aşağıya bak) — yoksa demo modu
npm start                # http://localhost:3000
```

### API anahtarı (3 seçenek)

Öncelik sırası: **Gemini → Claude → Demo**

1. **Ücretsiz (önerilir): Google Gemini** — ücretsiz anahtar:
   [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   ```
   GEMINI_API_KEY=...
   ```
2. **Claude (Anthropic, ücretli):** [console.anthropic.com](https://console.anthropic.com)
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. **Hiçbiri:** Eviko **demo modunda** örnek verilerle çalışır (arayüzü görmek için).

> 📱 Telefondan denemek için bilgisayarınla aynı ağda `http://<bilgisayar-ip>:3000`.

---

## 📦 APK'yı kendin derlemek (opsiyonel)

APK her push'ta **GitHub Actions** ile otomatik derlenir ve hem Release'e hem de
çalışmanın **Artifacts** bölümüne yüklenir. Yerelde derlemek için (Android SDK gerekir):

```bash
npm run android:init    # bir kez: android/ projesini oluşturur
npm run android:build   # APK derler → android/app/build/outputs/apk/debug/
```

---

## 🌐 Canlı yayın (Render)

Hesap, yorum ve "en çok kullanılan" gibi özellikler bir sunucu gerektirir.
Eviko'yu ücretsiz canlıya almak için:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/servankrall/Eviko)

Adım adım anlatım: **[DEPLOY.md](DEPLOY.md)**. Özetle: PR'ı `main`'e birleştir →
Render'da **Blueprint** ile bu depoyu seç → `GEMINI_API_KEY` (ve istersen
`GOOGLE_CLIENT_ID`) gir → deploy. Birkaç dakikada `https://<adın>.onrender.com`
hazır olur.

## 🛠️ Teknik

| Katman     | Teknoloji                                                        |
| ---------- | --------------------------------------------------------------- |
| Sunucu     | Node.js + Express                                               |
| Yapay zekâ | Google Gemini (REST, ücretsiz) **veya** Claude (`@anthropic-ai/sdk`) |
| Ön yüz     | Vanilla HTML/CSS/JS (mobil öncelikli, PWA)                      |
| Mobil      | Capacitor (Android APK) + GitHub Actions                        |

### Proje yapısı

```
eviko/
├── server.js              # Express sunucusu ve API uçları
├── src/
│   ├── provider.js        # Sağlayıcı seçimi (Gemini > Claude > demo)
│   ├── gemini.js          # Google Gemini entegrasyonu (ücretsiz)
│   ├── claude.js          # Claude entegrasyonu
│   └── demo.js            # Anahtar yokken örnek veriler
├── public/                # Ön yüz + PWA (manifest, sw, ikonlar)
├── scripts/gen-icons.mjs  # İkon/kapak üretimi
├── capacitor.config.json  # Capacitor (APK) yapılandırması
└── .github/workflows/android.yml  # APK derleme + Release
```

### API uçları

- `GET  /api/health` → `{ ok, demo, provider }`
- `POST /api/analyze` → `{ image, mediaType }` → `{ detected, recipes }`
- `POST /api/recipe` → `{ title, detected }` → adım adım tarif (ölçeklenebilir)
- `POST /api/calories` → `{ image, mediaType }` → kalori + makro tahmini

---

## 📝 Notlar

- Görseller, hız/maliyet için tarayıcıda küçültülerek (~1280px) gönderilir.
- Tarifler ve kalori değerleri yapay zekâ tahminidir; alerjen ve gıda güvenliği
  için kendi muhakemeni kullan.
