#!/usr/bin/env node
/**
 * Built-in product image library → public/library/<slug>.webp + public/library/manifest.json
 *
 * Shop owners pick one of these covers in the admin ("เลือกรูปจากคลัง") instead of hunting for
 * images. Vite copies public/ into dist/, so the files reach both the Worker (assets.directory
 * = ./dist) and the Pages artifact (scripts/build-pages.mjs copies dist/).
 *
 * HOW A COVER IS MADE
 *   1. The official logo file comes from Wikimedia Commons (preferred: PD-textlogo / public
 *      domain), or — when Commons has no free file — the logo shown on the brand's English
 *      Wikipedia article (licence recorded as "non-free logo (trademark)"). Never draw a logo.
 *   2. Downloads are untrusted: they go to their own folder (--src, default
 *      $TMPDIR/asiax-library-src) and are scanned for <script>, event handlers, javascript:,
 *      <foreignObject> and external references before use. They are only ever drawn through
 *      an <img>, which never runs SVG scripts.
 *   3. Headless Chrome draws the logo centred on a 1200×1200 canvas over a subtle 2-stop
 *      diagonal gradient (dark for light logos, light for dark logos). The logo is at most
 *      ~760px wide / ~320px tall (square icons may use `maxH`). `invert: true` flips black-only
 *      logos to white for dark backgrounds.
 *   4. Exported as webp quality 0.9 (each must stay ≤ 150KB; tests/image-library.test.mjs).
 *
 * ADDING A BRAND
 *   - Find the file:  https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=<brand>%20logo
 *   - Check its licence (the --check-licenses flag prints the Commons licence + PD templates).
 *   - Add an entry to BRANDS below (slug, name, category, keywords in Thai + English, file,
 *     licence, background colours), then run:
 *         node scripts/build-image-library.mjs --fetch --only=<slug>
 *   - Look at the result, then run `npm test` (manifest test) and commit the webp + manifest.
 *   Existing webp files are kept as-is unless --force is given (the first ten covers were
 *   made by hand earlier with this exact method and are reused unchanged).
 *
 * USAGE
 *   node scripts/build-image-library.mjs                    # render missing covers from --src, write manifest
 *   node scripts/build-image-library.mjs --fetch            # also download missing logo files first
 *   node scripts/build-image-library.mjs --only=a,b --force # re-render just these
 *   node scripts/build-image-library.mjs --manifest         # only rewrite manifest.json
 *   node scripts/build-image-library.mjs --check-licenses   # print the live licence of every file
 *
 * Needs Google Chrome (CHROME_PATH overrides the default macOS location).
 * Network etiquette: one batched API request per site, a descriptive User-Agent, pauses
 * between downloads and back-off on HTTP 429.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(ROOT, "public", "library");
const UA = { "User-Agent": "asiax-catalog-bot/1.0 (product image library)" };
const SIZE = 1200;
const MAX_BYTES = 150 * 1024;
const PD = "Public domain (PD-textlogo); trademark of its owner";

/** Display order in the admin follows this list. `file` is a Commons file unless `site` says otherwise. */
export const BRANDS = [
  // ---- streaming
  { slug: "netflix", name: "Netflix", category: "streaming", keywords: ["netflix", "เน็ตฟลิกซ์", "เน็ตฟลิก", "เน็ตฟิก"], file: "File:Netflix 2015 logo.svg", license: "Public domain (PD-textlogo)", bg: ["#1a1a1a", "#000000"] },
  { slug: "disney-plus", name: "Disney+", category: "streaming", keywords: ["disney", "disney+", "disney plus", "disneyplus", "hotstar", "ดิสนีย์", "ดิสนีย์พลัส"], file: "File:Disney+ logo.svg", license: PD, bg: ["#ffffff", "#e6ecff"] },
  { slug: "youtube-premium", name: "YouTube Premium", category: "streaming", keywords: ["youtube", "youtube premium", "yt premium", "ยูทูป", "ยูทูบ", "ยูทูปพรีเมียม", "ยูทูบพรีเมียม"], file: "File:YouTube Premium logo 2024.svg", license: "Public domain (PD-shape, PD-simple); trademark of its owner", bg: ["#ffffff", "#f3f5f7"] },
  { slug: "prime-video", name: "Prime Video", category: "streaming", keywords: ["prime video", "primevideo", "amazon prime", "amazon", "ไพรม์วิดีโอ", "ไพร์มวิดีโอ", "อเมซอน"], file: "File:Prime Video logo (2024).svg", license: PD, bg: ["#1b2b38", "#0f171d"] },
  { slug: "hbo-max", name: "HBO Max", category: "streaming", keywords: ["hbo", "hbo max", "hbomax", "เอชบีโอ"], file: "File:HBO Max (2025).svg", license: PD, bg: ["#3b2bff", "#0b0a4a"] },
  { slug: "viu", name: "Viu", category: "streaming", keywords: ["viu", "วิวพรีเมียม", "viu premium"], file: "File:Viu logo.svg", license: PD, bg: ["#1f1f1f", "#000000"] },
  { slug: "iqiyi", name: "iQIYI", category: "streaming", keywords: ["iqiyi", "iq", "aiqiyi", "อ้ายฉีอี้", "ไอฉีอี้", "ไอคิวยี่"], file: "File:IQIYI logo (2022).svg", license: PD, bg: ["#ffffff", "#eefbf2"] },
  { slug: "apple-tv", name: "Apple TV+", category: "streaming", keywords: ["apple tv", "appletv", "apple tv+", "แอปเปิ้ลทีวี", "แอปเปิลทีวี"], file: "File:Apple TV Plus Logo.svg", license: PD, bg: ["#2a292e", "#000000"], invert: true },
  { slug: "wetv", name: "WeTV", category: "streaming", keywords: ["wetv", "we tv", "วีทีวี", "tencent video"], file: "File:Wetv-july-2024-logo.svg", license: "CC0 1.0 (public domain dedication); trademark of its owner", bg: ["#ffffff", "#ffeef3"] },
  { slug: "bilibili", name: "Bilibili", category: "streaming", keywords: ["bilibili", "bstation", "บิลิบิลิ", "บิลิ"], file: "File:Bilibili 2023.svg", license: PD, bg: ["#ffffff", "#e8f6fd"] },
  { slug: "crunchyroll", name: "Crunchyroll", category: "streaming", keywords: ["crunchyroll", "ครันชีโรล", "ครันชี่โรล"], file: "File:Crunchyroll 2024.svg", license: PD, bg: ["#1f1f1f", "#000000"] },
  // ---- music
  { slug: "spotify", name: "Spotify", category: "music", keywords: ["spotify", "สปอติฟาย", "สปอตติฟาย"], file: "File:Spotify logo with text.svg", license: PD, bg: ["#1f1f1f", "#111111"] },
  { slug: "youtube-music", name: "YouTube Music", category: "music", keywords: ["youtube music", "youtubemusic", "yt music", "ยูทูปมิวสิค", "ยูทูบมิวสิค"], file: "File:YouTube Music 2024.svg", license: PD, bg: ["#ffffff", "#f3f5f7"] },
  { slug: "apple-music", name: "Apple Music", category: "music", keywords: ["apple music", "applemusic", "แอปเปิ้ลมิวสิค", "แอปเปิลมิวสิค"], file: "File:Apple Music Logo (2026).svg", license: PD, bg: ["#fc3c44", "#b5102c"], invert: true },
  { slug: "joox", name: "JOOX", category: "music", keywords: ["joox", "จูกซ์", "จู๊กซ์", "joox vip"], file: "File:JOOX font logo.svg", license: PD, bg: ["#ffffff", "#e9f9ef"] },
  { slug: "tidal", name: "TIDAL", category: "music", keywords: ["tidal", "ไทดัล"], file: "File:Tidal (service) logo.svg", license: "Public domain (PD-textlogo)", bg: ["#1f1f1f", "#000000"], invert: true },
  // ---- ai
  { slug: "chatgpt", name: "ChatGPT", category: "ai", keywords: ["chatgpt", "chat gpt", "gpt", "openai", "แชทจีพีที", "แชท gpt"], file: "File:ChatGPT-Logo.svg", license: "Public domain (PD-shape, PD-simple); trademark of its owner", bg: ["#ffffff", "#e8f6f1"], maxH: 400 },
  // ---- productivity
  { slug: "canva", name: "Canva", category: "productivity", keywords: ["canva", "canva pro", "แคนวา", "แคนว่า"], file: "File:Canva Logo.svg", site: "en.wikipedia.org", license: "Public domain in the US (PD-ineligible-USonly, en.wikipedia); trademark of its owner", bg: ["#ffffff", "#f1ecff"] },
  { slug: "microsoft-365", name: "Microsoft 365", category: "productivity", keywords: ["microsoft 365", "microsoft", "office 365", "office", "m365", "ไมโครซอฟท์", "ออฟฟิศ"], file: "File:Microsoft 365 (2022).svg", license: PD, bg: ["#ffffff", "#eef0ff"], maxH: 400 },
  { slug: "notion", name: "Notion", category: "productivity", keywords: ["notion", "โนชั่น", "โน้ตชั่น"], file: "File:Notion-logo.svg", license: PD, bg: ["#ffffff", "#eef0f3"], maxH: 400 },
  { slug: "grammarly", name: "Grammarly", category: "productivity", keywords: ["grammarly", "แกรมมาร์ลี่", "แกรมม่าลี่"], file: "File:Grammarly logo 2024.svg", license: PD, bg: ["#ffffff", "#e9f7f1"] },
  { slug: "duolingo", name: "Duolingo", category: "productivity", keywords: ["duolingo", "super duolingo", "ดูโอลิงโก", "ดูโอ้ลิงโก้"], file: "File:Duolingo logo (2019).svg", license: PD, bg: ["#ffffff", "#eefbe3"] },
  { slug: "capcut", name: "CapCut", category: "productivity", keywords: ["capcut", "capcut pro", "แคปคัท", "แคปคัต"], file: "File:Capcut-icon.svg", license: "Public domain (PD-shape); trademark of its owner", bg: ["#26262b", "#000000"], maxH: 400 },
  { slug: "adobe-creative-cloud", name: "Adobe Creative Cloud", category: "productivity", keywords: ["adobe", "creative cloud", "adobe cc", "photoshop", "illustrator", "premiere", "อะโดบี", "โฟโต้ชอป"], file: "File:Adobe Creative Cloud rainbow icon.svg", license: PD, bg: ["#26262b", "#000000"], maxH: 400 },
  // ---- storage
  { slug: "google-one", name: "Google One", category: "storage", keywords: ["google one", "googleone", "google drive", "กูเกิลวัน", "กูเกิ้ลวัน", "กูเกิลไดรฟ์"], file: "File:Google One logo.svg", license: PD, bg: ["#ffffff", "#eef3fd"], maxH: 400 },
  { slug: "icloud", name: "iCloud+", category: "storage", keywords: ["icloud", "icloud+", "ไอคลาวด์"], file: "File:ICloud logo.svg", license: PD, bg: ["#ffffff", "#eaf2fd"], maxH: 400 },
  // ---- vpn
  { slug: "nordvpn", name: "NordVPN", category: "vpn", keywords: ["nordvpn", "nord vpn", "nord", "นอร์ดวีพีเอ็น"], file: "File:NordVPN logo.svg", license: PD, bg: ["#ffffff", "#eaf0ff"] },
  { slug: "expressvpn", name: "ExpressVPN", category: "vpn", keywords: ["expressvpn", "express vpn", "เอ็กซ์เพรสวีพีเอ็น"], file: "File:ExpressVPN wordmark.svg", license: PD, bg: ["#ffffff", "#fdeeee"] },
  // ---- games
  { slug: "discord-nitro", name: "Discord Nitro", category: "games", keywords: ["discord", "discord nitro", "nitro", "ดิสคอร์ด", "ดิสคอด"], file: "File:Discord colour textlogo (2021).svg", license: PD, bg: ["#2b2d31", "#111214"] },
  { slug: "steam", name: "Steam", category: "games", keywords: ["steam", "steam wallet", "สตีม", "สตรีม วอลเล็ท"], file: "File:Steam icon logo.svg", license: "Public domain (PD-shape); trademark of its owner", bg: ["#ffffff", "#e9eef5"], maxH: 400 },
  { slug: "playstation-plus", name: "PlayStation Plus", category: "games", keywords: ["playstation", "playstation plus", "ps plus", "ps+", "psn", "เพลย์สเตชั่น", "เพลสเตชั่น"], file: "File:PlayStation Plus second logo and wordmark.svg", license: "Public domain (PD-ineligible); trademark of its owner", bg: ["#ffffff", "#eef1f8"] },
  { slug: "xbox-game-pass", name: "Xbox Game Pass", category: "games", keywords: ["xbox", "game pass", "gamepass", "xbox game pass", "เอ็กซ์บ็อกซ์", "เกมพาส"], file: "File:Xbox Game Pass new logo - colored version.svg", license: PD, bg: ["#ffffff", "#ecf6ec"], maxH: 400 },
];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const SRC = resolve(typeof args.src === "string" ? args.src : join(tmpdir(), "asiax-library-src"));
const only = typeof args.only === "string" ? new Set(args.only.split(",")) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pageUrl(brand) {
  return `https://${brand.site ?? "commons.wikimedia.org"}/wiki/${encodeURI(brand.file.replace(/ /g, "_"))}`;
}
function extOf(brand) {
  return brand.file.split(".").pop().toLowerCase();
}

async function getJson(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.status === 429 || res.status >= 500) {
      await sleep(10000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      await sleep(10000 * (attempt + 1)); // "too many requests" comes back as plain text
    }
  }
  throw new Error("API kept rate-limiting: " + url.slice(0, 80));
}

/** One batched imageinfo request per site → { title: { url, license } }. */
async function lookup(brands) {
  const info = {};
  const bySite = Map.groupBy(brands, (b) => b.site ?? "commons.wikimedia.org");
  for (const [site, list] of bySite) {
    for (let i = 0; i < list.length; i += 45) {
      const titles = list.slice(i, i + 45).map((b) => b.file);
      const r = await getJson(
        `https://${site}/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=LicenseShortName&format=json&titles=` +
          encodeURIComponent(titles.join("|")),
      );
      const from = Object.fromEntries((r.query.normalized ?? []).map((n) => [n.to, n.from]));
      for (const p of Object.values(r.query.pages))
        info[from[p.title] ?? p.title] = {
          url: p.imageinfo?.[0]?.url,
          license: p.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value,
        };
      await sleep(1500);
    }
  }
  return info;
}

/** Untrusted SVG: refuse anything that could do more than draw. */
export function unsafeSvgReason(text) {
  if (/<script/i.test(text)) return "<script>";
  if (/\son[a-z]+\s*=/i.test(text)) return "event handler attribute";
  if (/javascript:/i.test(text)) return "javascript: URL";
  if (/<foreignObject/i.test(text)) return "<foreignObject>";
  if (/(?:href|src)\s*=\s*["'](?!data:|#)/i.test(text)) return "external reference";
  return "";
}

async function fetchLogos(brands) {
  mkdirSync(SRC, { recursive: true });
  const info = await lookup(brands);
  for (const brand of brands) {
    const url = info[brand.file]?.url;
    if (!url) {
      console.warn(`! ${brand.slug}: ${brand.file} not found — skipped`);
      continue;
    }
    let saved = false;
    for (let attempt = 0; attempt < 6 && !saved; attempt++) {
      const res = await fetch(url.split("?")[0], { headers: UA });
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 15000 * (attempt + 1);
        console.log(`  ${brand.slug}: rate-limited, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`${brand.slug}: HTTP ${res.status}`);
      writeFileSync(join(SRC, `${brand.slug}.${extOf(brand)}`), Buffer.from(await res.arrayBuffer()));
      console.log(`↓ ${brand.slug}`);
      saved = true;
    }
    if (!saved) console.warn(`! ${brand.slug}: still rate-limited — try again later`);
    await sleep(2000);
  }
}

async function render(brands) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>covers</title>");
  mkdirSync(OUT, { recursive: true });
  for (const brand of brands) {
    const file = join(SRC, `${brand.slug}.${extOf(brand)}`);
    if (!existsSync(file)) {
      console.warn(`! ${brand.slug}: no source file in ${SRC} (run with --fetch)`);
      continue;
    }
    const bytes = readFileSync(file);
    const svg = extOf(brand) === "svg";
    if (svg) {
      const reason = unsafeSvgReason(bytes.toString("utf8"));
      if (reason) {
        console.warn(`! ${brand.slug}: refused (${reason})`);
        continue;
      }
    }
    const src = `data:${svg ? "image/svg+xml" : "image/png"};base64,${bytes.toString("base64")}`;
    const ratio = svg ? svgRatio(bytes.toString("utf8")) : 0;
    const b64 = await page.evaluate(
      async ({ src, ratio, size, bg, invert, maxW, maxH }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        // Rasterise large first, then trim to the drawn pixels: many logo files carry padding
        // inside their viewBox, which would otherwise make them look smaller than their peers.
        const aspect = ratio || img.naturalWidth / img.naturalHeight;
        const big = document.createElement("canvas");
        big.width = Math.round(aspect >= 1 ? 2400 : 2400 * aspect);
        big.height = Math.round(aspect >= 1 ? 2400 / aspect : 2400);
        const bctx = big.getContext("2d", { willReadFrequently: true });
        bctx.drawImage(img, 0, 0, big.width, big.height);
        const px = bctx.getImageData(0, 0, big.width, big.height).data;
        let x0 = big.width, y0 = big.height, x1 = -1, y1 = -1;
        for (let y = 0; y < big.height; y++)
          for (let x = 0; x < big.width; x++)
            if (px[(y * big.width + x) * 4 + 3] > 8) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
        if (x1 < 0) throw new Error("logo rendered empty");
        const bw = x1 - x0 + 1;
        const bh = y1 - y0 + 1;
        const scale = Math.min(maxW / bw, maxH / bh);
        const w = bw * scale;
        const h = bh * scale;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        const g = ctx.createLinearGradient(0, 0, size, size);
        g.addColorStop(0, bg[0]);
        g.addColorStop(1, bg[1]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        if (invert) ctx.filter = "invert(1)";
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(big, x0, y0, bw, bh, (size - w) / 2, (size - h) / 2, w, h);
        return canvas.toDataURL("image/webp", 0.9).split(",")[1];
      },
      { src, ratio, size: SIZE, bg: brand.bg, invert: !!brand.invert, maxW: brand.maxW ?? 760, maxH: brand.maxH ?? 320 },
    );
    const out = Buffer.from(b64, "base64");
    if (out.length > MAX_BYTES) throw new Error(`${brand.slug}.webp is ${out.length} bytes (> 150KB)`);
    writeFileSync(join(OUT, `${brand.slug}.webp`), out);
    console.log(`✓ ${brand.slug}.webp ${(out.length / 1024).toFixed(1)}KB`);
  }
  await browser.close();
}

/** width/height ratio from viewBox (or width/height attributes) so the logo is drawn sharp at any size. */
function svgRatio(text) {
  const head = text.slice(0, text.indexOf(">", text.indexOf("<svg")) + 1);
  const vb = head.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb) return Number(vb[1]) / Number(vb[2]);
  const w = head.match(/\swidth\s*=\s*["']([\d.]+)/i);
  const h = head.match(/\sheight\s*=\s*["']([\d.]+)/i);
  return w && h ? Number(w[1]) / Number(h[1]) : 0;
}

function writeManifest() {
  const present = BRANDS.filter((b) => existsSync(join(OUT, `${b.slug}.webp`)));
  const manifest = {
    version: 1,
    note: "Logos are trademarks of their owners, used only to identify products the shop is entitled to sell.",
    items: present.map((b) => ({
      slug: b.slug,
      name: b.name,
      category: b.category,
      keywords: b.keywords,
      file: `/library/${b.slug}.webp`,
      source: pageUrl(b),
      license: b.license,
    })),
  };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const total = present.reduce((n, b) => n + statSync(join(OUT, `${b.slug}.webp`)).size, 0);
  console.log(`manifest.json: ${present.length} brands, ${(total / 1024).toFixed(0)}KB of webp`);
}

async function checkLicenses() {
  const info = await lookup(BRANDS);
  for (const b of BRANDS) console.log(`${b.slug.padEnd(22)} ${String(info[b.file]?.license ?? "MISSING").padEnd(16)} ${pageUrl(b)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args["check-licenses"]) await checkLicenses();
  else {
    if (!args.manifest) {
      const todo = BRANDS.filter((b) => (only ? only.has(b.slug) : true)).filter(
        (b) => args.force || !existsSync(join(OUT, `${b.slug}.webp`)),
      );
      if (todo.length) {
        if (args.fetch) await fetchLogos(todo);
        await render(todo);
      }
    }
    writeManifest();
  }
}
