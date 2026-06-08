// API anahtarı tanımlı değilken kullanılan örnek veriler.
// Böylece uygulama anahtar olmadan da çalışır ve arayüz denenebilir.

export function demoAnalyze() {
  return {
    detected: [
      { name: "Domates", emoji: "🍅", confidence: "yüksek" },
      { name: "Biber", emoji: "🫑", confidence: "yüksek" },
      { name: "Soğan", emoji: "🧅", confidence: "yüksek" },
      { name: "Patlıcan", emoji: "🍆", confidence: "orta" },
      { name: "Patates", emoji: "🥔", confidence: "yüksek" },
    ],
    recipes: [
      {
        id: "menemen",
        title: "Menemen",
        description: "Domates ve biberle yapılan, kahvaltıların vazgeçilmezi pratik bir yemek.",
        category: "kahvaltı",
        durationMinutes: 20,
        difficulty: "kolay",
        usesIngredients: ["Domates", "Biber", "Soğan"],
        missingCommonIngredients: ["Yumurta"],
      },
      {
        id: "turlu",
        title: "Sebze Türlüsü",
        description: "Mevsim sebzelerinin fırında ya da tencerede buluştuğu doyurucu bir ana yemek.",
        category: "ana yemek",
        durationMinutes: 50,
        difficulty: "orta",
        usesIngredients: ["Patlıcan", "Biber", "Domates", "Patates", "Soğan"],
        missingCommonIngredients: ["Zeytinyağı"],
      },
      {
        id: "domates-corbasi",
        title: "Domates Çorbası",
        description: "Kadifemsi, sıcacık ve birkaç malzemeyle hazırlanan klasik çorba.",
        category: "çorba",
        durationMinutes: 30,
        difficulty: "kolay",
        usesIngredients: ["Domates", "Soğan"],
        missingCommonIngredients: ["Un", "Tereyağı"],
      },
      {
        id: "coban-salata",
        title: "Çoban Salatası",
        description: "Çıtır çıtır, ferah ve her sofraya yakışan klasik salata.",
        category: "salata",
        durationMinutes: 10,
        difficulty: "kolay",
        usesIngredients: ["Domates", "Biber", "Soğan"],
        missingCommonIngredients: ["Salatalık", "Limon"],
      },
      {
        id: "patates-kizartmasi",
        title: "Fırında Patates",
        description: "Dışı çıtır içi yumuşak, baharatlı fırın patatesleri.",
        category: "atıştırmalık",
        durationMinutes: 40,
        difficulty: "kolay",
        usesIngredients: ["Patates"],
        missingCommonIngredients: ["Zeytinyağı", "Kekik"],
      },
      {
        id: "patlican-musakka",
        title: "Patlıcan Musakka",
        description: "Patlıcan ve sebzelerin kat kat dizildiği, sofralık bir ana yemek.",
        category: "ana yemek",
        durationMinutes: 55,
        difficulty: "orta",
        usesIngredients: ["Patlıcan", "Domates", "Biber", "Soğan"],
        missingCommonIngredients: ["Kıyma (opsiyonel)"],
      },
    ],
  };
}

export function demoRecipe(title) {
  return {
    title: title || "Menemen",
    servings: 2,
    durationMinutes: 20,
    difficulty: "kolay",
    caloriesPerServing: 280,
    estimatedCostTl: 95,
    macros: { proteinG: 14, carbsG: 18, fatG: 16 },
    pairing: "Yanında taze ekmek ve bir bardak çay çok yakışır.",
    ingredients: [
      { item: "Domates", quantity: 3, unit: "adet", toTaste: false },
      { item: "Yeşil biber", quantity: 2, unit: "adet", toTaste: false },
      { item: "Soğan", quantity: 1, unit: "adet", toTaste: false },
      { item: "Yumurta", quantity: 3, unit: "adet", toTaste: false },
      { item: "Zeytinyağı", quantity: 2, unit: "yemek kaşığı", toTaste: false },
      { item: "Tuz ve karabiber", quantity: 0, unit: "", toTaste: true },
      { item: "Pul biber", quantity: 0, unit: "", toTaste: true },
    ],
    steps: [
      "Soğanı ve biberleri küçük küçük doğrayın.",
      "Tavada zeytinyağını ısıtıp soğan ve biberi yumuşayana kadar kavurun.",
      "Rendelenmiş domatesi ekleyip suyunu çekene kadar pişirin.",
      "Baharatları ekleyin ve karıştırın.",
      "Yumurtaları kırıp hafifçe karıştırarak istediğiniz kıvamda pişirin.",
      "Sıcak servis yapın; yanında taze ekmekle keyfini çıkarın.",
    ],
    tips: [
      "Yumurtaları çok karıştırmazsanız menemen daha güzel görünür.",
      "Acı sevenler pişirme sonunda biraz daha pul biber ekleyebilir.",
    ],
  };
}

export function demoPlan() {
  const days = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  const meals = [
    ["Menemen", "Pratik ve doyurucu", ["Domates", "Biber", "Yumurta", "Soğan"]],
    ["Sebze Türlüsü", "Mevsim sebzeleriyle", ["Patlıcan", "Kabak", "Patates", "Domates"]],
    ["Mercimek Çorbası", "Yanında ekmekle", ["Kırmızı mercimek", "Soğan", "Havuç", "Un"]],
    ["Fırında Patates", "Çıtır ve baharatlı", ["Patates", "Zeytinyağı", "Kekik"]],
    ["Çoban Salatası + Omlet", "Hafif bir akşam", ["Domates", "Salatalık", "Biber", "Yumurta"]],
    ["Patlıcan Musakka", "Sofralık ana yemek", ["Patlıcan", "Kıyma", "Domates", "Biber"]],
    ["Domates Çorbası", "Sıcacık kapanış", ["Domates", "Un", "Tereyağı", "Süt"]],
  ];
  return {
    days: days.map((d, i) => ({
      day: d,
      title: meals[i][0],
      description: meals[i][1],
      ingredients: meals[i][2],
    })),
  };
}

export function demoSubstitute(item) {
  return {
    item: item || "malzeme",
    alternatives: [
      { name: "Benzer bir malzeme", note: "Demo modu: gerçek öneri için sunucuya API anahtarı ekleyin." },
      { name: "Pratik alternatif", note: "Örnek not." },
    ],
  };
}

export function demoEventPlan(people, dish) {
  const p = Math.max(1, Number(people) || 4);
  return {
    dish: dish || "Mangal",
    people: p,
    items: [
      { item: "Köftelik kıyma", quantity: `${(p * 0.15).toFixed(1)} kg`, note: "kişi başı ~150 g" },
      { item: "Ekmek", quantity: `${Math.ceil(p / 3)} adet`, note: "" },
      { item: "Domates & biber", quantity: `${(p * 0.2).toFixed(1)} kg`, note: "" },
      { item: "Soğan", quantity: `${Math.ceil(p / 4)} adet`, note: "" },
      { item: "Ayran", quantity: `${p} adet`, note: "kişi başı 1" },
    ],
    estimatedCostTl: p * 120,
    tips: [
      "Demo modu: gerçek hesap için API anahtarı ekleyin.",
      "Eti bir gece önceden marine etmek lezzeti artırır.",
    ],
  };
}

export function demoReceipt() {
  return { items: ["Süt", "Yumurta", "Ekmek", "Domates", "Beyaz peynir", "Salatalık"] };
}

export function demoCalories() {
  return {
    dishName: "Mercimek Çorbası (örnek)",
    summary: "Bir kase klasik kırmızı mercimek çorbası.",
    totalCalories: 230,
    confidence: "orta",
    components: [
      { name: "Mercimek", emoji: "🥣", calories: 150 },
      { name: "Zeytinyağı / tereyağı", emoji: "🧈", calories: 60 },
      { name: "Sebzeler", emoji: "🥕", calories: 20 },
    ],
    macros: { proteinG: 12, carbsG: 30, fatG: 7 },
    healthNote: "Yanına limon sıkmak hem lezzeti hem de demir emilimini artırır.",
  };
}
