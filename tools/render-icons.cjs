const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function render(svgRel, outRel, size) {
  const svg = fs.readFileSync(path.join(root, svgRel), 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'transparent',
  });
  const png = resvg.render();
  const buf = png.asPng();
  fs.writeFileSync(path.join(root, outRel), buf);
  console.log(`rendered ${outRel} -> ${buf.length} bytes (${size}x${size})`);
}

// any 用途：圆角图标 512 / 192
render('public/icon.svg', 'public/icon-512.png', 512);
render('public/icon.svg', 'public/icon-192.png', 192);
// maskable 用途：全画布无圆角、内容留白（512）
render('public/icon-maskable.svg', 'public/icon-maskable-512.png', 512);
console.log('done');
