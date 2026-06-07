import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getProvider } from "./src/provider.js";
import { demoAnalyze, demoRecipe, demoCalories, demoPlan } from "./src/demo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const provider = getProvider(); // null ise demo modu
const DEMO = !provider;

// Base64 görüntüler büyük olabildiği için JSON limitini yükseltiyoruz.
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

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

app.listen(PORT, () => {
  console.log(`\n🥗  Eviko çalışıyor:  http://localhost:${PORT}`);
  if (DEMO) {
    console.log("⚠️   DEMO MODU: API anahtarı yok, örnek veriler gösterilecek.");
    console.log("    Ücretsiz için GEMINI_API_KEY, ya da ANTHROPIC_API_KEY ekleyin (.env).\n");
  } else {
    console.log(`✅  ${provider.name} bağlantısı hazır (gerçek analiz aktif).\n`);
  }
});
