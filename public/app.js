// ---- Eviko ön yüz mantığı ----

const el = (id) => document.getElementById(id);

const screens = {
  capture: el("screen-capture"),
  loading: el("screen-loading"),
  results: el("screen-results"),
};

const fileInput = el("file-input");
const previewWrap = el("preview-wrap");
const previewImg = el("preview");

let selectedImage = null; // { base64, mediaType }
let detectedNames = []; // tarif istemek için malzeme adları

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- Demo modu kontrolü ----
fetch("/api/health")
  .then((r) => r.json())
  .then((d) => {
    if (d.demo) {
      const b = el("banner");
      b.textContent =
        "Demo modu: API anahtarı yok, örnek veriler gösteriliyor. Gerçek analiz için .env dosyasına ANTHROPIC_API_KEY ekleyin.";
      b.classList.remove("hidden");
    }
  })
  .catch(() => {});

// ---- Fotoğraf seçme + küçültme ----
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    selectedImage = await resizeImage(file);
    previewImg.src = `data:${selectedImage.mediaType};base64,${selectedImage.base64}`;
    el("dropzone").classList.add("hidden");
    previewWrap.classList.remove("hidden");
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

function resetCapture() {
  selectedImage = null;
  fileInput.value = "";
  previewImg.src = "";
  previewWrap.classList.add("hidden");
  el("dropzone").classList.remove("hidden");
}

// Görseli tarayıcıda en uzun kenarı ~1280px olacak şekilde küçültüp
// JPEG base64'e çevirir (yükleme hızını ve boyutu düşürür).
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

// ---- Analiz ----
el("btn-analyze").addEventListener("click", async () => {
  if (!selectedImage) return;
  showScreen("loading");
  el("loading-text").textContent = "Fotoğraf inceleniyor…";

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: selectedImage.base64,
        mediaType: selectedImage.mediaType,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analiz başarısız");
    renderResults(data);
    showScreen("results");
  } catch (err) {
    console.error(err);
    alert(err.message || "Bir hata oluştu. Lütfen tekrar deneyin.");
    showScreen("capture");
  }
});

// ---- Sonuçları çiz ----
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
        (d) => `
        <span class="chip">
          <span>${d.emoji || "🥬"}</span>
          <span>${escapeHtml(d.name)}</span>
          <span class="conf">${escapeHtml(d.confidence || "")}</span>
        </span>`
      )
      .join("");
  }

  const recipes = data.recipes || [];
  const grid = el("recipes");
  grid.innerHTML = recipes
    .map((r, i) => {
      const diffClass = r.difficulty === "kolay" ? "easy" : "";
      return `
      <button class="recipe-card" data-index="${i}">
        <h3>${escapeHtml(r.title)}</h3>
        <p class="desc">${escapeHtml(r.description || "")}</p>
        <div class="recipe-meta">
          ${r.category ? `<span class="tag cat">${escapeHtml(r.category)}</span>` : ""}
          ${r.durationMinutes ? `<span class="tag">⏱ ${r.durationMinutes} dk</span>` : ""}
          ${r.difficulty ? `<span class="tag ${diffClass}">${escapeHtml(r.difficulty)}</span>` : ""}
        </div>
      </button>`;
    })
    .join("");

  grid.querySelectorAll(".recipe-card").forEach((card) => {
    card.addEventListener("click", () => {
      const r = recipes[Number(card.dataset.index)];
      openRecipe(r.title);
    });
  });
}

// ---- Tarif detayı (modal) ----
const modal = el("modal");
el("modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

function closeModal() {
  modal.classList.add("hidden");
}

async function openRecipe(title) {
  el("modal-body").innerHTML = `
    <div class="detail-loading">
      <div class="pan">🍲</div>
      <p>"${escapeHtml(title)}" tarifi hazırlanıyor…</p>
    </div>`;
  modal.classList.remove("hidden");

  try {
    const res = await fetch("/api/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, detected: detectedNames }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Tarif alınamadı");
    renderRecipe(data);
  } catch (err) {
    console.error(err);
    el("modal-body").innerHTML = `
      <div class="detail-loading">
        <p>${escapeHtml(err.message || "Tarif yüklenemedi.")}</p>
      </div>`;
  }
}

function renderRecipe(r) {
  const ingredients = (r.ingredients || [])
    .map(
      (ing) =>
        `<li><span>${escapeHtml(ing.item)}</span><span class="amount">${escapeHtml(
          ing.amount || ""
        )}</span></li>`
    )
    .join("");

  const steps = (r.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const tips = (r.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");

  el("modal-body").innerHTML = `
    <div class="recipe-detail">
      <h2>${escapeHtml(r.title)}</h2>
      <div class="detail-meta">
        ${r.servings ? `<span class="tag">🍽 ${r.servings} kişilik</span>` : ""}
        ${r.durationMinutes ? `<span class="tag">⏱ ${r.durationMinutes} dk</span>` : ""}
        ${r.difficulty ? `<span class="tag easy">${escapeHtml(r.difficulty)}</span>` : ""}
      </div>

      <div class="detail-section">
        <h4>Malzemeler</h4>
        <ul class="ingredient-list">${ingredients}</ul>
      </div>

      <div class="detail-section">
        <h4>Hazırlanışı</h4>
        <ol class="step-list">${steps}</ol>
      </div>

      ${
        tips
          ? `<div class="detail-section">
               <div class="tips">
                 <strong>İpuçları</strong>
                 <ul>${tips}</ul>
               </div>
             </div>`
          : ""
      }
    </div>`;
  modal.querySelector(".modal-card").scrollTop = 0;
}

// ---- Yardımcı ----
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
