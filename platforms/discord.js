const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} = require('discord.js');
const { accountId } = require('../lib/user-store');
const { asList, truncate } = require('../lib/cards');
const { suggest } = require('../lib/catalog');
const { dispatch, completeApiLogin, answerQuiz } = require('../lib/commands');

const PREFIX = '/kabbak';

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
    category: options?.getString?.('category'),
    deck: options?.getString?.('deck'),
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

  const ephemeral = commandName === 'kabbak' && group === 'api';
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

    const components = result?.type === 'quiz' ? buttonRows(result.buttons) : [];
    const files = asList(result)
      .filter((item) => item?.attachment?.buffer)
      .map((item) => new AttachmentBuilder(item.attachment.buffer, {
        name: item.attachment.name || 'image.jpg',
      }));
    const embeds = toEmbeds(result);
    if (!embeds.length && files.length) {
      await interaction.editReply({ files, components: [] }).catch((error) => {
        if (error?.code !== 10062) console.error('[discord] editReply failed:', error?.message || error);
      });
      return;
    }
    await interaction.editReply({
      embeds,
      components,
      files,
    }).catch((error) => {
      if (error?.code !== 10062) console.error('[discord] editReply failed:', error?.message || error);
    });
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
      await handleQuizButton(interaction);
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
