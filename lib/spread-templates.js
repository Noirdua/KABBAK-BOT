const fs = require('fs');
const path = require('path');

const MAX_TEMPLATE_BYTES = 2_000_000;

const SHIPPED_DIR = path.join(__dirname, '..', 'templates');
const USER_DIR = path.join(process.cwd(), 'storage', 'templates');

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeSvg(svg) {
  return String(svg || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(?:href|xlink:href)\s*=\s*("https?:[^"]*"|'https?:[^']*')/gi, '');
}

function readCapped(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_TEMPLATE_BYTES) return null;
  return fs.readFileSync(filePath);
}

function parseJsonTemplate(id, filePath, raw) {
  let spec;
  try {
    spec = JSON.parse(String(raw));
  } catch (_error) {
    return null;
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const name = String(spec.name || spec.title || id).trim() || id;
  return {
    id: slug(spec.id) || id,
    name,
    kind: 'json',
    source: filePath,
    spec,
  };
}

function parseSvgMeta(svg) {
  const open = String(svg || '').match(/<svg\b[^>]*>/i)?.[0] || '';
  const pick = (name) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(open);
    return match ? String(match[2] ?? match[3] ?? '').trim() : '';
  };
  return {
    id: slug(pick('data-id')),
    name: pick('data-name'),
  };
}

function parseSvgTemplate(id, filePath, raw) {
  const svg = sanitizeSvg(String(raw));
  if (!/<svg[\s>]/i.test(svg)) return null;
  const meta = parseSvgMeta(svg);
  return {
    id: meta.id || id,
    name: meta.name || id,
    kind: 'svg',
    source: filePath,
    svg,
  };
}

function loadFromDir(dir, sourceLabel) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (_error) {
    return [];
  }
  const templates = [];
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (ext !== '.svg' && ext !== '.json') continue;
    const filePath = path.join(dir, name);
    const raw = readCapped(filePath);
    if (!raw) continue;
    const id = slug(path.basename(name, ext));
    if (!id) continue;
    const parsed = ext === '.json'
      ? parseJsonTemplate(id, filePath, raw)
      : parseSvgTemplate(id, filePath, raw);
    if (parsed) {
      parsed.sourceLabel = sourceLabel;
      templates.push(parsed);
    }
  }
  return templates;
}

function builtinAtelier() {
  return {
    id: 'atelier',
    name: 'Atelier',
    kind: 'atelier',
    sourceLabel: 'built-in',
    source: 'built-in',
  };
}

function listTemplates() {
  const found = [
    builtinAtelier(),
    ...loadFromDir(SHIPPED_DIR, 'shipped'),
    ...loadFromDir(USER_DIR, 'local'),
  ];
  const byId = new Map();
  for (const template of found) {
    byId.set(template.id, template);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.id === 'atelier') return -1;
    if (b.id === 'atelier') return 1;
    return a.name.localeCompare(b.name);
  });
}

function resolveTemplate(templateId) {
  const wanted = slug(templateId);
  if (!wanted || wanted === 'atelier' || wanted === 'default') return builtinAtelier();
  const match = listTemplates().find((template) => template.id === wanted);
  if (!match) {
    throw new Error(`Unknown template "${templateId}". Use tarot templates to list them.`);
  }
  return match;
}

module.exports = {
  SHIPPED_DIR,
  USER_DIR,
  listTemplates,
  resolveTemplate,
};
