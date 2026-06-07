// Basit JSON tabanlı veritabanı (sıfır bağımlılık).
// Kullanıcılar, oturumlar, tarifler (slug bazlı), yorumlar ve olaylar.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Kalıcı disk için EVIKO_DATA_DIR ile değiştirilebilir (ör. Render'da /data).
const DATA_DIR = process.env.EVIKO_DATA_DIR || path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "eviko.json");

function emptyDb() {
  return { users: [], sessions: {}, recipes: {}, comments: [], events: [] };
}

let db = emptyDb();

function load() {
  try {
    if (existsSync(DB_FILE)) db = { ...emptyDb(), ...JSON.parse(readFileSync(DB_FILE, "utf8")) };
  } catch (e) {
    console.error("DB okunamadı, sıfırdan başlanıyor:", e.message);
    db = emptyDb();
  }
}

function save() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error("DB yazılamadı:", e.message);
  }
}

load();

export function slugify(s) {
  return (
    String(s || "")
      .trim()
      .toLocaleLowerCase("tr")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tarif"
  );
}

// ---- Kullanıcılar ----
export function findUserByEmail(email) {
  const e = String(email || "").toLowerCase();
  return db.users.find((u) => u.email === e) || null;
}
export function findUserById(id) {
  return db.users.find((u) => u.id === id) || null;
}
export function createUser({ email, name, passHash = null, googleId = null }) {
  const user = {
    id: randomUUID(),
    email: String(email).toLowerCase(),
    name: name || String(email).split("@")[0],
    passHash,
    googleId,
    createdAt: Date.now(),
  };
  db.users.push(user);
  save();
  return user;
}
export function publicUser(u) {
  return u ? { id: u.id, name: u.name, email: u.email } : null;
}

// ---- Oturumlar ----
export function createSession(userId) {
  const token = randomUUID() + randomUUID().replace(/-/g, "");
  db.sessions[token] = { userId, createdAt: Date.now() };
  save();
  return token;
}
export function getSessionUser(token) {
  const s = token && db.sessions[token];
  if (!s) return null;
  return findUserById(s.userId);
}
export function deleteSession(token) {
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    save();
  }
}

// ---- Tarifler (slug bazlı) ----
export function ensureRecipe(slug, title) {
  if (!db.recipes[slug]) {
    db.recipes[slug] = {
      slug,
      title: title || slug,
      photo: null,
      photoTried: false,
      views: 0,
      ratingSum: 0,
      ratingCount: 0,
      createdAt: Date.now(),
    };
    save();
  } else if (title && !db.recipes[slug].title) {
    db.recipes[slug].title = title;
    save();
  }
  return db.recipes[slug];
}
export function getRecipe(slug) {
  return db.recipes[slug] || null;
}
export function setPhoto(slug, url) {
  const r = db.recipes[slug];
  if (r) {
    r.photo = url || null;
    r.photoTried = true;
    save();
  }
}
export function addEvent(slug, type) {
  db.events.push({ slug, type, ts: Date.now() });
  if (db.events.length > 5000) db.events = db.events.slice(-4000);
  save();
}
export function incView(slug) {
  const r = db.recipes[slug];
  if (r) {
    r.views = (r.views || 0) + 1;
    addEvent(slug, "view");
  }
}

// ---- Yorumlar + puan ----
export function addComment({ slug, userId, userName, text, stars }) {
  const c = {
    id: randomUUID(),
    slug,
    userId,
    userName,
    text: String(text).slice(0, 1000),
    stars: stars >= 1 && stars <= 5 ? Math.round(stars) : null,
    ts: Date.now(),
  };
  db.comments.push(c);
  const r = db.recipes[slug];
  if (r && c.stars) {
    r.ratingSum = (r.ratingSum || 0) + c.stars;
    r.ratingCount = (r.ratingCount || 0) + 1;
  }
  save();
  return c;
}
export function listComments(slug) {
  return db.comments
    .filter((c) => c.slug === slug)
    .sort((a, b) => b.ts - a.ts)
    .map((c) => ({ userName: c.userName, text: c.text, stars: c.stars, ts: c.ts }));
}
export function recipeRating(r) {
  return r && r.ratingCount ? Math.round((r.ratingSum / r.ratingCount) * 10) / 10 : 0;
}

// ---- Ana sayfa bölümleri ----
function recipeCard(r) {
  return {
    slug: r.slug,
    title: r.title,
    photo: r.photo,
    views: r.views || 0,
    rating: recipeRating(r),
  };
}
export function mostUsed(limit = 10) {
  return Object.values(db.recipes)
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, limit)
    .map(recipeCard);
}
export function dailyFavorites(limit = 10) {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const counts = {};
  for (const e of db.events) if (e.ts >= dayAgo) counts[e.slug] = (counts[e.slug] || 0) + 1;
  return Object.keys(counts)
    .map((slug) => db.recipes[slug])
    .filter(Boolean)
    .sort((a, b) => counts[b.slug] - counts[a.slug])
    .slice(0, limit)
    .map(recipeCard);
}
export function recommended(limit = 10) {
  return Object.values(db.recipes)
    .filter((r) => r.ratingCount > 0)
    .sort((a, b) => recipeRating(b) - recipeRating(a) || (b.views || 0) - (a.views || 0))
    .slice(0, limit)
    .map(recipeCard);
}
