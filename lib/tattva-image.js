const Jimp = require('jimp');

const SIZE = 512;
const UNIT = SIZE / 120;
const BACKGROUND = 0x111113ff;
const STROKE_HEX = {
  akasha: '#c4b5fd',
  vayu: '#1e3a8a',
  tejas: '#7f1d1d',
  apas: '#52525b',
  prithivi: '#854d0e',
};
const NEST = {
  circle: { x: 0, y: 0, scale: 0.48 },
  square: { x: 0, y: 0, scale: 0.48 },
  egg: { x: 0, y: 3, scale: 0.4 },
  triangle: { x: 0, y: 8, scale: 0.36 },
  crescent: { x: 0, y: -12, scale: 0.52 },
};

function parseColor(value, fallback = 0x71717aff) {
  const hex = String(value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return ((Number.parseInt(hex, 16) << 8) | 0xff) >>> 0;
}

function insideShape(shape, dx, dy, scale) {
  const s = Number(scale) || 1;
  const k = UNIT * s;
  if (shape === 'circle') {
    const r = 42 * k;
    return (dx * dx) + (dy * dy) <= r * r;
  }
  if (shape === 'egg') {
    const rx = 32 * k;
    const ry = 46 * k;
    return ((dx * dx) / (rx * rx)) + ((dy * dy) / (ry * ry)) <= 1;
  }
  if (shape === 'square') {
    const half = 40 * k;
    return Math.abs(dx) <= half && Math.abs(dy) <= half;
  }
  if (shape === 'triangle') {
    const h = 48 * k;
    const w = 54 * k;
    const x1 = 0;
    const y1 = -h;
    const x2 = w;
    const y2 = h * 0.72;
    const x3 = -w;
    const y3 = h * 0.72;
    const area = (x1 * (y2 - y3)) + (x2 * (y3 - y1)) + (x3 * (y1 - y2));
    const a = ((x1 * (y2 - dy)) + (x2 * (dy - y1)) + (dx * (y1 - y2))) / area;
    const b = ((x1 * (dy - y3)) + (dx * (y3 - y1)) + (x3 * (y1 - dy))) / area;
    const c = 1 - a - b;
    return a >= 0 && b >= 0 && c >= 0;
  }
  const oy = 6 * k;
  const or = 44 * k;
  const iy = -12 * k;
  const ir = 30 * k;
  const inOuter = (dx * dx) + ((dy - oy) * (dy - oy)) <= or * or;
  const inInner = (dx * dx) + ((dy - iy) * (dy - iy)) <= ir * ir;
  return inOuter && !inInner;
}

function paintShape(mask, shape, cx, cy, scale) {
  const s = Number(scale) || 1;
  const pad = Math.ceil(52 * UNIT * s);
  const x0 = Math.max(0, Math.floor(cx - pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const x1 = Math.min(SIZE - 1, Math.ceil(cx + pad));
  const y1 = Math.min(SIZE - 1, Math.ceil(cy + pad));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (insideShape(shape, x - cx, y - cy, s)) {
        mask[(y * SIZE) + x] = 1;
      }
    }
  }
}

function blitMask(image, mask, fillHex, strokeHex) {
  const fillColor = parseColor(fillHex);
  const strokeColor = parseColor(strokeHex, 0xe4e4e7ff);
  for (let y = 1; y < SIZE - 1; y += 1) {
    for (let x = 1; x < SIZE - 1; x += 1) {
      const i = (y * SIZE) + x;
      if (mask[i]) {
        image.setPixelColor(fillColor, x, y);
        continue;
      }
      if (
        mask[i - 1] || mask[i + 1]
        || mask[i - SIZE] || mask[i + SIZE]
        || mask[i - SIZE - 1] || mask[i - SIZE + 1]
        || mask[i + SIZE - 1] || mask[i + SIZE + 1]
      ) {
        image.setPixelColor(strokeColor, x, y);
      }
    }
  }
}

function drawEntry(image, entry, scale, cx, cy) {
  if (!entry) return;
  const mask = new Uint8Array(SIZE * SIZE);
  paintShape(mask, String(entry.shape || 'square'), cx, cy, scale);
  blitMask(
    image,
    mask,
    entry.color || '#71717a',
    STROKE_HEX[entry.id] || '#e4e4e7'
  );
}

async function renderTattvaPng(tattva, catalog = {}) {
  const image = new Jimp(SIZE, SIZE, BACKGROUND);
  const parent = tattva?.kind === 'compound'
    ? (catalog[tattva.parentId] || tattva)
    : tattva;
  const child = tattva?.kind === 'compound'
    ? catalog[tattva.childId]
    : null;
  const originX = SIZE / 2;
  const originY = SIZE / 2;
  drawEntry(image, parent, 1, originX, originY);
  if (child) {
    const nest = NEST[parent.shape] || NEST.circle;
    drawEntry(
      image,
      child,
      nest.scale,
      originX + (nest.x * UNIT),
      originY + (nest.y * UNIT)
    );
  }
  return image.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = {
  renderTattvaPng,
};
