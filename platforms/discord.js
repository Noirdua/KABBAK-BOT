const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} = require('discord.js');
const { accountId } = require('../lib/user-store');
const { asList, truncate } = require('../lib/cards');
const { suggest, getSpreadOptions, getDeckOptions, getTextCatalog, getSectionVerses, verseNumber } = require('../lib/catalog');
const { dispatch, completeApiLogin, answerQuiz } = require('../lib/commands');

const PREFIX = '/kabbak';
const tarotDrafts = new Map();
const textDrafts = new Map();

function textDraft(userId) {
  if (!textDrafts.has(userId)) {
    textDrafts.set(userId, { source: '', work: '', section: '', verse: '', query: '', versePage: 0 });
  }
  return textDrafts.get(userId);
}

function tarotDraft(userId) {
  if (!tarotDrafts.has(userId)) {
    tarotDrafts.set(userId, {
      spread: 'three-card',
      deck: '',
      template: '',
      stitch: true,
      reversed: false,
      private: false,
    });
  }
  return tarotDrafts.get(userId);
}

function selectChoices(items, selected, labelOf, valueOf) {
  const rows = [{ label: 'Default', value: '-' }];
  items.slice(0, 24).forEach((item) => {
    const value = String(valueOf(item) || '').trim().slice(0, 100);
    if (!value || rows.some((row) => row.value === value)) return;
    rows.push({
      label: String(labelOf(item) || value).slice(0, 100),
      value,
    });
  });
  const picked = selected && rows.some((row) => row.value === selected) ? selected : '-';
  return rows.slice(0, 25).map((row) => new StringSelectMenuOptionBuilder()
    .setLabel(row.label || row.value)
    .setValue(row.value)
    .setDefault(row.value === picked));
}

function selectRow(customId, placeholder, choices) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(choices)
  );
}

async function tarotDrawRows(draft) {
  const spreads = await getSpreadOptions().catch(() => []);
  const decks = (await getDeckOptions().catch(() => []))
    .filter((deck) => String(deck?.system || 'tarot').trim().toLowerCase() === 'tarot');
  const templates = require('../lib/spread-templates').listTemplates();
  const toggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tarot:toggle:stitch').setLabel(draft.stitch ? 'Stitch: on' : 'Stitch: off').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tarot:toggle:reversed').setLabel(draft.reversed ? 'Reversed: on' : 'Reversed: off').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tarot:toggle:private').setLabel(draft.private ? 'Private' : 'Public').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tarot:run:draw').setLabel('Draw').setStyle(ButtonStyle.Primary)
  );
  return [
    selectRow('tarot:set:spread', 'Spread', selectChoices(spreads, draft.spread, (item) => item.label || item.name || item.id, (item) => item.id)),
    selectRow('tarot:set:deck', 'Deck', selectChoices(decks, draft.deck, (item) => item.label || item.name || item.id, (item) => item.id)),
    selectRow('tarot:set:template', 'Template', selectChoices(templates, draft.template, (item) => item.name || item.id, (item) => item.id)),
    toggles,
  ];
}

function tarotTextModal(customId, title, fieldId, label, required) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(fieldId)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
      .setMaxLength(80)
  ));
  return modal;
}

function userIdFrom(interaction) {
  return accountId('discord', interaction.user?.id);
}

function readArgs(options) {
  return {
    spread: options?.getString?.('spread'),
    name: options?.getString?.('name'),
    query: options?.getString?.('query'),
    source: options?.getString?.('source'),
    work: options?.getString?.('work'),
    section: options?.getString?.('section'),
    verse: options?.getString?.('verse'),
    location: options?.getString?.('location'),
    country: options?.getString?.('country'),
    region: options?.getString?.('region'),
    city: options?.getString?.('city'),
    latitude: options?.getNumber?.('latitude'),
    longitude: options?.getNumber?.('longitude'),
    label: options?.getString?.('label'),
    date: options?.getString?.('date'),
    timezone: options?.getString?.('timezone'),
    time: options?.getString?.('time'),
    number: options?.getInteger?.('number'),
    tattva: options?.getString?.('tattva'),
    value: options?.getInteger?.('value'),
    kind: options?.getString?.('kind'),
    id: options?.getString?.('id'),
    category: options?.getString?.('category'),
    count: options?.getInteger?.('count'),
    deck: options?.getString?.('deck'),
    mode: options?.getString?.('mode'),
    visibility: options?.getString?.('visibility'),
    template: options?.getString?.('template'),
    stitch: options?.getBoolean?.('stitch'),
    reversed: options?.getBoolean?.('reversed'),
  };
}

function toEmbed(payload) {
  const embed = new EmbedBuilder()
    .setTitle(truncate(payload.title || 'KABBAK', 256))
    .setColor(payload.color || 0x6b4e71)
    .setTimestamp();
  if (payload.description) embed.setDescription(truncate(payload.description, 4096));
  if (payload.fields?.length) {
    embed.addFields(payload.fields.map((field) => ({
      name: truncate(field.name, 256),
      value: truncate(field.value, 1024),
      inline: !!field.inline,
    })));
  }
  if (payload.imageUrl) embed.setImage(payload.imageUrl);
  if (payload.footer) embed.setFooter({ text: truncate(payload.footer, 2048) });
  return embed;
}

function toEmbeds(result) {
  return asList(result)
    .filter((item) => item && item.type !== 'collect-secret' && !item.imageOnly)
    .map(toEmbed);
}

function buttonRows(buttons) {
  const items = Array.isArray(buttons) ? buttons : [];
  const rows = [];
  for (let i = 0; i < items.length && rows.length < 5; i += 5) {
    const row = new ActionRowBuilder();
    items.slice(i, i + 5).forEach((button) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(String(button.id || '').slice(0, 100))
          .setLabel(truncate(button.label || 'Option', 80))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(button.disabled === true)
      );
    });
    rows.push(row);
  }
  return rows;
}

async function showApiLoginModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('kabbak-api-login')
    .setTitle('Save your KABBAK API key');
  const keyInput = new TextInputBuilder()
    .setCustomId('api-key')
    .setLabel('Paste your KABBAK API key')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(200)
    .setPlaceholder('kabbak_… or the key from your KABBAK account');
  modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
  await interaction.showModal(modal);
}

function flattenOptions(options, acc = []) {
  for (const option of Array.isArray(options) ? options : []) {
    acc.push(option);
    if (Array.isArray(option.options)) flattenOptions(option.options, acc);
  }
  return acc;
}

function optionValue(interaction, name) {
  try {
    const direct = interaction.options.get(name);
    if (direct?.value != null && direct.value !== '') return direct.value;
  } catch (_error) {
    // Nested subcommand options sometimes fail get(); walk the raw tree.
  }
  const found = flattenOptions(interaction.options.data)
    .find((option) => option.name === name && option.value != null && option.value !== '');
  return found?.value;
}

async function handleAutocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    const choices = await suggest(String(focused?.name || ''), focused?.value, {
        source: optionValue(interaction, 'source'),
        work: optionValue(interaction, 'work'),
        section: optionValue(interaction, 'section'),
        country: optionValue(interaction, 'country'),
        region: optionValue(interaction, 'region'),
    }, { autocomplete: true });
    await interaction.respond(choices);
  } catch (error) {
    console.error('[discord] autocomplete failed:', error?.message || error);
    await interaction.respond([]).catch(() => {});
  }
}

async function textCatalog() {
  return getTextCatalog().catch(() => ({ sources: [] }));
}

async function textSearchRows(draft) {
  const catalog = await textCatalog();
  const sources = Array.isArray(catalog.sources) ? catalog.sources : [];
  const source = sources.find((entry) => String(entry.id) === draft.source) || null;
  const works = Array.isArray(source?.works) ? source.works : [];
  return [
    selectRow('text:set:source', 'Source (optional)', selectChoices(sources, draft.source, (item) => item.title || item.name || item.id, (item) => item.id)),
    selectRow('text:set:work', 'Work (optional)', selectChoices(works, draft.work, (item) => item.title || item.name || item.id, (item) => item.id)),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('text:query').setLabel(draft.query ? `Query: ${draft.query}`.slice(0, 80) : 'Set query').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('text:run:search').setLabel('Search').setStyle(ButtonStyle.Primary)
    ),
  ];
}

async function textReadRows(draft) {
  const catalog = await textCatalog();
  const sources = Array.isArray(catalog.sources) ? catalog.sources : [];
  const source = sources.find((entry) => String(entry.id) === draft.source) || null;
  const works = Array.isArray(source?.works) ? source.works : [];
  const work = works.find((entry) => String(entry.id) === draft.work) || null;
  const sections = Array.isArray(work?.sections) ? work.sections : [];
  const verses = draft.source && draft.work && draft.section
    ? await getSectionVerses(draft.source, draft.work, draft.section).catch(() => [])
    : [];
  return [
    selectRow('text:set:source', 'Source', selectChoices(sources, draft.source, (item) => item.title || item.name || item.id, (item) => item.id)),
    selectRow('text:set:work', 'Work', selectChoices(works, draft.work, (item) => item.title || item.name || item.id, (item) => item.id)),
    selectRow('text:set:section', 'Section', selectChoices(sections, draft.section, (item) => item.title || item.name || item.id, (item) => item.id)),
    selectRow('text:set:verse', 'Verse', verseChoices(verses, draft)),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('text:run:section').setLabel('Read').setStyle(ButtonStyle.Primary)
    ),
  ];
}

function verseChoices(verses, draft) {
  const pageSize = 22;
  const page = Math.max(0, Number(draft.versePage) || 0);
  const start = page * pageSize;
  const rows = [{ label: 'Whole section', value: '-' }];
  if (page > 0) rows.push({ label: 'Previous verses', value: '__prev' });
  verses.slice(start, start + pageSize).forEach((verse, index) => {
    const number = verseNumber(verse, start + index);
    const preview = String(verse?.text || verse?.body || '').replace(/\s+/g, ' ').trim().slice(0, 70);
    rows.push({
      label: (preview ? `${number} — ${preview}` : String(number)).slice(0, 100),
      value: String(number),
    });
  });
  if (start + pageSize < verses.length) rows.push({ label: 'More verses', value: '__next' });
  if (!draft.section) rows.splice(1, rows.length - 1, { label: 'Pick a section first', value: '__wait' });
  const selected = draft.verse && rows.some((row) => row.value === String(draft.verse)) ? String(draft.verse) : '-';
  return rows.slice(0, 25).map((row) => new StringSelectMenuOptionBuilder()
    .setLabel(row.label)
    .setValue(row.value)
    .setDefault(row.value === selected));
}

async function handleTextButton(interaction) {
  const userId = userIdFrom(interaction);
  const customId = String(interaction.customId || '');
  const draft = textDraft(userId);
  if (customId === 'text:menu:search') {
    await interaction.update({
      embeds: toEmbeds({ title: 'Search', description: 'Pick a source if you want, set a query, then Search.' }),
      components: await textSearchRows(draft),
    }).catch(() => {});
    return;
  }
  if (customId === 'text:menu:section') {
    await interaction.update({
      embeds: toEmbeds({ title: 'Read', description: 'Pick a source, work, and section, then Read.' }),
      components: await textReadRows(draft),
    }).catch(() => {});
    return;
  }
  if (customId === 'text:query') {
    await interaction.showModal(tarotTextModal('kabbak-text-query', 'Search query', 'query', 'Words to find', true));
    return;
  }
  if (customId === 'text:run:search' || customId === 'text:run:section') {
    const savedPrivate = require('../lib/user-store').getReplyVisibility(userId) === 'private';
    if (savedPrivate) await interaction.deferUpdate();
    else await interaction.deferReply({ ephemeral: false });
    const result = customId === 'text:run:search'
      ? await dispatch({
        userId,
        group: 'text',
        subcommand: 'search',
        args: { query: draft.query, source: draft.source, work: draft.work },
        prefix: PREFIX,
      })
      : await dispatch({
        userId,
        group: 'text',
        subcommand: 'section',
        args: {
          source: draft.source,
          work: draft.work,
          section: draft.section,
          verse: draft.verse,
        },
        prefix: PREFIX,
      });
    await editDispatchResult(interaction, result);
    if (!savedPrivate && interaction.message) {
      await interaction.message.delete().catch(() => {});
    }
    return;
  }
  const privateReply = require('../lib/user-store').getReplyVisibility(userId) === 'private';
  await interaction.deferReply({ ephemeral: true });
  const result = await dispatch({ userId, group: 'text', subcommand: 'sources', args: {}, prefix: PREFIX });
  await deliverResult(interaction, result, { ephemeral: privateReply });
}

async function handleTextSelect(interaction) {
  const draft = textDraft(userIdFrom(interaction));
  const key = String(interaction.customId || '').split(':')[2];
  const value = interaction.values?.[0] === '-' ? '' : (interaction.values?.[0] || '');
  if (key === 'source') {
    draft.source = value;
    draft.work = '';
    draft.section = '';
  } else if (key === 'work') {
    draft.work = value;
    draft.section = '';
  } else if (key === 'section') {
    draft.section = value;
    draft.verse = '';
    draft.versePage = 0;
  } else if (key === 'verse') {
    if (value === '__next') draft.versePage = (Number(draft.versePage) || 0) + 1;
    else if (value === '__prev') draft.versePage = Math.max(0, (Number(draft.versePage) || 0) - 1);
    else if (value && value !== '__wait') draft.verse = value;
    else draft.verse = '';
  }
  const rows = interaction.message?.embeds?.[0]?.title === 'Read'
    ? await textReadRows(draft)
    : await textSearchRows(draft);
  await interaction.update({ components: rows }).catch(() => {});
}

async function handleTextModal(interaction) {
  const draft = textDraft(userIdFrom(interaction));
  if (interaction.customId === 'kabbak-text-query') {
    draft.query = String(interaction.fields.getTextInputValue('query') || '').trim();
    await interaction.update({
      embeds: toEmbeds({ title: 'Search', description: draft.query ? `Query: ${draft.query}` : 'Set a query, then Search.' }),
      components: await textSearchRows(draft),
    }).catch(() => {});
    return;
  }
  await interaction.reply({ content: 'Use the verse list on the Read form.', ephemeral: true }).catch(() => {});
}

async function handleTarotButton(interaction) {
  const userId = userIdFrom(interaction);
  const customId = String(interaction.customId || '');
  const draft = tarotDraft(userId);
  if (customId === 'tarot:menu:card') {
    await interaction.showModal(tarotTextModal('kabbak-tarot-card', 'Look up a card', 'name', 'Card name', true));
    return;
  }
  if (customId === 'tarot:menu:cards') {
    await interaction.showModal(tarotTextModal('kabbak-tarot-search', 'Search cards', 'query', 'Search text', false));
    return;
  }
  if (customId === 'tarot:menu:draw') {
    draft.private = require('../lib/user-store').getReplyVisibility(userId) === 'private';
    const rows = await tarotDrawRows(draft);
    await interaction.update({
      embeds: toEmbeds({ title: 'Draw', description: 'Set the options, then press Draw.' }),
      components: rows,
    }).catch(() => {});
    return;
  }
  if (customId.startsWith('tarot:toggle:')) {
    const key = customId.split(':')[2];
    if (key === 'stitch' || key === 'reversed' || key === 'private') draft[key] = !draft[key];
    await interaction.update({ components: await tarotDrawRows(draft) }).catch(() => {});
    return;
  }
  if (customId === 'tarot:run:draw') {
    const savedPrivate = require('../lib/user-store').getReplyVisibility(userId) === 'private';
    const ephemeral = draft.private || savedPrivate;
    if (!ephemeral) {
      await interaction.deferReply({ ephemeral: false });
    } else {
      await interaction.deferUpdate();
    }
    const result = await dispatch({
      userId,
      group: 'tarot',
      subcommand: 'draw',
      args: {
        spread: draft.spread && draft.spread !== '-' ? draft.spread : 'three-card',
        deck: draft.deck && draft.deck !== '-' ? draft.deck : '',
        template: draft.template && draft.template !== '-' ? draft.template : '',
        stitch: draft.stitch,
        reversed: draft.reversed,
        visibility: ephemeral ? 'private' : 'public',
      },
      prefix: PREFIX,
    });
    await editDispatchResult(interaction, result);
    if (!ephemeral && interaction.message) {
      await interaction.message.delete().catch(() => {});
    }
    return;
  }
  const subcommand = customId.split(':')[2];
  const privateReply = require('../lib/user-store').getReplyVisibility(userId) === 'private';
  await interaction.deferReply({ ephemeral: true });
  const result = await dispatch({
    userId,
    group: 'tarot',
    subcommand,
    args: {},
    prefix: PREFIX,
  });
  await deliverResult(interaction, result, { ephemeral: privateReply });
}

async function handleTarotSelect(interaction) {
  const draft = tarotDraft(userIdFrom(interaction));
  const key = String(interaction.customId || '').split(':')[2];
  const value = interaction.values?.[0] || '';
  if (key === 'spread' || key === 'deck' || key === 'template') {
    draft[key] = value === '-' ? '' : value;
  }
  await interaction.update({ components: await tarotDrawRows(draft) }).catch(() => {});
}

async function handleTarotModal(interaction) {
  const userId = userIdFrom(interaction);
  const savedPrivate = require('../lib/user-store').getReplyVisibility(userId) === 'private';
  await interaction.deferReply({ ephemeral: true });
  const isSearch = interaction.customId === 'kabbak-tarot-search';
  const result = isSearch
    ? await dispatch({
      userId,
      group: 'tarot',
      subcommand: 'cards',
      args: { query: interaction.fields.getTextInputValue('query') },
      prefix: PREFIX,
    })
    : await dispatch({
      userId,
      group: 'tarot',
      subcommand: 'card',
      args: { name: interaction.fields.getTextInputValue('name') },
      prefix: PREFIX,
    });
  await deliverResult(interaction, result, { ephemeral: savedPrivate });
}

function plainContent(item) {
  if (item?.layout !== 'plain') return '';
  return [item.title ? `**${item.title}**` : '', item.description || ''].filter(Boolean).join('\n\n').slice(0, 2000);
}

function shouldStayPrivate(result) {
  return asList(result).some((item) => {
    if (!item || item.type === 'quiz') return false;
    return item.ephemeral || item.buttons?.length || item.type === 'collect-secret';
  });
}

async function publicChannel(interaction) {
  if (interaction.channel && typeof interaction.channel.send === 'function') return interaction.channel;
  if (!interaction.channelId) return null;
  return interaction.client.channels.fetch(interaction.channelId).catch((error) => {
    console.error('[discord] channel fetch failed:', error?.message || error);
    return null;
  });
}

async function postPublic(interaction, items) {
  const channel = await publicChannel(interaction);
  if (!channel) return false;
  try {
    for (const item of items) {
      await channel.send(dispatchPayload(item));
    }
    return true;
  } catch (error) {
    console.error('[discord] public post failed:', error?.message || error);
    return false;
  }
}

async function showPrivate(interaction, items) {
  await interaction.editReply(dispatchPayload(items[0])).catch(() => {});
  for (const item of items.slice(1)) {
    const payload = dispatchPayload(item);
    payload.ephemeral = true;
    await interaction.followUp(payload).catch(() => {});
  }
}

async function deliverResult(interaction, result, { ephemeral = false } = {}) {
  const items = asList(result).filter((item) => item && item.type !== 'collect-secret');
  if (!items.length) {
    await interaction.editReply({ content: 'No result.', embeds: [], components: [] }).catch(() => {});
    return;
  }
  if (ephemeral || shouldStayPrivate(result)) {
    await showPrivate(interaction, items);
    return;
  }
  const posted = await postPublic(interaction, items);
  if (posted) {
    await interaction.deleteReply().catch(() => {});
    return;
  }
  await showPrivate(interaction, items);
}

function dispatchPayload(item) {
  const files = item?.attachment?.buffer
    ? [new AttachmentBuilder(item.attachment.buffer, { name: item.attachment.name || 'image.jpg' })]
    : [];
  const components = item?.buttons?.length ? buttonRows(item.buttons) : [];
  const content = plainContent(item);
  if (content) return { content, embeds: [], components, files };
  const embeds = toEmbeds(item);
  if (!embeds.length && files.length) {
    return { content: '', embeds: [], components, files };
  }
  return { content: '', embeds, components, files };
}

async function editDispatchResult(interaction, result) {
  const items = asList(result).filter((item) => item && item.type !== 'collect-secret');
  if (!items.length) {
    await interaction.editReply({ content: 'No result.', embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }
  await interaction.editReply(dispatchPayload(items[0])).catch(() => {});
  for (const item of items.slice(1)) {
    await interaction.followUp(dispatchPayload(item)).catch(() => {});
  }
}

async function followDispatchResult(interaction, result, { ephemeral = false } = {}) {
  const items = asList(result).filter((item) => item && item.type !== 'collect-secret');
  if (!items.length) {
    await interaction.followUp({ content: 'No result.', ephemeral }).catch(() => {});
    return;
  }
  for (const item of items) {
    const payload = dispatchPayload(item);
    if (ephemeral) payload.ephemeral = true;
    await interaction.followUp(payload).catch(() => {});
  }
}

async function sendDispatchResult(interaction, result) {
  const items = asList(result).filter((item) => item && item.type !== 'collect-secret');
  if (!items.length) {
    await interaction.editReply({ content: 'No result.' }).catch(() => {});
    return;
  }
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const payload = dispatchPayload(item);
    if (item.buttons?.length) payload.components = buttonRows(item.buttons);
    const send = i === 0 ? interaction.editReply(payload) : interaction.followUp(payload);
    await send.catch(() => {});
  }
}

async function handleConfigButton(interaction) {
  const [, section, action] = String(interaction.customId || '').split(':');
  if (section === 'api' && action === 'login') {
    try {
      await showApiLoginModal(interaction);
    } catch (error) {
      if (error?.code !== 10062) console.error('[discord] config login failed:', error?.message || error);
    }
    return;
  }
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (error) {
    if (error?.code === 10062) return;
    return;
  }
  const userId = userIdFrom(interaction);
  const result = section === 'reply'
    ? await dispatch({ userId, subcommand: 'reply', args: { mode: action }, prefix: PREFIX })
    : await dispatch({ userId, group: 'api', subcommand: action, args: {}, prefix: PREFIX });
  const panel = await dispatch({ userId, subcommand: 'config', args: {}, prefix: PREFIX });
  await interaction.editReply({
    embeds: toEmbeds([result, panel].filter(Boolean)),
    components: buttonRows(panel?.buttons),
  }).catch(() => {});
}

async function handleQuizButton(interaction) {
  const customId = String(interaction.customId || '');
  const match = /^quiz:([a-f0-9]+):(\d+)$/.exec(customId);
  if (!match) return;
  const result = answerQuiz(match[1], Number(match[2]), `${interaction.user}`, { prefix: PREFIX });
  if (result.ephemeral) {
    await interaction.reply({ embeds: toEmbeds(result), ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.update({ embeds: toEmbeds(result), components: [] }).catch(() => {});
}

async function handleLoginModal(interaction) {
  const raw = String(interaction.fields.getTextInputValue('api-key') || '').trim();
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (error) {
    if (error?.code === 10062) return;
    console.error('[discord] api login defer failed:', error?.message || error);
    return;
  }
  try {
    const result = await completeApiLogin(userIdFrom(interaction), raw, { prefix: PREFIX });
    await interaction.editReply({ embeds: toEmbeds(result) });
  } catch (error) {
    await interaction.editReply({
      embeds: toEmbeds({ title: 'Login Failed', description: error.message || 'Could not save that API key.' }),
    }).catch(() => {});
  }
}

async function handleChatCommand(interaction) {
  const { commandName, options } = interaction;
  const group = options?.getSubcommandGroup?.() || '';
  const subcommand = options?.getSubcommand?.() || '';

  if (commandName === 'kabbak' && group === 'api' && subcommand === 'login') {
    try {
      await showApiLoginModal(interaction);
    } catch (error) {
      if (error?.code === 10062) {
        console.warn('[discord] api login already handled elsewhere (another bot instance?)');
        return;
      }
      console.error('[discord] showModal failed:', error?.message || error);
    }
    return;
  }

  const replyMode = String(options?.getString?.('mode') || optionValue(interaction, 'visibility') || '').toLowerCase();
  const savedPrivate = require('../lib/user-store').getReplyVisibility(userIdFrom(interaction)) === 'private';
  const outputPrivate = replyMode === 'private' || (replyMode !== 'public' && savedPrivate);
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (error) {
    if (error?.code === 10062) {
      console.warn(`[discord] ${commandName} already handled elsewhere (another bot instance?)`);
      return;
    }
    console.error(`[discord] deferReply failed for ${commandName}:`, error?.message || error);
    return;
  }

  try {
    const result = commandName === 'kabbak'
      ? await dispatch({
        userId: userIdFrom(interaction),
        group,
        subcommand,
        args: readArgs(options),
        prefix: PREFIX,
      })
      : { title: 'KABBAK', description: `Commands now live under ${PREFIX} — try ${PREFIX} help.` };

    if (result?.type === 'collect-secret') {
      await interaction.editReply({ content: result.description || 'Send your API key privately.' }).catch(() => {});
      return;
    }

    await deliverResult(interaction, result, { ephemeral: outputPrivate });
  } catch (err) {
    console.error(err);
    await interaction.editReply({ content: `Error: ${err.message}` }).catch(() => {});
  }
}

async function start() {
  const token = String(process.env.DISCORD_TOKEN || '').trim();
  if (!token) return null;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once('clientReady', () => {
    console.log(`[discord] ready as ${client.user.tag}`);
  });

  client.on('error', (error) => {
    console.error('[discord] client error:', error?.message || error);
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }
    if (interaction.isButton()) {
      const customId = String(interaction.customId || '');
      if (customId.startsWith('config:')) {
        await handleConfigButton(interaction);
        return;
      }
      if (customId.startsWith('tarot:')) {
        await handleTarotButton(interaction);
        return;
      }
      if (customId.startsWith('text:')) {
        await handleTextButton(interaction);
        return;
      }
      await handleQuizButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && String(interaction.customId || '').startsWith('tarot:set:')) {
      await handleTarotSelect(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && String(interaction.customId || '').startsWith('text:set:')) {
      await handleTextSelect(interaction);
      return;
    }
    if (interaction.isModalSubmit() && String(interaction.customId || '').startsWith('kabbak-tarot-')) {
      await handleTarotModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && String(interaction.customId || '').startsWith('kabbak-text-')) {
      await handleTextModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'kabbak-api-login') {
      await handleLoginModal(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    await handleChatCommand(interaction);
  });

  await client.login(token);
  return client;
}

module.exports = { start };
