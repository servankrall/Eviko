// Kimlik doğrulama yardımcıları (sıfır bağımlılık).
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const dk = scryptSync(String(pw), salt, 64);
  return salt.toString("hex") + ":" + dk.toString("hex");
}

export function verifyPassword(pw, stored) {
  try {
    const [s, h] = String(stored).split(":");
    const salt = Buffer.from(s, "hex");
    const dk = scryptSync(String(pw), salt, 64);
    const hb = Buffer.from(h, "hex");
    return hb.length === dk.length && timingSafeEqual(hb, dk);
  } catch {
    return false;
  }
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `eviko_sid=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`
  );
}
export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "eviko_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
}

export function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}

// Google ID token'ı doğrular (tokeninfo uç noktası ile, ek bağımlılık olmadan).
export async function verifyGoogleToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google girişi yapılandırılmamış.");
  const r = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken)
  );
  if (!r.ok) throw new Error("Google token doğrulanamadı.");
  const d = await r.json();
  if (d.aud !== clientId) throw new Error("Google token bu uygulamaya ait değil.");
  if (!d.email) throw new Error("Google hesabından e-posta alınamadı.");
  return { email: d.email, name: d.name || d.email.split("@")[0], googleId: d.sub };
}
