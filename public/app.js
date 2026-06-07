// ===== Eviko ön yüz mantığı =====

const el = (id) => document.getElementById(id);
const screens = {
  capture: el("screen-capture"),
  loading: el("screen-loading"),
  results: el("screen-results"),
  calories: el("screen-calories"),
  favorites: el("screen-favorites"),
  shopping: el("screen-shopping"),
  history: el("screen-history"),
  plan: el("screen-plan"),
};

// ---- Durum ----
let mode = "ingredients"; // "ingredients" | "dish"
let selectedImage = null; // { base64, mediaType }
let detectedNames = [];
let currentRecipe = null; // açık olan tarif (detay)
let currentServings = 2; // porsiyon ayarı
let lastMainScreen = "capture"; // favoriler/listeden geri dönüş için

// ---- Kalıcı depolama ----
const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  },
};
let favorites = store.get("eviko_favorites", []);
let shopping = store.get("eviko_shopping", []);
let prefs = store.get("eviko_prefs", []);
let history = store.get("eviko_history", []);
let lastRecipes = [];
let lastPlan = [];
let currentSocial = null;
let currentUser = null;
let googleClientId = null;

// ---- API adresi (web'de boş = göreli yol; APK'da ayarlanır) ----
function apiBase() {
  return (localStorage.getItem("eviko_api_base") || window.EVIKO_API_BASE || "").replace(/\/$/, "");
}
function api(path) {
  return apiBase() + path;
}
function langPref() {
  return localStorage.getItem("eviko_lang") || "tr";
}

// ---- Ekran geçişi ----
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
  if (["capture", "results", "calories"].includes(name)) lastMainScreen = name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- Başlangıç: sağlık kontrolü + rozetler ----
init();
function init() {
  registerServiceWorker();
  applyTheme();
  initPrefs();
  setMode(mode);
  updateBadges();
  checkHealth();
  refreshAuth();
  loadHome();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

// ---- Tema (açık/koyu/otomatik) ----
function applyTheme() {
  const t = localStorage.getItem("eviko_theme") || "auto";
  const dark =
    t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
try {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem("eviko_theme") || "auto") === "auto") applyTheme();
  });
} catch {}

// ---- Diyet tercihleri ----
function initPrefs() {
  document.querySelectorAll(".pref-chip").forEach((chip) => {
    if (prefs.includes(chip.dataset.pref)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      const p = chip.dataset.pref;
      if (prefs.includes(p)) prefs = prefs.filter((x) => x !== p);
      else prefs.push(p);
      store.set("eviko_prefs", prefs);
      chip.classList.toggle("active");
    });
  });
}

async function checkHealth() {
  const banner = el("banner");
  // Cihazda Gemini anahtarı varsa sunucuya gerek yok — her şey hazır.
  if (useGemini()) {
    banner.classList.add("hidden");
    return;
  }
  try {
    const r = await fetch(api("/api/health"), { credentials: "include" });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("no-server");
    const d = await r.json();
    if (d.demo) {
      banner.textContent =
        "Demo modu: örnek veriler. Kendi fotoğraflarını analiz etmek için ⚙️ Ayarlar'dan ücretsiz Gemini API anahtarı ekleyin.";
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  } catch {
    banner.textContent =
      "Başlamak için ⚙️ Ayarlar'dan ücretsiz Gemini API anahtarını ekle (aistudio.google.com/apikey).";
    banner.classList.remove("hidden");
  }
}

// ---- Mod seçici ----
el("mode-ingredients").addEventListener("click", () => setMode("ingredients"));
el("mode-dish").addEventListener("click", () => setMode("dish"));

function setMode(m) {
  mode = m;
  el("mode-ingredients").classList.toggle("active", m === "ingredients");
  el("mode-dish").classList.toggle("active", m === "dish");
  const ing = m === "ingredients";
  el("prefs-row").classList.toggle("hidden", !ing);
  el("manual-entry").classList.toggle("hidden", !ing);
  el("btn-plan").classList.toggle("hidden", !ing);
  if (m === "ingredients") {
    el("hero-emoji").textContent = "📸🥕🍅";
    el("hero-title").textContent = "Sebzelerinin fotoğrafını çek";
    el("hero-text").innerHTML =
      "Evdeki sebze ve meyveleri bir araya getir, fotoğrafını çek. Eviko onları tanıyıp sana <strong>birçok pratik yemek</strong> önersin.";
    el("btn-analyze").textContent = "Yemekleri bul";
  } else {
    el("hero-emoji").textContent = "🍽️🔥";
    el("hero-title").textContent = "Tabaktaki yemeğin fotoğrafını çek";
    el("hero-text").innerHTML =
      "Hazır bir yemeğin fotoğrafını çek; Eviko <strong>tahmini kalorisini</strong> ve besin değerlerini söylesin.";
    el("btn-analyze").textContent = "Kaloriyi hesapla";
  }
}

// ---- Fotoğraf seçme + küçültme ----
const fileInput = el("file-input");
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    selectedImage = await resizeImage(file);
    el("preview").src = `data:${selectedImage.mediaType};base64,${selectedImage.base64}`;
    el("dropzone").classList.add("hidden");
    el("preview-wrap").classList.remove("hidden");
  } catch (err) {
    alert("Fotoğraf okunamadı. Lütfen başka bir görsel deneyin.");
    console.error(err);
  }
});

el("btn-retake").addEventListener("click", resetCapture);
el("btn-new").addEventListener("click", () => {
  resetCapture();
  showScreen("capture");
});
el("btn-new-2").addEventListener("click", () => {
  resetCapture();
  showScreen("capture");
});
el("brand-home").addEventListener("click", () => {
  resetCapture();
  showScreen("capture");
});

function resetCapture() {
  selectedImage = null;
  fileInput.value = "";
  el("preview").src = "";
  el("preview-wrap").classList.add("hidden");
  el("dropzone").classList.remove("hidden");
}

function resizeImage(file, maxEdge = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Dosya okunamadı"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Görsel yüklenemedi"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxEdge || height > maxEdge) {
          if (width >= height) {
            height = Math.round((height * maxEdge) / width);
            width = maxEdge;
          } else {
            width = Math.round((width * maxEdge) / height);
            height = maxEdge;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- Analiz (moda göre) ----
el("btn-analyze").addEventListener("click", () => {
  if (!selectedImage) return;
  mode === "ingredients" ? runIngredients() : runCalories();
});

async function runIngredients() {
  showScreen("loading");
  el("loading-text").textContent = "Fotoğraf inceleniyor…";
  el("loading-sub").textContent = "Malzemeler tanınıyor ve tarifler hazırlanıyor.";
  try {
    const data = useGemini()
      ? await window.GeminiClient.analyze(selectedImage.base64, selectedImage.mediaType, prefs)
      : await serverPost("/api/analyze", {
          image: selectedImage.base64,
          mediaType: selectedImage.mediaType,
          preferences: prefs,
          language: langPref(),
        });
    renderResults(data);
    saveHistory("ingredients", data);
    showScreen("results");
  } catch (err) {
    fail(err);
  }
}

// ---- Malzemeleri yazarak ara (fotoğrafsız) ----
el("manual-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el("manual-input").value.trim();
  if (text) runManual(text);
});

async function runManual(text) {
  showScreen("loading");
  el("loading-text").textContent = "Malzemeler değerlendiriliyor…";
  el("loading-sub").textContent = "Sana uygun yemekler hazırlanıyor.";
  try {
    const data = useGemini()
      ? await window.GeminiClient.analyzeText(text, prefs)
      : await serverPost("/api/analyze-text", { text, preferences: prefs, language: langPref() });
    renderResults(data);
    saveHistory("ingredients", data);
    showScreen("results");
  } catch (err) {
    fail(err);
  }
}

// ---- Haftalık yemek planı ----
el("btn-plan").addEventListener("click", runPlan);
async function runPlan() {
  showScreen("loading");
  el("loading-text").textContent = "Haftalık plan hazırlanıyor…";
  el("loading-sub").textContent = "Sana uygun 7 günlük menü oluşturuluyor.";
  try {
    const data = useGemini()
      ? await window.GeminiClient.planWeek(prefs, detectedNames)
      : await serverPost("/api/plan", {
          preferences: prefs,
          detected: detectedNames,
          language: langPref(),
        });
    renderPlan(data);
    showScreen("plan");
  } catch (err) {
    fail(err);
  }
}

function renderPlan(data) {
  const days = (data && data.days) || [];
  lastPlan = days;
  const list = el("plan-list");
  el("btn-share-plan").classList.toggle("hidden", days.length === 0);
  if (days.length === 0) {
    list.innerHTML = '<div class="list-empty">Plan oluşturulamadı, tekrar dene.</div>';
    return;
  }
  list.innerHTML = days
    .map(
      (d, i) => `
      <button class="plan-card" data-index="${i}">
        <div class="plan-day">${escapeHtml(d.day || "")}</div>
        <div class="plan-meal">
          <h3>${escapeHtml(d.title || "")}</h3>
          <p class="muted small">${escapeHtml(d.description || "")}</p>
        </div>
      </button>`
    )
    .join("");
  list.querySelectorAll(".plan-card").forEach((c) =>
    c.addEventListener("click", () => openRecipeByTitle(days[Number(c.dataset.index)].title))
  );
}

// ---- Sürpriz tarif + planı paylaş ----
el("btn-surprise").addEventListener("click", () => {
  if (!lastRecipes.length) return;
  const r = lastRecipes[Math.floor(Math.random() * lastRecipes.length)];
  openRecipeByTitle(r.title);
});

el("btn-share-plan").addEventListener("click", sharePlan);
async function sharePlan() {
  if (!lastPlan.length) return;
  const lines = ["📅 Haftalık Yemek Planı (Eviko)", ""];
  lastPlan.forEach((d) =>
    lines.push(`${d.day}: ${d.title}${d.description ? " — " + d.description : ""}`)
  );
  const text = lines.join("\n");
  try {
    if (navigator.share) await navigator.share({ title: "Haftalık Plan", text });
    else {
      await navigator.clipboard.writeText(text);
      toast("Plan kopyalandı 📋");
    }
  } catch {}
}

async function runCalories() {
  showScreen("loading");
  el("loading-text").textContent = "Yemek inceleniyor…";
  el("loading-sub").textContent = "Kalori ve besin değerleri hesaplanıyor.";
  try {
    const data = useGemini()
      ? await window.GeminiClient.calories(selectedImage.base64, selectedImage.mediaType)
      : await serverPost("/api/calories", {
          image: selectedImage.base64,
          mediaType: selectedImage.mediaType,
          language: langPref(),
        });
    renderCalories(data);
    saveHistory("dish", data);
    showScreen("calories");
  } catch (err) {
    fail(err);
  }
}

// Cihazda Gemini anahtarı varsa doğrudan Gemini kullanılır (sunucusuz).
function useGemini() {
  return Boolean(window.GeminiClient && window.GeminiClient.hasKey());
}

// Sunucuya POST — yanıt JSON değilse (ör. sunucu yoksa HTML dönerse) net hata verir.
async function serverPost(path, body) {
  let res;
  try {
    res = await fetch(api(path), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Sunucuya ulaşılamadı. ⚙️ Ayarlar'dan ücretsiz Gemini API anahtarını ekleyin.");
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Sunucu bulunamadı. ⚙️ Ayarlar'dan ücretsiz Gemini API anahtarını ekleyin.");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "İşlem başarısız");
  return data;
}

function fail(err) {
  console.error(err);
  alert(err.message || "Bir hata oluştu. Lütfen tekrar deneyin.");
  showScreen("capture");
}

// ---- Sonuçları çiz (malzeme modu) ----
function renderResults(data) {
  const detected = data.detected || [];
  detectedNames = detected.map((d) => d.name);

  const chips = el("detected");
  if (detected.length === 0) {
    chips.innerHTML =
      '<div class="empty-note">Fotoğrafta sebze veya meyve tanıyamadık. Daha aydınlık ve yakın bir fotoğraf deneyebilirsin.</div>';
  } else {
    chips.innerHTML = detected
      .map(
        (d) =>
          `<span class="chip tappable" data-store="${escapeHtml(d.name)}" title="Markete git"><span>${
            d.emoji || "🥬"
          }</span><span>${escapeHtml(d.name)}</span><span class="conf">${escapeHtml(
            d.confidence || ""
          )}</span></span>`
      )
      .join("");
    chips.querySelectorAll(".chip.tappable").forEach((c) =>
      c.addEventListener("click", () => openStore(c.dataset.store))
    );
  }

  const recipes = data.recipes || [];
  lastRecipes = recipes;

  // Eksik malzemeler (alışveriş listesi için)
  const missing = [...new Set(recipes.flatMap((r) => r.missingCommonIngredients || []))];
  const missingBar = el("missing-bar");
  if (missing.length > 0) {
    el("missing-text").textContent = `Eksik olabilecek ${missing.length} malzeme bulundu.`;
    missingBar.classList.remove("hidden");
    el("btn-add-missing").onclick = () => {
      addToShopping(missing);
      toast("Eksik malzemeler listeye eklendi 🛒");
    };
  } else {
    missingBar.classList.add("hidden");
  }

  const grid = el("recipes");
  grid.innerHTML = recipes
    .map((r, i) => {
      const fav = isFavorite(r.title) ? '<span class="fav-star">⭐</span>' : "";
      return `
      <button class="recipe-card" data-index="${i}">
        ${fav}
        <h3>${escapeHtml(r.title)}</h3>
        <p class="desc">${escapeHtml(r.description || "")}</p>
        <div class="recipe-meta">
          ${r.category ? `<span class="tag cat">${escapeHtml(r.category)}</span>` : ""}
          ${r.durationMinutes ? `<span class="tag">⏱ ${r.durationMinutes} dk</span>` : ""}
          ${r.difficulty ? `<span class="tag ${r.difficulty === "kolay" ? "easy" : ""}">${escapeHtml(r.difficulty)}</span>` : ""}
        </div>
      </button>`;
    })
    .join("");

  grid.querySelectorAll(".recipe-card").forEach((card) => {
    card.addEventListener("click", () => openRecipeByTitle(recipes[Number(card.dataset.index)].title));
  });
}

// ---- Kalori kartı ----
function renderCalories(data) {
  const card = el("calorie-card");
  if (!data.dishName) {
    card.innerHTML =
      '<div class="empty-note">Fotoğrafta bir yemek tanıyamadık. Tabağı daha net gösteren bir fotoğraf deneyebilirsin.</div>';
    return;
  }
  const comps = (data.components || [])
    .map(
      (c) =>
        `<li><span>${c.emoji || "🍽️"} ${escapeHtml(c.name)}</span><span class="ccal">${c.calories} kcal</span></li>`
    )
    .join("");
  const m = data.macros || {};
  card.innerHTML = `
    <div class="cal-card">
      <p class="cal-dish">${escapeHtml(data.dishName)}</p>
      <p class="cal-summary">${escapeHtml(data.summary || "")}</p>
      <div class="cal-total">
        <div><span class="num">${data.totalCalories}</span> <span class="unit">kcal</span></div>
        <div class="muted small">tahmini · güven: ${escapeHtml(data.confidence || "-")}</div>
      </div>
      <div class="macros">
        <div class="macro"><div class="mnum">${m.proteinG ?? "-"}g</div><div class="mlabel">Protein</div></div>
        <div class="macro"><div class="mnum">${m.carbsG ?? "-"}g</div><div class="mlabel">Karbonhidrat</div></div>
        <div class="macro"><div class="mnum">${m.fatG ?? "-"}g</div><div class="mlabel">Yağ</div></div>
      </div>
      ${comps ? `<h4 class="muted small">Bileşenler</h4><ul class="comp-list">${comps}</ul>` : ""}
      ${data.healthNote ? `<div class="cal-note">💡 ${escapeHtml(data.healthNote)}</div>` : ""}
    </div>`;
}

// ---- Tarif detayı (modal) ----
const modal = el("modal");
function closeRecipeModal() {
  modal.classList.add("hidden");
  try {
    if (window.speechSynthesis) speechSynthesis.cancel();
  } catch {}
}
el("modal-close").addEventListener("click", closeRecipeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeRecipeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeRecipeModal();
    el("settings-modal").classList.add("hidden");
  }
});

async function openRecipeByTitle(title) {
  el("modal-body").innerHTML = `
    <div class="detail-loading"><div class="pan">🍲</div><p>"${escapeHtml(
      title
    )}" tarifi hazırlanıyor…</p></div>`;
  modal.classList.remove("hidden");
  try {
    const data = useGemini()
      ? await window.GeminiClient.recipe(title, detectedNames, prefs)
      : await serverPost("/api/recipe", {
          title,
          detected: detectedNames,
          preferences: prefs,
          language: langPref(),
        });
    openRecipeObject(data);
  } catch (err) {
    el("modal-body").innerHTML = `<div class="detail-loading"><p>${escapeHtml(
      err.message || "Tarif yüklenemedi."
    )}</p></div>`;
  }
}

function openRecipeObject(recipe) {
  currentRecipe = recipe;
  currentServings = recipe.servings || 2;
  currentSocial = null;
  modal.classList.remove("hidden");
  renderRecipeDetail();
  modal.querySelector(".modal-card").scrollTop = 0;
  loadRecipeSocial(recipe.title);
}

function renderRecipeDetail() {
  const r = currentRecipe;
  const base = r.servings || 2;
  const factor = currentServings / base;

  const ingredients = (r.ingredients || [])
    .map((ing) => {
      let amount;
      if (ing.toTaste) amount = "damak zevkine göre";
      else if (ing.quantity > 0) amount = `${formatQty(ing.quantity * factor)} ${ing.unit || ""}`.trim();
      else amount = ing.unit || "—";
      return `<li class="tappable" data-item="${escapeHtml(ing.item)}"><span>${escapeHtml(
        ing.item
      )}<span class="item-shop">🛒</span></span><span class="amount">${escapeHtml(amount)}</span></li>`;
    })
    .join("");

  const steps = (r.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const tips = (r.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const favOn = isFavorite(r.title);

  el("modal-body").innerHTML = `
    <div class="recipe-detail">
      <div id="recipe-photo-slot">${
        currentSocial && currentSocial.photo
          ? `<img class="recipe-photo" src="${escapeHtml(currentSocial.photo)}" alt="${escapeHtml(r.title)}" />`
          : ""
      }</div>
      <h2>${escapeHtml(r.title)}</h2>
      <div class="detail-meta">
        ${r.durationMinutes ? `<span class="tag">⏱ ${r.durationMinutes} dk</span>` : ""}
        ${r.difficulty ? `<span class="tag easy">${escapeHtml(r.difficulty)}</span>` : ""}
        ${r.caloriesPerServing ? `<span class="tag cat">🔥 ~${r.caloriesPerServing} kcal/porsiyon</span>` : ""}
        ${r.estimatedCostTl ? `<span class="tag">🛒 ~${r.estimatedCostTl} ₺</span>` : ""}
      </div>

      <div class="portion">
        <span class="portion-label">🍽 Porsiyon</span>
        <div class="stepper">
          <button id="serv-minus" aria-label="Azalt">−</button>
          <span class="count" id="serv-count">${currentServings}</span>
          <button id="serv-plus" aria-label="Artır">+</button>
        </div>
      </div>

      <div class="detail-toolbar">
        <button class="btn btn-ghost btn-fav ${favOn ? "on" : ""}" id="btn-fav">
          ${favOn ? "⭐ Favorilerde" : "☆ Favorilere ekle"}
        </button>
        <button class="btn btn-ghost" id="btn-to-shop">🛒 Malzemeleri ekle</button>
        <button class="btn btn-ghost" id="btn-speak">🔊 Sesli oku</button>
        <button class="btn btn-ghost" id="btn-share">📤 Paylaş</button>
      </div>

      <div class="detail-section">
        <h4>Malzemeler${currentServings !== base ? ` (${currentServings} kişilik)` : ""}</h4>
        <ul class="ingredient-list">${ingredients}</ul>
      </div>

      <div class="detail-section">
        <h4>Hazırlanışı</h4>
        <ol class="step-list">${steps}</ol>
      </div>

      ${
        tips
          ? `<div class="detail-section"><div class="tips"><strong>İpuçları</strong><ul>${tips}</ul></div></div>`
          : ""
      }
      <div id="recipe-social" class="detail-section">${socialHtml(r)}</div>
    </div>`;

  el("serv-minus").onclick = () => changeServings(-1);
  el("serv-plus").onclick = () => changeServings(1);
  el("btn-fav").onclick = () => {
    toggleFavorite(r);
    renderRecipeDetail();
  };
  el("btn-to-shop").onclick = () => {
    const items = (r.ingredients || []).filter((i) => !i.toTaste).map((i) => i.item);
    addToShopping(items);
    toast("Malzemeler listeye eklendi 🛒");
  };
  el("btn-speak").onclick = () => toggleSpeak(r);
  el("btn-share").onclick = () => shareRecipe(r);
  modal.querySelectorAll(".step-list li").forEach((li) =>
    li.addEventListener("click", () => li.classList.toggle("done"))
  );
  modal.querySelectorAll(".ingredient-list li.tappable").forEach((li) =>
    li.addEventListener("click", () => openStore(li.dataset.item))
  );
  wireSocial(r);
}

function changeServings(delta) {
  currentServings = Math.min(20, Math.max(1, currentServings + delta));
  renderRecipeDetail();
}

// ---- Favoriler ----
function isFavorite(title) {
  return favorites.some((f) => f.title === title);
}
function toggleFavorite(recipe) {
  if (isFavorite(recipe.title)) {
    favorites = favorites.filter((f) => f.title !== recipe.title);
  } else {
    favorites.push(recipe);
  }
  store.set("eviko_favorites", favorites);
  updateBadges();
}
function renderFavorites() {
  const list = el("favorites-list");
  if (favorites.length === 0) {
    list.innerHTML = '<div class="list-empty">Henüz favori tarifin yok.<br>Bir tarifi açıp ⭐ ile kaydedebilirsin.</div>';
    return;
  }
  list.innerHTML = favorites
    .map(
      (f, i) => `
      <div class="fav-item">
        <div class="fav-main" data-index="${i}">
          <h3>${escapeHtml(f.title)}</h3>
          <div class="muted small">${f.durationMinutes ? `⏱ ${f.durationMinutes} dk · ` : ""}${escapeHtml(f.difficulty || "")}</div>
        </div>
        <button class="remove" data-remove="${i}" aria-label="Kaldır">🗑️</button>
      </div>`
    )
    .join("");
  list.querySelectorAll(".fav-main").forEach((m) =>
    m.addEventListener("click", () => openRecipeObject(favorites[Number(m.dataset.index)]))
  );
  list.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => {
      favorites.splice(Number(b.dataset.remove), 1);
      store.set("eviko_favorites", favorites);
      updateBadges();
      renderFavorites();
    })
  );
}

// ---- Alışveriş listesi ----
function addToShopping(names) {
  const existing = new Set(shopping.map((s) => s.name.toLocaleLowerCase("tr")));
  names.forEach((n) => {
    const name = String(n).trim();
    if (name && !existing.has(name.toLocaleLowerCase("tr"))) {
      shopping.push({ name, checked: false });
      existing.add(name.toLocaleLowerCase("tr"));
    }
  });
  store.set("eviko_shopping", shopping);
  updateBadges();
}
function renderShopping() {
  const list = el("shopping-list");
  el("btn-clear-shop").classList.toggle("hidden", shopping.length === 0);
  if (shopping.length === 0) {
    list.innerHTML = '<div class="list-empty">Listen boş.<br>Tariflerden veya yukarıdan malzeme ekleyebilirsin.</div>';
    return;
  }
  list.innerHTML = shopping
    .map(
      (it, i) => `
      <li class="shop-item ${it.checked ? "done" : ""}">
        <span class="check" data-check="${i}">${it.checked ? "✓" : ""}</span>
        <span class="name">${escapeHtml(it.name)}</span>
        <button class="remove" data-del="${i}" aria-label="Sil">×</button>
      </li>`
    )
    .join("");
  list.querySelectorAll("[data-check]").forEach((c) =>
    c.addEventListener("click", () => {
      const i = Number(c.dataset.check);
      shopping[i].checked = !shopping[i].checked;
      store.set("eviko_shopping", shopping);
      renderShopping();
    })
  );
  list.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      shopping.splice(Number(b.dataset.del), 1);
      store.set("eviko_shopping", shopping);
      updateBadges();
      renderShopping();
    })
  );
}
el("shop-add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = el("shop-add-input");
  if (input.value.trim()) {
    addToShopping([input.value]);
    input.value = "";
    renderShopping();
  }
});
el("btn-clear-shop").addEventListener("click", () => {
  if (confirm("Tüm liste silinsin mi?")) {
    shopping = [];
    store.set("eviko_shopping", shopping);
    updateBadges();
    renderShopping();
  }
});

// ---- Üst bar gezinme ----
el("nav-favorites").addEventListener("click", () => {
  renderFavorites();
  showScreen("favorites");
});
el("nav-shopping").addEventListener("click", () => {
  renderShopping();
  showScreen("shopping");
});
document.querySelectorAll("[data-back]").forEach((b) =>
  b.addEventListener("click", () => showScreen(lastMainScreen))
);

function updateBadges() {
  const f = el("badge-fav");
  const s = el("badge-shop");
  f.textContent = favorites.length;
  f.classList.toggle("hidden", favorites.length === 0);
  const pending = shopping.filter((x) => !x.checked).length;
  s.textContent = pending;
  s.classList.toggle("hidden", pending === 0);
}

// ---- Ayarlar ----
const settingsModal = el("settings-modal");
el("nav-settings").addEventListener("click", () => {
  el("gemini-key-input").value = localStorage.getItem("eviko_gemini_key") || "";
  el("gemini-model-select").value =
    localStorage.getItem("eviko_gemini_model") || "gemini-2.5-flash";
  el("api-base-input").value = localStorage.getItem("eviko_api_base") || "";
  el("theme-select").value = localStorage.getItem("eviko_theme") || "auto";
  el("lang-select").value = localStorage.getItem("eviko_lang") || "tr";
  settingsModal.classList.remove("hidden");
});
el("settings-close").addEventListener("click", () => settingsModal.classList.add("hidden"));
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.classList.add("hidden");
});
el("settings-save").addEventListener("click", () => {
  const k = el("gemini-key-input").value.trim();
  const v = el("api-base-input").value.trim();
  if (k) localStorage.setItem("eviko_gemini_key", k);
  else localStorage.removeItem("eviko_gemini_key");
  localStorage.setItem("eviko_gemini_model", el("gemini-model-select").value);
  if (v) localStorage.setItem("eviko_api_base", v);
  else localStorage.removeItem("eviko_api_base");
  localStorage.setItem("eviko_theme", el("theme-select").value);
  localStorage.setItem("eviko_lang", el("lang-select").value);
  applyTheme();
  settingsModal.classList.add("hidden");
  checkHealth();
  toast("Ayarlar kaydedildi ✓");
});
el("settings-clear").addEventListener("click", () => {
  localStorage.removeItem("eviko_gemini_key");
  localStorage.removeItem("eviko_gemini_model");
  localStorage.removeItem("eviko_api_base");
  el("gemini-key-input").value = "";
  el("gemini-model-select").value = "gemini-2.5-flash";
  el("api-base-input").value = "";
  localStorage.removeItem("eviko_theme");
  el("theme-select").value = "auto";
  localStorage.removeItem("eviko_lang");
  el("lang-select").value = "tr";
  applyTheme();
  checkHealth();
  toast("Ayarlar temizlendi");
});

// ---- Geçmiş ----
function saveHistory(type, data) {
  const title =
    type === "dish"
      ? data.dishName || "Yemek"
      : (data.detected || [])
          .map((d) => d.name)
          .slice(0, 4)
          .join(", ") || "Malzeme analizi";
  if (type === "ingredients" && (!data.recipes || data.recipes.length === 0)) return;
  history.unshift({ type, title, ts: Date.now(), data });
  history = history.slice(0, 30);
  store.set("eviko_history", history);
}

function renderHistory() {
  const list = el("history-list");
  el("btn-clear-history").classList.toggle("hidden", history.length === 0);
  if (history.length === 0) {
    list.innerHTML =
      '<div class="list-empty">Henüz geçmiş yok.<br>Bir analiz yaptığında burada görünür.</div>';
    return;
  }
  list.innerHTML = history
    .map((h, i) => {
      const icon = h.type === "dish" ? "🔥" : "🥗";
      const sub = h.type === "dish" ? "Kalori analizi" : "Yemek önerileri";
      const date = new Date(h.ts).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return `
      <div class="hist-item">
        <div class="hist-main" data-index="${i}">
          <h3>${icon} ${escapeHtml(h.title)}</h3>
          <div class="muted small">${sub} · ${date}</div>
        </div>
        <button class="remove" data-remove="${i}" aria-label="Sil">🗑️</button>
      </div>`;
    })
    .join("");
  list.querySelectorAll(".hist-main").forEach((m) =>
    m.addEventListener("click", () => openHistory(history[Number(m.dataset.index)]))
  );
  list.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => {
      history.splice(Number(b.dataset.remove), 1);
      store.set("eviko_history", history);
      renderHistory();
    })
  );
}

function openHistory(h) {
  if (h.type === "dish") {
    renderCalories(h.data);
    showScreen("calories");
  } else {
    detectedNames = (h.data.detected || []).map((d) => d.name);
    renderResults(h.data);
    showScreen("results");
  }
}

el("nav-history").addEventListener("click", () => {
  renderHistory();
  showScreen("history");
});
el("btn-clear-history").addEventListener("click", () => {
  if (confirm("Tüm geçmiş silinsin mi?")) {
    history = [];
    store.set("eviko_history", history);
    renderHistory();
  }
});

// ---- Sesli okuma + paylaşım ----
function toggleSpeak(r) {
  const btn = el("btn-speak");
  if (!("speechSynthesis" in window)) {
    toast("Cihaz sesli okumayı desteklemiyor.");
    return;
  }
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    if (btn) btn.textContent = "🔊 Sesli oku";
    return;
  }
  const text =
    `${r.title}. Malzemeler: ` +
    (r.ingredients || []).map((i) => i.item).join(", ") +
    ". Hazırlanışı: " +
    (r.steps || []).map((s, i) => `${i + 1}. adım. ${s}`).join(" ");
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "tr-TR";
  u.onend = () => {
    if (el("btn-speak")) el("btn-speak").textContent = "🔊 Sesli oku";
  };
  u.onerror = u.onend;
  if (btn) btn.textContent = "⏹ Durdur";
  speechSynthesis.speak(u);
}

async function shareRecipe(r) {
  const lines = [r.title, ""];
  lines.push("Malzemeler:");
  (r.ingredients || []).forEach((i) => {
    let amt = i.toTaste
      ? "damak zevkine göre"
      : i.quantity
        ? `${formatQty(i.quantity)} ${i.unit || ""}`.trim()
        : i.unit || "";
    lines.push("• " + i.item + (amt ? ` — ${amt}` : ""));
  });
  lines.push("", "Hazırlanışı:");
  (r.steps || []).forEach((s, idx) => lines.push(`${idx + 1}. ${s}`));
  lines.push("", "Eviko ile hazırlandı 🥗");
  const text = lines.join("\n");
  try {
    if (navigator.share) {
      await navigator.share({ title: r.title, text });
    } else {
      await navigator.clipboard.writeText(text);
      toast("Tarif kopyalandı 📋");
    }
  } catch {}
}

// ---- Malzeme → en yakın market (Google Haritalar) ----
function openStore(name) {
  const q = encodeURIComponent((name || "").trim() + " market manav");
  const go = (c) => {
    const url = c
      ? `https://www.google.com/maps/search/${q}/@${c.latitude},${c.longitude},14z`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
    window.open(url, "_blank");
  };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((p) => go(p.coords), () => go(null), { timeout: 5000 });
  } else go(null);
}

// ---- Tarif sosyal verisi (fotoğraf + yorum + puan) ----
function socialHtml(r) {
  const s = currentSocial;
  if (!s) return '<div class="comments"><p class="muted small">Yorumlar yükleniyor…</p></div>';
  const ratingLine = s.ratingCount
    ? `<span class="c-stars">★ ${s.rating}</span> <span class="muted small">(${s.ratingCount} puan)</span>`
    : '<span class="muted small">Henüz puan yok</span>';
  const comments = (s.comments || []).length
    ? s.comments
        .map(
          (c) => `
        <div class="comment">
          <div class="c-head"><span class="c-user">${escapeHtml(c.userName || "Kullanıcı")}</span>${
            c.stars ? `<span class="c-stars">${"★".repeat(c.stars)}</span>` : ""
          }</div>
          <div class="c-text">${escapeHtml(c.text)}</div>
        </div>`
        )
        .join("")
    : '<p class="muted small">İlk yorumu sen yaz!</p>';
  const form = currentUser
    ? `<div class="comment-form">
         <div class="star-pick" id="star-pick">${[1, 2, 3, 4, 5]
           .map((n) => `<span data-star="${n}">★</span>`)
           .join("")}</div>
         <textarea id="comment-text" placeholder="Bu tarif hakkında yorumun…"></textarea>
         <button class="btn btn-primary auth-submit" id="comment-submit" style="margin-top:8px">Yorum yap</button>
       </div>`
    : '<div class="comment-login-note">Yorum yapmak için <a href="#" id="comment-login">giriş yap</a>.</div>';
  return `<div class="comments"><h4>Yorumlar &nbsp; ${ratingLine}</h4>${comments}${form}</div>`;
}

function wireSocial(r) {
  let picked = 0;
  const pick = el("star-pick");
  if (pick) {
    pick.querySelectorAll("span").forEach((sp) =>
      sp.addEventListener("click", () => {
        picked = Number(sp.dataset.star);
        pick.querySelectorAll("span").forEach((x) =>
          x.classList.toggle("on", Number(x.dataset.star) <= picked)
        );
      })
    );
  }
  const submit = el("comment-submit");
  if (submit) submit.onclick = () => submitComment(r.title, picked);
  const login = el("comment-login");
  if (login)
    login.onclick = (e) => {
      e.preventDefault();
      openAuth();
    };
}

async function loadRecipeSocial(title) {
  try {
    const res = await fetch(api("/api/recipes/view"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return; // sunucu yok (Gemini-only/APK)
    const data = await res.json();
    if (!res.ok) return;
    currentSocial = data;
    if (currentRecipe && currentRecipe.title === title) renderRecipeDetail();
  } catch {}
}

async function submitComment(title, stars) {
  const ta = el("comment-text");
  const text = ta ? ta.value.trim() : "";
  if (!text) return;
  try {
    const res = await fetch(api("/api/recipes/comment"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text, stars: stars || null }),
    });
    if (res.status === 401) {
      openAuth();
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Yorum eklenemedi");
    if (currentSocial) {
      currentSocial.comments = data.comments;
      currentSocial.rating = data.rating;
      currentSocial.ratingCount = (currentSocial.ratingCount || 0) + 1;
    }
    renderRecipeDetail();
    toast("Yorumun eklendi ✓");
  } catch (err) {
    toast(err.message || "Yorum eklenemedi");
  }
}

// ---- Hesap ----
const authModal = el("auth-modal");
let authMode = "login";
function openAuth() {
  el("auth-error").classList.add("hidden");
  renderAuthState();
  authModal.classList.remove("hidden");
}
el("nav-account").addEventListener("click", openAuth);
el("auth-close").addEventListener("click", () => authModal.classList.add("hidden"));
authModal.addEventListener("click", (e) => {
  if (e.target === authModal) authModal.classList.add("hidden");
});
el("tab-login").addEventListener("click", () => setAuthMode("login"));
el("tab-register").addEventListener("click", () => setAuthMode("register"));
function setAuthMode(m) {
  authMode = m;
  el("tab-login").classList.toggle("active", m === "login");
  el("tab-register").classList.toggle("active", m === "register");
  el("auth-name").classList.toggle("hidden", m !== "register");
  el("auth-title").textContent = m === "login" ? "Giriş yap" : "Kayıt ol";
  el("auth-submit").textContent = m === "login" ? "Giriş yap" : "Kayıt ol";
}
el("auth-submit").addEventListener("click", submitAuth);
async function submitAuth() {
  const email = el("auth-email").value.trim();
  const password = el("auth-password").value;
  const name = el("auth-name").value.trim();
  const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  try {
    const res = await fetch(api(path), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json"))
      throw new Error("Sunucu yok. Hesap özellikleri website/sunucu modunda çalışır.");
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "İşlem başarısız");
    currentUser = d.user;
    renderAuthState();
    authModal.classList.add("hidden");
    toast("Hoş geldin, " + currentUser.name + " 👋");
  } catch (err) {
    showAuthError(err.message);
  }
}
function showAuthError(msg) {
  const e = el("auth-error");
  e.textContent = msg;
  e.classList.remove("hidden");
}
el("auth-logout").addEventListener("click", async () => {
  try {
    await fetch(api("/api/auth/logout"), { method: "POST", credentials: "include" });
  } catch {}
  currentUser = null;
  renderAuthState();
  toast("Çıkış yapıldı");
});

function renderAuthState() {
  const btn = el("nav-account");
  btn.textContent = currentUser ? (currentUser.name || "?").slice(0, 1).toLocaleUpperCase("tr") : "👤";
  el("auth-logged-in").classList.toggle("hidden", !currentUser);
  el("auth-logged-out").classList.toggle("hidden", !!currentUser);
  if (currentUser) el("auth-hello").textContent = `Merhaba, ${currentUser.name} (${currentUser.email})`;
  el("google-btn").classList.toggle("hidden", !googleClientId || !!currentUser);
}

async function refreshAuth() {
  try {
    const r = await fetch(api("/api/auth/me"), { credentials: "include" });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return;
    const d = await r.json();
    currentUser = d.user;
    googleClientId = d.googleEnabled ? d.googleClientId : null;
    renderAuthState();
    if (googleClientId) initGoogle(googleClientId);
  } catch {}
}

let googleInited = false;
function initGoogle(clientId) {
  if (googleInited) return;
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.async = true;
  s.defer = true;
  s.onload = () => {
    try {
      window.google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential });
      window.google.accounts.id.renderButton(el("google-btn"), {
        theme: "outline",
        size: "large",
        text: "continue_with",
        width: 280,
      });
      googleInited = true;
    } catch {}
  };
  document.head.appendChild(s);
}
async function onGoogleCredential(resp) {
  try {
    const res = await fetch(api("/api/auth/google"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: resp.credential }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Google girişi başarısız");
    currentUser = d.user;
    renderAuthState();
    authModal.classList.add("hidden");
    toast("Hoş geldin, " + currentUser.name + " 👋");
  } catch (err) {
    showAuthError(err.message);
  }
}

// ---- Ana sayfa bölümleri (günün favorileri / en çok kullanılan / tavsiye) ----
async function loadHome() {
  try {
    const r = await fetch(api("/api/recipes/home"), { credentials: "include" });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return;
    const d = await r.json();
    let any = false;
    any = renderHomeRow("daily", d.daily) || any;
    any = renderHomeRow("popular", d.popular) || any;
    any = renderHomeRow("recommended", d.recommended) || any;
    el("home-sections").classList.toggle("hidden", !any);
  } catch {}
}
function renderHomeRow(key, items) {
  const sec = el("home-" + key);
  const row = el("row-" + key);
  const list = items || [];
  sec.classList.toggle("hidden", list.length === 0);
  if (!list.length) return false;
  row.innerHTML = list
    .map(
      (it) => `
      <button class="home-card" data-title="${escapeHtml(it.title)}">
        ${
          it.photo
            ? `<img src="${escapeHtml(it.photo)}" alt="" loading="lazy"/>`
            : '<div class="ph">🥗</div>'
        }
        <div class="hc-body"><h3>${escapeHtml(it.title)}</h3>
          <div class="hc-meta">${it.rating ? `★ ${it.rating} · ` : ""}${it.views || 0} kez</div></div>
      </button>`
    )
    .join("");
  row.querySelectorAll(".home-card").forEach((c) =>
    c.addEventListener("click", () => openRecipeByTitle(c.dataset.title))
  );
  return true;
}

// ---- Yardımcılar ----
function formatQty(n) {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace(".", ",");
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer = null;
function toast(msg) {
  let t = el("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.style.cssText =
      "position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#1f2a24;color:#fff;padding:12px 18px;border-radius:999px;font-size:.9rem;font-weight:600;z-index:100;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:opacity .25s;opacity:0;";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => (t.style.opacity = "1"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.opacity = "0"), 2200);
}
