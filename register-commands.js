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
  if (option.type === 1 && option.name !== 'reply' && option.name !== 'login' && option.name !== 'config' && option.name !== 'tarot') {
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
        name: 'decks',
        description: 'List available tarot decks',
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
        name: 'natal',
        description: 'Natal chart (sun, moon, rising, planets, aspects)',
        options: [
          { name: 'date', type: 3, description: 'Birth date (YYYY-MM-DD)', required: true },
          { name: 'time', type: 3, description: 'Birth time (HH:MM). Place comes from your connected API profile.', required: false },
        ],
      },
      {
        type: 1,
        name: 'calendar',
        description: 'Upcoming week events from your connected API location',
      },
      {
        type: 1,
        name: 'tattva',
        description: 'Look up a Golden Dawn tattva, or list the five primaries',
        options: [
          {
            name: 'tattva',
            type: 3,
            description: 'Tattva id or name (Akasha, Tejas of Vayu, …)',
            required: false,
            autocomplete: true,
          },
        ],
      },
      {
        type: 1,
        name: 'iching',
        description: 'Cast an I-Ching hexagram (random, or pick a number)',
        options: [
          {
            name: 'number',
            type: 4,
            description: 'Hexagram number 1-64 (type to search, omit for a random cast)',
            required: false,
            autocomplete: true,
          },
        ],
      },
      {
        type: 1,
        name: 'relations',
        description: 'Show how a correspondence connects to the rest of the tree',
        options: [
          { name: 'kind', type: 3, description: 'Entity kind, e.g. sephirah, planet, sign, kabbalah-path', required: true },
          { name: 'id', type: 3, description: 'Entity id or name, e.g. keter or aries', required: true },
        ],
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
        description: 'Pull a quiz round with clickable answers',
        options: [
          {
            name: 'category',
            type: 3,
            description: 'Category (type to search the full list)',
            required: false,
            autocomplete: true,
          },
          {
            name: 'count',
            type: 4,
            description: 'How many questions (1–5, default 5)',
            required: false,
            min_value: 1,
            max_value: 5,
          },
        ],
      },
      {
        type: 2,
        name: 'text',
        description: 'Search and read the text library',
        options: [
          {
            type: 1,
            name: 'search',
            description: 'Search the library (full verses)',
            options: [
              { name: 'query', type: 3, description: 'Search query', required: true },
              { name: 'source', type: 3, description: 'Limit to one book/source (type to search)', required: false, autocomplete: true },
              { name: 'work', type: 3, description: 'Limit to one work (type to search)', required: false, autocomplete: true },
            ],
          },
          {
            type: 1,
            name: 'sources',
            description: 'List available text sources (books)',
          },
          {
            type: 1,
            name: 'section',
            description: 'Read a section of a book (full verses)',
            options: [
              {
                name: 'source',
                type: 3,
                description: 'Book/source (type to search)',
                required: true,
                autocomplete: true,
              },
              {
                name: 'work',
                type: 3,
                description: 'Work (type to search)',
                required: true,
                autocomplete: true,
              },
              {
                name: 'section',
                type: 3,
                description: 'Section/chapter (type to search)',
                required: true,
                autocomplete: true,
              },
              {
                name: 'verse',
                type: 3,
                description: 'Verse (type a number; Discord shows 25 at a time). Omit for random',
                required: false,
                autocomplete: true,
              },
            ],
          },
        ],
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
