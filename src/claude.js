import Anthropic from "@anthropic-ai/sdk";

// Görme (vision) + tarif üretimi için en yetenekli model.
const MODEL = "claude-opus-4-8";

let client = null;

/** API anahtarı tanımlı mı? (demo modunu belirlemek için kullanılır) */
export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!client) {
    // Anahtarı ortam değişkeninden okur (ANTHROPIC_API_KEY).
    client = new Anthropic();
  }
  return client;
}

/** Modelin döndürdüğü ilk metin bloğunu bulup JSON olarak ayrıştırır. */
function parseJson(message) {
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("Model yanıtında beklenen metin bulunamadı.");
  }
  return JSON.parse(textBlock.text);
}

const PERSONA =
  "Sen Eviko adlı sıcak, pratik bir mutfak asistanısın. Kullanıcıların evindeki " +
  "sebze ve meyvelerle yapabilecekleri kolay yemekler önerir, hazır yemeklerin " +
  "kalorisini tahmin edersin. Türk ev mutfağına ağırlık verir, ama dünya " +
  "mutfağından da çeşitli fikirler sunarsın. Her zaman Türkçe yanıt verir ve " +
  "gerçekçi, uygulanabilir bilgiler paylaşırsın.";

// ---------------------------------------------------------------------------
// 1) Fotoğraf analizi: malzemeleri tanı + birçok yemek önerisi üret
// ---------------------------------------------------------------------------

function prefText(preferences) {
  return preferences && preferences.length
    ? ` Diyet tercihleri: ${preferences.join(", ")}. Önerileri ve tarifi bunlara kesinlikle uygun yap.`
    : "";
}

function langText(language) {
  return language === "en" ? " IMPORTANT: Respond ENTIRELY in English." : "";
}

const ANALYZE_SCHEMA = {
  type: "object",
  properties: {
    detected: {
      type: "array",
      description: "Fotoğrafta görülen sebze ve meyveler",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Malzemenin Türkçe adı" },
          emoji: { type: "string", description: "Malzemeyi temsil eden tek bir emoji" },
          confidence: {
            type: "string",
            enum: ["yüksek", "orta", "düşük"],
            description: "Tanıma güven düzeyi",
          },
        },
        required: ["name", "emoji", "confidence"],
        additionalProperties: false,
      },
    },
    recipes: {
      type: "array",
      description: "Önerilen yemekler (6-8 adet, çeşitli türlerde)",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Kısa, benzersiz kimlik (ör. 'menemen')" },
          title: { type: "string", description: "Yemeğin adı" },
          description: { type: "string", description: "Bir-iki cümlelik iştah açıcı tanıtım" },
          category: {
            type: "string",
            enum: ["çorba", "ana yemek", "salata", "kahvaltı", "meze", "tatlı", "atıştırmalık"],
          },
          durationMinutes: { type: "integer", description: "Tahmini toplam süre (dakika)" },
          difficulty: { type: "string", enum: ["kolay", "orta", "zor"] },
          usesIngredients: {
            type: "array",
            description: "Bu yemekte kullanılan, fotoğraftaki malzemeler",
            items: { type: "string" },
          },
          missingCommonIngredients: {
            type: "array",
            description: "Gerekebilecek ama fotoğrafta olmayan temel malzemeler",
            items: { type: "string" },
          },
        },
        required: [
          "id",
          "title",
          "description",
          "category",
          "durationMinutes",
          "difficulty",
          "usesIngredients",
          "missingCommonIngredients",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["detected", "recipes"],
  additionalProperties: false,
};

const ANALYZE_INSTRUCTION =
  "Bu fotoğraftaki tüm sebze ve meyveleri tek tek tanımla. Ardından bu " +
  "malzemelerle yapılabilecek 6-8 farklı pratik yemek öner. Tuz, yağ, soğan, " +
  "sarımsak, un, yumurta, baharat gibi temel mutfak malzemelerinin evde " +
  "bulunduğunu varsayabilirsin. Öneriler çeşitli olsun: çorba, ana yemek, " +
  "salata, kahvaltılık gibi farklı türlerde. Her yemekte fotoğraftaki hangi " +
  "malzemeleri kullandığını belirt; gerekiyorsa eksik temel malzemeleri de yaz. " +
  "Fotoğrafta hiç sebze/meyve göremezsen 'detected' listesini boş bırak.";

/**
 * Fotoğrafı analiz eder, malzemeleri ve yemek önerilerini döndürür.
 * @param {{ imageBase64: string, mediaType: string }} args
 */
export async function analyzeImage({ imageBase64, mediaType, preferences = [], language = "tr" }) {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: ANALYZE_INSTRUCTION + prefText(preferences) + langText(language) },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: ANALYZE_SCHEMA } },
  });

  return parseJson(message);
}

/**
 * Yazılan malzeme listesinden yemek önerileri üretir (fotoğrafsız).
 * @param {{ text: string, preferences?: string[] }} args
 */
export async function analyzeText({ text, preferences = [], language = "tr" }) {
  const instruction =
    `Kullanıcının elindeki malzemeler: ${text}. Bu malzemelerle yapılabilecek 6-8 ` +
    "farklı pratik yemek öner (tuz, yağ, soğan, sarımsak, un, yumurta, baharat evde " +
    "var sayılır). 'detected' alanına kullanıcının yazdığı malzemeleri uygun emoji ve " +
    "confidence 'yüksek' ile koy." +
    prefText(preferences) +
    langText(language);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [{ role: "user", content: instruction }],
    output_config: { format: { type: "json_schema", schema: ANALYZE_SCHEMA } },
  });
  return parseJson(message);
}

// ---------------------------------------------------------------------------
// 2) Tarif detayı: seçilen yemeğin adım adım tarifi (ölçeklenebilir porsiyon)
// ---------------------------------------------------------------------------

const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    servings: { type: "integer", description: "Tarifin temel alındığı kişi sayısı (2-4 arası)" },
    durationMinutes: { type: "integer", description: "Toplam süre (dakika)" },
    difficulty: { type: "string", enum: ["kolay", "orta", "zor"] },
    caloriesPerServing: { type: "integer", description: "Porsiyon başına tahmini kalori (kcal)" },
    estimatedCostTl: { type: "integer", description: "Tarifin yaklaşık toplam malzeme maliyeti (TL)" },
    macros: {
      type: "object",
      description: "Porsiyon başına makro besinler (gram)",
      properties: {
        proteinG: { type: "integer" },
        carbsG: { type: "integer" },
        fatG: { type: "integer" },
      },
      required: ["proteinG", "carbsG", "fatG"],
      additionalProperties: false,
    },
    pairing: { type: "string", description: "Yanında iyi giden içecek/yan lezzet" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "Malzeme adı" },
          quantity: {
            type: "number",
            description:
              "Belirtilen 'servings' için sayısal miktar. 'toTaste' true ise 0 olabilir.",
          },
          unit: {
            type: "string",
            description: "Birim, ör. 'adet', 'su bardağı', 'yemek kaşığı', 'g', 'ml'. Yoksa boş.",
          },
          toTaste: {
            type: "boolean",
            description: "Miktar 'damak zevkine göre' ise true (tuz, baharat vb.)",
          },
        },
        required: ["item", "quantity", "unit", "toTaste"],
        additionalProperties: false,
      },
    },
    steps: { type: "array", description: "Sıralı pişirme adımları", items: { type: "string" } },
    tips: { type: "array", description: "Faydalı ipuçları (1-3 adet)", items: { type: "string" } },
  },
  required: [
    "title",
    "servings",
    "durationMinutes",
    "difficulty",
    "caloriesPerServing",
    "estimatedCostTl",
    "macros",
    "pairing",
    "ingredients",
    "steps",
    "tips",
  ],
  additionalProperties: false,
};

/**
 * Seçilen yemeğin detaylı tarifini üretir.
 * @param {{ title: string, detected?: string[], preferences?: string[], language?: string }} args
 */
export async function getRecipe({ title, detected = [], preferences = [], language = "tr" }) {
  const elde =
    detected.length > 0 ? `Evde şu malzemeler var: ${detected.join(", ")}.` : "";

  const instruction =
    `"${title}" adlı yemeğin detaylı, adım adım tarifini ver. ${elde} ` +
    "Tarifi 2-4 kişilik temel al ve bu kişi sayısını 'servings' alanına yaz. " +
    "Malzeme miktarlarını ölçeklenebilir biçimde ver: her malzeme için sayısal " +
    "'quantity', birim için 'unit' ve damak zevkine göre olanlar için 'toTaste' " +
    "true olsun. Porsiyon başına tahmini kaloriyi 'caloriesPerServing', makroları " +
    "(protein/karbonhidrat/yağ gram) 'macros', tarifin yaklaşık toplam malzeme " +
    "maliyetini 'estimatedCostTl' (TL), yanında iyi giden bir öneriyi 'pairing' " +
    "olarak ver. Net pişirme adımları ve birkaç pratik ipucu ekle." +
    prefText(preferences) +
    langText(language);

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [{ role: "user", content: instruction }],
    output_config: { format: { type: "json_schema", schema: RECIPE_SCHEMA } },
  });

  return parseJson(message);
}

// ---------------------------------------------------------------------------
// 3) Kalori analizi: hazır/pişmiş bir yemeğin fotoğrafından kalori tahmini
// ---------------------------------------------------------------------------

const CALORIE_SCHEMA = {
  type: "object",
  properties: {
    dishName: { type: "string", description: "Tabaktaki yemeğin adı" },
    summary: { type: "string", description: "Bir cümlelik kısa açıklama" },
    totalCalories: { type: "integer", description: "Fotoğraftaki porsiyonun tahmini toplam kalorisi (kcal)" },
    confidence: { type: "string", enum: ["yüksek", "orta", "düşük"] },
    components: {
      type: "array",
      description: "Tabaktaki ana bileşenler ve tahmini kalorileri",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          emoji: { type: "string" },
          calories: { type: "integer", description: "Bu bileşenin tahmini kalorisi (kcal)" },
        },
        required: ["name", "emoji", "calories"],
        additionalProperties: false,
      },
    },
    macros: {
      type: "object",
      properties: {
        proteinG: { type: "integer", description: "Tahmini protein (gram)" },
        carbsG: { type: "integer", description: "Tahmini karbonhidrat (gram)" },
        fatG: { type: "integer", description: "Tahmini yağ (gram)" },
      },
      required: ["proteinG", "carbsG", "fatG"],
      additionalProperties: false,
    },
    healthNote: { type: "string", description: "Kısa, faydalı bir not veya ipucu" },
  },
  required: ["dishName", "summary", "totalCalories", "confidence", "components", "macros", "healthNote"],
  additionalProperties: false,
};

const CALORIE_INSTRUCTION =
  "Bu, hazır/pişmiş bir yemek fotoğrafı. Tabaktaki yemeği tanı ve porsiyon " +
  "büyüklüğünü fotoğraftan tahmin et. Tahmini toplam kaloriyi (kcal), ana " +
  "bileşenlerin kalori dağılımını ve makro besinleri (protein, karbonhidrat, " +
  "yağ — gram) ver. Bunların görsel bir tahmin olduğunu unutma; emin değilsen " +
  "'confidence' alanını düşük tut. Fotoğrafta yemek yoksa dishName'i boş bırak.";

/**
 * Hazır yemek fotoğrafından kalori tahmini yapar.
 * @param {{ imageBase64: string, mediaType: string }} args
 */
export async function analyzeCalories({ imageBase64, mediaType, language = "tr" }) {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: CALORIE_INSTRUCTION + langText(language) },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: CALORIE_SCHEMA } },
  });

  return parseJson(message);
}

// ---------------------------------------------------------------------------
// 4) Haftalık yemek planı
// ---------------------------------------------------------------------------

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    days: {
      type: "array",
      description: "7 günlük plan (Pazartesi-Pazar)",
      items: {
        type: "object",
        properties: {
          day: { type: "string", description: "Gün adı" },
          title: { type: "string", description: "O günün yemeği" },
          description: { type: "string", description: "Kısa açıklama" },
          ingredients: {
            type: "array",
            description: "O günün 4-6 ana malzemesi",
            items: { type: "string" },
          },
        },
        required: ["day", "title", "description", "ingredients"],
        additionalProperties: false,
      },
    },
  },
  required: ["days"],
  additionalProperties: false,
};

/**
 * Bir haftalık akşam yemeği planı üretir.
 * @param {{ preferences?: string[], detected?: string[], language?: string }} args
 */
export async function planWeek({ preferences = [], detected = [], language = "tr" }) {
  const elde = detected.length
    ? `Mümkünse şu malzemeleri değerlendir: ${detected.join(", ")}. `
    : "";
  const instruction =
    "Bir haftalık (7 gün, Pazartesi'den Pazar'a) pratik akşam yemeği planı oluştur. " +
    elde +
    "Çeşitli, dengeli ve ev yapımı yemekler seç. Her gün için 4-6 ana malzemeyi de yaz." +
    prefText(preferences) +
    langText(language);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [{ role: "user", content: instruction }],
    output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
  });
  return parseJson(message);
}

// ---------------------------------------------------------------------------
// 5) Malzeme ikamesi
// ---------------------------------------------------------------------------

const SUBSTITUTE_SCHEMA = {
  type: "object",
  properties: {
    item: { type: "string" },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          note: { type: "string" },
        },
        required: ["name", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["item", "alternatives"],
  additionalProperties: false,
};

/**
 * Bir malzeme yerine kullanılabilecek alternatifleri önerir.
 * @param {{ item: string, title?: string, language?: string }} args
 */
export async function substitute({ item, title = "", language = "tr" }) {
  const instruction =
    `"${title || "bu tarif"}" için "${item}" malzemesi yerine kullanılabilecek 3-4 ` +
    "pratik alternatif öner; her biri için çok kısa bir not ekle." +
    langText(language);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [{ role: "user", content: instruction }],
    output_config: { format: { type: "json_schema", schema: SUBSTITUTE_SCHEMA } },
  });
  return parseJson(message);
}

// ---------------------------------------------------------------------------
// 6) Davet / porsiyon hesaplayıcı
// ---------------------------------------------------------------------------

const EVENT_SCHEMA = {
  type: "object",
  properties: {
    dish: { type: "string" },
    people: { type: "integer" },
    items: {
      type: "array",
      description: "Kişi sayısına göre ölçeklenmiş malzeme listesi",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "Malzeme adı" },
          quantity: { type: "string", description: "Toplam miktar, ör. '3 kg', '12 adet'" },
          note: { type: "string", description: "Kısa not (kişi başı vb.), yoksa boş" },
        },
        required: ["item", "quantity", "note"],
        additionalProperties: false,
      },
    },
    estimatedCostTl: { type: "integer", description: "Yaklaşık toplam maliyet (TL)" },
    tips: { type: "array", items: { type: "string" } },
  },
  required: ["dish", "people", "items", "estimatedCostTl", "tips"],
  additionalProperties: false,
};

/**
 * Belirli kişi sayısı için bir yemek/etkinliğin malzeme ve porsiyon listesini çıkarır.
 * @param {{ people: number, dish: string, language?: string }} args
 */
export async function eventPlan({ people, dish, language = "tr" }) {
  const instruction =
    `${people} kişilik bir "${dish}" için alışveriş ve porsiyon listesi çıkar. ` +
    "Her malzeme için kişi sayısına göre ölçeklenmiş gerçekçi toplam miktarı 'quantity' " +
    "(ör. '3 kg', '12 adet') ile, gerekiyorsa kişi başı bilgisini 'note' ile ver. Yaklaşık " +
    "toplam maliyeti 'estimatedCostTl' (TL) ve 1-3 pratik ipucunu 'tips' olarak ekle." +
    langText(language);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [{ role: "user", content: instruction }],
    output_config: { format: { type: "json_schema", schema: EVENT_SCHEMA } },
  });
  return parseJson(message);
}

// ---------------------------------------------------------------------------
// 7) Market fişi okuma → ürün listesi
// ---------------------------------------------------------------------------

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "Fişteki yiyecek/içecek/market ürünlerinin sade, tekil adları",
      items: { type: "string" },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const RECEIPT_INSTRUCTION =
  "Bu bir market fişi/alışveriş fişi fotoğrafı. Üzerindeki yiyecek, içecek ve " +
  "temel mutfak ürünlerini sade, tekil adlarıyla listele (marka, fiyat, adet, kod " +
  "yazma; ör. 'Süt', 'Yumurta', 'Domates'). Yiyecek olmayan kalemleri (poşet, " +
  "deterjan, kâğıt vb.) atla. Fiş okunmuyorsa 'items' listesini boş bırak.";

/**
 * Market fişi fotoğrafından ürün adlarını çıkarır.
 * @param {{ imageBase64: string, mediaType: string, language?: string }} args
 */
export async function readReceipt({ imageBase64, mediaType, language = "tr" }) {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: RECEIPT_INSTRUCTION + langText(language) },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
  });
  return parseJson(message);
}

// ---------------------------------------------------------------------------
// 8) Sesli/serbest istek → yemek önerileri (asistan)
// ---------------------------------------------------------------------------

/**
 * Kullanıcının serbest isteğine ('akşama 4 kişiye hafif bir şey') göre yemek önerir.
 * @param {{ query: string, preferences?: string[], language?: string }} args
 */
export async function suggest({ query, preferences = [], language = "tr" }) {
  const instruction =
    `Kullanıcının isteği: "${query}". Bu isteğe uygun 6-8 farklı pratik yemek öner ` +
    "(tuz, yağ, soğan, sarımsak, un, yumurta, baharat evde var sayılır). İstekteki kişi " +
    "sayısı, öğün, hafiflik/doyuruculuk gibi ipuçlarını dikkate al. 'detected' alanını boş " +
    "bırakabilirsin." +
    prefText(preferences) +
    langText(language);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [{ role: "user", content: instruction }],
    output_config: { format: { type: "json_schema", schema: ANALYZE_SCHEMA } },
  });
  return parseJson(message);
}

// ---------------------------------------------------------------------------
// 9) Haftalık beslenme koçluğu
// ---------------------------------------------------------------------------

const COACH_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string", description: "Kısa, samimi, yargılamayan genel değerlendirme" },
    tips: {
      type: "array",
      description: "2-4 uygulanabilir öneri",
      items: { type: "string" },
    },
  },
  required: ["message", "tips"],
  additionalProperties: false,
};

/**
 * Kullanıcının son günlerdeki yeme özetine göre kısa koçluk verir (tıbbi tavsiye değil).
 * @param {{ summary: string, language?: string }} args
 */
export async function coach({ summary, language = "tr" }) {
  const instruction =
    "Bir beslenme koçu gibisin (doktor değilsin). Kullanıcının son günlerdeki yeme özeti " +
    "aşağıda. Kısa, samimi ve yargılamayan bir değerlendirme ('message') ve 2-4 uygulanabilir " +
    "öneri ('tips') ver. Tıbbi iddia veya teşhis yapma.\n\nÖzet:\n" +
    summary +
    langText(language);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: PERSONA,
    messages: [{ role: "user", content: instruction }],
    output_config: { format: { type: "json_schema", schema: COACH_SCHEMA } },
  });
  return parseJson(message);
}
