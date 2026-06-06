// İstemci taraflı Google Gemini istemcisi.
// APK/mobilde sunucuya gerek kalmadan, kullanıcının kendi ÜCRETSİZ Gemini
// anahtarıyla doğrudan cihazdan çalışır. Anahtar ⚙️ Ayarlar'dan girilir ve
// yalnızca bu cihazda (localStorage) saklanır.
(function () {
  const keyOf = () => localStorage.getItem("eviko_gemini_key") || "";
  const modelOf = () => localStorage.getItem("eviko_gemini_model") || "gemini-2.5-flash";
  const hasKey = () => Boolean(keyOf());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Seçili model olmazsa otomatik denenecek yedek modeller.
  const FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
  ];
  function modelChain() {
    const chosen = modelOf();
    return [chosen, ...FALLBACK_MODELS.filter((m) => m !== chosen)];
  }

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

  // Tek bir modele istek atar; sonucu/durumunu döndürür (hata fırlatmaz).
  async function tryModel(model, parts, maxOutputTokens) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
      encodeURIComponent(keyOf());
    const res = await fetch(url, {
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
    if (res.ok) {
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || "")
        .join("");
      if (!text) return { ok: false, retryable: true, msg: "boş yanıt" };
      return { ok: true, value: JSON.parse(strip(text)) };
    }
    let msg = "";
    try {
      msg = (await res.json())?.error?.message || "";
    } catch {}
    // Anahtar/yetki hatası: tekrar denemenin/yedeğe geçmenin anlamı yok.
    if (res.status === 400 || res.status === 403) {
      return { ok: false, fatal: true, status: res.status, msg };
    }
    // Yoğunluk/limit: tekrar denenebilir.
    const retryable =
      res.status === 429 || res.status === 500 || res.status === 503 || /overload/i.test(msg);
    return { ok: false, retryable, status: res.status, msg };
  }

  // "Yoğun" hatasında otomatik tekrar dener; model olmazsa yedeklere geçer.
  async function call(parts, maxOutputTokens = 4096) {
    if (!hasKey()) throw new Error("Gemini API anahtarı yok. ⚙️ Ayarlar'dan ekleyin.");
    const chain = modelChain();
    let last = "";
    for (let i = 0; i < chain.length; i++) {
      const attempts = i === 0 ? 3 : 1; // seçili modeli ısrarla, yedekleri birer kez dene
      for (let a = 0; a < attempts; a++) {
        let r;
        try {
          r = await tryModel(chain[i], parts, maxOutputTokens);
        } catch {
          throw new Error("İnternet bağlantısı kurulamadı.");
        }
        if (r.ok) return r.value;
        if (r.fatal) {
          throw new Error(
            "Gemini anahtarı geçersiz/yetkisiz. Anahtarı aistudio.google.com/apikey'den oluştur." +
              (r.msg ? ` (${r.msg.slice(0, 140)})` : "")
          );
        }
        last = r.msg || `HTTP ${r.status}`;
        if (r.retryable && a < attempts - 1) {
          await sleep(1200 * (a + 1)); // 1.2s, 2.4s bekleyerek tekrar dene
          continue;
        }
        break; // sonraki yedek modele geç
      }
    }
    throw new Error(
      "Tüm modeller şu an yoğun/limitli görünüyor. Birkaç dakika sonra tekrar dene. (" +
        String(last).slice(0, 140) +
        ")"
    );
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
