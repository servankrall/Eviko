// İstemci taraflı Google Gemini istemcisi.
// APK/mobilde sunucuya gerek kalmadan, kullanıcının kendi ÜCRETSİZ Gemini
// anahtarıyla doğrudan cihazdan çalışır. Anahtar ⚙️ Ayarlar'dan girilir ve
// yalnızca bu cihazda (localStorage) saklanır.
(function () {
  const keyOf = () => localStorage.getItem("eviko_gemini_key") || "";
  const modelOf = () => localStorage.getItem("eviko_gemini_model") || "gemini-2.0-flash";
  const hasKey = () => Boolean(keyOf());

  const PERSONA =
    "Sen Eviko adlı sıcak, pratik bir mutfak asistanısın. Sebze/meyve " +
    "fotoğraflarından pratik yemekler önerir, hazır yemeklerin kalorisini tahmin " +
    "edersin. Türk ev mutfağına ağırlık verir ve her zaman Türkçe yanıt verirsin.";

  function strip(s) {
    return s
      .replace(/^﻿/, "")
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
  }

  async function call(parts, maxOutputTokens = 4096) {
    if (!hasKey()) {
      throw new Error("Gemini API anahtarı yok. ⚙️ Ayarlar'dan ekleyin.");
    }
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelOf()}:generateContent?key=` +
      encodeURIComponent(keyOf());
    let res;
    try {
      res = await fetch(url, {
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
    } catch {
      throw new Error("İnternet bağlantısı kurulamadı.");
    }
    if (!res.ok) {
      let msg = "";
      try {
        const e = await res.json();
        msg = e?.error?.message || "";
      } catch {}
      const detail = msg ? ` (${msg.slice(0, 160)})` : "";
      if (res.status === 400 || res.status === 403) {
        throw new Error(
          "Gemini anahtarı geçersiz veya yetkisiz görünüyor. Anahtarı aistudio.google.com/apikey'den aldığından emin ol." +
            detail
        );
      }
      if (res.status === 429) {
        throw new Error(
          "Gemini limiti aşıldı. ⚙️ Ayarlar'dan daha yüksek ücretsiz limitli bir model seç " +
            "(ör. gemini-2.0-flash-lite) veya 1 dakika bekle. Anahtar AI Studio'dan değilse " +
            "ücretsiz kota 0 olabilir." +
            detail
        );
      }
      throw new Error(`Gemini hatası (${res.status}).${detail}`);
    }
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("");
    if (!text) throw new Error("Gemini boş yanıt verdi, tekrar deneyin.");
    return JSON.parse(strip(text));
  }

  const ANALYZE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{"detected":[{"name":"Türkçe ad","emoji":"tek emoji","confidence":"yüksek|orta|düşük"}],
"recipes":[{"id":"kisa-kimlik","title":"ad","description":"kısa tanıtım","category":"çorba|ana yemek|salata|kahvaltı|meze|tatlı|atıştırmalık","durationMinutes":30,"difficulty":"kolay|orta|zor","usesIngredients":["..."],"missingCommonIngredients":["..."]}]}`;

  const RECIPE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{"title":"ad","servings":2,"durationMinutes":30,"difficulty":"kolay|orta|zor",
"ingredients":[{"item":"malzeme","quantity":2,"unit":"adet|su bardağı|yemek kaşığı|g|ml","toTaste":false}],
"steps":["..."],"tips":["..."]}
"toTaste" true olanlarda "quantity" 0 olabilir.`;

  const CALORIE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{"dishName":"ad","summary":"kısa açıklama","totalCalories":350,"confidence":"yüksek|orta|düşük",
"components":[{"name":"bileşen","emoji":"tek emoji","calories":120}],
"macros":{"proteinG":10,"carbsG":40,"fatG":12},"healthNote":"kısa not"}`;

  async function analyze(imageBase64, mediaType) {
    const prompt =
      "Bu fotoğraftaki sebze ve meyveleri tanımla. Sonra bunlarla (tuz, yağ, " +
      "soğan, sarımsak, un, yumurta, baharat evde var sayılır) yapılabilecek 6-8 " +
      "çeşitli pratik yemek öner (çorba, ana yemek, salata, kahvaltılık vb.). " +
      "Fotoğrafta sebze/meyve yoksa 'detected' boş olsun." + ANALYZE_SHAPE;
    return call([{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: prompt }]);
  }

  async function recipe(title, detected = []) {
    const elde = detected.length ? `Evde şunlar var: ${detected.join(", ")}. ` : "";
    const prompt =
      `"${title}" yemeğinin detaylı, adım adım tarifini ver. ${elde}` +
      "2-4 kişilik temel al ('servings'). Miktarları sayısal 'quantity' + 'unit' ile, " +
      "damak zevkine göre olanları 'toTaste': true ile belirt." + RECIPE_SHAPE;
    return call([{ text: prompt }]);
  }

  async function calories(imageBase64, mediaType) {
    const prompt =
      "Bu hazır/pişmiş bir yemek fotoğrafı. Yemeği tanı, porsiyonu tahmin et; " +
      "tahmini toplam kaloriyi (kcal), bileşen dağılımını ve makroları " +
      "(protein/karbonhidrat/yağ - gram) ver. Görsel tahmindir; emin değilsen " +
      "'confidence' düşük olsun. Yemek yoksa 'dishName' boş olsun." + CALORIE_SHAPE;
    return call([{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: prompt }], 2048);
  }

  window.GeminiClient = { hasKey, analyze, recipe, calories };
})();
