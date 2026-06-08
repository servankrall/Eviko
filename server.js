import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getProvider } from "./src/provider.js";
import {
  demoAnalyze,
  demoRecipe,
  demoCalories,
  demoPlan,
  demoSubstitute,
  demoEventPlan,
  demoReceipt,
} from "./src/demo.js";
import * as db from "./src/db.js";
import {
  hashPassword,
  verifyPassword,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  googleEnabled,
  verifyGoogleToken,
} from "./src/auth.js";
import { getDishPhoto } from "./src/images.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const provider = getProvider(); // null ise demo modu
const DEMO = !provider;

// Base64 görüntüler büyük olabildiği için JSON limitini yükseltiyoruz.
app.use(express.json({ limit: "20mb" }));

// Mobil (Capacitor) farklı origin'den bağlanır → çerezli CORS gerekir.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function isHttps(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

// Oturumu çereze göre yükle (req.user)
app.use((req, _res, next) => {
  const token = parseCookies(req).eviko_sid;
  req.sessionToken = token;
  req.user = token ? db.getSessionUser(token) : null;
  next();
});

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Bu işlem için giriş yapmalısın." });
  next();
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Ortam durumu (ön yüz demo modunu buradan öğrenir)
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, demo: DEMO, provider: provider ? provider.name : null });
});

// Fotoğraf analizi: malzemeler + yemek önerileri
app.post("/api/analyze", async (req, res) => {
  try {
    if (DEMO) return res.json({ ...demoAnalyze(), demo: true });

    const { image, mediaType, preferences, language } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: "Fotoğraf verisi (image) gerekli." });
    }

    const result = await provider.impl.analyzeImage({
      imageBase64: image,
      mediaType: mediaType || "image/jpeg",
      preferences: Array.isArray(preferences) ? preferences : [],
      language: language || "tr",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("Analiz hatası:", err);
    res.status(500).json({
      error: "Fotoğraf analiz edilirken bir sorun oluştu. Lütfen tekrar deneyin.",
    });
  }
});

// Yazılan malzeme listesinden yemek önerileri (fotoğrafsız)
app.post("/api/analyze-text", async (req, res) => {
  try {
    const { text, preferences, language } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "Malzeme metni (text) gerekli." });
    }

    if (DEMO) return res.json({ ...demoAnalyze(), demo: true });

    const result = await provider.impl.analyzeText({
      text: String(text),
      preferences: Array.isArray(preferences) ? preferences : [],
      language: language || "tr",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("Metin analizi hatası:", err);
    res.status(500).json({
      error: "Öneriler hazırlanırken bir sorun oluştu. Lütfen tekrar deneyin.",
    });
  }
});

// Seçilen yemeğin detaylı tarifi
app.post("/api/recipe", async (req, res) => {
  try {
    const { title, detected, preferences, language } = req.body || {};
    if (!title) {
      return res.status(400).json({ error: "Yemek adı (title) gerekli." });
    }

    if (DEMO) return res.json({ ...demoRecipe(title), demo: true });

    const recipe = await provider.impl.getRecipe({
      title,
      detected: Array.isArray(detected) ? detected : [],
      preferences: Array.isArray(preferences) ? preferences : [],
      language: language || "tr",
    });
    res.json({ ...recipe, demo: false });
  } catch (err) {
    console.error("Tarif hatası:", err);
    res.status(500).json({
      error: "Tarif hazırlanırken bir sorun oluştu. Lütfen tekrar deneyin.",
    });
  }
});

// Hazır yemek fotoğrafından kalori tahmini
app.post("/api/calories", async (req, res) => {
  try {
    if (DEMO) return res.json({ ...demoCalories(), demo: true });

    const { image, mediaType, language } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: "Fotoğraf verisi (image) gerekli." });
    }

    const result = await provider.impl.analyzeCalories({
      imageBase64: image,
      mediaType: mediaType || "image/jpeg",
      language: language || "tr",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("Kalori analizi hatası:", err);
    res.status(500).json({
      error: "Kalori tahmini yapılırken bir sorun oluştu. Lütfen tekrar deneyin.",
    });
  }
});

// Haftalık yemek planı
app.post("/api/plan", async (req, res) => {
  try {
    if (DEMO) return res.json({ ...demoPlan(), demo: true });

    const { preferences, detected, language } = req.body || {};
    const result = await provider.impl.planWeek({
      preferences: Array.isArray(preferences) ? preferences : [],
      detected: Array.isArray(detected) ? detected : [],
      language: language || "tr",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("Plan hatası:", err);
    res.status(500).json({
      error: "Haftalık plan hazırlanırken bir sorun oluştu. Lütfen tekrar deneyin.",
    });
  }
});

// Malzeme ikamesi (yerine ne kullanılır?)
app.post("/api/substitute", async (req, res) => {
  try {
    const { item, title, language } = req.body || {};
    if (!item) return res.status(400).json({ error: "item gerekli." });
    if (DEMO) return res.json({ ...demoSubstitute(item), demo: true });
    const result = await provider.impl.substitute({
      item: String(item),
      title: title || "",
      language: language || "tr",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("İkame hatası:", err);
    res.status(500).json({ error: "Alternatif bulunamadı." });
  }
});

// Davet / porsiyon hesaplayıcı
app.post("/api/event-plan", async (req, res) => {
  try {
    const { people, dish, language } = req.body || {};
    if (!dish) return res.status(400).json({ error: "dish gerekli." });
    if (DEMO) return res.json({ ...demoEventPlan(people, dish), demo: true });
    const result = await provider.impl.eventPlan({
      people: Number(people) || 4,
      dish: String(dish),
      language: language || "tr",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("Davet planı hatası:", err);
    res.status(500).json({ error: "Hesaplama yapılamadı. Lütfen tekrar deneyin." });
  }
});

// Market fişi okuma → ürün listesi
app.post("/api/receipt", async (req, res) => {
  try {
    const { image, mediaType, language } = req.body || {};
    if (!image) return res.status(400).json({ error: "image gerekli." });
    if (DEMO) return res.json({ ...demoReceipt(), demo: true });
    const result = await provider.impl.readReceipt({
      imageBase64: image,
      mediaType: mediaType || "image/jpeg",
      language: language || "tr",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("Fiş okuma hatası:", err);
    res.status(500).json({ error: "Fiş okunamadı. Daha net bir fotoğraf deneyin." });
  }
});

// ---------------------------------------------------------------------------
// Hesaplar
// ---------------------------------------------------------------------------
app.get("/api/auth/me", (req, res) => {
  res.json({
    user: db.publicUser(req.user),
    googleEnabled: googleEnabled(),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  });
});

app.post("/api/auth/register", (req, res) => {
  const { email, name, password } = req.body || {};
  if (!EMAIL_RE.test(String(email || ""))) {
    return res.status(400).json({ error: "Geçerli bir e-posta girin." });
  }
  if (String(password || "").length < 6) {
    return res.status(400).json({ error: "Şifre en az 6 karakter olmalı." });
  }
  if (db.findUserByEmail(email)) {
    return res.status(409).json({ error: "Bu e-posta zaten kayıtlı." });
  }
  const user = db.createUser({ email, name, passHash: hashPassword(password) });
  setSessionCookie(res, db.createSession(user.id), isHttps(req));
  res.json({ user: db.publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.findUserByEmail(email);
  if (!user || !user.passHash || !verifyPassword(password, user.passHash)) {
    return res.status(401).json({ error: "E-posta veya şifre hatalı." });
  }
  setSessionCookie(res, db.createSession(user.id), isHttps(req));
  res.json({ user: db.publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  db.deleteSession(req.sessionToken);
  clearSessionCookie(res, isHttps(req));
  res.json({ ok: true });
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const { idToken } = req.body || {};
    const g = await verifyGoogleToken(idToken);
    let user = db.findUserByEmail(g.email);
    if (!user) user = db.createUser({ email: g.email, name: g.name, googleId: g.googleId });
    setSessionCookie(res, db.createSession(user.id), isHttps(req));
    res.json({ user: db.publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: err.message || "Google girişi başarısız." });
  }
});

// ---------------------------------------------------------------------------
// Tarif sosyal verileri (fotoğraf, görüntülenme, yorum, puan)
// ---------------------------------------------------------------------------
app.get("/api/recipes/home", (_req, res) => {
  res.json({
    daily: db.dailyFavorites(12),
    popular: db.mostUsed(12),
    recommended: db.recommended(12),
  });
});

// Tarif açılınca: görüntülenme say + fotoğraf (yoksa Wikimedia'dan) + yorumlar
app.post("/api/recipes/view", async (req, res) => {
  try {
    const { title } = req.body || {};
    if (!title) return res.status(400).json({ error: "title gerekli." });
    const slug = db.slugify(title);
    const r = db.ensureRecipe(slug, title);
    db.incView(slug);
    if (!r.photoTried) {
      const photo = await getDishPhoto(title);
      db.setPhoto(slug, photo);
    }
    const cur = db.getRecipe(slug);
    res.json({
      slug,
      title: cur.title,
      photo: cur.photo,
      views: cur.views,
      rating: db.recipeRating(cur),
      ratingCount: cur.ratingCount || 0,
      comments: db.listComments(slug),
    });
  } catch (err) {
    console.error("recipe view hatası:", err);
    res.status(500).json({ error: "Tarif bilgisi alınamadı." });
  }
});

// Yorum ekle (yalnızca giriş yapanlar)
app.post("/api/recipes/comment", requireAuth, (req, res) => {
  const { title, text, stars } = req.body || {};
  if (!title || !String(text || "").trim()) {
    return res.status(400).json({ error: "Yorum metni gerekli." });
  }
  const slug = db.slugify(title);
  db.ensureRecipe(slug, title);
  db.addComment({
    slug,
    userId: req.user.id,
    userName: req.user.name,
    text,
    stars: Number(stars) || null,
  });
  res.json({ ok: true, comments: db.listComments(slug), rating: db.recipeRating(db.getRecipe(slug)) });
});

db.init()
  .catch((e) => console.error("DB init hatası:", e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`\n🥗  Eviko çalışıyor:  http://localhost:${PORT}`);
      if (DEMO) {
        console.log("⚠️   DEMO MODU: API anahtarı yok, örnek veriler gösterilecek.");
        console.log("    Ücretsiz için GEMINI_API_KEY, ya da ANTHROPIC_API_KEY ekleyin (.env).\n");
      } else {
        console.log(`✅  ${provider.name} bağlantısı hazır (gerçek analiz aktif).\n`);
      }
    });
  });
