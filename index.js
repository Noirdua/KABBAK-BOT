require('dotenv').config();

const { API_BASE } = require('./lib/kabbak-api');
const { warmup } = require('./lib/catalog');

function readEnv(name, ...aliases) {
  for (const key of [name, ...aliases]) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

async function main() {
  await warmup();
  const starters = [];

  const discordToken = readEnv('DISCORD_TOKEN');
  const matrixHome = readEnv('MATRIX_HOMESERVER', 'MATRIX_URL');
  console.log(`[config] Discord token: ${discordToken ? 'set' : 'NOT set'}; Matrix homeserver: ${matrixHome ? 'set' : 'not set'} (Matrix is optional)`);

  if (discordToken) {
    try {
      starters.push(require('./platforms/discord').start());
    } catch (error) {
      console.error('Discord failed to start:', error?.message || error);
    }
  } else {
    console.warn('[config] DISCORD_TOKEN is empty in .env — Discord will not start.');
  }

  // if (process.env.TELEGRAM_BOT_TOKEN) starters.push(require('./platforms/telegram').start());

  try {
    const matrix = require('./platforms/matrix');
    if (matrix.configured()) {
      starters.push(matrix.start());
    }
  } catch (error) {
    console.error('Matrix failed to start:', error?.message || error);
  }

  if (!starters.length) {
    console.error('No chat platform configured. Set DISCORD_TOKEN for Discord, and/or MATRIX_HOMESERVER (or MATRIX_URL) plus MATRIX_ACCESS_TOKEN or MATRIX_PASSWORD for Matrix.');
    process.exit(1);
  }

  console.log(`KABBAK bot starting. API target: ${API_BASE}`);
  const results = await Promise.allSettled(starters);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('A chat platform stopped:', result.reason?.message || result.reason);
    }
  }
}

main().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
