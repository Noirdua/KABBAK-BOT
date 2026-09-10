const { apiGet } = require('./kabbak-api');

const AUTOCOMPLETE_TTL_MS = 10 * 60 * 1000;

const caches = {
  texts: { value: { sources: [] }, fetchedAt: 0, ttl: 0 },
  quiz: { value: [], fetchedAt: 0, ttl: 0 },
  spreads: { value: [], fetchedAt: 0, ttl: 0 },
  cards: { value: [], fetchedAt: 0, ttl: 0 },
  hexagrams: { value: [], fetchedAt: 0, ttl: 0 },
  tattvas: { value: [], fetchedAt: 0, ttl: 0 },
  decks: { value: [], fetchedAt: 0, ttl: 0 },
  countries: { value: [], fetchedAt: 0, ttl: 0 },
};

function hasCatalogValue(name, value) {
  if (name === 'texts') return Array.isArray(value?.sources) && value.sources.length > 0;
  return Array.isArray(value) && value.length > 0;
}

async function cached(name, loader) {
  const entry = caches[name];
  const now = Date.now();
  if (entry.fetchedAt > 0 && now - entry.fetchedAt < entry.ttl) {
    return entry.value;
  }
  try {
    entry.value = await loader();
    entry.ttl = AUTOCOMPLETE_TTL_MS;
    entry.fetchedAt = now;
  } catch (error) {
    console.error(`[catalog] ${name} fetch failed:`, error?.message || error);
    if (entry.fetchedAt > 0 && hasCatalogValue(name, entry.value)) {
      return entry.value;
    }
    entry.value = name === 'texts' ? { sources: [] } : [];
    entry.ttl = 5000;
    entry.fetchedAt = now;
  }
  return entry.value;
}

async function getTextCatalog() {
  return cached('texts', async () => {
    const data = await apiGet('/texts');
    const payload = data?.data && typeof data.data === 'object' ? data.data : data;
    const sources = Array.isArray(payload?.sources)
      ? payload.sources
      : Array.isArray(payload?.data?.sources)
        ? payload.data.sources
        : [];
    return { ...(payload && typeof payload === 'object' ? payload : {}), sources };
  });
}

async function getQuizCategories() {
  return cached('quiz', async () => {
    const data = await apiGet('/quiz/categories');
    const payload = data.data || data;
    return Array.isArray(payload?.categories) ? payload.categories : [];
  });
}

async function getSpreadOptions() {
  return cached('spreads', async () => {
    const data = await apiGet('/tarot/spreads');
    const payload = data.data || data;
    return Array.isArray(payload?.spreads) ? payload.spreads : [];
  });
}

async function getCardOptions() {
  return cached('cards', async () => {
    const data = await apiGet('/tarot/cards', { limit: 200 });
    return Array.isArray(data?.data) ? data.data : [];
  });
}

async function getDeckOptions() {
  return cached('decks', async () => {
    const data = await apiGet('/decks/options');
    const payload = data.data || data;
    if (Array.isArray(payload?.decks)) return payload.decks;
    if (Array.isArray(payload)) return payload;
    return [];
  });
}

async function getCountryOptions() {
  return cached('countries', async () => {
    const data = await apiGet('/locations/countries');
    const payload = data.data || data;
    return Array.isArray(payload?.countries) ? payload.countries : [];
  });
}

async function getRegionOptions(countryId) {
  const country = String(countryId || '').trim();
  if (!country) return [];
  const key = `regions:${country}`;
  if (!caches[key]) caches[key] = { value: [], fetchedAt: 0, ttl: 0 };
  return cached(key, async () => {
    const data = await apiGet('/locations/regions', { country });
    const payload = data.data || data;
    return Array.isArray(payload?.regions) ? payload.regions : [];
  });
}

async function getCityOptions(countryId, regionId) {
  const country = String(countryId || '').trim();
  if (!country) return [];
  const region = String(regionId || '').trim();
  const key = `cities:${country}:${region}`;
  if (!caches[key]) caches[key] = { value: [], fetchedAt: 0, ttl: 0 };
  return cached(key, async () => {
    const params = { country };
    if (region) params.region = region;
    const data = await apiGet('/locations/cities', params);
    const payload = data.data || data;
    return Array.isArray(payload?.cities) ? payload.cities : [];
  });
}

function tattvaLabel(entry) {
  if (!entry) return '';
  if (typeof entry.name === 'string') return entry.name;
  return String(entry.name?.en || entry.id || '').trim();
}

function flattenTattvas(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return Object.values(payload);
  return [];
}

async function getTattvaOptions() {
  return cached('tattvas', async () => {
    const data = await apiGet('/tattvas');
    return flattenTattvas(data.data || data).filter((entry) => entry && entry.id);
  });
}

async function getHexagramOptions() {
  return cached('hexagrams', async () => {
    const data = await apiGet('/iching');
    const payload = data.data || data;
    return Array.isArray(payload?.hexagrams) ? payload.hexagrams : [];
  });
}

function clipChoice(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 3))}...`;
}

function sanitizeChoices(choices) {
  const seen = new Set();
  const out = [];
  for (const choice of Array.isArray(choices) ? choices : []) {
    let value = String(choice?.value || '').trim();
    if (!value) continue;
    if (value.length > 100) value = value.slice(0, 100);
    let name = clipChoice(choice?.name || value, 100);
    if (!name) name = value.slice(0, 100);
    let unique = name;
    let n = 2;
    while (seen.has(unique.toLowerCase())) {
      const suffix = ` (${n})`;
      unique = `${clipChoice(name, 100 - suffix.length)}${suffix}`;
      n += 1;
    }
    seen.add(unique.toLowerCase());
    out.push({ name: unique, value });
    if (out.length >= 25) break;
  }
  return out;
}

function wordsOf(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

function prefixScore(fields, q) {
  if (!q) return 0;
  const values = (Array.isArray(fields) ? fields : []).map((field) => String(field || '').toLowerCase().trim());
  if (values.some((value) => value === q)) return 0;
  if (values.some((value) => value.startsWith(q))) return 1;
  if (values.some((value) => wordsOf(value).some((word) => word.startsWith(q)))) return 2;
  if (values.some((value) => value.includes(q))) return 3;
  return 99;
}

function byNumberThenLabel(a, b) {
  const an = Number(a?.number ?? a?.order);
  const bn = Number(b?.number ?? b?.order);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  return String(a?.label || a?.title || a?.name || a?.id || '').localeCompare(
    String(b?.label || b?.title || b?.name || b?.id || ''),
    undefined,
    { numeric: true }
  );
}

function filterMapChoices(items, query, match, toChoice, fieldsOf) {
  const q = String(query || '').trim().toLowerCase();
  const scored = (Array.isArray(items) ? items : []).map((item) => {
    const fields = typeof fieldsOf === 'function' ? fieldsOf(item) : [];
    const score = q
      ? (fields.length ? prefixScore(fields, q) : (match(item, q) ? 3 : 99))
      : 0;
    return { item, score };
  }).filter((entry) => entry.score < 99);

  const prefixHits = scored.filter((entry) => entry.score <= 2);
  const pool = q && prefixHits.length ? prefixHits : scored;
  pool.sort((a, b) => a.score - b.score || byNumberThenLabel(a.item, b.item));
  return sanitizeChoices(pool.slice(0, 40).map((entry) => toChoice(entry.item)));
}

function findCatalogWork(catalog, sourceId, workId) {
  const source = (Array.isArray(catalog?.sources) ? catalog.sources : [])
    .find((entry) => String(entry.id) === String(sourceId || '')) || null;
  const work = (Array.isArray(source?.works) ? source.works : [])
    .find((entry) => String(entry.id) === String(workId || '')) || null;
  return { source, work };
}

async function getSectionVerses(sourceId, workId, sectionId) {
  const key = `verses:${sourceId}:${workId}:${sectionId}`;
  if (!caches[key]) caches[key] = { value: [], fetchedAt: 0, ttl: 0 };
  return cached(key, async () => {
    const data = await apiGet(
      `/texts/${encodeURIComponent(sourceId)}/works/${encodeURIComponent(workId)}/sections/${encodeURIComponent(sectionId)}`
    );
    const payload = data.data || data;
    return Array.isArray(payload?.verses) ? payload.verses : [];
  });
}

function verseNumber(verse, index) {
  const num = Number(verse?.number);
  return Number.isFinite(num) && num > 0 ? num : index + 1;
}

function suggestVerses(verses, query) {
  const q = String(query || '').trim();
  const qLower = q.toLowerCase();
  const range = /^(\d+)(?:\s*-\s*(\d*))?$/.exec(q);
  const start = range ? Number(range[1]) : NaN;
  const endTyped = range && range[2] !== undefined && range[2] !== '';
  const end = endTyped ? Number(range[2]) : start;
  const openRange = Boolean(range && q.includes('-') && !endTyped);

  const indexed = (Array.isArray(verses) ? verses : []).map((verse, index) => ({
    verse,
    index,
    number: verseNumber(verse, index),
  }));

  const scored = indexed.map((entry) => {
    if (!q) return { entry, score: 0 };
    if (openRange) return { entry, score: entry.number >= start ? 0 : 99 };
    if (range && endTyped) return { entry, score: entry.number >= start && entry.number <= end ? 0 : 99 };
    if (range) {
      const num = String(entry.number);
      if (entry.number === start) return { entry, score: 0 };
      if (num.startsWith(range[1])) return { entry, score: 1 };
      return { entry, score: 99 };
    }
    return {
      entry,
      score: prefixScore([
        String(entry.number),
        entry.verse.reference,
        entry.verse.text,
      ], qLower),
    };
  }).filter((row) => row.score < 99);

  const prefixHits = scored.filter((row) => row.score <= 2);
  const pool = q && !range && prefixHits.length ? prefixHits : scored;
  pool.sort((a, b) => a.score - b.score || a.entry.number - b.entry.number);
  const matched = pool.map((row) => row.entry);

  const choices = [];
  if (range && endTyped && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    const span = Math.min(end, start + 2);
    choices.push({
      name: end > start ? `Verses ${start}-${span}${end > span ? ` (shows ${span - start + 1})` : ''}` : `Verse ${start}`,
      value: end > start ? `${start}-${span}` : String(start),
    });
  }

  for (const entry of matched) {
    const preview = String(entry.verse.text || '').replace(/\s+/g, ' ').trim();
    const ref = String(entry.verse.reference || '').trim();
    const label = preview
      ? `${entry.number}${ref ? ` ${ref}` : ''} — ${preview}`
      : (ref ? `${entry.number} — ${ref}` : `Verse ${entry.number}`);
    choices.push({ name: label, value: String(entry.number) });
  }

  return sanitizeChoices(choices);
}

async function suggest(optionName, query, linked = {}) {
  if (optionName === 'category') {
    return filterMapChoices(
      await getQuizCategories(),
      query,
      (category, q) => String(category.id || '').toLowerCase().includes(q) || String(category.label || '').toLowerCase().includes(q),
      (category) => ({ name: `${category.label} (${category.questionCount} q)`, value: String(category.id) }),
      (category) => [category.id, category.label]
    );
  }
  if (optionName === 'spread') {
    return filterMapChoices(
      await getSpreadOptions(),
      query,
      (spread, q) => String(spread.id || '').toLowerCase().includes(q) || String(spread.label || '').toLowerCase().includes(q),
      (spread) => ({
        name: `${spread.label || spread.id} (${Array.isArray(spread.positions) ? spread.positions.length : '?'} positions)`,
        value: String(spread.id),
      }),
      (spread) => [spread.id, spread.label]
    );
  }
  if (optionName === 'name' || optionName === 'query') {
    return filterMapChoices(
      await getCardOptions(),
      query,
      (card, q) => String(card.id || '').toLowerCase().includes(q) || String(card.name || '').toLowerCase().includes(q),
      (card) => ({ name: `${card.name} (${card.id})`, value: String(card.id) }),
      (card) => [card.id, card.name]
    );
  }
  if (optionName === 'deck') {
    return filterMapChoices(
      await getDeckOptions(),
      query,
      (deck, q) => String(deck.id || '').toLowerCase().includes(q) || String(deck.name || deck.label || '').toLowerCase().includes(q),
      (deck) => ({ name: String(deck.label || deck.name || deck.id), value: String(deck.id) }),
      (deck) => [deck.id, deck.name, deck.label]
    );
  }
  if (optionName === 'tattva') {
    return filterMapChoices(
      await getTattvaOptions(),
      query,
      (entry, q) => {
        const id = String(entry.id || '').toLowerCase();
        const name = tattvaLabel(entry).toLowerCase();
        const sanskrit = String(entry.sanskrit || '').toLowerCase();
        return id.includes(q) || name.includes(q) || sanskrit.includes(q);
      },
      (entry) => ({
        name: `${tattvaLabel(entry)}${entry.kind === 'compound' ? ' (compound)' : ''}`,
        value: String(entry.id),
      }),
      (entry) => [entry.id, tattvaLabel(entry), entry.sanskrit, entry.elementName, entry.shape]
    );
  }
  if (optionName === 'number') {
    return filterMapChoices(
      await getHexagramOptions(),
      query,
      (hexagram, q) => String(hexagram.number ?? '').includes(q) || String(hexagram.name || '').toLowerCase().includes(q),
      (hexagram) => ({ name: `${hexagram.number} — ${hexagram.name}`, value: String(hexagram.number) }),
      (hexagram) => [hexagram.number, hexagram.name]
    );
  }
  if (optionName === 'source') {
    const catalog = await getTextCatalog();
    return filterMapChoices(
      catalog?.sources,
      query,
      (source, q) => String(source.id || '').toLowerCase().includes(q) || String(source.title || '').toLowerCase().includes(q),
      (source) => ({ name: `${source.title} (${source.id})`, value: String(source.id) }),
      (source) => [source.id, source.title, source.shortTitle]
    );
  }
  if (optionName === 'work') {
    const catalog = await getTextCatalog();
    if (linked.source) {
      const { source } = findCatalogWork(catalog, linked.source);
      return filterMapChoices(
        source?.works,
        query,
        (work, q) => String(work.id || '').toLowerCase().includes(q) || String(work.title || '').toLowerCase().includes(q),
        (work) => ({ name: `${work.title} (${work.sectionCount || 0} sections)`, value: String(work.id) }),
        (work) => [work.id, work.title, work.shortTitle]
      );
    }
    const works = (Array.isArray(catalog?.sources) ? catalog.sources : []).flatMap((source) => (
      (Array.isArray(source.works) ? source.works : []).map((work) => ({
        ...work,
        sourceTitle: source.title,
      }))
    ));
    return filterMapChoices(
      works,
      query,
      (work, q) => String(work.id || '').toLowerCase().includes(q)
        || String(work.title || '').toLowerCase().includes(q)
        || String(work.sourceTitle || '').toLowerCase().includes(q),
      (work) => ({
        name: `${work.title} — ${work.sourceTitle} (${work.sectionCount || 0} sections)`,
        value: String(work.id),
      }),
      (work) => [work.id, work.title, work.shortTitle, work.sourceTitle]
    );
  }
  if (optionName === 'section') {
    const catalog = await getTextCatalog();
    const { work } = findCatalogWork(catalog, linked.source, linked.work);
    return filterMapChoices(
      work?.sections,
      query,
      (section, q) => {
        const id = String(section.id || '').toLowerCase();
        const label = String(section.label || '').toLowerCase();
        const title = String(section.title || '').toLowerCase();
        const number = String(section.number ?? '');
        return id.includes(q) || label.includes(q) || title.includes(q) || number.includes(q);
      },
      (section) => ({ name: `${section.label || section.id} (${section.verseCount || 0} verses)`, value: String(section.id) }),
      (section) => [section.id, section.label, section.title, section.number]
    );
  }
  if (optionName === 'location') {
    const params = { q: String(query || '').trim() };
    if (linked.country) params.country = linked.country;
    if (linked.region) params.region = linked.region;
    let places = [];
    try {
      const data = await apiGet('/locations/search', params);
      const payload = data.data || data;
      places = Array.isArray(payload?.places) ? payload.places : [];
    } catch (_error) {
      places = [];
    }
    const rank = { city: 0, region: 1, country: 2 };
    places.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
    return filterMapChoices(
      places,
      '',
      () => true,
      (place) => ({ name: String(place.label || place.name || place.id), value: String(place.id) }),
      (place) => [place.id, place.label, place.name]
    );
  }
  if (optionName === 'country') {
    return filterMapChoices(
      await getCountryOptions(),
      query,
      (entry, q) => String(entry.id || '').toLowerCase().includes(q) || String(entry.name || '').toLowerCase().includes(q),
      (entry) => ({ name: `${entry.name} (${entry.id.toUpperCase()})`, value: String(entry.id) }),
      (entry) => [entry.id, entry.name, ...(entry.aliases || [])]
    );
  }
  if (optionName === 'region') {
    return filterMapChoices(
      await getRegionOptions(linked.country),
      query,
      (entry, q) => String(entry.id || '').toLowerCase().includes(q) || String(entry.name || '').toLowerCase().includes(q),
      (entry) => ({ name: `${entry.name} (${entry.countryName})`, value: String(entry.id) }),
      (entry) => [entry.id, entry.name, entry.countryName, ...(entry.aliases || [])]
    );
  }
  if (optionName === 'city') {
    return filterMapChoices(
      await getCityOptions(linked.country, linked.region),
      query,
      (entry, q) => String(entry.id || '').toLowerCase().includes(q) || String(entry.name || '').toLowerCase().includes(q),
      (entry) => ({
        name: entry.regionName ? `${entry.name} — ${entry.regionName}` : entry.name,
        value: String(entry.id),
      }),
      (entry) => [entry.id, entry.name, entry.regionName, ...(entry.aliases || [])]
    );
  }
  if (optionName === 'verse') {
    const sourceId = String(linked.source || '').trim();
    const workId = String(linked.work || '').trim();
    const sectionId = String(linked.section || '').trim();
    if (!sourceId || !workId || !sectionId) return [];
    let verses = [];
    try {
      verses = await getSectionVerses(sourceId, workId, sectionId);
    } catch (_error) {
      verses = [];
    }
    if (!verses.length) {
      const catalog = await getTextCatalog();
      const { work } = findCatalogWork(catalog, sourceId, workId);
      const section = (Array.isArray(work?.sections) ? work.sections : [])
        .find((entry) => String(entry.id) === sectionId) || null;
      const count = Number(section?.verseCount) || 0;
      verses = Array.from({ length: count }, (_, index) => ({
        number: index + 1,
        reference: `Verse ${index + 1}`,
        text: '',
      }));
    }
    return suggestVerses(verses, query);
  }
  return [];
}

async function resolveChoice(optionName, query, linked = {}) {
  const raw = String(query || '').trim();
  if (!raw) return '';
  const choices = await suggest(optionName, raw, linked);
  if (!choices.length) return raw;
  const q = raw.toLowerCase();
  const exact = choices.find((choice) => (
    String(choice.value || '').toLowerCase() === q
    || String(choice.name || '').toLowerCase() === q
    || String(choice.name || '').toLowerCase().startsWith(`${q} `)
    || String(choice.name || '').toLowerCase().startsWith(`${q}(`)
    || String(choice.name || '').toLowerCase().startsWith(`${q}—`)
    || String(choice.name || '').toLowerCase().startsWith(`${q}-`)
  ));
  if (exact) return exact.value;
  return String(choices[0].value || raw);
}

async function warmup() {
  await Promise.allSettled([
    getTextCatalog(),
    getQuizCategories(),
    getSpreadOptions(),
    getCardOptions(),
    getHexagramOptions(),
    getTattvaOptions(),
    getDeckOptions(),
    getCountryOptions(),
  ]);
  const catalog = caches.texts.value;
  const sourceCount = Array.isArray(catalog?.sources) ? catalog.sources.length : 0;
  console.log(`[catalog] warmed (${sourceCount} text sources)`);
}

module.exports = {
  getTextCatalog,
  getQuizCategories,
  getSpreadOptions,
  getCardOptions,
  getHexagramOptions,
  getTattvaOptions,
  getDeckOptions,
  suggest,
  resolveChoice,
  warmup,
};
