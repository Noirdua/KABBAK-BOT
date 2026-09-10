const axios = require('axios');
const userStore = require('./user-store');

const API_BASE = process.env.KABBAK_API_URL || 'http://localhost:3100/api/v1';
const API_KEY = process.env.KABBAK_API_KEY || '';
const REQUEST_TIMEOUT_MS = 15000;

function apiHeaders(apiKey) {
  const key = String(apiKey || API_KEY || '').trim();
  return key ? { 'x-api-key': key } : {};
}

function isPersonalKey(apiKey) {
  const key = String(apiKey || '').trim();
  const botKey = String(API_KEY || '').trim();
  return Boolean(key) && key !== botKey;
}

function resolveUserApiKey(userId) {
  return userStore.getApiKey(userId) || API_KEY;
}

function friendlyApiError(err, usedPersonalKey) {
  const status = err.response?.status;
  const code = err.code;
  if (status === 401 || status === 403) {
    return new Error(usedPersonalKey
      ? 'Your saved API key was rejected. Update it with **/kabbak api login**.'
      : 'The bot could not authenticate with KABBAK. Save your own key with **/kabbak api login**.');
  }
  if (status === 429) {
    return new Error('KABBAK is rate-limiting requests. Wait a moment and try again.');
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return new Error('Could not reach the KABBAK API right now. Try again in a moment.');
  }
  const msg = err.response?.data?.message || err.response?.data?.error || err.message;
  return new Error(msg || 'API request failed.');
}

async function apiGet(path, params = {}, apiKey = API_KEY) {
  try {
    const res = await axios.get(`${API_BASE}${path}`, {
      params,
      timeout: REQUEST_TIMEOUT_MS,
      headers: apiHeaders(apiKey),
    });
    return res.data;
  } catch (err) {
    throw friendlyApiError(err, isPersonalKey(apiKey));
  }
}

async function apiPatch(path, body = {}, apiKey = API_KEY) {
  try {
    const res = await axios.patch(`${API_BASE}${path}`, body, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: apiHeaders(apiKey),
    });
    return res.data;
  } catch (err) {
    throw friendlyApiError(err, isPersonalKey(apiKey));
  }
}

async function verifyApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (key.length < 4) {
    throw new Error('That does not look like an API key. Paste the full key from KABBAK.');
  }
  let payload;
  try {
    const res = await axios.get(`${API_BASE}/health`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: apiHeaders(key),
    });
    payload = res.data?.data || res.data || {};
  } catch (err) {
    throw friendlyApiError(err, true);
  }
  const auth = payload.auth || {};
  if (auth.authenticated !== true) {
    throw new Error('That API key was not accepted. Check it and try again.');
  }
  let profile = null;
  try {
    const profRes = await axios.get(`${API_BASE}/profile`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: apiHeaders(key),
    });
    profile = profRes.data?.data || profRes.data || null;
  } catch (_error) {
    profile = null;
  }
  return {
    name: String(auth.name || profile?.authName || profile?.displayName || '').trim(),
    clientId: String(auth.clientId || '').trim(),
    accessLevel: String(auth.accessLevel || '').trim(),
    profile,
  };
}

function buildAssetUrl(assetPath, { includeKey = true } = {}) {
  let relative = String(assetPath || '').trim();
  try {
    relative = decodeURIComponent(relative);
  } catch (_error) {
    // already decoded
  }
  relative = relative.replace(/^\/+/, '').replace(/^asset\//i, '');
  if (!relative) return '';
  const encoded = relative.split(/[/\\]+/).filter(Boolean).map(encodeURIComponent).join('/');
  const base = String(API_BASE || '').replace(/\/+$/, '');
  const url = `${base}/assets/${encoded}`;
  if (!includeKey || !API_KEY) return url;
  return `${url}?apiKey=${encodeURIComponent(API_KEY)}`;
}

async function fetchAssetBuffer(url) {
  const target = String(url || '').trim();
  if (!target) throw new Error('missing asset url');
  const res = await axios.get(target, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 20_000_000,
    headers: {
      ...apiHeaders(API_KEY),
      Accept: 'image/png,image/jpeg,image/*,*/*',
    },
  });
  const buf = Buffer.from(res.data || []);
  if (buf.length < 32) throw new Error('empty asset');
  const ctype = String(res.headers['content-type'] || '');
  if (ctype.includes('json') || ctype.includes('text/html')) {
    throw new Error(`asset was ${ctype || 'not an image'}`);
  }
  return buf;
}

async function resolveCardImageUrl(cardId, deckId) {
  try {
    const params = {};
    const deck = String(deckId || '').trim();
    if (deck) params.deckId = deck;
    const data = await apiGet(`/tarot/cards/${encodeURIComponent(cardId)}/image`, params);
    const info = data.data || data;
    if (!info?.found) return '';
    return buildAssetUrl(info.assetPath);
  } catch (_error) {
    return '';
  }
}

module.exports = {
  API_BASE,
  API_KEY,
  apiGet,
  apiPatch,
  verifyApiKey,
  buildAssetUrl,
  fetchAssetBuffer,
  resolveCardImageUrl,
  resolveUserApiKey,
  isPersonalKey,
};
