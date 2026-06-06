import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getProvider } from "./src/provider.js";
import { demoAnalyze, demoRecipe, demoCalories } from "./src/demo.js";

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

    const { image, mediaType } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: "Fotoğraf verisi (image) gerekli." });
    }

    const result = await provider.impl.analyzeImage({
      imageBase64: image,
      mediaType: mediaType || "image/jpeg",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("Analiz hatası:", err);
    res.status(500).json({
      error: "Fotoğraf analiz edilirken bir sorun oluştu. Lütfen tekrar deneyin.",
    });
  }
});

// Seçilen yemeğin detaylı tarifi
app.post("/api/recipe", async (req, res) => {
  try {
    const { title, detected } = req.body || {};
    if (!title) {
      return res.status(400).json({ error: "Yemek adı (title) gerekli." });
    }

    if (DEMO) return res.json({ ...demoRecipe(title), demo: true });

    const recipe = await provider.impl.getRecipe({
      title,
      detected: Array.isArray(detected) ? detected : [],
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

    const { image, mediaType } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: "Fotoğraf verisi (image) gerekli." });
    }

    const result = await provider.impl.analyzeCalories({
      imageBase64: image,
      mediaType: mediaType || "image/jpeg",
    });
    res.json({ ...result, demo: false });
  } catch (err) {
    console.error("Kalori analizi hatası:", err);
    res.status(500).json({
      error: "Kalori tahmini yapılırken bir sorun oluştu. Lütfen tekrar deneyin.",
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
