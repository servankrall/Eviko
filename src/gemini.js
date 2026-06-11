// Google Gemini sağlayıcısı — ücretsiz API katmanıyla çalışır.
// Anahtar: GEMINI_API_KEY  (https://aistudio.google.com/apikey üzerinden ücretsiz alınır)
// REST API kullanılır (ek SDK bağımlılığı yok).

// Model zinciri: biri yoğun/kota dolu/hata verirse sıradakine geçilir.
// Her modelin ayrı ücretsiz kotası vardır; bu, "sürekli hata"yı büyük ölçüde önler.
const MODEL_CHAIN = (() => {
  const base = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash", "gemini-1.5-flash"];
  const pref = process.env.GEMINI_MODEL;
  if (!pref) return base;
  return [pref, ...base.filter((m) => m !== pref)];
})();
const endpointFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function extractJson(text) {
  const t = stripFences(text);
  try {
    return JSON.parse(t);
  } catch {}
  // Metnin içindeki ilk JSON bloğunu yakalamayı dene (model fazladan metin eklerse).
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}

async function tryModel(model, parts, maxOutputTokens) {
  const key = process.env.GEMINI_API_KEY;
  const generationConfig = { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens };
  // 2.5 modellerinde "düşünme" JSON çıktısını kırpabiliyor; kapatıyoruz.
  if (model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  let res;
  try {
    res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PERSONA }] },
        contents: [{ role: "user", parts }],
        generationConfig,
      }),
    });
  } catch {
    return { ok: false, retryable: true, msg: "ağ hatası" };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 403) {
      return { ok: false, fatal: true, status: res.status, msg: body.slice(0, 160) };
    }
    const retryable =
      res.status === 429 || res.status === 500 || res.status === 503 || /overload|unavailable/i.test(body);
    return { ok: false, retryable, status: res.status, msg: body.slice(0, 160) };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, retryable: true, msg: "yanıt okunamadı" };
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || "boş";
    return { ok: false, retryable: reason === "MAX_TOKENS", msg: "boş yanıt (" + reason + ")" };
  }
  const json = extractJson(text);
  if (!json) return { ok: false, retryable: true, msg: "biçim hatası" };
  return { ok: true, value: json };
}

// Yoğunlukta otomatik tekrar dener; model olmazsa yedeklere geçer.
async function callGemini(parts, maxOutputTokens = 4096) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY tanımlı değil.");
  let last = "";
  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const attempts = i === 0 ? 3 : 1; // ilk modeli ısrarla, yedekleri birer kez dene
    for (let a = 0; a < attempts; a++) {
      const r = await tryModel(MODEL_CHAIN[i], parts, maxOutputTokens);
      if (r.ok) return r.value;
      if (r.fatal) {
        throw new Error(`Gemini anahtarı geçersiz/yetkisiz (HTTP ${r.status}).`);
      }
      last = r.msg || `HTTP ${r.status || "?"}`;
      if (r.retryable && a < attempts - 1) {
        await sleep(800 * (a + 1));
        continue;
      }
      break; // sonraki yedek modele geç
    }
  }
  // Buraya gelindiyse tüm modeller başarısız — istemci bunu "yoğunluk" olarak gösterir.
  throw new Error("Şu an çok yoğunuz (" + String(last).slice(0, 120) + "). Birkaç dakika sonra tekrar dene.");
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
  if (language === "en") return " IMPORTANT: Respond ENTIRELY in English.";
  if (language === "de") return " WICHTIG: Antworte vollständig auf Deutsch.";
  if (language === "ar") return " مهم: أجب بالكامل باللغة العربية.";
  return "";
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
  "macros": {"proteinG": 20, "carbsG": 45, "fatG": 15},
  "pairing": "yanında iyi giden içecek/yan lezzet",
  "ingredients": [{"item": "malzeme", "quantity": 2, "unit": "adet|su bardağı|yemek kaşığı|g|ml", "toTaste": false}],
  "steps": ["sıralı pişirme adımları"],
  "tips": ["1-3 ipucu"]
}
Not: "toTaste" true olanlarda "quantity" 0 olabilir. "estimatedCostTl" toplam malzeme maliyeti (TL), "macros" porsiyon başı protein/karbonhidrat/yağ (gram), "pairing" yanında iyi giden kısa öneri.`;

export async function getRecipe({ title, detected = [], preferences = [], language = "tr" }) {
  const elde = detected.length ? `Evde şu malzemeler var: ${detected.join(", ")}. ` : "";
  const prompt =
    `"${title}" adlı yemeğin detaylı, adım adım tarifini ver. ${elde}` +
    "Tarifi 2-4 kişilik temel al ve 'servings' alanına yaz. Malzeme miktarlarını " +
    "sayısal 'quantity' + 'unit' ile, damak zevkine göre olanları 'toTaste': true ile belirt. " +
    "Porsiyon başına tahmini kaloriyi 'caloriesPerServing', makroları " +
    "(protein/karbonhidrat/yağ gram) 'macros', tarifin yaklaşık toplam malzeme " +
    "maliyetini 'estimatedCostTl' (TL), yanında iyi giden bir öneriyi 'pairing' " +
    "olarak ver." +
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
{"days":[{"day":"Pazartesi","title":"yemek adı","description":"kısa açıklama","ingredients":["ana malzeme","..."]}]}
Tam 7 gün ver (Pazartesi'den Pazar'a). Her gün için 4-6 ana malzemeyi "ingredients" olarak yaz.`;

export async function planWeek({ preferences = [], detected = [], language = "tr" }) {
  const elde = detected.length
    ? `Mümkünse şu malzemeleri değerlendir: ${detected.join(", ")}. `
    : "";
  const prompt =
    "Bir haftalık (7 gün) pratik akşam yemeği planı oluştur. " +
    elde +
    "Çeşitli, dengeli ve ev yapımı yemekler seç. Her gün için ana malzemeleri de listele." +
    prefText(preferences) +
    PLAN_SHAPE +
    langText(language);
  return callGemini([{ text: prompt }]);
}

const SUBSTITUTE_SHAPE = `
Yanıtı SADECE şu JSON ile ver: {"item":"...","alternatives":[{"name":"alternatif","note":"kısa açıklama"}]}`;

export async function substitute({ item, title = "", language = "tr" }) {
  const prompt =
    `"${title || "bu tarif"}" için "${item}" malzemesi yerine kullanılabilecek 3-4 pratik ` +
    "alternatif öner; her biri için kısa not." +
    SUBSTITUTE_SHAPE +
    langText(language);
  return callGemini([{ text: prompt }]);
}

// 6) Davet / porsiyon hesaplayıcı
const EVENT_SHAPE = `
Yanıtı SADECE şu JSON ile ver:
{"dish":"ad","people":12,"items":[{"item":"malzeme","quantity":"3 kg","note":"kişi başı ~250 g"}],"estimatedCostTl":0,"tips":["..."]}`;

export async function eventPlan({ people, dish, language = "tr" }) {
  const prompt =
    `${people} kişilik bir "${dish}" için alışveriş ve porsiyon listesi çıkar. Her malzeme için ` +
    "kişi sayısına göre ölçeklenmiş gerçekçi toplam miktarı 'quantity' ile, kişi başı bilgisini " +
    "'note' ile ver. Yaklaşık toplam maliyeti 'estimatedCostTl' (TL) ve 1-3 ipucunu 'tips' olarak ekle." +
    EVENT_SHAPE +
    langText(language);
  return callGemini([{ text: prompt }]);
}

// 7) Market fişi okuma → ürün listesi
const RECEIPT_SHAPE = `
Yanıtı SADECE şu JSON ile ver: {"items":["Süt","Yumurta","Domates"]}`;

export async function readReceipt({ imageBase64, mediaType, language = "tr" }) {
  const prompt =
    "Bu bir market fişi/alışveriş fişi fotoğrafı. Üzerindeki yiyecek, içecek ve temel mutfak " +
    "ürünlerini sade, tekil adlarıyla listele (marka, fiyat, adet, kod yazma; ör. 'Süt', " +
    "'Yumurta'). Yiyecek olmayan kalemleri (poşet, deterjan vb.) atla. Okunmuyorsa boş liste." +
    RECEIPT_SHAPE +
    langText(language);
  return callGemini(
    [{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: prompt }],
    1024
  );
}

// 8) Sesli/serbest istek → yemek önerileri (asistan)
export async function suggest({ query, preferences = [], language = "tr" }) {
  const prompt =
    `Kullanıcının isteği: "${query}". Bu isteğe uygun 6-8 farklı pratik yemek öner (tuz, yağ, ` +
    "soğan, sarımsak, un, yumurta, baharat evde var sayılır). İstekteki kişi sayısı, öğün, " +
    "hafiflik/doyuruculuk gibi ipuçlarını dikkate al. 'detected' boş olabilir." +
    prefText(preferences) +
    ANALYZE_SHAPE +
    langText(language);
  return callGemini([{ text: prompt }]);
}

// 9) Haftalık beslenme koçluğu
const COACH_SHAPE = `
Yanıtı SADECE şu JSON ile ver: {"message":"...","tips":["...","..."]}`;

export async function coach({ summary, language = "tr" }) {
  const prompt =
    "Bir beslenme koçu gibisin (doktor değilsin). Aşağıdaki yeme özetine göre kısa, samimi, " +
    "yargılamayan bir değerlendirme ('message') ve 2-4 uygulanabilir öneri ('tips') ver. Tıbbi " +
    "iddia veya teşhis yapma.\n\nÖzet:\n" +
    summary +
    COACH_SHAPE +
    langText(language);
  return callGemini([{ text: prompt }], 1024);
}
