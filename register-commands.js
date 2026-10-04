require('dotenv').config();
const { REST, Routes } = require('discord.js');

// Everything lives under a single global /kabbak command:
//   /kabbak tarot draw spread:three-card
//   /kabbak tarot card name:2-disks
//   /kabbak now latitude:... longitude:...
// Discord option types: 1 = SUB_COMMAND, 2 = SUB_COMMAND_GROUP,
// 3 = STRING, 4 = INTEGER, 10 = NUMBER.
const VISIBILITY_OPTION = {
  name: 'visibility',
  type: 3,
  description: 'This reply only: type private or public',
  required: false,
  autocomplete: true,
};

function addVisibilityOption(option) {
  if (!option || typeof option !== 'object') return option;
  if (Array.isArray(option.options)) {
    option.options = option.options.map(addVisibilityOption);
  }
  if (option.type === 1 && !['reply', 'login', 'config', 'tarot', 'text', 'iching', 'quiz'].includes(option.name)) {
    const options = Array.isArray(option.options) ? option.options : [];
    if (!options.some((entry) => entry.name === 'visibility')) {
      option.options = [...options, VISIBILITY_OPTION];
    }
  }
  return option;
}

const commands = [
  {
    name: 'kabbak',
    description: 'KABBAK esoteric toolkit — tarot, astrology, I-Ching, gematria and more',
    options: [
      {
        type: 1,
        name: 'help',
        description: 'List every KABBAK command with descriptions',
      },
      {
        type: 1,
        name: 'config',
        description: 'Account settings: API key and whether replies are public or private',
      },
      {
        type: 1,
        name: 'now',
        description: 'Current astrological snapshot (planetary hour, moon, decan, planets)',
        options: [
          { name: 'timezone', type: 3, description: 'Timezone (type to search). Uses your API location if connected.', required: false, autocomplete: true },
          { name: 'date', type: 3, description: 'Optional date override (ISO, e.g. 2026-08-25)', required: false },
        ],
      },
      {
        type: 1,
        name: 'calendar',
        description: 'Upcoming week events from your connected API location',
      },
      {
        type: 1,
        name: 'iching',
        description: 'I Ching menu: draw a spread or look up a hexagram',
      },
      {
        type: 1,
        name: 'gematria',
        description: 'Reverse gematria: find words carrying a numeric value',
        options: [
          { name: 'value', type: 4, description: 'Gematria value to look up (e.g. 111)', required: true },
        ],
      },
      {
        type: 1,
        name: 'quiz',
        description: 'Quiz menu: pick a category, 4 or 5 questions, then answer from dropdowns',
      },
      {
        type: 1,
        name: 'text',
        description: 'Text menu: search the library or read a section',
      },
      {
        type: 1,
        name: 'tarot',
        description: 'Tarot menu: draw, look up a card, search, and templates',
      },


    ],
  },
].map(addVisibilityOption);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) throw new Error('DISCORD_CLIENT_ID missing');

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
