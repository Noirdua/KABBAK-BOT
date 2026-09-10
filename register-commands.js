require('dotenv').config();
const { REST, Routes } = require('discord.js');

// Everything lives under a single global /kabbak command:
//   /kabbak tarot draw spread:three-card
//   /kabbak tarot card name:2-disks
//   /kabbak now latitude:... longitude:...
// Discord option types: 1 = SUB_COMMAND, 2 = SUB_COMMAND_GROUP,
// 3 = STRING, 4 = INTEGER, 10 = NUMBER.
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
        name: 'status',
        description: 'KABBAK API health and version',
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
          { name: 'location', type: 3, description: 'Place (type a city, e.g. Los Angeles)', required: false, autocomplete: true },
          { name: 'country', type: 3, description: 'Country (type to search)', required: false, autocomplete: true },
          { name: 'region', type: 3, description: 'State/region (type to search)', required: false, autocomplete: true },
          { name: 'city', type: 3, description: 'City (type to search)', required: false, autocomplete: true },
          { name: 'latitude', type: 10, description: 'Latitude (decimal degrees)', required: false },
          { name: 'longitude', type: 10, description: 'Longitude (decimal degrees)', required: false },
          { name: 'date', type: 3, description: 'Optional date override (ISO, e.g. 2026-08-25)', required: false },
        ],
      },
      {
        type: 1,
        name: 'calendar',
        description: 'Upcoming week events (moon phases, planetary hours)',
        options: [
          { name: 'location', type: 3, description: 'Place (type a city, e.g. Los Angeles)', required: false, autocomplete: true },
          { name: 'country', type: 3, description: 'Country (type to search)', required: false, autocomplete: true },
          { name: 'region', type: 3, description: 'State/region (type to search)', required: false, autocomplete: true },
          { name: 'city', type: 3, description: 'City (type to search)', required: false, autocomplete: true },
          { name: 'latitude', type: 10, description: 'Latitude (decimal degrees)', required: false },
          { name: 'longitude', type: 10, description: 'Longitude (decimal degrees)', required: false },
        ],
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
        name: 'gematria',
        description: 'Reverse gematria: find words carrying a numeric value',
        options: [
          { name: 'value', type: 4, description: 'Gematria value to look up (e.g. 111)', required: true },
        ],
      },
      {
        type: 1,
        name: 'quiz',
        description: 'Pull a quiz question with clickable answers',
        options: [
          {
            name: 'category',
            type: 3,
            description: 'Category (type to search the full list)',
            required: false,
            autocomplete: true,
          },
        ],
      },
      {
        type: 1,
        name: 'search',
        description: 'Search the KABBAK text library (full verses)',
        options: [
          { name: 'query', type: 3, description: 'Search query', required: true },
          {
            name: 'source',
            type: 3,
            description: 'Limit to one book/source (type to search)',
            required: false,
            autocomplete: true,
          },
          {
            name: 'work',
            type: 3,
            description: 'Limit to one work (type to search)',
            required: false,
            autocomplete: true,
          },
        ],
      },
      {
        type: 2,
        name: 'text',
        description: 'Read passages from the text library',
        options: [
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
        type: 2,
        name: 'tarot',
        description: 'Tarot cards and spreads',
        options: [
          {
            type: 1,
            name: 'draw',
            description: 'Draw cards from a spread (default: three-card)',
            options: [
              {
                name: 'spread',
                type: 3,
                description: 'Spread (type to search)',
                required: false,
                autocomplete: true,
              },
              {
                name: 'deck',
                type: 3,
                description: 'Deck art (type to search)',
                required: false,
                autocomplete: true,
              },
              {
                name: 'stitch',
                type: 5,
                description: 'One image with cards and meanings (default on; false = separate cards)',
                required: false,
              },
              {
                name: 'reversed',
                type: 5,
                description: 'Allow reversed cards (default off)',
                required: false,
              },
            ],
          },
          {
            type: 1,
            name: 'card',
            description: 'Look up a single tarot card with its image',
            options: [
              {
                name: 'name',
                type: 3,
                description: 'Card (type to search the full card library)',
                required: true,
                autocomplete: true,
              },
              {
                name: 'deck',
                type: 3,
                description: 'Deck art (type to search)',
                required: false,
                autocomplete: true,
              },
            ],
          },
          {
            type: 1,
            name: 'cards',
            description: 'List or search the card library',
            options: [
              {
                name: 'query',
                type: 3,
                description: 'Optional search text (autocompletes from the card library)',
                required: false,
                autocomplete: true,
              },
              {
                name: 'deck',
                type: 3,
                description: 'Deck art (type to search)',
                required: false,
                autocomplete: true,
              },
            ],
          },
          {
            type: 1,
            name: 'spreads',
            description: 'List available spreads',
          },
        ],
      },
      {
        type: 2,
        name: 'location',
        description: 'Your saved location (used by now and calendar)',
        options: [
          { type: 1, name: 'view', description: 'Show your saved location' },
          {
            type: 1,
            name: 'set',
            description: 'Save a location for now and calendar',
            options: [
              { name: 'location', type: 3, description: 'Place (type a city, e.g. Los Angeles)', required: false, autocomplete: true },
              { name: 'country', type: 3, description: 'Country (type to search)', required: false, autocomplete: true },
              { name: 'region', type: 3, description: 'State/region (type to search)', required: false, autocomplete: true },
              { name: 'city', type: 3, description: 'City (type to search)', required: false, autocomplete: true },
              { name: 'latitude', type: 10, description: 'Latitude (e.g. 40.7128)', required: false },
              { name: 'longitude', type: 10, description: 'Longitude (e.g. -74.0060)', required: false },
              { name: 'label', type: 3, description: 'Optional label (e.g. Home)', required: false },
            ],
          },
          { type: 1, name: 'clear', description: 'Remove your saved location' },
        ],
      },
      {
        type: 2,
        name: 'api',
        description: 'Log in with your own KABBAK API key',
        options: [
          {
            type: 1,
            name: 'login',
            description: 'Save your API key (private form, never shown in chat)',
          },
          {
            type: 1,
            name: 'status',
            description: 'Check whether you have a saved API key',
          },
          {
            type: 1,
            name: 'logout',
            description: 'Remove your saved API key',
          },
        ],
      },
    ],
  },
];

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
