const sharp = require('sharp');

const FONT = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Times New Roman', serif";

const DEFAULT_THEME = {
  bg: '#0b0710',
  panel: '#16101f',
  ink: '#f3ead6',
  muted: '#b7a48c',
  gold: '#d4b36a',
  goldDim: '#8d6d32',
  frame: '#1a1424',
  rule: '#6b4e71',
};

const CARD = { w: 196, h: 334 };

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hexColor(value, fallback) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function mergeTheme(theme) {
  const next = { ...DEFAULT_THEME };
  const src = theme && typeof theme === 'object' ? theme : {};
  for (const key of Object.keys(DEFAULT_THEME)) {
    if (src[key]) next[key] = hexColor(src[key], DEFAULT_THEME[key]);
  }
  return next;
}

function measureText(text, fontSize) {
  let width = 0;
  for (const ch of String(text || '')) {
    if (ch === ' ') width += fontSize * 0.32;
    else if ('ilI.,\'!:;|'.includes(ch)) width += fontSize * 0.28;
    else if ('mwMW@'.includes(ch)) width += fontSize * 0.86;
    else if (ch.charCodeAt(0) > 255) width += fontSize * 0.95;
    else width += fontSize * 0.55;
  }
  return width;
}

function wrapLines(text, maxWidth, fontSize, maxLines = 0) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  const fits = (value) => measureText(value, fontSize) <= maxWidth;
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (fits(trial)) {
      current = trial;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    if (fits(word)) {
      current = word;
      continue;
    }
    let chunk = '';
    for (const ch of word) {
      const next = chunk + ch;
      if (fits(next)) chunk = next;
      else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  if (maxLines > 0 && lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = `${String(clipped[maxLines - 1] || '').replace(/…$/, '')}…`;
    return clipped;
  }
  return lines;
}

function cardCaption(item) {
  const name = String(item?.name || 'Unknown').trim();
  return item?.reversed ? `${name} (reversed)` : name;
}

function isCeltic(spreadId, items) {
  return /celtic/i.test(String(spreadId || '')) && (items || []).length >= 8;
}

function svgText(str, x, y, opts = {}) {
  const fill = opts.fill || '#f3ead6';
  const size = opts.size || 14;
  const anchor = opts.anchor || 'start';
  const weight = opts.weight ? ` font-weight="${opts.weight}"` : '';
  const style = opts.italic ? ' font-style="italic"' : '';
  const tracking = opts.tracking != null ? ` letter-spacing="${opts.tracking}"` : '';
  const opacity = opts.opacity != null ? ` opacity="${opts.opacity}"` : '';
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="${FONT}" text-anchor="${anchor}"${weight}${style}${tracking}${opacity}>${esc(str)}</text>`;
}

function cornerSet(width, height, margin, gold) {
  const s = 38;
  const spots = [
    [margin, margin, 1, 1],
    [width - margin, margin, -1, 1],
    [margin, height - margin, 1, -1],
    [width - margin, height - margin, -1, -1],
  ];
  return spots.map(([x, y, dx, dy]) => (
    `<path d="M${x},${y + dy * s} L${x},${y} L${x + dx * s},${y}" fill="none" stroke="${gold}" stroke-width="1.35" stroke-linejoin="miter"/>`
    + `<path d="M${x + dx * 9},${y + dy * (s - 7)} L${x + dx * 9},${y + dy * 9} L${x + dx * (s - 7)},${y + dy * 9}" fill="none" stroke="${gold}" stroke-width="0.55" opacity="0.65"/>`
    + `<circle cx="${x + dx * 15}" cy="${y + dy * 15}" r="2.1" fill="${gold}"/>`
  )).join('');
}

function titleRule(cx, y, half, gold) {
  return (
    `<path d="M${cx - half},${y} H${cx - 14}" fill="none" stroke="${gold}" stroke-width="0.8"/>`
    + `<path d="M${cx + 14},${y} H${cx + half}" fill="none" stroke="${gold}" stroke-width="0.8"/>`
    + `<path d="M${cx},${y - 4} L${cx + 4},${y} L${cx},${y + 4} L${cx - 4},${y} Z" fill="${gold}"/>`
  );
}

function cardFrame(slot, theme) {
  if (slot.framed === false) return '';
  const pad = 9;
  const x = slot.x - pad;
  const y = slot.y - pad;
  const w = slot.width + pad * 2;
  const h = slot.height + pad * 2;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${theme.frame}" stroke="${theme.gold}" stroke-width="1.35"/>`
    + `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="4" fill="none" stroke="${theme.goldDim}" stroke-width="0.5" opacity="0.7"/>`
  );
}

function layoutHeader(meta, width) {
  const title = String(meta.title || 'Tarot').trim() || 'Tarot';
  const description = String(meta.description || '').trim();
  const titleLines = wrapLines(title, width - 160, 32, 2);
  const subLines = wrapLines(description, width - 180, 14, 3);
  const height = 54 + titleLines.length * 36 + (subLines.length ? 10 + subLines.length * 20 : 0) + 28;
  return { titleLines, subLines, height };
}

function layoutRow(items, meta, theme) {
  const n = items.length;
  const gap = 44;
  const padX = 58;
  const inner = n * CARD.w + (n - 1) * gap;
  const width = Math.max(980, padX * 2 + inner);
  const header = layoutHeader(meta, width);
  const cards = items.map((item, index) => ({
    item,
    x: Math.round((width - inner) / 2 + index * (CARD.w + gap)),
    y: header.height,
    width: CARD.w,
    height: CARD.h,
    rotate: 0,
  }));
  const meaningTop = header.height + CARD.h + 58;
  const meaningLines = Math.max(...items.map((item) => wrapLines(item.meaning, CARD.w, 13, 8).length), 1);
  const footerH = meta.footer ? 36 : 22;
  const height = meaningTop + meaningLines * 18 + footerH + 28;
  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    cards,
    header,
    meaningMode: 'under',
    theme,
    ...meta,
  };
}

function layoutGrid(items, meta, theme) {
  const n = items.length;
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const gapX = 36;
  const gapY = 76;
  const padX = 58;
  const inner = cols * CARD.w + (cols - 1) * gapX;
  const width = Math.max(1040, padX * 2 + inner);
  const header = layoutHeader(meta, width);
  const originX = Math.round((width - inner) / 2);
  const cards = items.map((item, index) => ({
    item,
    x: originX + (index % cols) * (CARD.w + gapX),
    y: header.height + Math.floor(index / cols) * (CARD.h + gapY),
    width: CARD.w,
    height: CARD.h,
    rotate: 0,
  }));
  const gridBottom = header.height + rows * CARD.h + (rows - 1) * gapY + 52;
  const legend = legendLayout(items, width - 120, 5);
  const footerH = meta.footer ? 36 : 22;
  const height = gridBottom + 18 + legend.height + footerH + 24;
  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    cards,
    header,
    meaningMode: 'legend',
    legend,
    legendTop: gridBottom + 18,
    theme,
    ...meta,
  };
}

function geom(x, y, extra = {}) {
  return {
    x, y, width: CARD.w, height: CARD.h, rotate: 0, ...extra,
  };
}

function layoutCeltic(items, meta, theme) {
  const gx = 124;
  const gy = 40;
  const padX = 58;
  const header = layoutHeader({ ...meta, title: meta.title || 'Celtic Cross' }, 1360);
  const presentX = padX + CARD.w + gx;
  const presentY = header.height + CARD.h + gy;
  const staffX = presentX + CARD.w + gx + CARD.w + 56;
  const staffGap = 28;
  const slots = {
    crown: geom(presentX, header.height),
    present: geom(presentX, presentY),
    chall: geom(presentX, presentY, { rotate: 90, scale: 0.72, framed: false, z: 2 }),
    found: geom(presentX, presentY + CARD.h + gy),
    past: geom(padX, presentY),
    'near-fut': geom(presentX + CARD.w + gx, presentY),
    out: geom(staffX, header.height),
    hope: geom(staffX, header.height + CARD.h + staffGap),
    env: geom(staffX, header.height + (CARD.h + staffGap) * 2),
    self: geom(staffX, header.height + (CARD.h + staffGap) * 3),
  };
  const used = new Set();
  const cards = [];
  for (const [pos, slot] of Object.entries(slots)) {
    const index = items.findIndex((item, i) => !used.has(i) && String(item.pos || '').toLowerCase() === pos);
    if (index < 0) continue;
    used.add(index);
    cards.push({ ...slot, item: items[index], hideLabel: true, order: index + 1 });
  }
  items.forEach((item, index) => {
    if (used.has(index)) return;
    const leftover = Object.values(slots).find((slot) => !cards.some((card) => card.x === slot.x && card.y === slot.y && card.rotate === slot.rotate));
    if (leftover) cards.push({ ...leftover, item, hideLabel: true, order: index + 1 });
  });
  cards.sort((a, b) => (a.z || 0) - (b.z || 0));
  const width = Math.max(1320, staffX + CARD.w + padX);
  const spreadBottom = Math.max(...cards.map((card) => card.y + card.height)) + 28;
  const legend = legendLayout(items, width - 120, 4);
  const footerH = meta.footer ? 36 : 22;
  const height = spreadBottom + 22 + legend.height + footerH + 28;
  header.titleLines = wrapLines(String(meta.title || 'Celtic Cross').trim(), width - 160, 32, 2);
  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    cards,
    header,
    meaningMode: 'legend',
    legend,
    legendTop: spreadBottom + 22,
    theme,
    ...meta,
  };
}

function legendLayout(items, totalWidth, maxLines) {
  const gap = 36;
  const colWidth = Math.floor((totalWidth - gap) / 2);
  const entries = items.map((item, index) => {
    const heading = `${index + 1}. ${String(item.label || `Card ${index + 1}`).trim()} — ${cardCaption(item)}`;
    const headLines = wrapLines(heading, colWidth, 13, 2);
    const bodyLines = wrapLines(item.meaning, colWidth, 13, maxLines);
    return {
      headLines,
      bodyLines,
      height: headLines.length * 18 + 4 + bodyLines.length * 17 + 14,
    };
  });
  const mid = Math.ceil(entries.length / 2);
  const left = entries.slice(0, mid);
  const right = entries.slice(mid);
  const colH = (list) => list.reduce((sum, entry) => sum + entry.height, 0);
  return {
    colWidth,
    gap,
    left,
    right,
    height: Math.max(colH(left), colH(right), 40),
  };
}

function layoutAtelier(items, spreadId, meta, theme) {
  if (isCeltic(spreadId, items)) return layoutCeltic(items, meta, theme);
  if (items.length <= 3) return layoutRow(items, meta, theme);
  return layoutGrid(items, meta, theme);
}

function matchSlotItem(slot, items, used) {
  const pos = String(slot.pos || slot.id || '').toLowerCase();
  if (pos) {
    const index = items.findIndex((item, i) => !used.has(i) && String(item.pos || '').toLowerCase() === pos);
    if (index >= 0) return index;
  }
  const raw = Number(slot.index);
  if (Number.isFinite(raw)) {
    const index = raw >= 1 ? raw - 1 : raw;
    if (items[index] && !used.has(index)) return index;
  }
  return items.findIndex((_, index) => !used.has(index));
}

function layoutFromJson(spec, items, meta) {
  const theme = mergeTheme(spec.theme);
  const slots = (Array.isArray(spec.slots) ? spec.slots : [])
    .filter((slot) => !slot.type || slot.type === 'card');
  if (!slots.length) {
    const layout = layoutAtelier(items, meta.spreadId, meta, theme);
    if (spec.meaningMode === 'legend' && layout.meaningMode === 'under') {
      return layoutGrid(items, meta, theme);
    }
    if (Number(spec.width) > 0) layout.width = Math.round(Number(spec.width));
    if (Number(spec.height) > 0) layout.height = Math.round(Number(spec.height));
    return layout;
  }
  const used = new Set();
  const cards = [];
  for (const slot of slots) {
    const index = matchSlotItem(slot, items, used);
    if (index < 0) continue;
    used.add(index);
    cards.push({
      item: items[index],
      x: Number(slot.x) || 0,
      y: Number(slot.y) || 0,
      width: Number(slot.width) || CARD.w,
      height: Number(slot.height) || CARD.h,
      rotate: Number(slot.rotate) || 0,
      scale: Number(slot.scale) || 1,
      framed: slot.framed !== false,
    });
  }
  items.forEach((item, index) => {
    if (used.has(index)) return;
    const last = cards[cards.length - 1];
    cards.push({
      item,
      x: last ? last.x + last.width + 36 : 64,
      y: last ? last.y : 140,
      width: CARD.w,
      height: CARD.h,
      rotate: 0,
    });
  });
  const pad = 56;
  const maxR = Math.max(...cards.map((card) => card.x + card.width), 400);
  const maxB = Math.max(...cards.map((card) => card.y + card.height), 400);
  const width = Math.max(960, Number(spec.width) || (maxR + pad));
  const header = layoutHeader(meta, width);
  const meaningMode = spec.meaningMode === 'under' ? 'under' : 'legend';
  let height;
  let legend;
  let legendTop;
  let legendX = 60;
  if (meaningMode === 'under') {
    const meaningLines = Math.max(...items.map((item) => wrapLines(item.meaning, CARD.w, 13, 8).length), 1);
    height = Math.max(Number(spec.height) || 0, maxB + 58 + meaningLines * 18 + 48);
  } else {
    const side = width - maxR;
    if (side > 380) {
      legend = legendLayout(items, side - 56, 8);
      legendX = maxR + 40;
      legendTop = Math.max(header.height, Math.min(...cards.map((card) => card.y)));
      height = Math.max(Number(spec.height) || 0, maxB + 48, legendTop + legend.height + 48);
    } else {
      legend = legendLayout(items, width - 120, 5);
      legendTop = maxB + 48;
      height = Math.max(Number(spec.height) || 0, legendTop + legend.height + 48);
    }
  }
  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    cards,
    header,
    meaningMode,
    legend,
    legendTop,
    legendX,
    theme,
    ...meta,
  };
}

function headerSvg(layout) {
  const { width, header, theme } = layout;
  const cx = width / 2;
  let y = 38;
  const parts = [
    svgText('K A B B A K', cx, y, {
      fill: theme.gold, size: 11, anchor: 'middle', tracking: 6, opacity: 0.9,
    }),
  ];
  y = 70;
  header.titleLines.forEach((line) => {
    parts.push(svgText(line, cx, y, {
      fill: theme.ink, size: 32, anchor: 'middle',
    }));
    y += 36;
  });
  const ruleY = y - 10;
  const half = Math.min(220, Math.max(90, width / 6));
  parts.push(titleRule(cx, ruleY, half, theme.gold));
  y += 8;
  header.subLines.forEach((line) => {
    parts.push(svgText(line, cx, y, {
      fill: theme.muted, size: 14, anchor: 'middle', italic: true,
    }));
    y += 20;
  });
  return parts.join('');
}

function meaningSvg(layout) {
  const { theme, cards, meaningMode } = layout;
  if (meaningMode === 'under') {
    return cards.map((slot) => {
      const cx = slot.x + slot.width / 2;
      const labelY = slot.y + slot.height + 22;
      const nameY = labelY + 18;
      const parts = [
        svgText(String(slot.item.label || '').toUpperCase(), cx, labelY, {
          fill: theme.gold, size: 11, anchor: 'middle', tracking: 2.2,
        }),
        svgText(cardCaption(slot.item), cx, nameY, {
          fill: theme.ink, size: 14, anchor: 'middle',
        }),
      ];
      const lines = wrapLines(slot.item.meaning, slot.width, 13, 8);
      lines.forEach((line, index) => {
        parts.push(svgText(line, slot.x, nameY + 22 + index * 18, {
          fill: theme.muted, size: 13,
        }));
      });
      return parts.join('');
    }).join('');
  }

  const legend = layout.legend;
  const top = layout.legendTop;
  const x0 = layout.legendX || 60;
  const sideLegend = x0 > 80;
  const parts = sideLegend ? [] : [
    `<line x1="48" y1="${top - 14}" x2="${layout.width - 48}" y2="${top - 14}" stroke="${theme.rule}" stroke-width="0.8" opacity="0.85"/>`,
  ];
  const paintCol = (entries, x, startY) => {
    let y = startY;
    entries.forEach((entry) => {
      entry.headLines.forEach((line) => {
        parts.push(svgText(line, x, y, { fill: theme.ink, size: 13 }));
        y += 18;
      });
      y += 2;
      entry.bodyLines.forEach((line) => {
        parts.push(svgText(line, x, y, { fill: theme.muted, size: 13 }));
        y += 17;
      });
      y += 12;
    });
  };
  paintCol(legend.left, x0, top + 8);
  paintCol(legend.right, x0 + legend.colWidth + legend.gap, top + 8);
  cards.forEach((slot) => {
    if (slot.framed === false) return;
    if (slot.hideLabel) {
      if (slot.order) {
        parts.push(svgText(String(slot.order), slot.x + slot.width / 2, slot.y + slot.height + 18, {
          fill: theme.gold, size: 12, anchor: 'middle',
        }));
      }
      return;
    }
    const cx = slot.x + slot.width / 2;
    parts.push(svgText(String(slot.item.label || '').toUpperCase(), cx, slot.y + slot.height + 20, {
      fill: theme.gold, size: 11, anchor: 'middle', tracking: 2,
    }));
    parts.push(svgText(cardCaption(slot.item), cx, slot.y + slot.height + 38, {
      fill: theme.ink, size: 13, anchor: 'middle',
    }));
  });
  return parts.join('');
}

function buildChromeSvg(layout) {
  const { width, height, theme, cards, footer } = layout;
  const frames = cards.map((slot) => cardFrame(slot, theme)).join('');
  const foot = footer
    ? svgText(footer, width / 2, height - 22, {
      fill: theme.goldDim, size: 12, anchor: 'middle', tracking: 1.2,
    })
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<defs>`
    + `<radialGradient id="vignette" cx="50%" cy="40%" r="74%">`
    + `<stop offset="0%" stop-color="${theme.panel}"/>`
    + `<stop offset="100%" stop-color="${theme.bg}"/>`
    + `</radialGradient>`
    + `</defs>`
    + `<rect width="100%" height="100%" fill="url(#vignette)"/>`
    + `<rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="none" stroke="${theme.gold}" stroke-width="1.25"/>`
    + `<rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="${theme.gold}" stroke-width="0.5" opacity="0.55"/>`
    + cornerSet(width, height, 18, theme.gold)
    + frames
    + headerSvg(layout)
    + meaningSvg(layout)
    + foot
    + `</svg>`
  );
}

async function placeholderPng(width, height, theme) {
  const svg = (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="100%" height="100%" fill="${theme.frame}"/>`
    + `<rect x="14" y="14" width="${width - 28}" height="${height - 28}" fill="none" stroke="${theme.goldDim}" stroke-width="1"/>`
    + `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="${theme.goldDim}" font-size="22" font-family="${FONT}">✦</text>`
    + `</svg>`
  );
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderCardOverlay(item, slot, theme) {
  const scale = Number(slot.scale) || 1;
  const width = Math.max(1, Math.round(slot.width * scale));
  const height = Math.max(1, Math.round(slot.height * scale));
  let pipeline;
  if (item?.buffer && item.buffer.length > 32) {
    pipeline = sharp(item.buffer).rotate();
    if (item.reversed) pipeline = pipeline.rotate(180);
    pipeline = pipeline.resize(width, height, { fit: 'cover' });
  } else {
    pipeline = sharp(await placeholderPng(width, height, theme));
  }
  const rotate = Number(slot.rotate) || 0;
  if (rotate) {
    pipeline = pipeline.rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  const input = await pipeline.png().toBuffer();
  const meta = await sharp(input).metadata();
  const cx = slot.x + slot.width / 2;
  const cy = slot.y + slot.height / 2;
  const left = Math.round(cx - (meta.width || width) / 2);
  const top = Math.round(cy - (meta.height || height) / 2);
  return { input, left, top };
}

async function rasterizeLayout(layout) {
  const svg = buildChromeSvg(layout);
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const overlays = [];
  for (const slot of layout.cards) {
    const overlay = await renderCardOverlay(slot.item, slot, layout.theme);
    const info = await sharp(overlay.input).metadata();
    const maxLeft = Math.max(0, layout.width - (info.width || 1));
    const maxTop = Math.max(0, layout.height - (info.height || 1));
    overlays.push({
      input: overlay.input,
      left: Math.max(0, Math.min(maxLeft, overlay.left)),
      top: Math.max(0, Math.min(maxTop, overlay.top)),
    });
  }
  let out = sharp(base);
  if (overlays.length) out = out.composite(overlays);
  return out.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

function attr(block, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(block);
  return match ? String(match[2] ?? match[3] ?? '') : '';
}

function numAttr(block, name, fallback = 0) {
  const value = Number(attr(block, name));
  return Number.isFinite(value) ? value : fallback;
}

function parseSvgSize(svg) {
  const open = String(svg || '').match(/<svg\b[^>]*>/i)?.[0] || '';
  const width = numAttr(open, 'width', 0);
  const height = numAttr(open, 'height', 0);
  const box = attr(open, 'viewBox').trim().split(/[\s,]+/).map(Number);
  return {
    width: width || box[2] || 1600,
    height: height || box[3] || 900,
  };
}

function parseSvgCardSlots(svg) {
  const slots = [];
  const re = /<image\b([^>]*)\/?>/gi;
  let match;
  while ((match = re.exec(String(svg || '')))) {
    const block = match[1] || '';
    if (!/data-kabbak\s*=\s*["']card["']/i.test(block)) continue;
    slots.push({
      pos: attr(block, 'data-pos'),
      index: numAttr(block, 'data-index', NaN),
      x: numAttr(block, 'x'),
      y: numAttr(block, 'y'),
      width: numAttr(block, 'width', CARD.w),
      height: numAttr(block, 'height', CARD.h),
      rotate: numAttr(block, 'data-rotate', 0),
      scale: numAttr(block, 'data-scale', 1),
      framed: false,
    });
  }
  return slots;
}

function wrapTspans(text, x, fontSize, width, maxLines) {
  const size = Math.min(48, Math.max(8, Number(fontSize) || 14));
  const maxW = Math.max(size * 10, Number(width) || 280);
  const value = String(text || '');
  if (measureText(value, size) <= maxW) return esc(value);
  const lines = wrapLines(value, maxW, size, maxLines || 8);
  return lines.map((line, index) => (
    `<tspan x="${x}" dy="${index === 0 ? 0 : Math.round(size * 1.28)}">${esc(line)}</tspan>`
  )).join('');
}

function fillSvgText(svg, kind, value, predicate) {
  const re = new RegExp(`(<text\\b[^>]*data-kabbak="${kind}"[^>]*>)([\\s\\S]*?)(</text>)`, 'gi');
  return String(svg || '').replace(re, (all, open, _inner, close) => {
    if (predicate && !predicate(open)) return all;
    const width = numAttr(open, 'data-width', 0);
    const size = numAttr(open, 'font-size', 14);
    const x = numAttr(open, 'x', 0);
    if (width > 0) return `${open}${wrapTspans(value, x, size, width, 10)}${close}`;
    return `${open}${esc(value)}${close}`;
  });
}

function fillIndexedText(svg, kind, items, getter) {
  let next = svg;
  items.forEach((item, index) => {
    next = fillSvgText(next, kind, getter(item, index), (open) => {
      const pos = attr(open, 'data-pos').toLowerCase();
      if (pos) return pos === String(item.pos || '').toLowerCase();
      const slot = numAttr(open, 'data-index', NaN);
      if (Number.isFinite(slot)) return slot === index + 1;
      return false;
    });
  });
  return next;
}

function setReversedVisibility(svg, items) {
  return String(svg || '').replace(
    /<g\b([^>]*data-kabbak="reversed"[^>]*)>/gi,
    (all, block) => {
      const pos = attr(block, 'data-pos').toLowerCase();
      const slot = numAttr(block, 'data-index', NaN);
      const item = items.find((entry, index) => (
        (pos && String(entry.pos || '').toLowerCase() === pos)
        || (Number.isFinite(slot) && slot === index + 1)
      ));
      const show = Boolean(item?.reversed);
      let attrs = String(block)
        .replace(/\sdisplay="[^"]*"/i, '')
        .replace(/\svisibility="[^"]*"/i, '');
      attrs += show ? ' display="inline"' : ' display="none"';
      return `<g${attrs}>`;
    }
  );
}

function neutralizeCardImages(svg) {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return String(svg || '').replace(/<image\b([^>]*data-kabbak="card"[^>]*)\/?>/gi, (_all, block) => {
    const cleaned = String(block)
      .replace(/\/\s*$/, '')
      .replace(/\s(?:href|xlink:href)="[^"]*"/gi, '')
      .replace(/\s(?:href|xlink:href)='[^']*'/gi, '');
    return `<image${cleaned} href="${pixel}"/>`;
  });
}

async function renderSvgTemplate(items, template, meta) {
  let svg = String(template.svg || '');
  svg = fillSvgText(svg, 'title', meta.title || '');
  svg = fillSvgText(svg, 'description', meta.description || '');
  svg = fillSvgText(svg, 'footer', meta.footer || '');
  svg = fillIndexedText(svg, 'label', items, (item) => String(item.label || ''));
  svg = fillIndexedText(svg, 'name', items, (item) => cardCaption(item));
  svg = fillIndexedText(svg, 'meaning', items, (item) => String(item.meaning || ''));
  svg = setReversedVisibility(svg, items);
  svg = neutralizeCardImages(svg);
  const size = parseSvgSize(svg);
  const slots = parseSvgCardSlots(template.svg);
  const used = new Set();
  const cards = [];
  for (const slot of slots) {
    const index = matchSlotItem(slot, items, used);
    if (index < 0) continue;
    used.add(index);
    cards.push({ ...slot, item: items[index], framed: false });
  }
  const base = await sharp(Buffer.from(svg), { density: 96 })
    .resize(Math.round(size.width), Math.round(size.height), { fit: 'fill' })
    .png()
    .toBuffer();
  const overlays = [];
  for (const slot of cards) {
    const overlay = await renderCardOverlay(slot.item, slot, DEFAULT_THEME);
    const info = await sharp(overlay.input).metadata();
    const maxLeft = Math.max(0, size.width - (info.width || 1));
    const maxTop = Math.max(0, size.height - (info.height || 1));
    overlays.push({
      input: overlay.input,
      left: Math.max(0, Math.min(maxLeft, overlay.left)),
      top: Math.max(0, Math.min(maxTop, overlay.top)),
    });
  }
  let out = sharp(base);
  if (overlays.length) out = out.composite(overlays);
  return out.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

async function renderSpreadPrint(items, { spreadId = '', title = '', description = '', footer = '', template = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const meta = {
    spreadId,
    title: String(title || 'Tarot').trim(),
    description: String(description || '').trim(),
    footer: String(footer || '').trim(),
  };
  if (template?.kind === 'svg') {
    return renderSvgTemplate(list, template, meta);
  }
  const layout = template?.kind === 'json'
    ? layoutFromJson(template.spec || {}, list, meta)
    : layoutAtelier(list, spreadId, meta, mergeTheme(template?.theme));
  return rasterizeLayout(layout);
}

module.exports = {
  DEFAULT_THEME,
  renderSpreadPrint,
  mergeTheme,
};
