// Eviko ikon ve kapak (splash) görsellerini üretir.
// Çalıştır:  npm run icons
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

// Salata kâsesi motifi (1024x1024). Salata önce çizilir; kâse üstüne çizilerek
// salatanın alt kısmını örter, böylece yemekler kâsenin İÇİNDE durur.
const MOTIF = `
  <circle cx="512" cy="500" r="352" fill="#ffffff" opacity="0.10"/>

  <!-- SALATA (kâsenin içine oturur; alt kısmı kâse tarafından örtülür) -->
  <g>
    <circle cx="512" cy="452" r="112" fill="#69db7c"/>
    <circle cx="408" cy="496" r="96"  fill="#51cf66"/>
    <circle cx="616" cy="496" r="96"  fill="#40c057"/>
    <circle cx="462" cy="474" r="84"  fill="#8ce99a"/>
    <circle cx="566" cy="472" r="86"  fill="#b2f2bb"/>
    <!-- mısır vurgusu -->
    <circle cx="424" cy="470" r="26" fill="#ffd43b"/>
    <!-- havuç dilimi -->
    <rect x="598" y="452" width="40" height="112" rx="18" transform="rotate(26 618 500)" fill="#ff922b"/>
    <!-- domates -->
    <circle cx="512" cy="486" r="62" fill="#fa5252"/>
    <circle cx="490" cy="462" r="15" fill="#ffc9c9" opacity="0.9"/>
    <path d="M 512 430 q 22 -26 48 -12 q -10 26 -48 14 z" fill="#2f9e44"/>
  </g>

  <!-- KÂSE (salatanın üstüne çizilir → alt yarısını örter) -->
  <path d="M 196 520 C 196 800 828 800 828 520 Z" fill="#fffdf7" stroke="#e6dfce" stroke-width="10"/>
  <!-- ön ağız kavisi (lip) ve hafif iç gölge -->
  <path d="M 206 522 A 312 54 0 0 0 818 522" fill="none" stroke="#e6dfce" stroke-width="9"/>
  <ellipse cx="512" cy="560" rx="250" ry="30" fill="#000000" opacity="0.05"/>
`;

function iconSvg(rx) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#40c057"/>
        <stop offset="1" stop-color="#2b8a3e"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="1024" height="1024" rx="${rx}" fill="url(#bg)"/>
    ${MOTIF}
  </svg>`;
}

const png = (svg, size, out) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);

await mkdir("public/icons", { recursive: true });
await mkdir("assets", { recursive: true });

// --- PWA ikonları ---
await png(iconSvg(180), 192, "public/icons/icon-192.png"); // any (yuvarlatılmış köşe)
await png(iconSvg(180), 512, "public/icons/icon-512.png");
await png(iconSvg(0), 512, "public/icons/maskable-512.png"); // maskable (tam dolu)
await png(iconSvg(0), 180, "public/icons/apple-touch-icon.png");
await png(iconSvg(180), 64, "public/icons/favicon-64.png");
await png(iconSvg(180), 1024, "public/icons/cover.png"); // README/önizleme

// --- Capacitor kaynak görselleri (@capacitor/assets bunları kullanır) ---
await png(iconSvg(0), 1024, "assets/icon.png");
await writeFile("assets/icon.svg", iconSvg(180));

// Splash (kapak): kremrengi/koyu zemine ortalanmış yuvarlatılmış logo
async function splash(bg, out) {
  const logo = await sharp(Buffer.from(iconSvg(220))).resize(1100, 1100).png().toBuffer();
  await sharp({
    create: { width: 2732, height: 2732, channels: 4, background: bg },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(out);
}
await splash({ r: 255, g: 253, b: 247, alpha: 1 }, "assets/splash.png");
await splash({ r: 31, g: 42, b: 36, alpha: 1 }, "assets/splash-dark.png");

console.log("✅ İkonlar ve kapak görselleri üretildi.");
