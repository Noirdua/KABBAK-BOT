const Jimp = require('jimp');
const sharp = require('sharp');
const { fetchAssetBuffer } = require('./kabbak-api');

const CARD_WIDTH = 240;
const GAP = 18;
const PAD = 32;
const COL_WIDTH = 300;
const BG = 0x140e1aff;
const RULE = 0x6b4e71ff;
const PLACEHOLDER = 0x2a2035ff;

const CELTIC_CELLS = {
  present: { col: 1, row: 1 },
  found: { col: 1, row: 2 },
  chall: { col: 1, row: 3 },
  crown: { col: 1, row: 0 },
  past: { col: 0, row: 1 },
  'near-fut': { col: 2, row: 1 },
  hope: { col: 3, row: 0 },
  env: { col: 3, row: 1 },
  self: { col: 3, row: 2 },
  out: { col: 3, row: 3 },
};

let fontsPromise = null;

function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      Jimp.loadFont(Jimp.FONT_SANS_32_WHITE),
      Jimp.loadFont(Jimp.FONT_SANS_16_WHITE),
    ]).then(([title, body]) => ({
      title,
      body,
      titleLine: Jimp.measureTextHeight(title, 'Ag', 400) || 36,
      bodyLine: Jimp.measureTextHeight(body, 'Ag', 400) || 20,
    }));
  }
  return fontsPromise;
}

async function decodeCardImage(buffer) {
  const png = await sharp(buffer).rotate().png().toBuffer();
  return Jimp.read(png);
}

async function fetchImage(url) {
  return decodeCardImage(await fetchAssetBuffer(url));
}

function cellLayout(items, spreadId) {
  const isCeltic = /celtic/i.test(String(spreadId || '')) && items.length >= 8;
  if (isCeltic) {
    return items.map((item, index) => {
      const pos = String(item.pos || '').toLowerCase();
      return CELTIC_CELLS[pos] || { col: index % 4, row: Math.floor(index / 4) };
    });
  }
  const cols = items.length <= 3 ? items.length : items.length <= 6 ? 3 : 4;
  return items.map((_, index) => ({
    col: index % cols,
    row: Math.floor(index / cols),
  }));
}

function wrapLines(font, text, maxWidth, maxLines = 0) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  const fits = (value) => Jimp.measureText(font, value) <= maxWidth;
  const push = (line) => {
    if (line) lines.push(line);
  };
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (fits(trial)) {
      current = trial;
      continue;
    }
    push(current);
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
        push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }
  push(current);
  if (maxLines > 0 && lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    const last = String(clipped[maxLines - 1] || '').replace(/…$/, '');
    clipped[maxLines - 1] = `${last}…`;
    return clipped;
  }
  return lines;
}

function printLines(canvas, font, x, y, lines, lineHeight, width, alignCenter = false) {
  let cursor = y;
  for (const line of lines) {
    if (alignCenter) {
      canvas.print(font, x, cursor, {
        text: line,
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
      }, width, lineHeight);
    } else {
      canvas.print(font, x, cursor, line);
    }
    cursor += lineHeight;
  }
  return cursor;
}

function rule(canvas, y, x0, x1) {
  const yy = Math.round(y);
  for (let x = Math.round(x0); x < Math.round(x1); x += 1) {
    canvas.setPixelColor(RULE, x, yy);
  }
}

function cardCaption(item) {
  const name = String(item.name || 'Unknown').trim();
  return item.reversed ? `${name} (reversed)` : name;
}

function headingFor(item, index) {
  const label = String(item.label || `Card ${index + 1}`).trim();
  return `${index + 1}. ${label} — ${cardCaption(item)}`;
}

async function loadCards(items) {
  const list = Array.isArray(items) ? items : [];
  return Promise.all(list.map(async (item) => {
    let image;
    try {
      if (item?.imageUrl) {
        image = await fetchImage(item.imageUrl);
        if (item.reversed) image.rotate(180);
        const width = image.bitmap.width || CARD_WIDTH;
        const height = image.bitmap.height || Math.round(CARD_WIDTH * 1.6);
        const nextHeight = Math.max(1, Math.round(height * (CARD_WIDTH / width)));
        image.resize(CARD_WIDTH, nextHeight);
      }
    } catch (error) {
      console.warn('[stitch] card image failed:', item?.name || item?.label || 'card', error?.message || error);
      image = null;
    }
    if (!image) {
      image = new Jimp(CARD_WIDTH, Math.round(CARD_WIDTH * 1.6), PLACEHOLDER);
    }
    return { ...item, image };
  }));
}

function headerHeight(fonts, titleLines, subLines) {
  let height = PAD + titleLines.length * fonts.titleLine;
  if (subLines.length) height += 8 + subLines.length * fonts.bodyLine;
  return height + GAP;
}

async function renderRowPoster(loaded, { title, description, footer, fonts }) {
  const titleWidth = loaded.length * COL_WIDTH + (loaded.length - 1) * GAP;
  const titleLines = wrapLines(fonts.title, title, titleWidth, 2);
  const subLines = wrapLines(fonts.body, description, titleWidth, 3);
  const cardHeight = Math.max(...loaded.map((item) => item.image.bitmap.height));
  const blocks = loaded.map((item, index) => {
    const label = String(item.label || `Card ${index + 1}`);
    const meaning = wrapLines(fonts.body, item.meaning, COL_WIDTH, 10);
    const height = cardHeight
      + 8 + fonts.bodyLine
      + fonts.bodyLine
      + (meaning.length ? 10 + meaning.length * fonts.bodyLine : 0);
    return { item, label, meaning, height };
  });
  const blockH = Math.max(...blocks.map((block) => block.height));
  const width = Math.ceil(PAD * 2 + titleWidth);
  let height = headerHeight(fonts, titleLines, subLines) + blockH + PAD;
  const footerLines = wrapLines(fonts.body, footer, titleWidth, 1);
  if (footerLines.length) height += GAP + footerLines.length * fonts.bodyLine;

  const canvas = new Jimp(width, Math.ceil(height), BG);
  let y = PAD;
  y = printLines(canvas, fonts.title, PAD, y, titleLines, fonts.titleLine, titleWidth, true);
  if (subLines.length) {
    y += 8;
    y = printLines(canvas, fonts.body, PAD, y, subLines, fonts.bodyLine, titleWidth, true);
  }
  y += GAP;
  blocks.forEach((block, index) => {
    const x = PAD + index * (COL_WIDTH + GAP);
    const imgX = x + Math.round((COL_WIDTH - CARD_WIDTH) / 2);
    canvas.composite(block.item.image, imgX, y);
    let ty = y + cardHeight + 8;
    canvas.print(fonts.body, x, ty, {
      text: block.label,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
    }, COL_WIDTH, fonts.bodyLine);
    ty += fonts.bodyLine;
    canvas.print(fonts.body, x, ty, {
      text: cardCaption(block.item),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
    }, COL_WIDTH, fonts.bodyLine);
    ty += fonts.bodyLine + 10;
    printLines(canvas, fonts.body, x, ty, block.meaning, fonts.bodyLine, COL_WIDTH);
  });
  if (footerLines.length) {
    printLines(
      canvas,
      fonts.body,
      PAD,
      canvas.bitmap.height - PAD - footerLines.length * fonts.bodyLine,
      footerLines,
      fonts.bodyLine,
      titleWidth,
      true
    );
  }
  canvas.quality(84);
  return canvas.getBufferAsync(Jimp.MIME_JPEG);
}

async function renderGridPoster(loaded, { title, description, footer, fonts, spreadId }) {
  const cells = cellLayout(loaded, spreadId);
  const maxCol = Math.max(...cells.map((cell) => cell.col));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const cardHeight = Math.max(...loaded.map((item) => item.image.bitmap.height));
  const labelBand = fonts.bodyLine * 2 + 8;
  const cellWidth = CARD_WIDTH + GAP;
  const cellHeight = cardHeight + labelBand + GAP;
  const gridWidth = (maxCol + 1) * cellWidth - GAP;
  const gridHeight = (maxRow + 1) * cellHeight - GAP;
  const textWidth = Math.max(gridWidth, 640);
  const titleLines = wrapLines(fonts.title, title, textWidth, 2);
  const subLines = wrapLines(fonts.body, description, textWidth, 3);
  const entries = loaded.map((item, index) => {
    const heading = wrapLines(fonts.body, headingFor(item, index), textWidth, 2);
    const meaning = wrapLines(fonts.body, item.meaning, textWidth, 7);
    return { heading, meaning };
  });
  const panelHeight = entries.reduce((sum, entry) => (
    sum + entry.heading.length * fonts.bodyLine + 4 + entry.meaning.length * fonts.bodyLine + 14
  ), 0);
  const footerLines = wrapLines(fonts.body, footer, textWidth, 1);
  const width = Math.ceil(PAD * 2 + Math.max(gridWidth, textWidth));
  const height = Math.ceil(
    headerHeight(fonts, titleLines, subLines)
    + gridHeight
    + GAP + 8
    + panelHeight
    + (footerLines.length ? GAP + footerLines.length * fonts.bodyLine : 0)
    + PAD
  );

  const canvas = new Jimp(width, height, BG);
  const contentX = PAD + Math.round((width - PAD * 2 - Math.max(gridWidth, textWidth)) / 2);
  let y = PAD;
  y = printLines(canvas, fonts.title, PAD, y, titleLines, fonts.titleLine, width - PAD * 2, true);
  if (subLines.length) {
    y += 8;
    y = printLines(canvas, fonts.body, PAD, y, subLines, fonts.bodyLine, width - PAD * 2, true);
  }
  y += GAP;
  const gridX = PAD + Math.round((width - PAD * 2 - gridWidth) / 2);
  loaded.forEach((item, index) => {
    const cell = cells[index];
    const x = gridX + cell.col * cellWidth;
    const cy = y + cell.row * cellHeight;
    canvas.composite(item.image, x, cy);
    canvas.print(fonts.body, x, cy + cardHeight + 4, {
      text: String(item.label || `Card ${index + 1}`),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
    }, CARD_WIDTH, fonts.bodyLine);
    canvas.print(fonts.body, x, cy + cardHeight + 4 + fonts.bodyLine, {
      text: cardCaption(item),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
    }, CARD_WIDTH, fonts.bodyLine);
  });
  y += gridHeight + GAP;
  rule(canvas, y, PAD, width - PAD);
  y += 12;
  entries.forEach((entry) => {
    y = printLines(canvas, fonts.body, contentX, y, entry.heading, fonts.bodyLine, textWidth);
    y += 4;
    y = printLines(canvas, fonts.body, contentX, y, entry.meaning, fonts.bodyLine, textWidth);
    y += 14;
  });
  if (footerLines.length) {
    printLines(canvas, fonts.body, PAD, y, footerLines, fonts.bodyLine, width - PAD * 2, true);
  }
  canvas.quality(84);
  return canvas.getBufferAsync(Jimp.MIME_JPEG);
}

async function stitchSpreadImages(items, { spreadId = '', title = '', description = '', footer = '' } = {}) {
  const loaded = await loadCards(items);
  if (!loaded.length) return null;
  const fonts = await loadFonts();
  const heading = String(title || 'Tarot').trim();
  const sub = String(description || '').trim();
  const foot = String(footer || '').trim();
  const useRow = loaded.length <= 3 && !/celtic/i.test(String(spreadId || ''));
  if (useRow) {
    return renderRowPoster(loaded, { title: heading, description: sub, footer: foot, fonts });
  }
  return renderGridPoster(loaded, { title: heading, description: sub, footer: foot, fonts, spreadId });
}

module.exports = {
  stitchSpreadImages,
};
