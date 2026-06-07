// Tarif fotoğrafı: anahtarsız, ücretsiz Wikimedia/Wikipedia araması.
// Önce Türkçe, sonra İngilizce Wikipedia'da arar; bir küçük resim (thumbnail) döndürür.
export async function getDishPhoto(title) {
  const q = String(title || "").trim();
  if (!q) return null;
  for (const lang of ["tr", "en"]) {
    try {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
        `&generator=search&gsrsearch=${encodeURIComponent(q + " yemek")}&gsrlimit=1` +
        `&prop=pageimages&piprop=thumbnail&pithumbsize=800`;
      const r = await fetch(url, { headers: { "User-Agent": "Eviko/1.0 (recipe app)" } });
      if (!r.ok) continue;
      const d = await r.json();
      const pages = d && d.query && d.query.pages;
      if (!pages) continue;
      for (const k in pages) {
        const thumb = pages[k] && pages[k].thumbnail && pages[k].thumbnail.source;
        if (thumb) return thumb;
      }
    } catch {
      /* sonraki dili dene */
    }
  }
  return null;
}
