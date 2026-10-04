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
const { suggest, getSpreadOptions, getDeckOptions } = require('../lib/catalog');
const { dispatch, completeApiLogin, answerQuiz } = require('../lib/commands');

const PREFIX = '/kabbak';
const tarotDrafts = new Map();

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
    await interaction.deferUpdate();
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
    if (ephemeral && !interaction.ephemeral) {
      const removed = await interaction.deleteReply().then(() => true).catch(() => false);
      if (!removed) {
        await interaction.editReply({ content: 'Sent privately.', embeds: [], components: [], files: [] }).catch(() => {});
      }
      await followDispatchResult(interaction, result, { ephemeral: true });
      return;
    }
    await editDispatchResult(interaction, result);
    return;
  }
  const subcommand = customId.split(':')[2];
  await interaction.deferReply({ ephemeral: require('../lib/user-store').getReplyVisibility(userId) === 'private' });
  const result = await dispatch({
    userId,
    group: 'tarot',
    subcommand,
    args: {},
    prefix: PREFIX,
  });
  await sendDispatchResult(interaction, result);
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
  await interaction.deferReply({ ephemeral: savedPrivate });
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
  await sendDispatchResult(interaction, result);
}

function dispatchPayload(item) {
  const files = item?.attachment?.buffer
    ? [new AttachmentBuilder(item.attachment.buffer, { name: item.attachment.name || 'image.jpg' })]
    : [];
  const embeds = toEmbeds(item);
  if (!embeds.length && files.length) {
    return { content: '', embeds: [], components: [], files };
  }
  return { content: '', embeds, components: [], files };
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
    const files = item?.attachment?.buffer
      ? [new AttachmentBuilder(item.attachment.buffer, { name: item.attachment.name || 'image.jpg' })]
      : [];
    const embeds = toEmbeds(item);
    const payload = !embeds.length && files.length
      ? { files, components: [] }
      : { embeds, components: [], files };
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
    const files = item?.attachment?.buffer
      ? [new AttachmentBuilder(item.attachment.buffer, { name: item.attachment.name || 'image.jpg' })]
      : [];
    const embeds = toEmbeds(item);
    const components = item.buttons?.length ? buttonRows(item.buttons) : [];
    const payload = !embeds.length && files.length
      ? { files, components: [] }
      : { embeds, components, files };
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
  const ephemeral = (commandName === 'kabbak' && (group === 'api' || subcommand === 'config'))
    || replyMode === 'private'
    || (replyMode !== 'public' && savedPrivate);
  try {
    await interaction.deferReply({ ephemeral });
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

    const items = asList(result).filter((item) => item && item.type !== 'collect-secret');
    if (!items.length) {
      await interaction.editReply({ content: 'No result.' }).catch(() => {});
      return;
    }
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const files = item?.attachment?.buffer
        ? [new AttachmentBuilder(item.attachment.buffer, { name: item.attachment.name || 'image.jpg' })]
        : [];
      const embeds = toEmbeds(item);
      const components = item.buttons?.length ? buttonRows(item.buttons) : [];
      const payload = !embeds.length && files.length
        ? { files, components: [] }
        : { embeds, components, files };
      const send = i === 0
        ? interaction.editReply(payload)
        : interaction.followUp(payload);
      await send.catch((error) => {
        if (error?.code !== 10062) console.error('[discord] reply failed:', error?.message || error);
      });
    }
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
      await handleQuizButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && String(interaction.customId || '').startsWith('tarot:set:')) {
      await handleTarotSelect(interaction);
      return;
    }
    if (interaction.isModalSubmit() && String(interaction.customId || '').startsWith('kabbak-tarot-')) {
      await handleTarotModal(interaction);
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
