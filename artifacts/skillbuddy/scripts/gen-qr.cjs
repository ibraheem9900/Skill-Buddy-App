/**
 * Generates a scannable HTML QR code page for the Expo dev server URL.
 * Renders each QR module as a square <div> so the code is perfectly scannable.
 * Uses the qrcode-terminal vendored QR encoder (pure JS, no deps to install).
 * Usage: node gen-qr.cjs "exp://192.168.0.114:8081" out.html
 */
const fs = require('fs');
const path = require('path');

const url = process.argv[2] || 'exp://192.168.0.114:8081';
const outFile = process.argv[3] || path.join(__dirname, '..', 'skillbuddy-qr.html');

// qrcode-terminal is hoisted into the workspace pnpm store (parent of this package).
const candidates = [
  path.resolve(__dirname, '..', 'node_modules/.pnpm/qrcode-terminal@0.11.0/node_modules/qrcode-terminal/vendor/QRCode'),
  path.resolve(__dirname, '..', '..', '..', 'node_modules/.pnpm/qrcode-terminal@0.11.0/node_modules/qrcode-terminal/vendor/QRCode'),
  path.resolve(__dirname, '..', '..', '..', '..', 'node_modules/.pnpm/qrcode-terminal@0.11.0/node_modules/qrcode-terminal/vendor/QRCode'),
];
const qrRoot = candidates.find((p) => fs.existsSync(p));
if (!qrRoot) {
  console.error('Could not locate qrcode-terminal in the pnpm store. Run: pnpm add -D qrcode-terminal');
  process.exit(1);
}
const QRCode = require(qrRoot);
const QRErrorCorrectLevel = require(path.join(qrRoot, 'QRErrorCorrectLevel'));

const qr = new QRCode(-1, QRErrorCorrectLevel.M);
qr.addData(url);
qr.make();

const cell = qr.getModuleCount();
// Render each module as a square div: dark = black block, light = transparent
// (on a white card so the QR has its own light background).
let blocks = '';
for (let r = 0; r < cell; r++) {
  for (let c = 0; c < cell; c++) {
    if (qr.isDark(r, c)) {
      blocks += `<div class="m"></div>`;
    } else {
      blocks += `<div class="m m-l"></div>`;
    }
  }
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SkillBuddy — Scan to test</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0A0D0D; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #EDF2F2; }
  .card { background: #151A1A; border: 1px solid #202626; border-radius: 20px; padding: 36px 40px;
          text-align: center; max-width: 430px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: #7E8C8C; font-size: 13px; margin: 0 0 22px; }
  .qr { display: inline-block; background: #FFFFFF; padding: 16px; border-radius: 14px;
        line-height: 0; }
  .grid { display: inline-grid; grid-template-columns: repeat(${cell}, 1fr); gap: 0; }
  .m { width: 7px; height: 7px; background: #000; }
  .m-l { background: transparent; }
  .url { display: inline-block; margin-top: 18px; padding: 10px 16px; border-radius: 10px;
         background: rgba(77,191,173,0.14); color: #4DBFAD; font-size: 14px; font-weight: 600; }
  .steps { text-align: left; margin: 20px 0 0; font-size: 12.5px; color: #AAB6B6; line-height: 1.8; }
  .brand { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px; }
  .brand .dot { width: 10px; height: 10px; border-radius: 50%; background: #4DBFAD; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand"><div class="dot"></div> SkillBuddy</div>
    <h1>Scan with Expo Go</h1>
    <p>Open <strong>Expo Go</strong> on your phone and scan this code to load the app.</p>
    <div class="qr"><div class="grid">${blocks}</div></div>
    <div>
      <span class="url">${url}</span>
    </div>
    <div class="steps">
      <b>Steps:</b><br />
      1. Install <b>Expo Go</b> from the App Store / Play Store<br />
      2. Make sure your phone is on the <b>same Wi-Fi</b> as this computer<br />
      3. Scan this QR with the Expo Go app (Android) or Camera (iPhone)
    </div>
  </div>
</body>
</html>`;

fs.writeFileSync(outFile, html);
console.log('QR page written to', outFile);
console.log('URL encoded:', url);
