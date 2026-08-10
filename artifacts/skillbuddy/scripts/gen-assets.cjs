/**
 * Regenerates the app assets deleted by the upstream commit:
 *   assets/images/icon.png       (1024x1024 launcher icon)
 *   assets/images/logo-white.png (splash logo on brand green)
 *   assets/images/favicon.png    (48x48 favicon)
 * Uses the real brand mark (logo-icon.png) tinted white on the brand green.
 */
const path = require('path');
const Jimp = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'node_modules/.pnpm/jimp-compact@0.16.1/node_modules/jimp-compact/dist/jimp.js'
));

const ASSETS = path.resolve(__dirname, '..', 'assets', 'images');
const SRC = path.join(ASSETS, 'logo-icon.png');
const BRAND_GREEN = 0x2e9e7aff; // palette.primary
const SPLASH_GREEN = 0x3a9e8fff; // splash backgroundColor in app.json

// Make every non-transparent pixel pure white (keeps alpha) — matches how the
// app tints the mark white for headers/splash.
async function whiteMask(src) {
  const img = await Jimp.read(src);
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
    const a = this.bitmap.data[idx + 3];
    if (a > 0) {
      this.bitmap.data[idx] = 255;
      this.bitmap.data[idx + 1] = 255;
      this.bitmap.data[idx + 2] = 255;
    }
  });
  return img;
}

async function makeIcon() {
  const logo = await whiteMask(SRC);
  const size = 1024;
  const icon = new Jimp(size, size, BRAND_GREEN);
  // Scale logo to ~72% of icon width, centered.
  const targetW = Math.round(size * 0.72);
  const targetH = Math.round((targetW / logo.bitmap.width) * logo.bitmap.height);
  logo.resize(targetW, targetH);
  icon.composite(
    logo,
    Math.round((size - targetW) / 2),
    Math.round((size - targetH) / 2)
  );
  await icon.writeAsync(path.join(ASSETS, 'icon.png'));
  console.log('icon.png written', `${size}x${size}`);
}

async function makeSplashLogo() {
  const logo = await whiteMask(SRC);
  const size = 1024;
  const splash = new Jimp(size, size, SPLASH_GREEN);
  const targetW = Math.round(size * 0.6);
  const targetH = Math.round((targetW / logo.bitmap.width) * logo.bitmap.height);
  logo.resize(targetW, targetH);
  splash.composite(
    logo,
    Math.round((size - targetW) / 2),
    Math.round((size - targetH) / 2)
  );
  await splash.writeAsync(path.join(ASSETS, 'logo-white.png'));
  console.log('logo-white.png written', `${size}x${size}`);
}

async function makeFavicon() {
  const logo = await whiteMask(SRC);
  const size = 48;
  const fav = new Jimp(size, size, BRAND_GREEN);
  const targetW = Math.round(size * 0.72);
  const targetH = Math.round((targetW / logo.bitmap.width) * logo.bitmap.height);
  logo.resize(targetW, targetH);
  fav.composite(
    logo,
    Math.round((size - targetW) / 2),
    Math.round((size - targetH) / 2)
  );
  await fav.writeAsync(path.join(ASSETS, 'favicon.png'));
  console.log('favicon.png written', `${size}x${size}`);
}

(async () => {
  await makeIcon();
  await makeSplashLogo();
  await makeFavicon();
})().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
