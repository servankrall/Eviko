// ===== Eviko ön yüz mantığı =====

const el = (id) => document.getElementById(id);
const screens = {
  capture: el("screen-capture"),
  loading: el("screen-loading"),
  error: el("screen-error"),
  results: el("screen-results"),
  calories: el("screen-calories"),
  favorites: el("screen-favorites"),
  shopping: el("screen-shopping"),
  history: el("screen-history"),
  plan: el("screen-plan"),
  diary: el("screen-diary"),
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
let avoid = store.get("eviko_avoid", []);
let history = store.get("eviko_history", []);
let lastRecipes = [];
let lastPlan = [];
let currentSocial = null;
let currentUser = null;
let googleClientId = null;
let pantry = store.get("eviko_pantry", []);
let installPrompt = null;
let diary = store.get("eviko_diary", []);
let calGoal = Number(localStorage.getItem("eviko_cal_goal")) || 2000;
let notes = store.get("eviko_notes", {});
let recipeFilter = "all";
let recipeSortTime = false;
let accent = localStorage.getItem("eviko_accent") || "green";
let water = store.get("eviko_water", {});
let favFilter = "";
let lastAction = null; // hata sonrası "tekrar dene" için
let lastFailType = null; // "results" | "calories" | "plan"
let lastResultsData = store.get("eviko_last_results", null);
let lastCaloriesData = store.get("eviko_last_calories", null);
let myRecipes = store.get("eviko_my_recipes", []);
let household = localStorage.getItem("eviko_household") || null;

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
// NOT: init() dosyanın EN SONUNDA çağrılır — böylece TIPS/DISHES gibi tüm
// const'lar tanımlandıktan sonra çalışır (erken çağrı "before initialization"
// hatasıyla tüm betiği öldürüyordu).
function init() {
  registerServiceWorker();
  applyTheme();
  applyAccent();
  applyDir();
  applyFontSize();
  initPrefs();
  renderAvoid();
  setMode(mode);
  updateBadges();
  renderPantry();
  renderTip();
  renderSeason();
  trackActiveDay();
  updateOnlineStatus();
  refreshAuth();
  loadHome();
  handleShortcut();
}
// PWA kısayolları (uygulama simgesine basılı tutunca) için ?go= yönlendirmesi.
function handleShortcut() {
  try {
    const go = new URLSearchParams(location.search).get("go");
    if (go === "diary") {
      renderDiary();
      showScreen("diary");
    } else if (go === "shopping") {
      renderShopping();
      showScreen("shopping");
    } else if (go === "assistant") {
      el("assistant-input").value = "";
      el("assistant-modal").classList.remove("hidden");
    }
  } catch {}
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  // Yeni sürüm devreye girince sayfayı bir kez tazele (güncelleme otomatik gelsin).
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          // Yeni sürüm kurulduysa ve zaten bir sürüm çalışıyorsa hemen devreye al.
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            nw.postMessage("skip-waiting");
          }
        });
      });
      reg.update().catch(() => {});
    })
    .catch(() => {});
}

// ---- Tema (açık/koyu/otomatik) ----
function applyTheme() {
  const t = localStorage.getItem("eviko_theme") || "auto";
  const dark =
    t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
function applyFontSize() {
  const s = localStorage.getItem("eviko_fontsize") || "100";
  document.documentElement.style.fontSize = s + "%";
}
function applyAccent() {
  document.documentElement.dataset.accent = accent;
}
function applyDir() {
  // Arapça için sağdan-sola yazım yönü.
  document.documentElement.dir = (localStorage.getItem("eviko_lang") || "tr") === "ar" ? "rtl" : "ltr";
}
// ---- Sebze-meyve "zıplama" animasyonu (seçimlerde küçük kutlama) ----
const VEGGIE_EMOJIS = ["🍅", "🥕", "🥦", "🍆", "🌽", "🥬", "🫑", "🍓", "🥑", "🧅", "🍋", "🥔", "🍏", "🌶️"];
const prefersReducedMotion =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
function veggieBurst(x, y, count = 7) {
  if (prefersReducedMotion) return;
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    s.className = "veggie-particle";
    s.textContent = VEGGIE_EMOJIS[Math.floor(Math.random() * VEGGIE_EMOJIS.length)];
    s.style.left = x + "px";
    s.style.top = y + "px";
    s.style.setProperty("--dx", (Math.random() * 140 - 70).toFixed(0) + "px");
    s.style.setProperty("--rot", (Math.random() * 140 - 70).toFixed(0) + "deg");
    s.style.fontSize = (1.1 + Math.random() * 0.9).toFixed(2) + "rem";
    s.style.animationDelay = (Math.random() * 0.08).toFixed(2) + "s";
    document.body.appendChild(s);
    s.addEventListener("animationend", () => s.remove());
  }
}
function burstFromEl(elm, count) {
  if (!elm) return;
  const r = elm.getBoundingClientRect();
  veggieBurst(r.left + r.width / 2, r.top + r.height / 2, count);
}
// Ekranın üstünden minik kutlama (sonuç gelince vb.).
function celebrate(count = 10) {
  const w = (typeof window !== "undefined" && window.innerWidth) || 360;
  veggieBurst(w / 2, 96, count);
}
// Hafif dokunsal geri bildirim (destekleyen cihazlarda).
function haptic(ms = 10) {
  try {
    if (!prefersReducedMotion && navigator.vibrate) navigator.vibrate(ms);
  } catch {}
}
// Sevimli, maskotlu boş ekran.
function emptyState(emoji, text) {
  return `<div class="empty-state"><div class="empty-emoji">${emoji}</div><p>${text}</p></div>`;
}

function markAccent() {
  document.querySelectorAll(".accent-dot").forEach((d) =>
    d.classList.toggle("active", d.dataset.accent === accent)
  );
}
document.querySelectorAll(".accent-dot").forEach((d) =>
  d.addEventListener("click", () => {
    accent = d.dataset.accent;
    localStorage.setItem("eviko_accent", accent);
    applyAccent();
    markAccent();
    burstFromEl(d, 8);
    haptic(8);
  })
);
// İlk açılış görünüm seçici: tema düğmeleri (Otomatik/Açık/Koyu).
function markThemeOpts() {
  const t = localStorage.getItem("eviko_theme") || "auto";
  document.querySelectorAll(".theme-opt").forEach((b) =>
    b.classList.toggle("active", b.dataset.theme === t)
  );
}
document.querySelectorAll(".theme-opt").forEach((b) =>
  b.addEventListener("click", () => {
    localStorage.setItem("eviko_theme", b.dataset.theme);
    applyTheme();
    markThemeOpts();
    burstFromEl(b, 8);
    haptic(8);
  })
);
// ---- Su takibi (günlük) ----
function changeWater(delta) {
  const k = todayKey();
  water[k] = Math.max(0, (water[k] || 0) + delta);
  store.set("eviko_water", water);
  el("water-count").textContent = water[k];
}
el("water-plus").addEventListener("click", () => changeWater(1));
el("water-minus").addEventListener("click", () => changeWater(-1));
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

// Diyet tercihleri + "sevmediğim malzemeler" birleştirilip AI'ya gönderilir.
function effectivePrefs() {
  if (!avoid.length) return prefs;
  return prefs.concat([`Şu malzemeleri kesinlikle kullanma: ${avoid.join(", ")}`]);
}
function renderAvoid() {
  const box = el("avoid-chips");
  if (!box) return;
  box.innerHTML = avoid
    .map(
      (a, i) =>
        `<span class="chip"><span>${escapeHtml(a)}</span><button class="chip-x" data-i="${i}" aria-label="Sil">×</button></span>`
    )
    .join("");
  box.querySelectorAll(".chip-x").forEach((b) =>
    b.addEventListener("click", () => {
      avoid.splice(Number(b.dataset.i), 1);
      store.set("eviko_avoid", avoid);
      renderAvoid();
    })
  );
}
el("avoid-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = el("avoid-input").value.trim();
  if (v && !avoid.some((x) => x.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"))) {
    avoid.push(v);
    store.set("eviko_avoid", avoid);
  }
  el("avoid-input").value = "";
  renderAvoid();
});

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
      banner.textContent = "Şu an örnek (demo) veriler gösteriliyor.";
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  } catch {
    banner.textContent = "Şu an sunucuya ulaşılamıyor; internetini kontrol edip tekrar dene.";
    banner.classList.remove("hidden");
  }
}

// Çevrimdışıyken sakin bir bilgi göster; çevrimiçide normal sağlık kontrolü.
function updateOnlineStatus() {
  const banner = el("banner");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    banner.textContent =
      "📴 Çevrimdışısın. Yeni tarif/analiz için internet gerekir; favori tariflerin ve listelerin yine açılır.";
    banner.classList.remove("hidden");
  } else {
    checkHealth();
  }
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

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
  el("pantry-box").classList.toggle("hidden", !ing);
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
    toast("Fotoğraf okunamadı, başka bir görsel dene.");
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
  lastAction = runIngredients;
  showScreen("loading");
  el("loading-text").textContent = "Fotoğraf inceleniyor…";
  el("loading-sub").textContent = "Malzemeler tanınıyor ve tarifler hazırlanıyor.";
  try {
    const data = useGemini()
      ? await window.GeminiClient.analyze(selectedImage.base64, selectedImage.mediaType, effectivePrefs())
      : await serverPost("/api/analyze", {
          image: selectedImage.base64,
          mediaType: selectedImage.mediaType,
          preferences: effectivePrefs(),
          language: langPref(),
        });
    renderResults(data);
    cacheResults(data);
    saveHistory("ingredients", data);
    showScreen("results");
  } catch (err) {
    fail(err, "results");
  }
}

// ---- Malzemeleri yazarak ara (fotoğrafsız) ----
el("manual-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el("manual-input").value.trim();
  if (text) runManual(text);
});

async function runManual(text) {
  lastAction = () => runManual(text);
  showScreen("loading");
  el("loading-text").textContent = "Malzemeler değerlendiriliyor…";
  el("loading-sub").textContent = "Sana uygun yemekler hazırlanıyor.";
  try {
    const data = useGemini()
      ? await window.GeminiClient.analyzeText(text, effectivePrefs())
      : await serverPost("/api/analyze-text", { text, preferences: effectivePrefs(), language: langPref() });
    renderResults(data);
    cacheResults(data);
    saveHistory("ingredients", data);
    showScreen("results");
  } catch (err) {
    fail(err, "results");
  }
}

// ---- Haftalık yemek planı ----
el("btn-plan").addEventListener("click", runPlan);
async function runPlan() {
  lastAction = runPlan;
  showScreen("loading");
  el("loading-text").textContent = "Haftalık plan hazırlanıyor…";
  el("loading-sub").textContent = "Sana uygun 7 günlük menü oluşturuluyor.";
  try {
    const data = useGemini()
      ? await window.GeminiClient.planWeek(effectivePrefs(), detectedNames)
      : await serverPost("/api/plan", {
          preferences: effectivePrefs(),
          detected: detectedNames,
          language: langPref(),
        });
    renderPlan(data);
    showScreen("plan");
  } catch (err) {
    fail(err, "plan");
  }
}

function renderPlan(data) {
  const days = (data && data.days) || [];
  lastPlan = days;
  const list = el("plan-list");
  el("btn-share-plan").classList.toggle("hidden", days.length === 0);
  el("btn-plan-shop").classList.toggle("hidden", !days.some((d) => (d.ingredients || []).length));
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
  lastAction = runCalories;
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
    cacheCalories(data);
    saveHistory("dish", data);
    showScreen("calories");
  } catch (err) {
    fail(err, "calories");
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

// GET/PUT/POST genel JSON isteği (ev grubu gibi sunucu özellikleri için).
async function serverJson(path, method = "GET", body) {
  let res;
  try {
    res = await fetch(api(path), {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Sunucuya ulaşılamadı.");
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("Sunucu bulunamadı.");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "İşlem başarısız");
  return data;
}

function cacheResults(data) {
  lastResultsData = data;
  store.set("eviko_last_results", data);
}
function cacheCalories(data) {
  lastCaloriesData = data;
  store.set("eviko_last_calories", data);
}

// Hatayı kullanıcı diline çevirir: sakin başlık + çözüm önerisi.
function friendlyError(err) {
  const m = (err && err.message) || "";
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    return {
      emoji: "📡",
      title: "İnternet yok",
      text: "Bağlantın kapalı görünüyor. Açınca tekrar dene. Kaydettiğin favori tarifler internetsiz de açılır.",
    };
  }
  if (/sunucu|bağlan|ulaşıl|bulunamadı/i.test(m)) {
    return {
      emoji: "📡",
      title: "Bağlantı kurulamadı",
      text: "Şu an sunucuya ulaşamadık. İnternetini kontrol edip birkaç saniye sonra tekrar dene.",
    };
  }
  if (/yoğun|çok kişi|yanıt alınamadı|kullanıyor|429|overload/i.test(m)) {
    return {
      emoji: "⏳",
      title: "Şu an yoğunluk var",
      text: "Çok fazla kişi kullanıyor. Birkaç saniye bekleyip tekrar dene — genelde hemen düzelir.",
    };
  }
  return {
    emoji: "😕",
    title: "Bir şeyler ters gitti",
    text: m || "Lütfen tekrar dene.",
  };
}

function fail(err, type) {
  console.error(err);
  lastFailType = type || null;
  const info = friendlyError(err);
  el("error-emoji").textContent = info.emoji;
  el("error-title").textContent = info.title;
  el("error-text").textContent = info.text;
  const cached =
    type === "results" ? lastResultsData : type === "calories" ? lastCaloriesData : null;
  el("error-cached").classList.toggle("hidden", !cached);
  showScreen("error");
}

el("error-retry").addEventListener("click", () => {
  if (typeof lastAction === "function") lastAction();
  else showScreen("capture");
});
el("error-cached").addEventListener("click", () => {
  if (lastFailType === "results" && lastResultsData) {
    renderResults(lastResultsData);
    showScreen("results");
  } else if (lastFailType === "calories" && lastCaloriesData) {
    renderCalories(lastCaloriesData);
    showScreen("calories");
  }
});
el("error-home").addEventListener("click", () => showScreen("capture"));

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

  recipeFilter = "all";
  recipeSortTime = false;
  renderRecipeControls();
  renderRecipeCards();
  if (recipes.length) celebrate(10); // yemekler bulununca minik kutlama
}

function renderRecipeControls() {
  const wrap = el("recipe-controls");
  const cats = [...new Set(lastRecipes.map((r) => r.category).filter(Boolean))];
  if (lastRecipes.length < 2) {
    wrap.innerHTML = "";
    return;
  }
  const chip = (val, label) =>
    `<button class="filter-chip ${recipeFilter === val ? "active" : ""}" data-cat="${escapeHtml(
      val
    )}">${escapeHtml(label)}</button>`;
  wrap.innerHTML =
    chip("all", "Tümü") +
    cats.map((c) => chip(c, c)).join("") +
    `<button class="filter-chip sort ${recipeSortTime ? "active" : ""}" id="sort-time">⏱ Süreye göre</button>`;
  wrap.querySelectorAll("[data-cat]").forEach((b) =>
    b.addEventListener("click", () => {
      recipeFilter = b.dataset.cat;
      renderRecipeControls();
      renderRecipeCards();
    })
  );
  const st = el("sort-time");
  if (st)
    st.addEventListener("click", () => {
      recipeSortTime = !recipeSortTime;
      renderRecipeControls();
      renderRecipeCards();
    });
}

function renderRecipeCards() {
  let list = lastRecipes.slice();
  if (recipeFilter !== "all") list = list.filter((r) => r.category === recipeFilter);
  if (recipeSortTime)
    list = list.sort((a, b) => (a.durationMinutes || 999) - (b.durationMinutes || 999));
  const grid = el("recipes");
  grid.innerHTML = list
    .map((r) => {
      const fav = isFavorite(r.title) ? '<span class="fav-star">⭐</span>' : "";
      return `
      <button class="recipe-card" data-title="${escapeHtml(r.title)}">
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
    card.addEventListener("click", () => openRecipeByTitle(card.dataset.title));
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
      <button id="cal-add" class="btn btn-primary cal-add">📒 Güne ekle</button>
    </div>`;
  el("cal-add").onclick = () => addToDiary(data.dishName, data.totalCalories, data.macros);
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
    // Açık olan her modalı kapat (erişilebilirlik).
    document.querySelectorAll(".modal:not(.hidden)").forEach((m) => m.classList.add("hidden"));
    closeRecipeModal();
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
      ? await window.GeminiClient.recipe(title, detectedNames, effectivePrefs())
      : await serverPost("/api/recipe", {
          title,
          detected: detectedNames,
          preferences: effectivePrefs(),
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
      else amount = ing.unit || "";
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
          ? `<img class="recipe-photo" src="${escapeHtml(currentSocial.photo)}" alt="${escapeHtml(r.title)}" loading="lazy" decoding="async" />`
          : ""
      }</div>
      <h2>${escapeHtml(r.title)}</h2>
      <div class="detail-meta">
        ${r.durationMinutes ? `<span class="tag">⏱ ${r.durationMinutes} dk</span>` : ""}
        ${r.difficulty ? `<span class="tag easy">${escapeHtml(r.difficulty)}</span>` : ""}
        ${r.caloriesPerServing ? `<span class="tag cat">🔥 ~${r.caloriesPerServing} kcal/porsiyon</span>` : ""}
        ${r.estimatedCostTl ? `<span class="tag">🛒 ~${r.estimatedCostTl} ₺</span>` : ""}
      </div>

      ${
        r.macros
          ? `<div class="macros recipe-macros">
        <div class="macro"><div class="mnum">${r.macros.proteinG ?? "-"}g</div><div class="mlabel">Protein</div></div>
        <div class="macro"><div class="mnum">${r.macros.carbsG ?? "-"}g</div><div class="mlabel">Karbonhidrat</div></div>
        <div class="macro"><div class="mnum">${r.macros.fatG ?? "-"}g</div><div class="mlabel">Yağ</div></div>
      </div>`
          : ""
      }

      ${r.pairing ? `<div class="cal-note pairing-note">🍷 ${escapeHtml(r.pairing)}</div>` : ""}

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
        <button class="btn btn-ghost" id="btn-video">▶️ Video</button>
        ${r.caloriesPerServing ? '<button class="btn btn-ghost" id="btn-diary-add">📒 Güne ekle</button>' : ""}
        <button class="btn btn-ghost" id="btn-print">🖨️ Yazdır</button>
        <button class="btn btn-primary" id="btn-cook">👨‍🍳 Pişir</button>
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
      <div class="detail-section">
        <h4>📝 Notum</h4>
        <textarea id="recipe-note" class="note-area" placeholder="Bu tarif için kişisel notun…"></textarea>
      </div>
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
  el("btn-video").onclick = () =>
    window.open(
      "https://www.youtube.com/results?search_query=" + encodeURIComponent(r.title + " tarifi"),
      "_blank"
    );
  el("btn-cook").onclick = () => openCook(r);
  el("btn-print").onclick = () => window.print();
  const da = el("btn-diary-add");
  if (da) da.onclick = () => addToDiary(r.title, r.caloriesPerServing, r.macros);
  const note = el("recipe-note");
  if (note) {
    note.value = notes[r.title] || "";
    note.addEventListener("input", () => {
      notes[r.title] = note.value;
      store.set("eviko_notes", notes);
    });
  }
  modal.querySelectorAll(".step-list li").forEach((li) =>
    li.addEventListener("click", () => li.classList.toggle("done"))
  );
  modal.querySelectorAll(".ingredient-list li.tappable").forEach((li) =>
    li.addEventListener("click", () => openIngredientSheet(li.dataset.item, r.title))
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
    haptic(12); // favoriye eklerken hafif titreşim
  }
  store.set("eviko_favorites", favorites);
  updateBadges();
}
function renderFavorites() {
  const list = el("favorites-list");
  el("fav-search").classList.toggle("hidden", favorites.length === 0);
  if (favorites.length === 0) {
    list.innerHTML = emptyState("⭐", "Henüz favori tarifin yok.<br>Bir tarifi açıp ⭐ ile kaydet.");
    return;
  }
  const q = favFilter.trim().toLocaleLowerCase("tr");
  const items = favorites
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !q || (f.title || "").toLocaleLowerCase("tr").includes(q));
  if (items.length === 0) {
    list.innerHTML = '<div class="list-empty">Aramana uygun favori bulunamadı.</div>';
    return;
  }
  list.innerHTML = items
    .map(
      ({ f, i }) => `
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

el("fav-search").addEventListener("input", (e) => {
  favFilter = e.target.value;
  renderFavorites();
});

// ---- Kendi tariflerim ----
const myrecModal = el("myrecipes-modal");
el("btn-myrecipes").addEventListener("click", () => {
  renderMyRecipes();
  el("myrec-form").classList.add("hidden");
  myrecModal.classList.remove("hidden");
});
el("myrec-close").addEventListener("click", () => myrecModal.classList.add("hidden"));
myrecModal.addEventListener("click", (e) => {
  if (e.target === myrecModal) myrecModal.classList.add("hidden");
});
el("myrec-new").addEventListener("click", () => {
  el("myrec-title").value = "";
  el("myrec-ing").value = "";
  el("myrec-steps").value = "";
  el("myrec-form").classList.remove("hidden");
  el("myrec-title").focus();
});
el("myrec-cancel").addEventListener("click", () => el("myrec-form").classList.add("hidden"));
el("myrec-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = el("myrec-title").value.trim();
  if (!title) {
    toast("Tarife bir ad ver.");
    return;
  }
  const ingredients = el("myrec-ing")
    .value.split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => ({ item: line, quantity: 0, unit: "", toTaste: false }));
  const steps = el("myrec-steps")
    .value.split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  myRecipes.unshift({ title, servings: 2, ingredients, steps, tips: [], mine: true });
  myRecipes = myRecipes.slice(0, 200);
  store.set("eviko_my_recipes", myRecipes);
  el("myrec-form").classList.add("hidden");
  renderMyRecipes();
  toast("Tarifin kaydedildi ✍️");
});
function renderMyRecipes() {
  const box = el("myrec-list");
  if (!myRecipes.length) {
    box.innerHTML =
      emptyState("✍️", 'Henüz kendi tarifin yok.<br>"➕ Yeni tarif ekle" ile başla.');
    return;
  }
  box.innerHTML = myRecipes
    .map(
      (r, i) =>
        `<div class="fav-item"><div class="fav-main" data-open="${i}"><h3>${escapeHtml(
          r.title
        )}</h3><div class="muted small">${(r.ingredients || []).length} malzeme · ${
          (r.steps || []).length
        } adım</div></div><button class="remove" data-del="${i}" aria-label="Sil">🗑️</button></div>`
    )
    .join("");
  box.querySelectorAll("[data-open]").forEach((m) =>
    m.addEventListener("click", () => {
      myrecModal.classList.add("hidden");
      detectedNames = [];
      openRecipeObject(myRecipes[Number(m.dataset.open)]);
    })
  );
  box.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      myRecipes.splice(Number(b.dataset.del), 1);
      store.set("eviko_my_recipes", myRecipes);
      renderMyRecipes();
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
  el("btn-market").classList.toggle("hidden", shopping.length === 0);
  if (shopping.length === 0) {
    list.innerHTML = emptyState("🛒", "Listen boş.<br>Tariflerden veya yukarıdan malzeme ekle.");
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
  el("theme-select").value = localStorage.getItem("eviko_theme") || "auto";
  el("lang-select").value = localStorage.getItem("eviko_lang") || "tr";
  el("fontsize-select").value = localStorage.getItem("eviko_fontsize") || "100";
  el("speech-rate-select").value = localStorage.getItem("eviko_speech_rate") || "1";
  markAccent();
  settingsModal.classList.remove("hidden");
});
el("settings-close").addEventListener("click", () => settingsModal.classList.add("hidden"));
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.classList.add("hidden");
});
el("settings-save").addEventListener("click", () => {
  localStorage.setItem("eviko_theme", el("theme-select").value);
  localStorage.setItem("eviko_lang", el("lang-select").value);
  localStorage.setItem("eviko_fontsize", el("fontsize-select").value);
  localStorage.setItem("eviko_speech_rate", el("speech-rate-select").value);
  applyTheme();
  applyDir();
  applyFontSize();
  markThemeOpts();
  settingsModal.classList.add("hidden");
  checkHealth();
  toast("Ayarlar kaydedildi ✓");
});
el("settings-clear").addEventListener("click", () => {
  localStorage.removeItem("eviko_theme");
  el("theme-select").value = "auto";
  localStorage.removeItem("eviko_lang");
  el("lang-select").value = "tr";
  localStorage.removeItem("eviko_fontsize");
  el("fontsize-select").value = "100";
  localStorage.removeItem("eviko_speech_rate");
  el("speech-rate-select").value = "1";
  applyTheme();
  applyDir();
  applyFontSize();
  markThemeOpts();
  checkHealth();
  toast("Ayarlar temizlendi");
});
el("btn-share-app").addEventListener("click", async () => {
  const url = "https://eviko.onrender.com";
  const text = "Eviko ile evdeki sebzelerden ne pişeceğini bul, kalorisini öğren! 🥗";
  try {
    if (navigator.share) await navigator.share({ title: "Eviko", text, url });
    else {
      await navigator.clipboard.writeText(text + " " + url);
      toast("Bağlantı kopyalandı 📋");
    }
  } catch {}
});

// ---- Veri yedekleme / geri yükleme (cihazda) ----
const BACKUP_KEYS = [
  "eviko_favorites", "eviko_my_recipes", "eviko_shopping", "eviko_prefs",
  "eviko_avoid", "eviko_history", "eviko_pantry", "eviko_diary", "eviko_notes",
  "eviko_water", "eviko_cal_goal", "eviko_accent", "eviko_theme", "eviko_lang",
  "eviko_fontsize", "eviko_weights", "eviko_speech_rate",
];
el("btn-backup").addEventListener("click", () => {
  const payload = { _eviko: true, version: 1, savedAt: new Date().toISOString(), data: {} };
  for (const k of BACKUP_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) payload.data[k] = v;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `eviko-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Yedek indirildi 💾");
});
el("btn-restore").addEventListener("click", () => el("restore-input").click());
el("restore-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (!obj || obj._eviko !== true || typeof obj.data !== "object") {
      toast("Bu bir Eviko yedeği değil.");
      return;
    }
    for (const k of BACKUP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(obj.data, k)) {
        localStorage.setItem(k, obj.data[k]);
      }
    }
    toast("Veriler geri yüklendi, yenileniyor…");
    setTimeout(() => location.reload(), 700);
  } catch {
    toast("Yedek dosyası okunamadı.");
  }
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
      emptyState("🕘", "Henüz geçmiş yok.<br>Bir analiz yaptığında burada görünür.");
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
  u.lang = langPref() === "en" ? "en-US" : "tr-TR";
  u.rate = Number(localStorage.getItem("eviko_speech_rate")) || 1;
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

// ---- Markete götür (online market / harita / kopyala) ----
const marketModal = el("market-modal");
el("btn-market").addEventListener("click", () => {
  if (!shopping.length) {
    toast("Listen boş.");
    return;
  }
  marketModal.classList.remove("hidden");
});
el("market-close").addEventListener("click", () => marketModal.classList.add("hidden"));
marketModal.addEventListener("click", (e) => {
  if (e.target === marketModal) marketModal.classList.add("hidden");
});
el("market-maps").addEventListener("click", () => {
  openStore("market manav");
  marketModal.classList.add("hidden");
});
el("market-migros").addEventListener("click", () => {
  const first = shopping.find((s) => !s.checked) || shopping[0];
  const q = encodeURIComponent(first ? first.name : "market");
  window.open(`https://www.migros.com.tr/arama?q=${q}`, "_blank");
  marketModal.classList.add("hidden");
});
el("market-getir").addEventListener("click", () => {
  window.open("https://getir.com/", "_blank");
  marketModal.classList.add("hidden");
});
el("market-copy").addEventListener("click", async () => {
  const text = "🛒 Alışveriş listem (Eviko):\n" + shopping.map((s) => "- " + s.name).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("Liste kopyalandı 📋");
  } catch {
    toast("Kopyalanamadı.");
  }
  marketModal.classList.add("hidden");
});

// ---- Ev/aile ortak listesi (kod ile paylaşım) ----
const hhModal = el("household-modal");
function renderHousehold() {
  const joined = !!household;
  el("hh-join").classList.toggle("hidden", joined);
  el("hh-active").classList.toggle("hidden", !joined);
  el("hh-status").textContent = "";
  if (joined) el("hh-code").textContent = household;
}
el("btn-household").addEventListener("click", () => {
  renderHousehold();
  hhModal.classList.remove("hidden");
});
el("hh-close").addEventListener("click", () => hhModal.classList.add("hidden"));
hhModal.addEventListener("click", (e) => {
  if (e.target === hhModal) hhModal.classList.add("hidden");
});
el("hh-create").addEventListener("click", async () => {
  try {
    const h = await serverJson("/api/household/create", "POST", {});
    household = h.code;
    localStorage.setItem("eviko_household", household);
    renderHousehold();
    toast("Ev grubu oluşturuldu 👨‍👩‍👧");
  } catch (err) {
    toast(err.message || "Oluşturulamadı.");
  }
});
el("hh-join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = el("hh-code-input").value.trim().toUpperCase();
  if (!code) return;
  try {
    const h = await serverJson("/api/household/" + encodeURIComponent(code), "GET");
    household = h.code;
    localStorage.setItem("eviko_household", household);
    el("hh-code-input").value = "";
    renderHousehold();
    toast("Gruba katıldın 👨‍👩‍👧");
  } catch (err) {
    toast(err.message || "Grup bulunamadı.");
  }
});
el("hh-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(household || "");
    toast("Kod kopyalandı 📋");
  } catch {
    toast("Kopyalanamadı.");
  }
});
el("hh-push").addEventListener("click", async () => {
  if (!household) return;
  el("hh-status").textContent = "Gönderiliyor…";
  try {
    await serverJson("/api/household/" + household, "PUT", {
      items: shopping.map((s) => ({ name: s.name, checked: !!s.checked })),
    });
    el("hh-status").textContent = "Listen gruba gönderildi ✓";
  } catch (err) {
    el("hh-status").textContent = err.message || "Gönderilemedi.";
  }
});
el("hh-pull").addEventListener("click", async () => {
  if (!household) return;
  el("hh-status").textContent = "Getiriliyor…";
  try {
    const h = await serverJson("/api/household/" + household, "GET");
    shopping = (h.items || []).map((it) => ({ name: it.name, checked: !!it.checked }));
    store.set("eviko_shopping", shopping);
    renderShopping();
    updateBadges();
    el("hh-status").textContent = "Grubun listesi alındı ✓";
  } catch (err) {
    el("hh-status").textContent = err.message || "Getirilemedi.";
  }
});
el("hh-leave").addEventListener("click", () => {
  household = null;
  localStorage.removeItem("eviko_household");
  renderHousehold();
  toast("Gruptan çıkıldı.");
});

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

// ---- Tarif arama (yemek adıyla) ----
el("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = el("search-input").value.trim();
  if (q) {
    detectedNames = [];
    openRecipeByTitle(q);
  }
});

// ---- Buzdolabım (kayıtlı malzemeler) ----
function renderPantry() {
  const box = el("pantry-chips");
  box.innerHTML = pantry
    .map(
      (p, i) =>
        `<span class="chip"><span>${escapeHtml(p)}</span><button class="chip-x" data-i="${i}" aria-label="Sil">×</button></span>`
    )
    .join("");
  box.querySelectorAll(".chip-x").forEach((b) =>
    b.addEventListener("click", () => {
      pantry.splice(Number(b.dataset.i), 1);
      store.set("eviko_pantry", pantry);
      renderPantry();
    })
  );
  el("btn-pantry-suggest").classList.toggle("hidden", pantry.length === 0);
}
el("pantry-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = el("pantry-input").value.trim();
  if (v && !pantry.some((x) => x.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"))) {
    pantry.push(v);
    store.set("eviko_pantry", pantry);
  }
  el("pantry-input").value = "";
  renderPantry();
});
el("btn-pantry-suggest").addEventListener("click", () => {
  if (pantry.length) runManual(pantry.join(", "));
});

// Fiş okut → buzdolabına ekle
el("btn-receipt").addEventListener("click", () => el("receipt-input").click());
el("receipt-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let img;
  try {
    img = await resizeImage(file);
  } catch {
    toast("Fotoğraf okunamadı, başka bir görsel dene.");
    return;
  }
  toast("Fiş okunuyor… 📷");
  try {
    const data = useGemini()
      ? await window.GeminiClient.readReceipt(img.base64, img.mediaType)
      : await serverPost("/api/receipt", {
          image: img.base64,
          mediaType: img.mediaType,
          language: langPref(),
        });
    const items = (data && data.items) || [];
    if (!items.length) {
      toast("Fişte ürün okunamadı, daha net bir fotoğraf dene.");
      return;
    }
    let added = 0;
    items.forEach((it) => {
      const v = String(it).trim();
      if (v && !pantry.some((x) => x.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"))) {
        pantry.push(v);
        added++;
      }
    });
    store.set("eviko_pantry", pantry);
    renderPantry();
    toast(added ? `${added} ürün buzdolabına eklendi 🧊` : "Hepsi zaten ekliydi.");
  } catch (err) {
    toast(err.message || "Fiş okunamadı.");
  }
});

// ---- Uygulamayı yükle (PWA) ----
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  el("btn-install").classList.remove("hidden");
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  el("btn-install").classList.add("hidden");
});
el("btn-install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try {
    await installPrompt.userChoice;
  } catch {}
  installPrompt = null;
  el("btn-install").classList.add("hidden");
});

// ---- Pişirme modu (adım adım + zamanlayıcı) ----
const cookModal = el("cook-modal");
let cookSteps = [];
let cookIdx = 0;
let cookInterval = null;
let cookRemain = 0;

function openCook(r) {
  cookSteps = r.steps || [];
  if (!cookSteps.length) {
    toast("Bu tarifte adım yok.");
    return;
  }
  cookIdx = 0;
  cookModal.classList.remove("hidden");
  renderCook();
}
function closeCook() {
  stopCookTimer();
  cookModal.classList.add("hidden");
}
function parseDuration(text) {
  const m = /(\d+)\s*(saat|dakika|dk|saniye|sn)/i.exec(text || "");
  if (!m) return 0;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u.indexOf("saat") === 0) return n * 3600;
  if (u.indexOf("dak") === 0 || u === "dk") return n * 60;
  return n;
}
function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
function renderCook() {
  const total = cookSteps.length;
  const step = cookSteps[cookIdx] || "";
  const dur = parseDuration(step);
  el("cook-body").innerHTML = `
    <div class="cook-top">Adım ${cookIdx + 1} / ${total}</div>
    <div class="cook-step">${escapeHtml(step)}</div>
    <div id="cook-timer" class="cook-timer">${
      dur ? `<button class="btn btn-primary" id="cook-start">⏱ ${fmtTime(dur)} başlat</button>` : ""
    }</div>
    <div class="cook-nav">
      <button class="btn btn-ghost" id="cook-prev" ${cookIdx === 0 ? "disabled" : ""}>‹ Önceki</button>
      ${
        cookIdx < total - 1
          ? `<button class="btn btn-primary" id="cook-next">Sonraki ›</button>`
          : `<button class="btn btn-primary" id="cook-finish">Bitti 🎉</button>`
      }
    </div>`;
  const start = el("cook-start");
  if (start) start.onclick = () => startCookTimer(dur);
  const prev = el("cook-prev");
  if (prev)
    prev.onclick = () => {
      stopCookTimer();
      cookIdx = Math.max(0, cookIdx - 1);
      renderCook();
    };
  const next = el("cook-next");
  if (next)
    next.onclick = () => {
      stopCookTimer();
      cookIdx = Math.min(total - 1, cookIdx + 1);
      renderCook();
    };
  const fin = el("cook-finish");
  if (fin)
    fin.onclick = () => {
      closeCook();
      haptic(20);
      celebrate(14); // pişirme bitti — kutlama
      toast("Afiyet olsun! 🎉");
    };
}
function startCookTimer(sec) {
  stopCookTimer();
  cookRemain = sec;
  const t = el("cook-timer");
  const paint = () => {
    t.innerHTML = `<div class="cook-count">${fmtTime(cookRemain)}</div><button class="btn btn-ghost" id="cook-stop">Durdur</button>`;
    const st = el("cook-stop");
    if (st) st.onclick = stopCookTimer;
  };
  paint();
  cookInterval = setInterval(() => {
    cookRemain--;
    if (cookRemain <= 0) {
      stopCookTimer();
      beep();
      t.innerHTML = '<div class="cook-count done">Süre doldu! ⏰</div>';
    } else paint();
  }, 1000);
}
function stopCookTimer() {
  if (cookInterval) {
    clearInterval(cookInterval);
    cookInterval = null;
  }
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    o.start();
    setTimeout(() => {
      try {
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        o.stop(ctx.currentTime + 0.25);
        ctx.close();
      } catch {}
    }, 700);
  } catch {}
  try {
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  } catch {}
}
el("cook-close").addEventListener("click", closeCook);
cookModal.addEventListener("click", (e) => {
  if (e.target === cookModal) closeCook();
});

// ---- Sesli giriş (ortak, sağlam) ----
let voiceActive = false;
async function startVoice(mic, onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast("Sesli giriş bu cihazda/uygulamada desteklenmiyor; yazarak deneyebilirsin.");
    return;
  }
  if (voiceActive) return;
  // Mikrofon iznini önden iste — bazı tarayıcı/WebView'larda bu olmadan başlamaz.
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    }
  } catch {
    toast("Mikrofon izni gerekli. Tarayıcı/uygulama ayarlarından izin ver.");
    return;
  }
  let rec;
  try {
    rec = new SR();
  } catch {
    toast("Sesli giriş başlatılamadı.");
    return;
  }
  rec.lang = langPref() === "en" ? "en-US" : "tr-TR";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  voiceActive = true;
  if (mic) mic.classList.add("listening");
  toast("Dinliyorum… 🎤");
  rec.onresult = (e) => {
    const t = e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript;
    if (t) onText(t);
  };
  rec.onerror = (e) => {
    const x = e && e.error;
    if (x === "not-allowed" || x === "service-not-allowed") toast("Mikrofon izni reddedildi.");
    else if (x === "no-speech") toast("Ses algılanamadı, tekrar dene.");
    else if (x === "audio-capture") toast("Mikrofon bulunamadı.");
  };
  rec.onend = () => {
    voiceActive = false;
    if (mic) mic.classList.remove("listening");
  };
  try {
    rec.start();
  } catch {
    voiceActive = false;
    if (mic) mic.classList.remove("listening");
  }
}

// ---- Sesle arama (üst arama kutusu) ----
(function () {
  const mic = el("search-mic");
  if (!mic) return;
  mic.classList.remove("hidden"); // her zaman görünür; desteklenmezse tıklayınca açıklar
  mic.addEventListener("click", () =>
    startVoice(mic, (t) => {
      el("search-input").value = t;
      el("search-form").dispatchEvent(new Event("submit"));
    })
  );
})();

// ---- Sesle malzeme yazma (alt kutu) ----
(function () {
  const mic = el("manual-mic");
  if (!mic) return;
  mic.classList.remove("hidden");
  mic.addEventListener("click", () =>
    startVoice(mic, (t) => {
      el("manual-input").value = t;
      el("manual-form").dispatchEvent(new Event("submit"));
    })
  );
})();

// ---- "Bugün ne pişeyim?" sürpriz ----
const DISHES = [
  "Menemen", "Mercimek çorbası", "Karnıyarık", "İmam bayıldı", "Tavuk sote", "Köfte",
  "Mantı", "Kuru fasulye", "Pilav", "Sigara böreği", "Zeytinyağlı taze fasulye",
  "Ispanaklı börek", "Domates çorbası", "Çoban salata", "Tavuklu pilav", "Patlıcan musakka",
  "Etli nohut", "Bulgur pilavı", "Sebzeli omlet", "Fırın tavuk", "Makarna", "Şakşuka",
  "Türlü", "Yeşil mercimek yemeği", "Kısır", "Mücver", "Pırasa yemeği", "Yoğurtlu kabak",
];
// ---- Günün mutfak ipucu ----
const TIPS = [
  "Soğanı doğramadan önce 10 dakika buzdolabında beklet; gözlerin daha az yanar.",
  "Makarna suyuna bol tuz at — sosa biraz makarna suyu eklemek kıvamı güzelleştirir.",
  "Eti tuzlamadan önce oda sıcaklığına getir; daha eşit pişer.",
  "Sarımsağı bıçağın yan yüzüyle ez, kabuğu kolayca soyulur.",
  "Domatesin kabuğunu kolay soymak için dibine çarpı çiz, kaynar suya 20 sn daldır.",
  "Pilavı demlemeden önce 5 dakika dinlendir; taneler ayrı ayrı olur.",
  "Limonu kesmeden önce tezgaha bastırıp yuvarla; daha çok su verir.",
  "Yumurtanın tazesini anlamak için suya koy: dibe yatıyorsa tazedir.",
  "Yeşillikleri yıkadıktan sonra iyice kurula; ıslakken çabuk bozulur.",
  "Çorbayı blenderdan geçirirken kapağı bezle tut; sıcak sıçramaz.",
  "Hamur işlerinde tereyağını soğuk kullan; daha çıtır olur.",
  "Bayat ekmeği rendele, dondur; köfte ve gratende işine yarar.",
  "Avokadoyu çekirdeğiyle sakla; kararması yavaşlar.",
  "Patatesi haşlarken suya biraz sirke ekle; dağılmadan pişer.",
  "Baharatları kavururken kokusu çıkınca ekle; tadı daha yoğun olur.",
  "Zeytinyağını çok kızdırma; dumanlanınca tadı bozulur, kızartmaya ayçiçeği daha uygun.",
  "Soğanı karamelize ederken bir tutam tuz ekle; suyunu bırakıp daha çabuk pişer.",
  "Et suyunu dondurma kalıbında sakla; tek tek kullanırsın.",
  "Salatayı servisten hemen önce sosla; erken soslarsan sular.",
  "Bıçağını düzenli bile; kör bıçak hem zor keser hem tehlikelidir.",
  "Muzları diğer meyvelerden ayrı tut; hepsini hızla olgunlaştırır.",
  "Tava çok dolu olmasın; sıkışık malzeme kavrulmaz, haşlanır.",
];
function dayOfYear() {
  const d = new Date();
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}
function renderTip() {
  const t = el("tip-text");
  if (t) t.textContent = TIPS[dayOfYear() % TIPS.length];
}

// ---- Bu ayın mevsimi (yerel veri) ----
const SEASONAL = [
  ["Lahana", "Pırasa", "Karnabahar", "Ispanak", "Portakal", "Mandalina", "Havuç", "Kereviz"],
  ["Pırasa", "Lahana", "Ispanak", "Brokoli", "Portakal", "Pancar", "Kereviz"],
  ["Ispanak", "Enginar", "Bakla", "Taze soğan", "Maydanoz", "Roka", "Pırasa"],
  ["Enginar", "Bakla", "Taze soğan", "Marul", "Çilek", "Dereotu", "Bezelye"],
  ["Çilek", "Kayısı", "Taze fasulye", "Bezelye", "Salatalık", "Marul", "Yeşil erik"],
  ["Domates", "Salatalık", "Kiraz", "Kayısı", "Kabak", "Biber", "Vişne"],
  ["Domates", "Biber", "Patlıcan", "Karpuz", "Kavun", "Şeftali", "Mısır"],
  ["Patlıcan", "Biber", "Domates", "İncir", "Üzüm", "Bamya", "Kavun"],
  ["Üzüm", "İncir", "Elma", "Patlıcan", "Biber", "Nar", "Ayva"],
  ["Nar", "Elma", "Ayva", "Balkabağı", "Karnabahar", "Mandalina", "Pırasa"],
  ["Pırasa", "Lahana", "Mandalina", "Portakal", "Balkabağı", "Kestane", "Havuç"],
  ["Portakal", "Mandalina", "Lahana", "Pırasa", "Karnabahar", "Kereviz", "Nar"],
];
function renderSeason() {
  const box = el("season-chips");
  if (!box) return;
  const list = SEASONAL[new Date().getMonth()] || [];
  box.innerHTML = list
    .map((p) => `<button class="season-chip" data-p="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
    .join("");
  box.querySelectorAll(".season-chip").forEach((b) =>
    b.addEventListener("click", () => runManual(b.dataset.p))
  );
}

// ---- Kilo takibi ----
let weights = store.get("eviko_weights", []);
el("weight-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const kg = Number(el("weight-input").value);
  if (!kg || kg <= 0) return;
  weights.push({ kg: Math.round(kg * 10) / 10, day: todayKey(), ts: Date.now() });
  weights = weights.slice(-120);
  store.set("eviko_weights", weights);
  el("weight-input").value = "";
  renderWeight();
  haptic(10);
  toast("Kilo kaydedildi ⚖️");
});
function renderWeight() {
  const box = el("weight-chart");
  if (!box) return;
  const last = weights.slice(-8);
  if (!last.length) {
    box.innerHTML = '<p class="muted small">Kilonu kaydet; değişimini burada gör.</p>';
    return;
  }
  const vals = last.map((w) => w.kg);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const latest = vals[vals.length - 1];
  const diff = (latest - vals[0]).toFixed(1);
  box.innerHTML =
    `<div class="muted small">Son: <b>${latest} kg</b>${
      last.length > 1 ? ` · değişim ${diff > 0 ? "+" : ""}${diff} kg` : ""
    }</div>` +
    '<div class="week-bars">' +
    last
      .map(
        (w) =>
          `<div class="week-col"><div class="week-bar" style="height:${
            Math.round(((w.kg - min) / range) * 52) + 10
          }px" title="${w.kg} kg"></div></div>`
      )
      .join("") +
    "</div>";
}

// ---- Aktif gün takibi (rozet serisi için) ----
function trackActiveDay() {
  const days = store.get("eviko_active_days", []);
  const k = todayKey();
  if (!days.includes(k)) {
    days.push(k);
    store.set("eviko_active_days", days.slice(-400));
  }
}
function currentStreak() {
  const days = new Set(store.get("eviko_active_days", []));
  let streak = 0;
  const d = new Date();
  while (days.has(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---- "Ne yesem?" çarkı ----
const wheelModal = el("wheel-modal");
let wheelPick = null;
let wheelSpinning = false;
el("btn-surprise-dish").addEventListener("click", () => {
  wheelPick = null;
  el("wheel-open").classList.add("hidden");
  el("wheel-display").textContent = "🍽️";
  wheelModal.classList.remove("hidden");
});
el("wheel-close").addEventListener("click", () => wheelModal.classList.add("hidden"));
wheelModal.addEventListener("click", (e) => {
  if (e.target === wheelModal) wheelModal.classList.add("hidden");
});
el("wheel-spin").addEventListener("click", () => {
  if (wheelSpinning) return;
  wheelSpinning = true;
  el("wheel-open").classList.add("hidden");
  const disp = el("wheel-display");
  const total = 22;
  let i = 0;
  const step = () => {
    disp.textContent = DISHES[Math.floor(Math.random() * DISHES.length)];
    i++;
    if (i >= total) {
      wheelPick = disp.textContent;
      disp.textContent = "🍽️ " + wheelPick;
      el("wheel-open").classList.remove("hidden");
      wheelSpinning = false;
      return;
    }
    setTimeout(step, 50 + i * i * 1.2); // hızlı başlar, yavaşlar
  };
  step();
});
el("wheel-open").addEventListener("click", () => {
  if (!wheelPick) return;
  wheelModal.classList.add("hidden");
  detectedNames = [];
  openRecipeByTitle(wheelPick);
});

// ---- Rozetler / başarımlar ----
const badgesModal = el("badges-modal");
el("btn-badges").addEventListener("click", () => {
  renderBadges();
  badgesModal.classList.remove("hidden");
});
el("badges-close").addEventListener("click", () => badgesModal.classList.add("hidden"));
badgesModal.addEventListener("click", (e) => {
  if (e.target === badgesModal) badgesModal.classList.add("hidden");
});

// ---- Mutfak terimleri sözlüğü ----
const glossaryModal = el("glossary-modal");
el("btn-glossary").addEventListener("click", () => glossaryModal.classList.remove("hidden"));
el("glossary-close").addEventListener("click", () => glossaryModal.classList.add("hidden"));
glossaryModal.addEventListener("click", (e) => {
  if (e.target === glossaryModal) glossaryModal.classList.add("hidden");
});
function renderBadges() {
  const favCount = favorites.length;
  const diaryDays = new Set(diary.map((e) => e.day)).size;
  const historyCount = history.length;
  const streak = currentStreak();
  const waterMax = Math.max(0, ...Object.values(water).map((n) => Number(n) || 0));
  const defs = [
    { emoji: "⭐", title: "İlk favori", desc: "Bir tarifi favorile", done: favCount >= 1 },
    { emoji: "🌟", title: "Koleksiyoncu", desc: "5 favori tarif", done: favCount >= 5 },
    { emoji: "📒", title: "Günlükçü", desc: "3 farklı gün günlüğe yaz", done: diaryDays >= 3 },
    { emoji: "🔥", title: "Seri başladı", desc: "3 gün üst üste kullan", done: streak >= 3 },
    { emoji: "💧", title: "Susuz kalma", desc: "Bir günde 8 bardak su", done: waterMax >= 8 },
    { emoji: "🔎", title: "Meraklı", desc: "10 kez ara/incele", done: historyCount >= 10 },
    { emoji: "🍳", title: "Şef adayı", desc: "20 favori tarif", done: favCount >= 20 },
    { emoji: "🏆", title: "Eviko ustası", desc: "7 gün seri", done: streak >= 7 },
  ];
  const earned = defs.filter((d) => d.done).length;
  el("badges-summary").textContent = `${earned}/${defs.length} rozet · 🔥 ${streak} günlük seri`;
  el("badges-grid").innerHTML = defs
    .map(
      (d) =>
        `<div class="badge-card ${d.done ? "earned" : "locked"}">
           <div class="badge-emoji">${d.emoji}</div>
           <div class="badge-title">${escapeHtml(d.title)}</div>
           <div class="badge-desc muted small">${escapeHtml(d.desc)}</div>
         </div>`
    )
    .join("");
}

// ---- Davet / porsiyon hesaplayıcı ----
const eventModal = el("event-modal");
el("btn-event").addEventListener("click", () => {
  el("event-result").innerHTML = "";
  eventModal.classList.remove("hidden");
});
el("event-close").addEventListener("click", () => eventModal.classList.add("hidden"));
eventModal.addEventListener("click", (e) => {
  if (e.target === eventModal) eventModal.classList.add("hidden");
});
eventModal.querySelectorAll(".event-presets .season-chip").forEach((b) =>
  b.addEventListener("click", () => {
    el("event-dish").value = b.dataset.dish;
    el("event-dish").focus();
  })
);
el("event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const people = Math.max(1, Number(el("event-people").value) || 1);
  const dish = el("event-dish").value.trim();
  if (!dish) {
    toast("Ne hazırlayacağını yaz.");
    return;
  }
  const box = el("event-result");
  box.innerHTML = '<p class="muted small">Hesaplanıyor…</p>';
  try {
    const data = useGemini()
      ? await window.GeminiClient.eventPlan(people, dish)
      : await serverPost("/api/event-plan", { people, dish, language: langPref() });
    renderEvent(data);
  } catch (err) {
    box.innerHTML = `<p class="muted small">${escapeHtml(err.message || "Hesaplama yapılamadı.")}</p>`;
  }
});
function renderEvent(data) {
  const items = (data && data.items) || [];
  const box = el("event-result");
  if (!items.length) {
    box.innerHTML = '<p class="muted small">Liste oluşturulamadı, tekrar dene.</p>';
    return;
  }
  box.innerHTML =
    `<div class="event-head">${escapeHtml(data.dish || "")} · ${data.people || ""} kişi${
      data.estimatedCostTl ? ` · ~${data.estimatedCostTl} TL` : ""
    }</div>` +
    '<ul class="event-list">' +
    items
      .map(
        (it) =>
          `<li><span class="ev-q">${escapeHtml(it.quantity || "")}</span> <span class="ev-i">${escapeHtml(
            it.item || ""
          )}</span>${it.note ? `<span class="muted small"> — ${escapeHtml(it.note)}</span>` : ""}</li>`
      )
      .join("") +
    "</ul>" +
    '<button class="btn btn-ghost" id="event-to-shop">🛒 Listeyi alışverişe ekle</button>' +
    (data.tips && data.tips.length
      ? `<div class="event-tips muted small">💡 ${data.tips.map(escapeHtml).join("<br>💡 ")}</div>`
      : "");
  el("event-to-shop").onclick = () => {
    addToShopping(items.map((it) => it.item).filter(Boolean));
    toast("Malzemeler listeye eklendi 🛒");
    eventModal.classList.add("hidden");
  };
}

// ---- Sesli asistan (serbest istek → öneriler) ----
const assistantModal = el("assistant-modal");
el("btn-assistant").addEventListener("click", () => {
  el("assistant-input").value = "";
  assistantModal.classList.remove("hidden");
  setTimeout(() => el("assistant-input").focus(), 60);
});
el("assistant-close").addEventListener("click", () => assistantModal.classList.add("hidden"));
assistantModal.addEventListener("click", (e) => {
  if (e.target === assistantModal) assistantModal.classList.add("hidden");
});
el("assistant-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = el("assistant-input").value.trim();
  if (q) runAssistant(q);
});
assistantModal.querySelectorAll("#assistant-presets .season-chip").forEach((b) =>
  b.addEventListener("click", () => runAssistant(b.dataset.q))
);
async function runAssistant(query) {
  assistantModal.classList.add("hidden");
  lastAction = () => runAssistant(query);
  showScreen("loading");
  el("loading-text").textContent = "İsteğin değerlendiriliyor…";
  el("loading-sub").textContent = "Sana uygun yemekler hazırlanıyor.";
  try {
    const data = useGemini()
      ? await window.GeminiClient.suggest(query, effectivePrefs())
      : await serverPost("/api/suggest", {
          query,
          preferences: effectivePrefs(),
          language: langPref(),
        });
    renderResults(data);
    cacheResults(data);
    saveHistory("ingredients", data);
    showScreen("results");
  } catch (err) {
    fail(err, "results");
  }
}
(function setupAssistantVoice() {
  const mic = el("assistant-mic");
  if (!mic) return;
  mic.classList.remove("hidden");
  mic.addEventListener("click", () =>
    startVoice(mic, (t) => {
      el("assistant-input").value = t;
      el("assistant-form").dispatchEvent(new Event("submit"));
    })
  );
})();

// ---- Haftalık beslenme koçluğu ----
function diarySummary() {
  const cutoff = Date.now() - 7 * 86400000;
  const recent = diary.filter((e) => (e.ts || 0) >= cutoff);
  const dayset = new Set(recent.map((e) => e.day));
  let totalKcal = 0,
    mp = 0,
    mc = 0,
    mf = 0;
  const names = [];
  recent.forEach((e) => {
    totalKcal += e.kcal || 0;
    if (e.m) {
      mp += e.m.p || 0;
      mc += e.m.c || 0;
      mf += e.m.f || 0;
    }
    if (e.name) names.push(e.name);
  });
  const days = dayset.size || 1;
  const waterDays = Object.keys(water).filter((k) => (water[k] || 0) > 0).length;
  return [
    `Kayıtlı gün sayısı (son 7 gün): ${dayset.size}`,
    `Günlük ortalama kalori: ${Math.round(totalKcal / days)} kcal`,
    `Toplam makro (g): protein ${mp}, karbonhidrat ${mc}, yağ ${mf}`,
    `Su içilen gün sayısı: ${waterDays}`,
    `Kalori hedefi: ${calGoal} kcal`,
    names.length ? `Son yenenler: ${names.slice(-15).join(", ")}` : "Henüz yemek kaydı yok.",
  ].join("\n");
}
const coachModal = el("coach-modal");
el("btn-coach").addEventListener("click", async () => {
  coachModal.classList.remove("hidden");
  const box = el("coach-body");
  box.innerHTML = '<p class="muted small">Hazırlanıyor… 🧑‍🏫</p>';
  try {
    const summary = diarySummary();
    const data = useGemini()
      ? await window.GeminiClient.coach(summary)
      : await serverPost("/api/coach", { summary, language: langPref() });
    const tips = (data.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    box.innerHTML =
      `<p>${escapeHtml(data.message || "")}</p>` +
      (tips ? `<ul class="coach-tips">${tips}</ul>` : "") +
      '<p class="muted small">Bu genel bir öneridir, tıbbi tavsiye değildir.</p>';
  } catch (err) {
    box.innerHTML = `<p class="muted small">${escapeHtml(err.message || "Koçluk alınamadı.")}</p>`;
  }
});
el("coach-close").addEventListener("click", () => coachModal.classList.add("hidden"));
coachModal.addEventListener("click", (e) => {
  if (e.target === coachModal) coachModal.classList.add("hidden");
});

// ---- Beslenme günlüğü (Bugün) ----
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function addToDiary(name, kcal, macros) {
  const k = Math.round(Number(kcal) || 0);
  const m = macros
    ? {
        p: Math.round(Number(macros.proteinG) || 0),
        c: Math.round(Number(macros.carbsG) || 0),
        f: Math.round(Number(macros.fatG) || 0),
      }
    : null;
  diary.push({ name: String(name).slice(0, 80), kcal: k, m, day: todayKey(), ts: Date.now() });
  diary = diary.slice(-300);
  store.set("eviko_diary", diary);
  toast(`Güne eklendi: ${name} (${k} kcal)`);
}
function renderDiary() {
  const items = diary.filter((e) => e.day === todayKey());
  const sum = items.reduce((s, e) => s + (e.kcal || 0), 0);
  el("diary-sum").textContent = sum;
  el("diary-goal-label").textContent = calGoal;
  el("diary-goal-input").value = calGoal;
  el("water-count").textContent = water[todayKey()] || 0;
  const mac = items.reduce(
    (a, e) => {
      if (e.m) {
        a.p += e.m.p || 0;
        a.c += e.m.c || 0;
        a.f += e.m.f || 0;
      }
      return a;
    },
    { p: 0, c: 0, f: 0 }
  );
  el("diary-protein").textContent = mac.p;
  el("diary-carbs").textContent = mac.c;
  el("diary-fat").textContent = mac.f;
  const fill = el("diary-bar-fill");
  fill.style.width = (calGoal > 0 ? Math.min(100, Math.round((sum / calGoal) * 100)) : 0) + "%";
  fill.style.background = sum > calGoal ? "var(--tomato)" : "var(--green)";
  el("btn-clear-diary").classList.toggle("hidden", items.length === 0);
  const list = el("diary-list");
  list.innerHTML = items.length
    ? items
        .map(
          (e) =>
            `<li class="shop-item"><span class="name">${escapeHtml(e.name)}</span><span class="ccal">${e.kcal} kcal</span><button class="remove" data-ts="${e.ts}" aria-label="Sil">×</button></li>`
        )
        .join("")
    : emptyState("📒", "Bugün henüz bir şey eklemedin.");
  list.querySelectorAll("[data-ts]").forEach((b) =>
    b.addEventListener("click", () => {
      diary = diary.filter((e) => String(e.ts) !== b.dataset.ts);
      store.set("eviko_diary", diary);
      renderDiary();
    })
  );
  renderDiaryWeek();
  renderWeight();
}
function renderDiaryWeek() {
  const box = el("diary-week");
  if (!box) return;
  const names = ["Pzr", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const total = diary
      .filter((e) => e.day === key)
      .reduce((s, e) => s + (e.kcal || 0), 0);
    days.push({ label: names[d.getDay()], total });
  }
  const max = Math.max(calGoal || 0, ...days.map((d) => d.total), 1);
  box.innerHTML =
    '<div class="week-title">📈 Son 7 gün (kcal)</div><div class="week-bars">' +
    days
      .map(
        (d) =>
          `<div class="week-col"><span class="week-val">${d.total || ""}</span><div class="week-bar" style="height:${Math.max(2, Math.round((d.total / max) * 64))}px"></div><span class="week-lbl">${d.label}</span></div>`
      )
      .join("") +
    "</div>";
}
el("diary-manual-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el("diary-food-name").value.trim();
  const kcal = Math.max(0, Number(el("diary-food-kcal").value) || 0);
  if (!name) return;
  addToDiary(name, kcal);
  el("diary-food-name").value = "";
  el("diary-food-kcal").value = "";
  renderDiary();
});
el("btn-diary").addEventListener("click", () => {
  renderDiary();
  showScreen("diary");
});
el("diary-goal-input").addEventListener("change", () => {
  calGoal = Math.max(0, Number(el("diary-goal-input").value) || 0);
  localStorage.setItem("eviko_cal_goal", String(calGoal));
  renderDiary();
});
el("btn-clear-diary").addEventListener("click", () => {
  if (confirm("Bugünün günlüğü temizlensin mi?")) {
    diary = diary.filter((e) => e.day !== todayKey());
    store.set("eviko_diary", diary);
    renderDiary();
  }
});

// ---- Malzeme ikamesi (yerine ne kullanırım?) ----
const ingModal = el("ing-modal");
el("ing-close").addEventListener("click", () => ingModal.classList.add("hidden"));
ingModal.addEventListener("click", (e) => {
  if (e.target === ingModal) ingModal.classList.add("hidden");
});
function openIngredientSheet(item, title) {
  el("ing-body").innerHTML = `
    <h3 class="ing-title">${escapeHtml(item)}</h3>
    <div class="ing-actions">
      <button class="btn btn-ghost" id="ing-store">🛒 Markete git</button>
      <button class="btn btn-primary" id="ing-sub">↔️ Yerine ne kullanırım?</button>
    </div>
    <div id="ing-sub-result"></div>`;
  ingModal.classList.remove("hidden");
  el("ing-store").onclick = () => {
    ingModal.classList.add("hidden");
    openStore(item);
  };
  el("ing-sub").onclick = () => loadSubstitute(item, title);
}
async function loadSubstitute(item, title) {
  const box = el("ing-sub-result");
  box.innerHTML = '<p class="muted small">Alternatifler aranıyor…</p>';
  try {
    const data = useGemini()
      ? await window.GeminiClient.substitute(item, title)
      : await serverPost("/api/substitute", { item, title, language: langPref() });
    const alts = (data && data.alternatives) || [];
    box.innerHTML = alts.length
      ? '<ul class="sub-list">' +
        alts
          .map(
            (a) =>
              `<li><b>${escapeHtml(a.name)}</b>${a.note ? ` — <span class="muted">${escapeHtml(a.note)}</span>` : ""}</li>`
          )
          .join("") +
        "</ul>"
      : '<p class="muted small">Uygun alternatif bulunamadı.</p>';
  } catch (err) {
    box.innerHTML = `<p class="muted small">${escapeHtml(err.message || "Alternatif alınamadı.")}</p>`;
  }
}

// ---- Ölçü çevirici ----
const convModal = el("conv-modal");
el("btn-converter").addEventListener("click", () => {
  convCompute();
  convModal.classList.remove("hidden");
});
el("conv-close").addEventListener("click", () => convModal.classList.add("hidden"));
convModal.addEventListener("click", (e) => {
  if (e.target === convModal) convModal.classList.add("hidden");
});
el("conv-val").addEventListener("input", convCompute);
el("conv-unit").addEventListener("change", convCompute);
function convCompute() {
  const v = Number(el("conv-val").value) || 0;
  const ml = v * Number(el("conv-unit").value);
  const f = (x) => (Math.round(x * 100) / 100).toString().replace(".", ",");
  el("conv-result").innerHTML = `
    <div class="conv-out"><b>${f(ml)}</b> ml</div>
    <div class="muted small">≈ ${f(ml / 200)} su bardağı · ${f(ml / 15)} yemek kaşığı · ${f(ml / 5)} çay kaşığı</div>`;
}

// ---- Haftanın alışveriş listesi ----
el("btn-plan-shop").addEventListener("click", () => {
  const all = [...new Set(lastPlan.flatMap((d) => d.ingredients || []))];
  if (!all.length) return;
  addToShopping(all);
  toast(`${all.length} malzeme listeye eklendi 🛒`);
  renderShopping();
  showScreen("shopping");
});

// ---- Tanıtım turu (ilk açılış) ----
const introModal = el("intro-modal");
el("intro-start").addEventListener("click", () => {
  burstFromEl(el("intro-start"), 16); // bitirişte küçük kutlama
  localStorage.setItem("eviko_seen_intro2", "1");
  introModal.classList.add("hidden");
});
el("intro-account").addEventListener("click", () => {
  localStorage.setItem("eviko_seen_intro2", "1");
  introModal.classList.add("hidden");
  openAuth();
});
if (!localStorage.getItem("eviko_seen_intro2")) {
  setTimeout(() => {
    markThemeOpts();
    markAccent();
    introModal.classList.remove("hidden");
    setTimeout(() => burstFromEl(el("intro-mascot"), 6), 200);
  }, 400);
}

// ---- Yardım / nasıl kullanılır ----
const helpModal = el("help-modal");
function openHelp() {
  helpModal.classList.remove("hidden");
}
function closeHelp() {
  helpModal.classList.add("hidden");
}
el("nav-help").addEventListener("click", openHelp);
el("help-close").addEventListener("click", closeHelp);
el("help-ok").addEventListener("click", closeHelp);
helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) closeHelp();
});
el("intro-help").addEventListener("click", () => {
  localStorage.setItem("eviko_seen_intro2", "1");
  introModal.classList.add("hidden");
  openHelp();
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

// ---- Uygulamayı başlat (tüm tanımlar ve dinleyiciler hazır olduktan sonra) ----
init();
