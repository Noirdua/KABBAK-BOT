const GROUPS = new Set(['api', 'tarot', 'text', 'location']);
const TOPLEVEL = new Set([
  'help', 'status', 'decks', 'now', 'calendar', 'natal',
  'tattva', 'iching', 'gematria', 'quiz', 'search',
]);
const INT_KEYS = new Set(['number', 'value']);
const NUMBER_KEYS = new Set(['latitude', 'longitude', 'number', 'value']);
const BOOL_KEYS = new Set(['stitch', 'reversed']);
const ALIASES = {
  draw: { group: 'tarot', subcommand: 'draw' },
  pull: { group: 'tarot', subcommand: 'draw' },
  card: { group: 'tarot', subcommand: 'card' },
  cards: { group: 'tarot', subcommand: 'cards' },
  spreads: { group: 'tarot', subcommand: 'spreads' },
  login: { group: 'api', subcommand: 'login' },
  logout: { group: 'api', subcommand: 'logout' },
};

const POSITIONAL = {
  'tarot.card': 'name',
  'tarot.cards': 'query',
  'tarot.draw': 'spread',
  'text.section': 'section',
  'search': 'query',
  'gematria': 'value',
  'iching': 'number',
  'tattva': 'tattva',
  'quiz': 'category',
  'now': 'location',
  'calendar': 'location',
  'natal': 'date',
  'location.set': 'location',
};

function defaultPrefixes() {
  const extra = String(process.env.MATRIX_PREFIX || '').trim();
  const prefixes = ['/kabbak', '!kabbak'];
  if (extra && !prefixes.includes(extra)) prefixes.unshift(extra);
  return prefixes;
}

function stripQuotes(value) {
  const text = String(value || '');
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function coerce(key, value) {
  const raw = String(value ?? '').trim();
  if (BOOL_KEYS.has(key)) return /^(1|true|yes|on)$/i.test(raw);
  if (INT_KEYS.has(key)) {
    const num = Number.parseInt(raw, 10);
    return Number.isFinite(num) ? num : raw;
  }
  if (NUMBER_KEYS.has(key)) {
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  return raw;
}

function tokenize(input) {
  const tokens = [];
  const re = /([a-zA-Z][\w]*)[:=](?:"([^"]*)"|'([^']*)'|([\s\S]*?))(?=\s+[a-zA-Z][\w]*[:=]|$)|"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(input || '')))) {
    if (match[1]) {
      tokens.push({
        kind: 'kv',
        key: match[1].toLowerCase(),
        value: String(match[2] ?? match[3] ?? match[4] ?? '').trim(),
      });
    } else {
      tokens.push({
        kind: 'word',
        value: match[5] ?? match[6] ?? match[7] ?? '',
      });
    }
  }
  return tokens;
}

function stripPrefix(body, prefixes = defaultPrefixes()) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return null;
  const ordered = [...prefixes].sort((a, b) => b.length - a.length);
  for (const prefix of ordered) {
    if (!prefix) continue;
    if (trimmed === prefix) return '';
    if (trimmed.startsWith(`${prefix} `) || trimmed.startsWith(`${prefix}\n`)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return null;
}

function assignPositionals(group, subcommand, positional, args) {
  if (!positional.length) return args;
  const flags = new Set(['stitch', 'separate', 'unstitch', 'reverse', 'reversed']);
  const lowered = positional.map((word) => String(word).toLowerCase());
  if (lowered.includes('stitch') && args.stitch === undefined) args.stitch = true;
  if ((lowered.includes('separate') || lowered.includes('unstitch')) && args.stitch === undefined) {
    args.stitch = false;
  }
  if ((lowered.includes('reverse') || lowered.includes('reversed')) && args.reversed === undefined) {
    args.reversed = true;
  }
  const rest = positional.filter((word) => !flags.has(String(word).toLowerCase()));
  if (!rest.length) return args;
  const key = POSITIONAL[group ? `${group}.${subcommand}` : subcommand];
  if (key && (args[key] === undefined || args[key] === '')) {
    if (INT_KEYS.has(key) || NUMBER_KEYS.has(key) || BOOL_KEYS.has(key)) {
      args[key] = coerce(key, rest[0]);
    } else {
      args[key] = rest.join(' ');
    }
  }
  return args;
}

function parseCommand(body, prefixes) {
  const rest = stripPrefix(body, prefixes);
  if (rest === null) return null;
  const tokens = tokenize(rest);
  const words = [];
  const args = {};
  const positional = [];
  for (const token of tokens) {
    if (token.kind === 'kv') {
      args[token.key] = coerce(token.key, token.value);
    } else {
      words.push(token.value);
    }
  }
  let group = '';
  let subcommand = '';
  if (GROUPS.has(String(words[0] || '').toLowerCase())) {
    group = words.shift().toLowerCase();
    if (words[0] && !/^[a-zA-Z][\w]*[:=]/.test(words[0])) {
      subcommand = words.shift().toLowerCase();
    }
  } else if (words[0]) {
    subcommand = words.shift().toLowerCase();
    if (!TOPLEVEL.has(subcommand) && GROUPS.has(subcommand)) {
      group = subcommand;
      subcommand = words[0] ? words.shift().toLowerCase() : '';
    } else if (ALIASES[subcommand]) {
      group = ALIASES[subcommand].group;
      subcommand = ALIASES[subcommand].subcommand;
    }
  }
  positional.push(...words.map(stripQuotes).filter(Boolean));
  assignPositionals(group, subcommand, positional, args);
  if (group === 'location' && !subcommand) subcommand = 'view';
  return { group, subcommand, args, rest };
}

module.exports = {
  GROUPS,
  TOPLEVEL,
  ALIASES,
  defaultPrefixes,
  stripPrefix,
  parseCommand,
};
