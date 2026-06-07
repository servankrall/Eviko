// Eviko ikon ve kapak (splash) görsellerini üretir.
// Çalıştır:  npm run icons
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

// Açık, derin kâse + ağzına kadar dolu salata (alçak yığın). Salata kâseye
// oturur; ön ağız kavisi salatanın önünü örttüğü için yemekler İÇERİDE durur,
// uçar gibi görünmez.
const MOTIF = `
  <defs>
    <clipPath id="inBowl">
      <rect x="214" y="230" width="596" height="290"/>
      <ellipse cx="512" cy="520" rx="306" ry="70"/>
    </clipPath>
  </defs>

  <circle cx="512" cy="512" r="356" fill="#ffffff" opacity="0.10"/>

  <!-- KÂSE gövdesi (derin, açık kâse) -->
  <path d="M 206 520 a 306 306 0 0 0 612 0 Z" fill="#fffdf7" stroke="#e6dfce" stroke-width="11"/>
  <!-- kâse ağzı (rim) + iç gölge -->
  <ellipse cx="512" cy="520" rx="306" ry="70" fill="#fffaf0"/>
  <ellipse cx="512" cy="520" rx="306" ry="70" fill="none" stroke="#e6dfce" stroke-width="10"/>
  <ellipse cx="512" cy="538" rx="252" ry="42" fill="#000000" opacity="0.06"/>

  <!-- SALATA: ağzı dolduran alçak yığın (kırpma ile taşmaz) -->
  <g clip-path="url(#inBowl)">
    <!-- birleşik yığın tabanı -->
    <ellipse cx="512" cy="506" rx="250" ry="96" fill="#69db7c"/>
    <circle cx="372" cy="498" r="74" fill="#51cf66"/>
    <circle cx="652" cy="498" r="74" fill="#40c057"/>
    <circle cx="452" cy="470" r="66" fill="#8ce99a"/>
    <circle cx="566" cy="468" r="70" fill="#b2f2bb"/>
    <circle cx="300" cy="506" r="46" fill="#40c057"/>
    <circle cx="724" cy="506" r="46" fill="#51cf66"/>
    <!-- mısır -->
    <circle cx="410" cy="486" r="22" fill="#ffd43b"/>
    <!-- havuç -->
    <rect x="604" y="468" width="38" height="100" rx="17" transform="rotate(28 623 512)" fill="#ff922b"/>
    <!-- domates -->
    <circle cx="512" cy="496" r="58" fill="#fa5252"/>
    <circle cx="492" cy="474" r="13" fill="#ffc9c9" opacity="0.9"/>
    <path d="M 512 442 q 22 -24 46 -12 q -10 24 -46 13 z" fill="#2f9e44"/>
  </g>

  <!-- ön ağız kavisi: salatanın ön-altını örter -->
  <path d="M 207 520 A 306 70 0 0 0 817 520" fill="none" stroke="#e6dfce" stroke-width="10" />
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
