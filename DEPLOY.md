# 🚀 Eviko'yu Render'a yayınlama (ücretsiz)

Bu rehber, Eviko'yu canlı bir web sitesine (ör. `eviko.onrender.com`) dönüştürür.
Hesap, yorum ve "en çok kullanılan" gibi özellikler için sunucu gerektiğinden,
bu adımları yapınca hepsi çalışır.

## 1) Kodu `main`'e al
En kolay yol PR'ı birleştirmek:
- GitHub → depo → **Pull requests** → **#1** → **Merge pull request**.

> Alternatif: Birleştirmeden de yayınlayabilirsin; Render'da branch olarak
> `claude/nifty-curie-oD1Oa` seçmen yeterli.

## 2) Render'da servis oluştur
1. [render.com](https://render.com) → ücretsiz hesap aç (GitHub ile giriş kolay).
2. **New → Blueprint** → Eviko deposunu seç → Render `render.yaml`'ı bulur → **Apply**.
   - (Blueprint çıkmazsa: **New → Web Service** → depo seç → Build: `npm ci`,
     Start: `npm start`, Plan: Free.)
3. **Environment** bölümüne anahtarları gir:
   - `GEMINI_API_KEY` → ücretsiz Gemini anahtarın (aistudio.google.com/apikey).
     *(girmezsen demo modunda örnek verilerle açılır)*
   - `GOOGLE_CLIENT_ID` → Google ile giriş istiyorsan (opsiyonel).
4. **Deploy**. Birkaç dakikada `https://<adın>.onrender.com` hazır olur.

## 3) Telefondan kullan
APK'yı açıp ⚙️ **Ayarlar → Sunucu adresi** alanına `https://<adın>.onrender.com`
yazarsan, telefonun da bu siteye bağlanır (hesap, yorum, ana sayfa dahil).

## Google ile giriş (opsiyonel)
1. [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services →
   Credentials → Create Credentials → OAuth client ID → Web application**.
2. **Authorized JavaScript origins**'e sitenin adresini ekle:
   `https://<adın>.onrender.com`
3. Çıkan **Client ID**'yi Render'da `GOOGLE_CLIENT_ID` olarak gir → yeniden deploy.

## 💾 Veriyi kalıcı yap (silinmesin) — ücretsiz
Render ücretsiz planında dosya sistemi her dağıtımda sıfırlanır. Hesap ve
yorumların **kalıcı** olması için ücretsiz bir Postgres bağla (Eviko bağlanınca
verileri orada tutar):

1. **[neon.tech](https://neon.tech)** (veya [supabase.com](https://supabase.com)) →
   ücretsiz hesap → yeni proje → **Connection string**'i kopyala
   (`postgres://...` ile başlar).
2. Render → servisin → **Environment** → yeni değişken:
   `DATABASE_URL` = kopyaladığın bağlantı dizesi.
3. Kaydet → otomatik yeniden deploy. Artık veriler kalıcı; bir daha silinmez.

> Bağlantı dizesi `?sslmode=require` içermese de Eviko SSL ile bağlanır.

## 📱 Mobilde otomatik bağlantı (URL yazmaya gerek yok)
Kullanıcıların uygulamada sunucu adresi yazmasına gerek kalmadan, APK doğrudan
sitene bağlansın:

1. GitHub → depo → **Settings → Secrets and variables → Actions → Variables →
   New repository variable**.
2. Ad: `EVIKO_API_BASE`, Değer: `https://<adın>.onrender.com`.
3. Sonraki APK derlemesi bu adresi otomatik gömer; indiren herkes hiçbir şey
   yazmadan bağlanır.

> Alternatif: adresi bana söyle, `public/config.js`'e ben gömeyim — aynı sonuç.

## Notlar
- **Ücretsiz plan uykuya geçer:** uzun süre kullanılmazsa ilk istek birkaç saniye
  gecikir (servis uyanır).
