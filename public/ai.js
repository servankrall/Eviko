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

  function prefsLine(prefs) {
    return prefs && prefs.length
      ? `\nDiyet tercihleri: ${prefs.join(", ")}. Tüm önerileri ve tarifi bunlara KESİNLİKLE uygun yap.`
      : "";
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

  function buildBody(model, parts, maxOutputTokens) {
    const cfg = {
      responseMimeType: "application/json",
      temperature: 0.6,
      maxOutputTokens,
    };
    // 2.5 modelleri varsayılan olarak "düşünür" ve token bütçesini tüketerek
    // JSON çıktısını yarıda kesebilir → düşünmeyi kapatıyoruz.
    if (/2\.5/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
    return JSON.stringify({
      systemInstruction: { parts: [{ text: PERSONA }] },
      contents: [{ role: "user", parts }],
      generationConfig: cfg,
    });
  }

  // Tek modele istek atar; ASLA exception fırlatmaz — durum nesnesi döndürür.
  async function tryModel(model, parts, maxOutputTokens) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
      encodeURIComponent(keyOf());
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildBody(model, parts, maxOutputTokens),
      });
    } catch {
      return { ok: false, network: true, retryable: true, msg: "ağ" };
    }
    if (!res.ok) {
      let msg = "";
      try {
        msg = (await res.json())?.error?.message || "";
      } catch {}
      if (res.status === 400 || res.status === 403) {
        return { ok: false, fatal: true, status: res.status, msg };
      }
      const retryable =
        res.status === 429 || res.status === 500 || res.status === 503 || /overload/i.test(msg);
      return { ok: false, retryable, status: res.status, msg };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, retryable: true, msg: "yanıt okunamadı" };
    }
    const cand = data && data.candidates && data.candidates[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .map((p) => p.text || "")
      .join("");
    if (!text) {
      const reason =
        (cand && cand.finishReason) ||
        (data && data.promptFeedback && data.promptFeedback.blockReason) ||
        "boş";
      return { ok: false, retryable: reason === "MAX_TOKENS", msg: "boş yanıt (" + reason + ")" };
    }
    try {
      return { ok: true, value: JSON.parse(strip(text)) };
    } catch {
      return { ok: false, retryable: true, msg: "biçim hatası" };
    }
  }

  // Yoğunlukta otomatik tekrar dener; model olmazsa yedeklere geçer.
  async function call(parts, maxOutputTokens = 8192) {
    if (!hasKey()) throw new Error("Gemini API anahtarı yok. ⚙️ Ayarlar'dan ekleyin.");
    const chain = modelChain();
    let last = "";
    let sawNetwork = false;
    for (let i = 0; i < chain.length; i++) {
      const attempts = i === 0 ? 3 : 1; // seçili modeli ısrarla, yedekleri birer kez dene
      for (let a = 0; a < attempts; a++) {
        const r = await tryModel(chain[i], parts, maxOutputTokens);
        if (r.ok) return r.value;
        if (r.fatal) {
          throw new Error(
            "Gemini anahtarı geçersiz/yetkisiz. Anahtarı aistudio.google.com/apikey'den oluştur." +
              (r.msg ? ` (${r.msg.slice(0, 140)})` : "")
          );
        }
        if (r.network) sawNetwork = true;
        last = r.msg || `HTTP ${r.status || "?"}`;
        if (r.retryable && a < attempts - 1) {
          await sleep(1000 * (a + 1));
          continue;
        }
        break; // sonraki yedek modele geç
      }
    }
    if (sawNetwork) {
      throw new Error("Google'a bağlanılamadı. İnterneti/VPN'i kontrol et; bazı ağlar engelleyebilir.");
    }
    throw new Error(
      "Şu an yanıt alınamadı (" + String(last).slice(0, 140) + "). Birkaç dakika sonra tekrar dene."
    );
  }

  function langOf() {
    return localStorage.getItem("eviko_lang") || "tr";
  }
  function langLine() {
    return langOf() === "en"
      ? "\nIMPORTANT: Respond ENTIRELY in English (all text values in the JSON)."
      : "";
  }
  function favLine() {
    try {
      const f = JSON.parse(localStorage.getItem("eviko_favorites") || "[]");
      const t = f.map((x) => x && x.title).filter(Boolean).slice(0, 8);
      return t.length
        ? `\nKullanıcının beğendiği yemekler: ${t.join(", ")}. Önerileri bu damak zevkine yakın tut.`
        : "";
    } catch {
      return "";
    }
  }

  const ANALYZE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{"detected":[{"name":"Türkçe ad","emoji":"tek emoji","confidence":"yüksek|orta|düşük"}],
"recipes":[{"id":"kisa-kimlik","title":"ad","description":"kısa tanıtım","category":"çorba|ana yemek|salata|kahvaltı|meze|tatlı|atıştırmalık","durationMinutes":30,"difficulty":"kolay|orta|zor","usesIngredients":["..."],"missingCommonIngredients":["..."]}]}`;

  const RECIPE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{"title":"ad","servings":2,"durationMinutes":30,"difficulty":"kolay|orta|zor","caloriesPerServing":420,"estimatedCostTl":85,"macros":{"proteinG":20,"carbsG":45,"fatG":15},"pairing":"yanında iyi giden içecek/yan lezzet",
"ingredients":[{"item":"malzeme","quantity":2,"unit":"adet|su bardağı|yemek kaşığı|g|ml","toTaste":false}],
"steps":["..."],"tips":["..."]}
"toTaste" true olanlarda "quantity" 0 olabilir. "caloriesPerServing" porsiyon başı tahmini kalori, "estimatedCostTl" toplam malzeme maliyeti (TL), "macros" porsiyon başı protein/karbonhidrat/yağ (gram), "pairing" yanında iyi giden kısa öneri.`;

  const CALORIE_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{"dishName":"ad","summary":"kısa açıklama","totalCalories":350,"confidence":"yüksek|orta|düşük",
"components":[{"name":"bileşen","emoji":"tek emoji","calories":120}],
"macros":{"proteinG":10,"carbsG":40,"fatG":12},"healthNote":"kısa not"}`;

  const PLAN_SHAPE = `
Yanıtı SADECE şu JSON yapısında ver:
{"days":[{"day":"Pazartesi","title":"yemek adı","description":"kısa açıklama","ingredients":["ana malzeme","..."]}]}
Tam 7 gün ver (Pazartesi'den Pazar'a). Her gün için 4-6 ana malzemeyi "ingredients" olarak yaz.`;

  async function analyze(imageBase64, mediaType, prefs = []) {
    const prompt =
      "Bu fotoğraftaki sebze ve meyveleri tanımla. Sonra bunlarla (tuz, yağ, " +
      "soğan, sarımsak, un, yumurta, baharat evde var sayılır) yapılabilecek 6-8 " +
      "çeşitli pratik yemek öner (çorba, ana yemek, salata, kahvaltılık vb.). " +
      "Fotoğrafta sebze/meyve yoksa 'detected' boş olsun." +
      prefsLine(prefs) +
      favLine() +
      ANALYZE_SHAPE +
      langLine();
    return call([{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: prompt }]);
  }

  async function analyzeText(text, prefs = []) {
    const prompt =
      `Kullanıcının elindeki malzemeler: ${text}. Bu malzemelerle (tuz, yağ, soğan, ` +
      "sarımsak, un, yumurta, baharat evde var sayılır) yapılabilecek 6-8 çeşitli " +
      "pratik yemek öner. 'detected' alanına kullanıcının yazdığı malzemeleri uygun " +
      "emoji ve confidence:'yüksek' ile koy." +
      prefsLine(prefs) +
      favLine() +
      ANALYZE_SHAPE +
      langLine();
    return call([{ text: prompt }]);
  }

  async function recipe(title, detected = [], prefs = []) {
    const elde = detected.length ? `Evde şunlar var: ${detected.join(", ")}. ` : "";
    const prompt =
      `"${title}" yemeğinin detaylı, adım adım tarifini ver. ${elde}` +
      "2-4 kişilik temel al ('servings'). Miktarları sayısal 'quantity' + 'unit' ile, " +
      "damak zevkine göre olanları 'toTaste': true ile belirt. Porsiyon başına " +
      "tahmini kaloriyi 'caloriesPerServing', makroları (protein/karbonhidrat/yağ " +
      "gram) 'macros', tarifin yaklaşık toplam malzeme maliyetini 'estimatedCostTl' " +
      "(Türk Lirası) ver. Yanında iyi giden bir içecek/yan lezzeti 'pairing' olarak ekle." +
      prefsLine(prefs) +
      RECIPE_SHAPE +
      langLine();
    return call([{ text: prompt }]);
  }

  async function calories(imageBase64, mediaType) {
    const prompt =
      "Bu hazır/pişmiş bir yemek fotoğrafı. Yemeği tanı, porsiyonu tahmin et; " +
      "tahmini toplam kaloriyi (kcal), bileşen dağılımını ve makroları " +
      "(protein/karbonhidrat/yağ - gram) ver. Görsel tahmindir; emin değilsen " +
      "'confidence' düşük olsun. Yemek yoksa 'dishName' boş olsun." +
      CALORIE_SHAPE +
      langLine();
    return call([{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: prompt }]);
  }

  async function planWeek(prefs = [], detected = []) {
    const elde = detected.length
      ? `Mümkünse şu malzemeleri de değerlendir: ${detected.join(", ")}. `
      : "";
    const prompt =
      "Bir haftalık (7 gün) pratik akşam yemeği planı oluştur. " +
      elde +
      "Çeşitli, dengeli ve ev yapımı yemekler seç. Her gün için ana malzemeleri de listele." +
      prefsLine(prefs) +
      favLine() +
      PLAN_SHAPE +
      langLine();
    return call([{ text: prompt }]);
  }

  async function substitute(item, title) {
    const prompt =
      `"${title || "bu tarif"}" için "${item}" malzemesi yerine kullanılabilecek 3-4 pratik ` +
      "alternatif öner; her biri için çok kısa bir not ekle.\n" +
      `Yanıtı SADECE şu JSON ile ver: {"item":"${item}","alternatives":[{"name":"alternatif","note":"kısa açıklama"}]}` +
      langLine();
    return call([{ text: prompt }]);
  }

  async function eventPlan(people, dish) {
    const prompt =
      `${people} kişilik bir "${dish}" için alışveriş ve porsiyon listesi çıkar. Her malzeme için ` +
      "kişi sayısına göre ölçeklenmiş gerçekçi toplam miktarı 'quantity' ile, kişi başı bilgisini " +
      "'note' ile ver. Yaklaşık toplam maliyeti 'estimatedCostTl' (TL) ve 1-3 ipucunu 'tips' olarak ekle.\n" +
      `Yanıtı SADECE şu JSON ile ver: {"dish":"${dish}","people":${people},"items":[{"item":"malzeme","quantity":"3 kg","note":"kısa not"}],"estimatedCostTl":0,"tips":["..."]}` +
      langLine();
    return call([{ text: prompt }]);
  }

  async function readReceipt(imageBase64, mediaType) {
    const prompt =
      "Bu bir market fişi/alışveriş fişi fotoğrafı. Üzerindeki yiyecek, içecek ve temel mutfak " +
      "ürünlerini sade, tekil adlarıyla listele (marka, fiyat, adet, kod yazma; ör. 'Süt', " +
      "'Yumurta'). Yiyecek olmayan kalemleri (poşet, deterjan vb.) atla. Okunmuyorsa boş liste.\n" +
      'Yanıtı SADECE şu JSON ile ver: {"items":["Süt","Yumurta","Domates"]}' +
      langLine();
    return call([{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: prompt }]);
  }

  async function suggest(query, prefs = []) {
    const prompt =
      `Kullanıcının isteği: "${query}". Bu isteğe uygun 6-8 farklı pratik yemek öner (tuz, yağ, ` +
      "soğan, sarımsak, un, yumurta, baharat evde var sayılır). İstekteki kişi sayısı, öğün, " +
      "hafiflik/doyuruculuk gibi ipuçlarını dikkate al. 'detected' boş olabilir." +
      prefsLine(prefs) +
      favLine() +
      ANALYZE_SHAPE +
      langLine();
    return call([{ text: prompt }]);
  }

  async function coach(summary) {
    const prompt =
      "Bir beslenme koçu gibisin (doktor değilsin). Aşağıdaki yeme özetine göre kısa, samimi, " +
      "yargılamayan bir değerlendirme ('message') ve 2-4 uygulanabilir öneri ('tips') ver. Tıbbi " +
      "iddia veya teşhis yapma.\n\nÖzet:\n" +
      summary +
      '\nYanıtı SADECE şu JSON ile ver: {"message":"...","tips":["...","..."]}' +
      langLine();
    return call([{ text: prompt }]);
  }

  window.GeminiClient = {
    hasKey, analyze, analyzeText, recipe, calories, planWeek, substitute, eventPlan,
    readReceipt, suggest, coach,
  };
})();
