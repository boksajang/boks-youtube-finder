// assets/icon.svg → assets/icon.png(512) + assets/icon.ico(16~256)
// 실행: npx electron scripts/generate-icons.js
// Electron 임시 데이터는 프로젝트 안 .dev/icon-gen 에만 생성한다.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, '.dev', 'icon-gen'));
app.setPath('sessionData', path.join(root, '.dev', 'icon-gen'));

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
  const svgUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');

  const sizes = [...ICO_SIZES, 512];
  const result = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(svgUrl)};
    await img.decode();
    const out = {};
    for (const s of ${JSON.stringify(sizes)}) {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, s, s);
      out[s] = c.toDataURL('image/png').split(',')[1];
    }
    return out;
  })()`);

  const png = s => Buffer.from(result[s], 'base64');
  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), png(512));
  fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), buildIco(ICO_SIZES.map(size => ({ size, buf: png(size) }))));
  console.log('icons written:', ['icon.png', 'icon.ico'].join(', '));
  app.quit();
});
