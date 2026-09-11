const dotenvResult = require('dotenv').config();

const { API_BASE } = require('./lib/kabbak-api');
const { warmup } = require('./lib/catalog');

function readEnv(name, ...aliases) {
  for (const key of [name, ...aliases]) {
    // Prefer a non-empty process value, but fall back to the parsed .env value:
    // dotenv does not override keys that already exist (even if exported empty),
    // which would otherwise hide a token that IS present in .env.
    const value = String(process.env[key] || dotenvResult?.parsed?.[key] || '').trim();
    if (value) return value;
  }
  return '';
}

async function main() {
  await warmup();
  const starters = [];

  const loadedKeys = Object.keys(dotenvResult?.parsed || {});
  console.log(`[config] .env keys: ${loadedKeys.length ? loadedKeys.join(', ') : '(none)'}`);

  const discordToken = readEnv('DISCORD_TOKEN');
  const matrixHome = readEnv('MATRIX_HOMESERVER', 'MATRIX_URL');
  console.log(`[config] Discord: ${discordToken ? 'configured' : 'not configured'}; Matrix: ${matrixHome ? 'configured' : 'not configured'} (Matrix is optional)`);

  if (discordToken) {
    try {
      starters.push(require('./platforms/discord').start());
    } catch (error) {
      console.error('Discord failed to start:', error?.message || error);
    }
  } else {
    const discordClientId = readEnv('DISCORD_CLIENT_ID');
    if (discordClientId) {
      console.warn('[config] DISCORD_CLIENT_ID is set but DISCORD_TOKEN is missing. The client/application ID is NOT the bot token — copy the bot token from the Discord Developer Portal (your app → Bot → Reset Token) and add DISCORD_TOKEN=<token> to .env.');
    } else {
      console.warn('[config] DISCORD_TOKEN is empty in this .env — Discord will not start. Add your bot token after DISCORD_TOKEN=.');
    }
  }

  // if (process.env.TELEGRAM_BOT_TOKEN) starters.push(require('./platforms/telegram').start());

  // Only touch the Matrix platform (and its native crypto dependency) when a
  // homeserver is actually configured, so Discord-only setups stay clean.
  if (matrixHome) {
    try {
      const matrix = require('./platforms/matrix');
      if (matrix.configured()) {
        starters.push(matrix.start());
      } else {
        console.warn('[config] MATRIX_HOMESERVER is set but no MATRIX_ACCESS_TOKEN or MATRIX_PASSWORD — Matrix will not start.');
      }
    } catch (error) {
      console.error('Matrix failed to start:', error?.message || error);
    }
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
