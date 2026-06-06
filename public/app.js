// ===== Eviko ön yüz mantığı =====

const el = (id) => document.getElementById(id);
const screens = {
  capture: el("screen-capture"),
  loading: el("screen-loading"),
  results: el("screen-results"),
  calories: el("screen-calories"),
  favorites: el("screen-favorites"),
  shopping: el("screen-shopping"),
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

// ---- API adresi (web'de boş = göreli yol; APK'da ayarlanır) ----
function apiBase() {
  return (localStorage.getItem("eviko_api_base") || window.EVIKO_API_BASE || "").replace(/\/$/, "");
}
function api(path) {
  return apiBase() + path;
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
  updateBadges();
  checkHealth();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

async function checkHealth() {
  const banner = el("banner");
  // Cihazda Gemini anahtarı varsa sunucuya gerek yok — her şey hazır.
  if (useGemini()) {
    banner.classList.add("hidden");
    return;
  }
  try {
    const r = await fetch(api("/api/health"));
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
      ? await window.GeminiClient.analyze(selectedImage.base64, selectedImage.mediaType)
      : await serverPost("/api/analyze", {
          image: selectedImage.base64,
          mediaType: selectedImage.mediaType,
        });
    renderResults(data);
    showScreen("results");
  } catch (err) {
    fail(err);
  }
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
        });
    renderCalories(data);
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
          `<span class="chip"><span>${d.emoji || "🥬"}</span><span>${escapeHtml(
            d.name
          )}</span><span class="conf">${escapeHtml(d.confidence || "")}</span></span>`
      )
      .join("");
  }

  const recipes = data.recipes || [];

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
el("modal-close").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    modal.classList.add("hidden");
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
      ? await window.GeminiClient.recipe(title, detectedNames)
      : await serverPost("/api/recipe", { title, detected: detectedNames });
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
  modal.classList.remove("hidden");
  renderRecipeDetail();
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
      return `<li><span>${escapeHtml(ing.item)}</span><span class="amount">${escapeHtml(amount)}</span></li>`;
    })
    .join("");

  const steps = (r.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const tips = (r.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const favOn = isFavorite(r.title);

  el("modal-body").innerHTML = `
    <div class="recipe-detail">
      <h2>${escapeHtml(r.title)}</h2>
      <div class="detail-meta">
        ${r.durationMinutes ? `<span class="tag">⏱ ${r.durationMinutes} dk</span>` : ""}
        ${r.difficulty ? `<span class="tag easy">${escapeHtml(r.difficulty)}</span>` : ""}
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
  modal.querySelector(".modal-card").scrollTop = 0;
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
    localStorage.getItem("eviko_gemini_model") || "gemini-2.0-flash";
  el("api-base-input").value = localStorage.getItem("eviko_api_base") || "";
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
  settingsModal.classList.add("hidden");
  checkHealth();
  toast("Ayarlar kaydedildi ✓");
});
el("settings-clear").addEventListener("click", () => {
  localStorage.removeItem("eviko_gemini_key");
  localStorage.removeItem("eviko_gemini_model");
  localStorage.removeItem("eviko_api_base");
  el("gemini-key-input").value = "";
  el("gemini-model-select").value = "gemini-2.0-flash";
  el("api-base-input").value = "";
  checkHealth();
  toast("Ayarlar temizlendi");
});

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
