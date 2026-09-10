const crypto = require('crypto');
const userStore = require('./user-store');
const { card, truncate, cmd } = require('./cards');
const { stitchSpreadImages } = require('./spread-stitch');
const { renderTattvaPng } = require('./tattva-image');
const { getTextCatalog, resolveChoice } = require('./catalog');
const {
  API_KEY,
  apiGet,
  apiPatch,
  verifyApiKey,
  resolveCardImageUrl,
  resolveUserApiKey,
  isPersonalKey,
} = require('./kabbak-api');

const DEFAULT_LAT = -33.8688;
const DEFAULT_LON = 151.2093;
const DEFAULT_LOCATION_LABEL = 'Sydney (default)';
const PROFILE_LOCATION_TTL_MS = 5 * 60 * 1000;
const QUIZ_TTL_MS = 10 * 60 * 1000;

const profileLocationCache = new Map();
const pendingQuizzes = new Map();

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

async function getSavedProfileLocation(ctx = {}, { force = false } = {}) {
  if (!isPersonalKey(ctx.apiKey)) return null;
  const cacheKey = String(ctx.userId || ctx.apiKey || 'user');
  const now = Date.now();
  const cached = profileLocationCache.get(cacheKey);
  if (!force && cached && now - cached.fetchedAt < PROFILE_LOCATION_TTL_MS) {
    return cached.location;
  }
  try {
    const data = await apiGet('/profile', {}, ctx.apiKey);
    const profile = data.data || data;
    const loc = profile?.location;
    const latitude = Number(loc?.latitude ?? loc?.lat);
    const longitude = Number(loc?.longitude ?? loc?.lng ?? loc?.lon);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
      const location = { latitude, longitude, label: String(loc?.label || '').trim() };
      profileLocationCache.set(cacheKey, { location, fetchedAt: now });
      return location;
    }
    profileLocationCache.set(cacheKey, { location: null, fetchedAt: now });
  } catch (_error) {
    profileLocationCache.set(cacheKey, { location: null, fetchedAt: now });
  }
  return null;
}

function placeFromPayload(data) {
  const place = data?.data && typeof data.data === 'object' ? data.data : data;
  const latitude = Number(place?.latitude);
  const longitude = Number(place?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    label: String(place.label || place.name || '').trim(),
    source: 'place',
  };
}

function isLocationLookupError(error) {
  return /country, region, city, or placeId|Unknown (country|region|city)|invalid_location|location_.*not_found/i
    .test(String(error?.message || ''));
}

async function resolvePlaceArgs(args = {}) {
  const placeId = String(args.location || args.placeId || args.place || '').trim();
  const country = String(args.country || '').trim();
  const region = String(args.region || '').trim();
  const city = String(args.city || '').trim();
  if (!placeId && !country && !region && !city) return null;

  const lookup = async (params) => {
    const data = await apiGet('/locations/resolve', params, args.apiKey);
    return placeFromPayload(data);
  };

  try {
    const direct = await lookup({ placeId, country, region, city });
    if (direct) return direct;
  } catch (error) {
    if (!isLocationLookupError(error)) throw error;
  }

  const query = placeId || city || region || country;
  const resolvedId = await resolveChoice('location', query, { country, region });
  if (resolvedId && resolvedId !== placeId) {
    try {
      const found = await lookup({ placeId: resolvedId });
      if (found) return found;
    } catch (error) {
      if (!isLocationLookupError(error)) throw error;
    }
  }

  throw new Error(`Could not find a place matching '${query}'. Try a city name, e.g. ${cmd(args, 'now Los Angeles')}.`);
}

async function resolveLocation(args = {}) {
  const explicitLat = toOptionalNumber(args.latitude);
  const explicitLon = toOptionalNumber(args.longitude);
  if (Number.isFinite(explicitLat) && Number.isFinite(explicitLon)) {
    return { latitude: explicitLat, longitude: explicitLon, label: '', source: 'command' };
  }
  try {
    const place = await resolvePlaceArgs(args);
    if (place) return place;
  } catch (_error) {
    if (args.location || args.placeId || args.country || args.region || args.city) throw _error;
  }
  const local = args.userId ? userStore.getLocation(args.userId) : null;
  if (local) return { ...local, source: 'saved' };
  const saved = await getSavedProfileLocation(args);
  if (saved) return { ...saved, source: 'profile' };
  return { latitude: DEFAULT_LAT, longitude: DEFAULT_LON, label: DEFAULT_LOCATION_LABEL, source: 'default' };
}

function describeLocation(location, ctx = {}) {
  const coords = `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
  if (location.source === 'command') return `${coords} (this command)`;
  if (location.source === 'place') {
    return location.label ? `${location.label} — ${coords}` : `${coords} (place)`;
  }
  if (location.source === 'saved') {
    return location.label ? `${location.label} — ${coords} (your saved location)` : `${coords} (your saved location)`;
  }
  if (location.source === 'profile') {
    return location.label ? `${location.label} — ${coords} (KABBAK profile)` : `${coords} (KABBAK profile)`;
  }
  return `${coords} — ${DEFAULT_LOCATION_LABEL}. Save yours with ${cmd(ctx, 'location set')}`;
}

function unwrapTarotCard(data) {
  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  if (payload?.card && typeof payload.card === 'object') {
    return { card: payload.card, relations: payload.relations || null };
  }
  return { card: payload || {}, relations: payload?.relations || null };
}

function formatHebrewLetter(letter) {
  if (!letter) return '';
  if (typeof letter === 'string') return letter;
  return [letter.char, letter.name, letter.transliteration].filter(Boolean).join(' · ');
}

function relationLabels(relations, types) {
  const wanted = new Set((Array.isArray(types) ? types : [types]).filter(Boolean));
  const groups = relations && typeof relations === 'object' ? relations : {};
  const lists = [
    groups.all,
    groups.elements,
    groups.zodiacRulership,
    groups.tetragrammaton,
    groups.cube,
    groups.iChing,
    groups.monthReferences,
    groups.base,
  ];
  const rows = lists.flatMap((list) => (Array.isArray(list) ? list : []));
  return rows
    .filter((row) => row && (!wanted.size || wanted.has(row.type)))
    .map((row) => String(row.label || row.name || row.id || '').trim())
    .filter(Boolean)
    .filter((label, index, all) => all.indexOf(label) === index);
}

function formatDateCorrespondences(relations, drawn) {
  const lines = [];
  const months = Array.isArray(relations?.monthReferences) ? [...relations.monthReferences] : [];
  months
    .sort((a, b) => (Number(a?.order) || 999) - (Number(b?.order) || 999))
    .forEach((month) => {
      const name = String(month?.name || month?.id || '').trim();
      const range = String(month?.dateRange || '').trim();
      const context = String(month?.context || '').trim();
      const parts = [];
      if (name) parts.push(name);
      if (range && range !== name) parts.push(range);
      if (context) parts.push(context);
      const line = parts.join(' · ');
      if (line && !lines.includes(line)) lines.push(line);
    });
  [
    ...relationLabels(relations, 'courtDateWindow'),
    ...relationLabels(relations, 'calendarMonth'),
    ...relationLabels({ all: drawn?.relations }, 'courtDateWindow'),
    ...relationLabels({ all: drawn?.relations }, 'calendarMonth'),
  ].forEach((label) => {
    if (label && !lines.includes(label)) lines.push(label);
  });
  return lines.slice(0, 8);
}

function cardMeaning(drawn, reversed = false) {
  const meanings = drawn?.meanings && typeof drawn.meanings === 'object' ? drawn.meanings : {};
  if (reversed) {
    return String(meanings.reversed || drawn?.meaning || drawn?.summary || '').trim();
  }
  return String(meanings.upright || drawn?.meaning || drawn?.summary || '').trim();
}

async function handleTarot(args = {}) {
  const action = args.action || 'pull';
  try {
    if (action === 'cards') {
      const q = args.card || args.q;
      const data = await apiGet('/tarot/cards', q ? { q } : {}, args.apiKey);
      const cards = data.data || data.results || data || [];
      const list = cards.slice(0, 10).map((c) => `**${c.id}** — ${c.name} (${c.arcana})`).join('\n');
      return card('Tarot Cards', list || 'No cards found.', [
        { name: 'Total', value: String(cards.length || 0), inline: true },
      ]);
    }
    if (action === 'spreads') {
      const data = await apiGet('/tarot/spreads', {}, args.apiKey);
      const spreads = data.data || data || [];
      const list = spreads.map((s) => `**${s.id}** — ${s.name || s.id} (${s.cardCount || '?'} cards)`).join('\n');
      return card('Available Spreads', list || 'None');
    }
    if (action === 'pull' || action === 'draw') {
      const spreadId = args.spread || 'three-card';
      const data = await apiGet(`/tarot/spreads/${encodeURIComponent(spreadId)}/pull`, args.reversed ? { reversed: true } : {}, args.apiKey);
      const spread = data.data || data;
      const positions = spread.positions || [];
      const drawnCards = await Promise.all(positions.map(async (p, i) => {
        const label = p.position?.label || p.position?.pos || p.label || 'Card';
        const drawn = unwrapTarotCard(p.card || p).card;
        const meaning = cardMeaning(drawn, Boolean(p.reversed));
        const imageUrl = drawn?.id ? await resolveCardImageUrl(drawn.id, args.deck) : '';
        return {
          index: i,
          pos: p.position?.pos || p.pos || '',
          label,
          name: drawn.name || drawn.id || '?',
          reversed: Boolean(p.reversed),
          meaning,
          imageUrl,
        };
      }));
      const shouldStitch = args.stitch !== false;
      if (shouldStitch) {
        const buffer = await stitchSpreadImages(drawnCards, {
          spreadId,
          title: spread.name || spreadId,
          description: spread.description || '',
          footer: args.deck ? `Deck: ${args.deck}` : '',
        });
        if (buffer) {
          return card('', '', [], {
            type: 'image',
            imageOnly: true,
            imageUrl: 'attachment://spread.jpg',
            attachment: { name: 'spread.jpg', buffer, contentType: 'image/jpeg' },
          });
        }
      }
      const cardEmbeds = drawnCards.map((entry) => card(
        `${entry.index + 1}. ${entry.label}${entry.reversed ? ' (reversed)' : ''} — ${entry.name}`,
        truncate(entry.meaning, 1500),
        [],
        { imageUrl: entry.imageUrl, footer: args.deck ? `Deck: ${args.deck}` : '' }
      ));
      if (spread.description) {
        cardEmbeds.unshift(card(`Tarot: ${spread.name || spreadId}`, spread.description));
      }
      return cardEmbeds;
    }
    return card('Tarot', 'Unknown action. Use cards, spreads, or pull.');
  } catch (e) {
    return card('Tarot Error', e.message);
  }
}

async function handleTarotCard(cardName, apiKey = API_KEY, ctx = {}) {
  try {
    const name = String(cardName || '').trim();
    if (!name) return card('Tarot Card', `Provide a card id or name, e.g. ${cmd(ctx, 'tarot card name:The Empress')}`);

    let payload = null;
    try {
      payload = unwrapTarotCard(await apiGet(`/tarot/cards/${encodeURIComponent(name)}`, {}, apiKey));
    } catch (_error) {
      payload = null;
    }
    if (!payload?.card?.name) {
      const search = await apiGet('/tarot/cards', { q: name, limit: 8 }, apiKey);
      const matches = Array.isArray(search?.data) ? search.data : [];
      const exact = matches.find((entry) => String(entry.id) === name || String(entry.name).toLowerCase() === name.toLowerCase());
      const picked = exact || matches[0];
      if (picked?.id) {
        payload = unwrapTarotCard(await apiGet(`/tarot/cards/${encodeURIComponent(picked.id)}`, {}, apiKey));
      }
    }

    const drawn = payload?.card || {};
    if (!drawn.name && !drawn.id) {
      return card('Tarot Card', `No card matched '${name}'. Try the autocomplete list.`);
    }

    const relations = payload?.relations || {};
    const typeLabel = String(relations.typeLabel || '').trim()
      || (drawn.arcana === 'Major'
        ? `Major Arcana${drawn.number != null ? ` · ${drawn.number}` : ''}`
        : ['Minor Arcana', drawn.suit, drawn.rank].filter(Boolean).join(' · '));
    const hebrew = formatHebrewLetter(drawn.hebrewLetter);
    const keywords = Array.isArray(drawn.keywords) ? drawn.keywords.filter(Boolean).join(', ') : '';
    const upright = cardMeaning(drawn, false);
    const reversed = String(drawn.meanings?.reversed || '').trim();
    const correspondences = [
      ...relationLabels(relations, 'planet'),
      ...relationLabels(relations, 'element'),
      ...relationLabels(relations, 'zodiac'),
      ...relationLabels(relations, 'sign'),
      ...relationLabels(relations, 'hebrewLetter'),
    ].slice(0, 6);

    const fields = [
      { name: 'Type', value: typeLabel || '—', inline: true },
      { name: 'Arcana', value: String(drawn.arcana || '—'), inline: true },
    ];
    if (drawn.number != null && drawn.number !== '') {
      fields.push({ name: 'Number', value: String(drawn.number), inline: true });
    }
    if (drawn.suit) fields.push({ name: 'Suit', value: String(drawn.suit), inline: true });
    if (drawn.rank) fields.push({ name: 'Rank', value: String(drawn.rank), inline: true });
    if (hebrew) fields.push({ name: 'Hebrew', value: hebrew, inline: true });
    if (keywords) fields.push({ name: 'Keywords', value: keywords, inline: false });
    if (upright) fields.push({ name: 'Upright', value: truncate(upright, 1024), inline: false });
    if (reversed) fields.push({ name: 'Reversed', value: truncate(reversed, 1024), inline: false });
    if (correspondences.length) {
      fields.push({ name: 'Correspondences', value: correspondences.join('\n'), inline: false });
    }
    const dates = formatDateCorrespondences(relations, drawn);
    if (dates.length) {
      fields.push({ name: 'Dates', value: dates.join('\n'), inline: false });
    }

    const imageUrl = drawn.id ? await resolveCardImageUrl(drawn.id, ctx.deck) : '';
    const footerParts = [
      drawn.id && drawn.id !== drawn.name ? String(drawn.id) : '',
      ctx.deck ? `deck ${ctx.deck}` : '',
    ].filter(Boolean);
    return card(
      drawn.name || name,
      truncate(drawn.summary || '', 1500),
      fields,
      { imageUrl, footer: footerParts.join(' · ') }
    );
  } catch (e) {
    return card('Tarot Card Error', e.message);
  }
}

async function handleNow(args = {}) {
  try {
    const location = await resolveLocation(args);
    const params = { latitude: location.latitude, longitude: location.longitude };
    if (args.date) params.date = String(args.date);
    const data = await apiGet('/now', params, args.apiKey);
    const snap = data.data || data;
    const fields = [];
    if (snap.currentHour) {
      const ch = snap.currentHour;
      fields.push({
        name: 'Current Hour',
        value: `${ch.planet?.symbol || ''} ${ch.planet?.name || ch.planetId} (${ch.isDaylight ? 'day' : 'night'})`,
        inline: true,
      });
      if (ch.msRemaining) {
        fields.push({ name: 'Ends in', value: `${Math.floor(ch.msRemaining / 60000)} min`, inline: true });
      }
    }
    if (snap.moon) {
      const illumination = Number(snap.moon.illuminationFraction);
      const percent = Number.isFinite(illumination) ? `${(illumination * 100).toFixed(0)}%` : '?';
      fields.push({ name: 'Moon', value: `${snap.moon.phase} (${percent})`, inline: true });
    }
    if (snap.decan?.sign) {
      fields.push({
        name: 'Sun Decan',
        value: `${snap.decan.sign.symbol || ''} ${snap.decan.sign.name} Decan ${snap.decan.decan?.index || ''}`,
        inline: true,
      });
    }
    (snap.stats?.planetPositions || []).slice(0, 6).forEach((p) => {
      fields.push({
        name: p.name || p.id,
        value: `${p.symbol || ''} ${p.sign?.symbol || ''} ${p.sign?.name || ''} ${p.degreeInSign?.toFixed(1) || ''}°`,
        inline: true,
      });
    });
    const anchor = args.date ? `Date: ${String(args.date)}\n` : '';
    return card('Now Snapshot', `${anchor}Location: ${describeLocation(location, args)}`, fields);
  } catch (e) {
    return card('Now Error', e.message);
  }
}

async function handleCalendar(args = {}) {
  try {
    const location = await resolveLocation(args);
    const data = await apiGet('/calendar/week-events', {
      latitude: location.latitude,
      longitude: location.longitude,
    }, args.apiKey);
    const payload = data.data || data || {};
    const events = payload.events || [];
    const lines = events.slice(0, 12).map((e) => {
      if (e.kind === 'moon') return `🌕 ${e.moonPhase} — ${new Date(e.start).toLocaleDateString()}`;
      if (e.kind === 'planetaryHour') return `🪐 ${e.planetId} ${e.isDaylight ? '☀' : '☾'}`;
      if (e.kind === 'sun') return `☉ ${e.signId || ''}`;
      return null;
    }).filter(Boolean).slice(0, 10);
    return card('Week Events', `Location: ${describeLocation(location, args)}\n\n${lines.join('\n') || 'No events'}`);
  } catch (e) {
    return card('Calendar Error', e.message);
  }
}

async function handleLocation(args = {}) {
  try {
    const action = args.action || 'view';
    if (action === 'clear') {
      userStore.clearLocation(args.userId);
      if (isPersonalKey(args.apiKey)) profileLocationCache.delete(String(args.userId || ''));
      return card('Location Cleared', `${cmd(args, 'now')} and ${cmd(args, 'calendar')} will fall back to ${DEFAULT_LOCATION_LABEL} until you save a new one.`);
    }
    if (action === 'set') {
      let lat = toOptionalNumber(args.latitude);
      let lon = toOptionalNumber(args.longitude);
      let label = String(args.label || '').trim();
      const body = { latitude: lat, longitude: lon, label };
      if (args.country) body.country = String(args.country).trim();
      if (args.region) body.region = String(args.region).trim();
      if (args.city) body.city = String(args.city).trim();
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        const place = await resolvePlaceArgs(args);
        if (!place) {
          return card('Location Error', `Could not match that place. Try a city name, e.g. ${cmd(args, 'location set Los Angeles')}.`);
        }
        lat = place.latitude;
        lon = place.longitude;
        if (!label) label = place.label;
        body.latitude = lat;
        body.longitude = lon;
        body.label = label;
      }
      userStore.setLocation(args.userId, { latitude: lat, longitude: lon, label });
      if (isPersonalKey(args.apiKey)) {
        try {
          await apiPatch('/profile/location', body, args.apiKey);
          profileLocationCache.set(String(args.userId || ''), {
            location: { latitude: lat, longitude: lon, label },
            fetchedAt: Date.now(),
          });
        } catch (error) {
          return card('Location Saved', `${label ? `${label} — ` : ''}${lat.toFixed(4)}, ${lon.toFixed(4)}\n\nSaved on this chat account. Could not also update your KABBAK profile — ${String(error.message || 'profile update failed')}`);
        }
      }
      return card('Location Saved', `${label ? `${label} — ` : ''}${lat.toFixed(4)}, ${lon.toFixed(4)}\n\n${cmd(args, 'now')} and ${cmd(args, 'calendar')} will use this when you omit coordinates.`);
    }
    const location = await resolveLocation(args);
    if (location.source === 'default') {
      return card('Saved Location', `No location saved yet. ${cmd(args, 'now')} and ${cmd(args, 'calendar')} fall back to ${DEFAULT_LOCATION_LABEL}.\n\nSave one with **${cmd(args, 'location set')}**.`);
    }
    return card('Saved Location', describeLocation(location, args));
  } catch (e) {
    return card('Location Error', e.message);
  }
}

function renderHexagramLines(lineDiagram) {
  const chars = String(lineDiagram || '').split('');
  if (chars.length !== 6) return '';
  const lines = chars.slice().reverse().map((ch, i) => {
    const number = 6 - i;
    const glyph = ch === '|' ? '━━━━━' : '━━ ━━';
    return `${number} ${glyph}`;
  });
  return '```\n' + lines.join('\n') + '\n```';
}

function tattvaDisplayName(entry) {
  if (!entry) return '';
  if (typeof entry.name === 'string') return entry.name;
  return String(entry.name?.en || entry.id || '').trim();
}

function parseHexColor(value) {
  const hex = String(value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return NaN;
  return Number.parseInt(hex, 16);
}

async function handleTattva(args = {}) {
  const requested = String(args.tattva || args.name || args.query || '').trim();
  try {
    if (!requested) {
      const data = await apiGet('/tattvas', {}, args.apiKey);
      const payload = data.data || data;
      const list = (Array.isArray(payload) ? payload : Object.values(payload || {}))
        .filter((entry) => entry && entry.kind === 'primary');
      const lines = list.map((entry) => {
        const name = tattvaDisplayName(entry);
        return `**${name}** — ${entry.colorName || ''} ${entry.shape || ''} · ${entry.elementName || ''}`.replace(/\s+/g, ' ').trim();
      });
      return card('Golden Dawn Tattvas', lines.join('\n') || 'No tattvas found.', [
        { name: 'Lookup', value: `${cmd(args, 'tattva tattva:akasha')} or a compound like tejas-of-vayu`, inline: false },
      ]);
    }
    const data = await apiGet(`/tattvas/${encodeURIComponent(requested)}`, {}, args.apiKey);
    const tattva = data.data || data;
    const name = tattvaDisplayName(tattva);
    const fields = [];
    if (tattva.sanskrit) fields.push({ name: 'Sanskrit', value: String(tattva.sanskrit), inline: true });
    if (tattva.elementName) fields.push({ name: 'Element', value: String(tattva.elementName), inline: true });
    if (tattva.shape) fields.push({ name: 'Shape', value: String(tattva.shape), inline: true });
    if (tattva.colorName) fields.push({ name: 'Color', value: String(tattva.colorName), inline: true });
    if (tattva.tanmatra) fields.push({ name: 'Tanmatra', value: String(tattva.tanmatra), inline: true });
    if (tattva.quality) fields.push({ name: 'Quality', value: String(tattva.quality), inline: true });
    if (tattva.kind === 'compound') {
      const parts = [tattva.childId, tattva.parentId].filter(Boolean);
      if (parts.length) fields.push({ name: 'Compound', value: `${tattva.childId} on ${tattva.parentId}`, inline: false });
    }
    const color = parseHexColor(tattva.color);
    let attachment = null;
    try {
      const catalogData = await apiGet('/tattvas', {}, args.apiKey);
      const catalogPayload = catalogData.data || catalogData;
      const catalog = {};
      (Array.isArray(catalogPayload) ? catalogPayload : Object.values(catalogPayload || {})).forEach((entry) => {
        if (entry?.id) catalog[entry.id] = entry;
      });
      const buffer = await renderTattvaPng(tattva, catalog);
      attachment = { name: 'tattva.png', buffer, contentType: 'image/png' };
    } catch (_error) {
      attachment = null;
    }
    return card(`Tattva: ${name}`, String(tattva.summary || ''), fields, {
      ...(Number.isFinite(color) ? { color } : {}),
      imageUrl: attachment ? 'attachment://tattva.png' : '',
      attachment,
    });
  } catch (error) {
    return card('Tattva', error.message || 'Could not look up that tattva.');
  }
}

async function handleIChing(args = {}) {
  const requested = toOptionalNumber(args.number);
  const number = Number.isFinite(requested) && requested >= 1 && requested <= 64
    ? Math.trunc(requested)
    : 1 + Math.floor(Math.random() * 64);
  try {
    const data = await apiGet(`/iching/hexagrams/${number}`, {}, args.apiKey);
    const hex = data.data || data;
    const fields = [];
    if (hex.pinyin || hex.chineseName) {
      fields.push({ name: 'Chinese', value: [hex.chineseName, hex.pinyin].filter(Boolean).join(' · '), inline: true });
    }
    fields.push({ name: 'Trigrams', value: `${hex.lowerTrigram || '?'} below · ${hex.upperTrigram || '?'} above`, inline: true });
    if (hex.planetaryInfluence) fields.push({ name: 'Planet', value: hex.planetaryInfluence, inline: true });
    if (hex.lineDiagram) {
      fields.push({ name: 'Lines', value: renderHexagramLines(hex.lineDiagram) + (hex.binary ? `Binary: ${hex.binary}` : '') });
    }
    if (Array.isArray(hex.keywords) && hex.keywords.length) {
      fields.push({ name: 'Keywords', value: hex.keywords.join(', ') });
    }
    return card(`I-Ching: ${number} ${hex.name}`, [hex.judgement, hex.image].filter(Boolean).join('\n'), fields);
  } catch (e) {
    try {
      const listData = await apiGet('/iching', {}, args.apiKey);
      const payload = listData.data || listData;
      const hexagrams = Array.isArray(payload?.hexagrams) ? payload.hexagrams : [];
      const sample = hexagrams.length ? `1-${hexagrams.length} (e.g. ${hexagrams[0].number} ${hexagrams[0].name})` : 'a valid number';
      return card('I-Ching', `Could not cast a hexagram (${e.message}). Try a number ${sample}.`);
    } catch {
      return card('I-Ching Error', e.message);
    }
  }
}

async function handleGematria(args = {}) {
  try {
    const value = toOptionalNumber(args.value);
    if (!Number.isFinite(value) || value < 0) {
      return card('Gematria', `Provide a non-negative integer value, e.g. ${cmd(args, 'gematria value:111')}`);
    }
    const data = await apiGet('/gematria/words', { value: String(Math.trunc(value)) }, args.apiKey);
    const payload = data.data || data;
    const matches = Array.isArray(payload?.matches) ? payload.matches : [];
    if (!matches.length) {
      return card(`Gematria: ${Math.trunc(value)}`, 'No words in the index carry this value.', [
        { name: 'Value', value: String(Math.trunc(value)), inline: true },
      ]);
    }
    const lines = matches.slice(0, 15).map((m) => {
      const name = m.word || m.name || m.id;
      const definition = m.definition ? ` — ${truncate(m.definition, 80)}` : '';
      const ciphers = Array.isArray(m.ciphers) && m.ciphers.length ? ` [${m.ciphers.map((c) => c.name).join(', ')}]` : '';
      return `**${name}**${definition}${ciphers}`;
    }).join('\n');
    return card(`Gematria: ${Math.trunc(value)}`, lines || 'No matches', [
      { name: 'Matches', value: String(matches.length), inline: true },
    ]);
  } catch (e) {
    return card('Gematria Error', e.message);
  }
}

async function handleSearch(query, ctx = {}) {
  try {
    const sourceId = String(ctx.source || '').trim();
    const workId = String(ctx.work || '').trim();
    const params = { q: query, limit: 5 };
    if (sourceId) params.sourceId = sourceId;
    if (workId) params.workId = workId;
    const data = await apiGet('/texts/search', params, ctx.apiKey);
    const payload = data.data || data;
    const results = payload?.matches || data.results || [];
    const fields = results.map((r) => ({
      name: `${r.reference || r.id || ''} — ${r.sourceTitle || r.sourceShortTitle || r.sourceId || ''}${r.workTitle ? ` · ${r.workTitle}` : ''}${r.sectionTitle ? ` · ${r.sectionTitle}` : ''}`,
      value: truncate(r.text || r.preview || '', 1024),
      inline: false,
    }));
    const label = String(query || '').trim();
    const titled = label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
    const scopeSource = payload?.scope?.source?.title || payload?.scope?.source?.id || sourceId;
    const scopeWork = results[0]?.workTitle || workId;
    const scopeParts = [];
    if (sourceId && scopeSource) scopeParts.push(scopeSource);
    if (workId && scopeWork) scopeParts.push(scopeWork);
    const scopeLine = scopeParts.length ? `In ${scopeParts.join(' · ')}` : '';
    return card(
      titled ? `Text Search: ${titled}` : 'Text Search',
      results.length ? scopeLine : (scopeLine ? `No results. ${scopeLine}` : 'No results'),
      fields
    );
  } catch (e) {
    return card('Search Error', e.message);
  }
}

async function handleTextSources() {
  try {
    const catalog = await getTextCatalog();
    const sources = Array.isArray(catalog?.sources) ? catalog.sources : [];
    const lines = sources.map((source) => {
      const workCount = Array.isArray(source.works) ? source.works.length : 0;
      const verseCount = Number(source.stats?.verseCount) || 0;
      return `**${source.title}** (${source.id}) — ${workCount} work(s), ${verseCount} verses`;
    });
    return card('Text Sources', lines.join('\n') || 'No sources', [
      { name: 'Sources', value: String(sources.length), inline: true },
    ]);
  } catch (e) {
    return card('Text Sources Error', e.message);
  }
}

async function handleTextSection(args = {}) {
  const sourceId = String(args.sourceId || args.source || '').trim();
  const workId = String(args.workId || args.work || '').trim();
  const sectionId = String(args.sectionId || args.section || '').trim();
  if (!sourceId || !workId || !sectionId) {
    return card('Text', `Pick a source, work, and section, e.g. ${cmd(args, 'text section')}.`);
  }
  try {
    const data = await apiGet(
      `/texts/${encodeURIComponent(sourceId)}/works/${encodeURIComponent(workId)}/sections/${encodeURIComponent(sectionId)}`,
      {},
      args.apiKey
    );
    const payload = data.data || data;
    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    if (!verses.length) return card(payload.section?.title || sectionId, 'This section has no verses.');

    const MAX_VERSES = 3;
    const rawVerse = String(args.verse || '').trim();
    let selected = [];
    let note = '';
    if (!rawVerse) {
      selected = [verses[Math.floor(Math.random() * verses.length)]];
      note = `Random verse (section has ${verses.length}).`;
    } else {
      const rangeMatch = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(rawVerse);
      if (!rangeMatch) {
        return card(payload.section?.title || sectionId,
          `Invalid verse selector '${rawVerse}'. Use a number (e.g. verse:4) or a range (e.g. verse:3-6). This section has verses 1-${verses.length}.`);
      }
      const start = Number(rangeMatch[1]);
      const end = rangeMatch[2] ? Number(rangeMatch[2]) : start;
      if (start < 1 || end < start || start > verses.length) {
        return card(payload.section?.title || sectionId,
          `Verse range ${start}-${end} is outside this section (1-${verses.length}).`);
      }
      const endClamped = Math.min(end, verses.length);
      let chosen = verses.slice(start - 1, endClamped);
      if (chosen.length > MAX_VERSES) {
        chosen = chosen.slice(0, MAX_VERSES);
        note = `Showing the first ${MAX_VERSES} of ${endClamped - start + 1} requested verses (${MAX_VERSES} verse max).`;
      } else {
        note = end !== endClamped
          ? `Clamped to the section end (${verses.length} verses).`
          : `${chosen.length} verse${chosen.length > 1 ? 's' : ''}.`;
      }
      selected = chosen;
    }
    return card(payload.section?.title || payload.work?.title || sectionId, note, selected.map((verse) => ({
      name: String(verse.reference || `Verse ${verse.number ?? verse.id ?? ''}`),
      value: truncate(String(verse.text || ''), 1024),
      inline: false,
    })));
  } catch (e) {
    return card('Text Error', e.message);
  }
}

async function handleDecks(apiKey = API_KEY) {
  try {
    const data = await apiGet('/decks', {}, apiKey);
    const decks = data.data?.decks || data.decks || data.data || [];
    const list = decks.map((d) => `**${d.id}** — ${d.name || d.title || ''}`).join('\n');
    return card('Tarot Decks', list || 'No decks registered');
  } catch (e) {
    return card('Decks Error', e.message);
  }
}

async function handleStatus(args = {}) {
  try {
    const data = await apiGet('/health', {}, args.apiKey);
    const h = data.data || data;
    const auth = h.auth || {};
    const personal = isPersonalKey(args.apiKey);
    const record = args.userId ? userStore.getRecord(args.userId) : null;
    const fields = [
      { name: 'Service', value: h.service || 'kabbak-api', inline: true },
      { name: 'Version', value: h.version || '?', inline: true },
      { name: 'Uptime', value: `${h.uptimeSeconds || 0}s`, inline: true },
      { name: 'Your key', value: personal ? `Saved (${record?.apiKeyHint || '••••'})` : 'Using the shared bot key', inline: true },
    ];
    if (personal && (auth.name || record?.accountName)) {
      fields.push({ name: 'Account', value: auth.name || record.accountName, inline: true });
    }
    if (personal && auth.accessLevel) {
      fields.push({ name: 'Access', value: String(auth.accessLevel), inline: true });
    }
    const desc = personal
      ? 'Commands run as your KABBAK account.'
      : `Commands use the shared bot key. Save your own with **${cmd(args, 'api login')}** to use your profile and access.`;
    return card('KABBAK API Status', desc, fields);
  } catch (e) {
    return card('Status Error', e.message);
  }
}

async function handleApiStatus(ctx = {}) {
  const record = userStore.getRecord(ctx.userId);
  const personalKey = userStore.getApiKey(ctx.userId);
  if (!personalKey) {
    return card('API Key', `You do not have a saved key. Commands currently use the shared bot key.\n\nSave yours with **${cmd(ctx, 'api login')}** — the key is collected privately and never shown in chat.`, [], { ephemeral: true });
  }
  const fields = [{ name: 'Key', value: record?.apiKeyHint || '••••', inline: true }];
  if (record?.accountName) fields.push({ name: 'Account', value: record.accountName, inline: true });
  if (record?.accessLevel) fields.push({ name: 'Access', value: record.accessLevel, inline: true });
  try {
    const info = await verifyApiKey(personalKey);
    if (info.name) fields.push({ name: 'Live account', value: info.name, inline: true });
    return card('API Key', `Your key is saved and currently accepted. All ${cmd(ctx)} commands use it.`, fields, { ephemeral: true });
  } catch (e) {
    return card('API Key', `${e.message}\n\nUpdate it with **${cmd(ctx, 'api login')}**.`, fields, { ephemeral: true });
  }
}

function handleApiLogout(ctx = {}) {
  if (!userStore.hasApiKey(ctx.userId)) {
    return card('API Key', 'No saved key to remove. Commands already use the shared bot key.', [], { ephemeral: true });
  }
  userStore.clearApiKey(ctx.userId);
  profileLocationCache.delete(String(ctx.userId || ''));
  return card('Logged Out', 'Your API key was removed. Commands now use the shared bot key.\n\nYour saved location is unchanged.', [], { ephemeral: true });
}

function requestApiLogin(ctx = {}) {
  return {
    type: 'collect-secret',
    reason: 'api-login',
    title: 'Save your KABBAK API key',
    description: 'Paste your KABBAK API key. It is stored for this chat account and never shown in the room.',
    ephemeral: true,
    prefix: cmd(ctx),
  };
}

async function completeApiLogin(userId, apiKey, ctx = {}) {
  const info = await verifyApiKey(apiKey);
  userStore.setApiKey(userId, apiKey, {
    accountName: info.name,
    clientId: info.clientId,
    accessLevel: info.accessLevel,
  });
  profileLocationCache.delete(String(userId || ''));
  const loc = info.profile?.location;
  const lat = Number(loc?.latitude ?? loc?.lat);
  const lon = Number(loc?.longitude ?? loc?.lng ?? loc?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && !userStore.getLocation(userId)) {
    userStore.setLocation(userId, {
      latitude: lat,
      longitude: lon,
      label: String(loc?.label || '').trim(),
    });
  }
  const who = info.name ? ` as **${info.name}**` : '';
  return card(
    'API Key Saved',
    `Logged in${who}. Your key is stored for this chat account and used for every ${cmd(ctx)} command.\n\nIt is never shown in chat. Use **${cmd(ctx, 'api logout')}** to remove it, or **${cmd(ctx, 'api status')}** to check it.`,
    [],
    { ephemeral: true }
  );
}

async function startQuiz(ctx = {}, categoryId) {
  try {
    const params = { includeAnswer: 'true' };
    if (categoryId) params.categoryId = categoryId;
    const data = await apiGet('/quiz/questions/pull', params, ctx.apiKey);
    const q = data.data || data;
    const options = Array.isArray(q.options) ? q.options : [];
    const quizId = crypto.randomBytes(8).toString('hex');
    const buttons = options.slice(0, 25).map((option, index) => ({
      id: `quiz:${quizId}:${index}`,
      label: truncate(`${index + 1}. ${option || `Option ${index + 1}`}`, 80),
    }));
    if (options.length) {
      pendingQuizzes.set(quizId, {
        prompt: q.prompt || q.text || '',
        category: q.category || q.categoryId || 'general',
        options,
        correctIndex: Number(q.correctIndex) || 0,
      });
      setTimeout(() => pendingQuizzes.delete(quizId), QUIZ_TTL_MS);
    }
    return card(
      'Quiz Question',
      q.prompt || q.question || q.text || 'No question',
      [{ name: 'Category', value: q.category || q.categoryId || 'general' }],
      { type: 'quiz', quizId, footer: 'Anyone can tap an answer.', buttons }
    );
  } catch (e) {
    return card('Quiz Error', e.message);
  }
}

function answerQuiz(quizId, chosenIndex, actorLabel = 'Someone', ctx = {}) {
  const entry = pendingQuizzes.get(String(quizId || ''));
  if (!entry) {
    return card('Quiz', `This quiz expired. Start a new one with ${cmd(ctx, 'quiz')}.`, [], { ephemeral: true });
  }
  const index = Number(chosenIndex);
  const isCorrect = index === entry.correctIndex;
  const chosen = entry.options[index] || '?';
  const correct = entry.options[entry.correctIndex] || '?';
  pendingQuizzes.delete(String(quizId || ''));
  return card('Quiz Question', entry.prompt || '', [
    { name: 'Category', value: entry.category },
    {
      name: isCorrect ? '✅ Correct' : '❌ Wrong',
      value: `${actorLabel} chose: ${chosen}\nCorrect answer: ${correct}`,
    },
  ]);
}

function isTextPrefix(ctx = {}) {
  return !String(ctx.prefix || '/kabbak').startsWith('/');
}

function handleHelp(ctx = {}) {
  const p = (path) => `**${cmd(ctx, path)}**`;
  if (isTextPrefix(ctx)) {
    return card('KABBAK Commands', `Type ${cmd(ctx)} then a command. Use ordinary names — no IDs or quotes needed.`, [
      { name: 'Your API key', value: `${p('api login')} — save your key privately\n${p('api status')} — check it\n${p('api logout')} — remove it`, inline: false },
      { name: 'Tarot', value: `${p('tarot draw')} — 3-card spread as one image (upright)\n${p('tarot draw celtic-cross')}\n${p('tarot draw reverse')} — allow reversed cards\n${p('tarot draw separate')} — one message per card\n${p('tarot card empress')}\n${p('tarot cards fool')}\n${p('tarot spreads')}\nShortcuts: ${p('draw')}, ${p('card empress')}`, inline: false },
      { name: 'Time & location', value: `${p('now')} — saved place, or Sydney\n${p('now Los Angeles')}\n${p('calendar Paris')}\n${p('location set Tokyo')}\n${p('location view')} / ${p('location clear')}`, inline: false },
      { name: 'Library', value: `${p('iching')} or ${p('iching 24')}\n${p('tattva')} or ${p('tattva akasha')}\n${p('gematria 111')}\n${p('quiz')}\n${p('search rose cross')}\n${p('text sources')}`, inline: false },
      { name: 'System', value: `${p('decks')}\n${p('status')}\n${p('help')}`, inline: false },
    ]);
  }
  return card('KABBAK Commands', `Everything lives under ${cmd(ctx)}. Save your own API key once and the bot remembers it.`, [
    { name: 'Your API key', value: `${p('api login')} — save your key privately\n${p('api status')} — check your saved key\n${p('api logout')} — remove it`, inline: false },
    { name: 'Tarot', value: `${p('tarot draw [spread] [deck]')} — one image with cards and meanings (reversed:true to allow reversals; stitch:false for separate cards)\n${p('tarot card name: [deck]')} — look up one card with its image\n${p('tarot cards [query]')} — list/search cards\n${p('tarot spreads')} — list spreads`, inline: false },
    { name: 'Time & location', value: `${p('now')} — astrological snapshot (type a city in location)\n${p('calendar')} — week events\n${p('location set')} — save a place`, inline: false },
    { name: 'Library', value: `${p('iching [number]')} — I-Ching hexagram\n${p('tattva [tattva]')} — Golden Dawn tattva\n${p('gematria value:')} — reverse gematria lookup\n${p('quiz [category]')} — quiz question\n${p('search query: [source] [work]')} — full-verse text search\n${p('text sources|section')} — read passages from the library`, inline: false },
    { name: 'System', value: `${p('decks')} — tarot decks\n${p('status')} — API health and which key you are using`, inline: false },
  ]);
}

async function resolveNamedArgs(group, subcommand, args = {}) {
  const next = { ...args };
  if (next.spread) next.spread = await resolveChoice('spread', next.spread);
  if (next.deck) next.deck = await resolveChoice('deck', next.deck);
  if (next.tattva) next.tattva = await resolveChoice('tattva', next.tattva);
  if (next.category) next.category = await resolveChoice('category', next.category);
  if (group === 'tarot' && subcommand === 'card' && next.name) {
    next.name = await resolveChoice('name', next.name);
  }
  if (next.source) next.source = await resolveChoice('source', next.source);
  if (next.work) next.work = await resolveChoice('work', next.work, { source: next.source });
  if (next.section) {
    next.section = await resolveChoice('section', next.section, {
      source: next.source,
      work: next.work,
    });
  }
  return next;
}

async function dispatch({ userId, group = '', subcommand = '', args = {}, prefix = '/kabbak' } = {}) {
  const apiKey = resolveUserApiKey(userId);
  const resolved = await resolveNamedArgs(group, subcommand, args);
  const ctx = { userId, apiKey, prefix, ...resolved };
  args = resolved;
  if (group === 'api') {
    if (subcommand === 'login') return requestApiLogin(ctx);
    if (subcommand === 'status') return handleApiStatus(ctx);
    if (subcommand === 'logout') return handleApiLogout(ctx);
    return card('API', `Use **${cmd(ctx, 'api login')}** to save a key, **status** to check it, or **logout** to remove it.`);
  }
  if (group === 'tarot') {
    switch (subcommand) {
      case 'draw':
        return handleTarot({ action: 'pull', spread: args.spread, ...ctx });
      case 'card':
        return handleTarotCard(args.name, apiKey, ctx);
      case 'cards':
        return handleTarot({ action: 'cards', q: args.query, ...ctx });
      case 'spreads':
        return handleTarot({ action: 'spreads', ...ctx });
      default:
        return card('Tarot', 'Pick a subcommand: draw, card, cards, or spreads.');
    }
  }
  if (group === 'text') {
    if (subcommand === 'sources') return handleTextSources();
    if (subcommand === 'section') {
      return handleTextSection({
        sourceId: args.source,
        workId: args.work,
        sectionId: args.section,
        verse: args.verse,
        ...ctx,
      });
    }
    return card('Text', 'Pick a subcommand: sources or section.');
  }
  if (group === 'location') {
    if (subcommand === 'set') {
      return handleLocation({
        action: 'set',
        latitude: args.latitude,
        longitude: args.longitude,
        label: args.label,
        ...ctx,
      });
    }
    if (subcommand === 'clear') return handleLocation({ action: 'clear', ...ctx });
    return handleLocation({ action: 'view', ...ctx });
  }
  switch (subcommand) {
    case 'help':
      return handleHelp(ctx);
    case 'status':
      return handleStatus(ctx);
    case 'decks':
      return handleDecks(apiKey);
    case 'now':
      return handleNow({
        latitude: args.latitude,
        longitude: args.longitude,
        date: args.date,
        ...ctx,
      });
    case 'calendar':
      return handleCalendar({
        latitude: args.latitude,
        longitude: args.longitude,
        ...ctx,
      });
    case 'iching':
      return handleIChing({ number: args.number, ...ctx });
    case 'tattva':
      return handleTattva({ tattva: args.tattva, ...ctx });
    case 'gematria':
      return handleGematria({ value: args.value, ...ctx });
    case 'search':
      return handleSearch(args.query || '', ctx);
    case 'quiz':
      return startQuiz(ctx, args.category);
    default:
      return card('KABBAK', `Unknown subcommand — try ${cmd(ctx, 'help')} to see every command.`);
  }
}

module.exports = {
  dispatch,
  completeApiLogin,
  answerQuiz,
  requestApiLogin,
};
