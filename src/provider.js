// Aktif yapay zekâ sağlayıcısını seçer.
// Öncelik: GEMINI_API_KEY (ücretsiz katman) > ANTHROPIC_API_KEY (Claude) > demo.
import * as claude from "./claude.js";
import * as gemini from "./gemini.js";

export function getProvider() {
  if (gemini.hasApiKey()) return { name: "Gemini", impl: gemini };
  if (claude.hasApiKey()) return { name: "Claude", impl: claude };
  return null; // sağlayıcı yok → demo modu
}
