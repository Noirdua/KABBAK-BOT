const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_PATH = process.env.KABBAK_USER_STORE
  || path.join(__dirname, '..', 'storage', 'users.json');

const KNOWN_PLATFORMS = new Set(['discord', 'telegram', 'matrix']);

let cache = null;

function accountId(platform, nativeId) {
  const plat = String(platform || '').trim().toLowerCase();
  const id = String(nativeId || '').trim();
  if (!plat || !id) return '';
  if (id.startsWith(`${plat}:`)) return id;
  return `${plat}:${id}`;
}

function lookupKeys(userId) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const keys = [id];
  const colon = id.indexOf(':');
  if (colon > 0) {
    const plat = id.slice(0, colon);
    const native = id.slice(colon + 1);
    if (KNOWN_PLATFORMS.has(plat) && native) {
      if (plat === 'discord') keys.push(native);
    }
  } else {
    keys.push(`discord:${id}`);
  }
  return keys;
}

function getSecretKey() {
  const secret = String(
    process.env.KABBAK_KEY_ENCRYPTION_SECRET
    || process.env.DISCORD_TOKEN
    || process.env.TELEGRAM_BOT_TOKEN
    || process.env.MATRIX_ACCESS_TOKEN
    || ''
  ).trim();
  if (!secret) {
    throw new Error('Set KABBAK_KEY_ENCRYPTION_SECRET to encrypt saved API keys.');
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  const buf = Buffer.from(String(payload || ''), 'base64');
  if (buf.length < 29) throw new Error('invalid ciphertext');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getSecretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function maskKey(apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (_error) {
    cache = { users: {} };
  }
  if (!cache || typeof cache !== 'object') cache = { users: {} };
  if (!cache.users || typeof cache.users !== 'object') cache.users = {};
  return cache;
}

function save() {
  const dir = path.dirname(STORE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const payload = `${JSON.stringify(cache, null, 2)}\n`;
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, payload);
  try {
    fs.renameSync(tmp, STORE_PATH);
  } catch (_error) {
    fs.copyFileSync(tmp, STORE_PATH);
    try { fs.unlinkSync(tmp); } catch (_cleanup) { /* ignore */ }
  }
}

function getRecord(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const data = load();
  for (const key of lookupKeys(id)) {
    const record = data.users[key];
    if (record && typeof record === 'object') {
      if (key !== id) {
        data.users[id] = record;
        delete data.users[key];
        save();
        return data.users[id];
      }
      return record;
    }
  }
  return null;
}

function upsertRecord(userId, patch) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const data = load();
  let existing = {};
  for (const key of lookupKeys(id)) {
    if (data.users[key] && typeof data.users[key] === 'object') {
      existing = { ...existing, ...data.users[key] };
      if (key !== id) delete data.users[key];
    }
  }
  const next = {
    ...existing,
    ...patch,
    platform: String(id.split(':')[0] || existing.platform || ''),
    updatedAt: new Date().toISOString(),
  };
  data.users[id] = next;
  save();
  return next;
}

function getApiKey(userId) {
  const record = getRecord(userId);
  if (!record?.apiKey) return '';
  try {
    return decrypt(record.apiKey);
  } catch (_error) {
    return '';
  }
}

function hasApiKey(userId) {
  return Boolean(getRecord(userId)?.apiKey);
}

function setApiKey(userId, apiKey, meta = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('API key is empty.');
  return upsertRecord(userId, {
    apiKey: encrypt(key),
    apiKeyHint: maskKey(key),
    accountName: String(meta.accountName || '').trim(),
    clientId: String(meta.clientId || '').trim(),
    accessLevel: String(meta.accessLevel || '').trim(),
  });
}

function clearApiKey(userId) {
  const record = getRecord(userId);
  if (!record) return null;
  return upsertRecord(userId, {
    apiKey: '',
    apiKeyHint: '',
    accountName: '',
    clientId: '',
    accessLevel: '',
  });
}

function getLocation(userId) {
  const location = getRecord(userId)?.location;
  if (!location || typeof location !== 'object') return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    latitude,
    longitude,
    label: String(location.label || '').trim(),
  };
}

function setLocation(userId, location) {
  return upsertRecord(userId, {
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      label: String(location.label || '').trim(),
    },
  });
}

function clearLocation(userId) {
  return upsertRecord(userId, { location: null });
}

module.exports = {
  accountId,
  maskKey,
  getRecord,
  getApiKey,
  hasApiKey,
  setApiKey,
  clearApiKey,
  getLocation,
  setLocation,
  clearLocation,
};
