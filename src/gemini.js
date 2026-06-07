// Google Gemini sağlayıcısı — ücretsiz API katmanıyla çalışır.
// Anahtar: GEMINI_API_KEY  (https://aistudio.google.com/apikey üzerinden ücretsiz alınır)
// REST API kullanılır (ek SDK bağımlılığı yok).

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export function hasApiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

const PERSONA =
  "Sen Eviko adlı sıcak, pratik bir mutfak asistanısın. Sebze/meyve " +
  "fotoğraflarından pratik yemekler önerir, hazır yemeklerin kalorisini tahmin " +
  "edersin. Türk ev mutfağına ağırlık verirsin ve her zaman Türkçe yanıt verirsin.";

function stripFences(s) {
  return s
    .replace(/^﻿/, "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function callGemini(parts, maxOutputTokens = 4096) {
  const key = process.env.GEMINI_API_KEY;
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PERSONA }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.6,
        maxOutputTokens,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API hatası (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");
  if (!text) throw new Error("Gemini yanıtı boş döndü.");
  return JSON.parse(stripFences(text));
}

// 1) Malzeme tanıma + yemek önerileri
const ANALYZE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver (başka metin ekleme):
{
  "detected": [{"name": "Türkçe ad", "emoji": "tek emoji", "confidence": "yüksek|orta|düşük"}],
  "recipes": [{
    "id": "kisa-kimlik",
    "title": "Yemek adı",
    "description": "bir-iki cümlelik iştah açıcı tanıtım",
    "category": "çorba|ana yemek|salata|kahvaltı|meze|tatlı|atıştırmalık",
    "durationMinutes": 30,
    "difficulty": "kolay|orta|zor",
    "usesIngredients": ["fotoğraftaki kullanılan malzemeler"],
    "missingCommonIngredients": ["eksik olabilecek temel malzemeler"]
  }]
}`;

function prefText(preferences) {
  return preferences && preferences.length
    ? ` Diyet tercihleri: ${preferences.join(", ")}. Önerileri ve tarifi bunlara kesinlikle uygun yap.`
    : "";
}

function langText(language) {
  return language === "en" ? " IMPORTANT: Respond ENTIRELY in English." : "";
}

export async function analyzeImage({ imageBase64, mediaType, preferences = [], language = "tr" }) {
  const prompt =
    "Bu fotoğraftaki tüm sebze ve meyveleri tanımla. Sonra bu malzemelerle " +
    "(tuz, yağ, soğan, sarımsak, un, yumurta, baharat gibi temel malzemeler evde " +
    "var sayılır) yapılabilecek 6-8 çeşitli pratik yemek öner. Çorba, ana yemek, " +
    "salata, kahvaltılık gibi farklı türlerde olsun. Fotoğrafta sebze/meyve yoksa " +
    "'detected' listesini boş bırak." +
    prefText(preferences) +
    ANALYZE_SHAPE +
    langText(language);
  return callGemini([
    { inlineData: { mimeType: mediaType, data: imageBase64 } },
    { text: prompt },
  ]);
}

export async function analyzeText({ text, preferences = [], language = "tr" }) {
  const prompt =
    `Kullanıcının elindeki malzemeler: ${text}. Bu malzemelerle yapılabilecek 6-8 ` +
    "çeşitli pratik yemek öner (tuz, yağ, soğan, sarımsak, un, yumurta, baharat evde " +
    "var sayılır). 'detected' alanına kullanıcının yazdığı malzemeleri uygun emoji ve " +
    "confidence 'yüksek' ile koy." +
    prefText(preferences) +
    ANALYZE_SHAPE +
    langText(language);
  return callGemini([{ text: prompt }]);
}

// 2) Tarif detayı (ölçeklenebilir porsiyon)
const RECIPE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{
  "title": "Yemek adı",
  "servings": 2,
  "durationMinutes": 30,
  "difficulty": "kolay|orta|zor",
  "caloriesPerServing": 420,
  "estimatedCostTl": 85,
  "ingredients": [{"item": "malzeme", "quantity": 2, "unit": "adet|su bardağı|yemek kaşığı|g|ml", "toTaste": false}],
  "steps": ["sıralı pişirme adımları"],
  "tips": ["1-3 ipucu"]
}
Not: "toTaste" true olanlarda "quantity" 0 olabilir. "estimatedCostTl" tarifin yaklaşık toplam malzeme maliyeti (TL).`;

export async function getRecipe({ title, detected = [], preferences = [], language = "tr" }) {
  const elde = detected.length ? `Evde şu malzemeler var: ${detected.join(", ")}. ` : "";
  const prompt =
    `"${title}" adlı yemeğin detaylı, adım adım tarifini ver. ${elde}` +
    "Tarifi 2-4 kişilik temel al ve 'servings' alanına yaz. Malzeme miktarlarını " +
    "sayısal 'quantity' + 'unit' ile, damak zevkine göre olanları 'toTaste': true ile belirt. " +
    "Porsiyon başına tahmini kaloriyi 'caloriesPerServing', tarifin yaklaşık toplam " +
    "malzeme maliyetini 'estimatedCostTl' (TL) olarak ver." +
    prefText(preferences) +
    RECIPE_SHAPE +
    langText(language);
  return callGemini([{ text: prompt }]);
}

// 3) Kalori tahmini
const CALORIE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{
  "dishName": "yemek adı",
  "summary": "bir cümlelik açıklama",
  "totalCalories": 350,
  "confidence": "yüksek|orta|düşük",
  "components": [{"name": "bileşen", "emoji": "tek emoji", "calories": 120}],
  "macros": {"proteinG": 10, "carbsG": 40, "fatG": 12},
  "healthNote": "kısa faydalı not"
}`;

export async function analyzeCalories({ imageBase64, mediaType, language = "tr" }) {
  const prompt =
    "Bu, hazır/pişmiş bir yemek fotoğrafı. Yemeği tanı, porsiyonu fotoğraftan " +
    "tahmin et; tahmini toplam kaloriyi (kcal), bileşen dağılımını ve makro " +
    "besinleri (protein/karbonhidrat/yağ - gram) ver. Bu görsel bir tahmindir; " +
    "emin değilsen 'confidence' düşük olsun. Yemek yoksa 'dishName' boş olsun." +
    CALORIE_SHAPE +
    langText(language);
  return callGemini(
    [{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: prompt }],
    2048
  );
}

// 4) Haftalık yemek planı
const PLAN_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{"days":[{"day":"Pazartesi","title":"yemek adı","description":"kısa açıklama"}]}
Tam 7 gün ver (Pazartesi'den Pazar'a).`;

export async function planWeek({ preferences = [], detected = [], language = "tr" }) {
  const elde = detected.length
    ? `Mümkünse şu malzemeleri değerlendir: ${detected.join(", ")}. `
    : "";
  const prompt =
    "Bir haftalık (7 gün) pratik akşam yemeği planı oluştur. " +
    elde +
    "Çeşitli, dengeli ve ev yapımı yemekler seç." +
    prefText(preferences) +
    PLAN_SHAPE +
    langText(language);
  return callGemini([{ text: prompt }]);
}
