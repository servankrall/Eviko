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
export async function analyzeImage({ imageBase64, mediaType }) {
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
          { type: "text", text: ANALYZE_INSTRUCTION },
        ],
      },
    ],
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
  required: ["title", "servings", "durationMinutes", "difficulty", "ingredients", "steps", "tips"],
  additionalProperties: false,
};

/**
 * Seçilen yemeğin detaylı tarifini üretir.
 * @param {{ title: string, detected?: string[] }} args
 */
export async function getRecipe({ title, detected = [] }) {
  const elde =
    detected.length > 0 ? `Evde şu malzemeler var: ${detected.join(", ")}.` : "";

  const instruction =
    `"${title}" adlı yemeğin detaylı, adım adım tarifini ver. ${elde} ` +
    "Tarifi 2-4 kişilik temel al ve bu kişi sayısını 'servings' alanına yaz. " +
    "Malzeme miktarlarını ölçeklenebilir biçimde ver: her malzeme için sayısal " +
    "'quantity', birim için 'unit' ve damak zevkine göre olanlar için 'toTaste' " +
    "true olsun. Net pişirme adımları ve birkaç pratik ipucu ekle.";

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
export async function analyzeCalories({ imageBase64, mediaType }) {
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
          { type: "text", text: CALORIE_INSTRUCTION },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: CALORIE_SCHEMA } },
  });

  return parseJson(message);
}
