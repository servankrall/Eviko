// Eviko ikon ve kapak (splash) görsellerini üretir.
// Çalıştır:  npm run icons
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

// Salata kâsesi motifi (1024x1024 koordinat sisteminde).
const MOTIF = `
  <circle cx="512" cy="500" r="340" fill="#ffffff" opacity="0.10"/>

  <!-- salata yığını -->
  <g transform="translate(512 470)">
    <circle cx="0"    cy="-70" r="108" fill="#69db7c"/>
    <circle cx="-120" cy="-10" r="96"  fill="#51cf66"/>
    <circle cx="120"  cy="-10" r="96"  fill="#40c057"/>
    <circle cx="-55"  cy="-35" r="82"  fill="#8ce99a"/>
    <circle cx="62"   cy="-38" r="84"  fill="#b2f2bb"/>
    <!-- domates -->
    <circle cx="-18"  cy="-18" r="60"  fill="#e8590c"/>
    <circle cx="-38"  cy="-40" r="14"  fill="#ffa94d" opacity="0.85"/>
    <path d="M -18 -80 q 20 -24 44 -10 q -10 24 -44 12 z" fill="#2f9e44"/>
    <!-- havuç dilimi -->
    <rect x="56" y="-74" width="38" height="104" rx="16" transform="rotate(24 75 -22)" fill="#f59f00"/>
  </g>

  <!-- kâse -->
  <g transform="translate(512 520)">
    <path d="M -300 0 a 300 300 0 0 0 600 0 Z" fill="#fffdf7"/>
    <ellipse cx="0" cy="0" rx="300" ry="60" fill="#ffffff"/>
    <ellipse cx="0" cy="0" rx="300" ry="60" fill="none" stroke="#e6dfce" stroke-width="9"/>
    <ellipse cx="0" cy="16" rx="250" ry="40" fill="#000000" opacity="0.05"/>
  </g>
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
