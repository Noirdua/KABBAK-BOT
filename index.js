require('dotenv').config();

const { API_BASE } = require('./lib/kabbak-api');
const { warmup } = require('./lib/catalog');

async function main() {
  await warmup();
  const starters = [];

  if (process.env.DISCORD_TOKEN) {
    starters.push(require('./platforms/discord').start());
  }

  // if (process.env.TELEGRAM_BOT_TOKEN) starters.push(require('./platforms/telegram').start());

  const matrix = require('./platforms/matrix');
  if (matrix.configured()) {
    starters.push(matrix.start());
  }

  if (!starters.length) {
    console.error('No chat platform configured. Set DISCORD_TOKEN and/or MATRIX_HOMESERVER with MATRIX_ACCESS_TOKEN or MATRIX_PASSWORD.');
    process.exit(1);
  }

  console.log(`KABBAK bot starting. API target: ${API_BASE}`);
  await Promise.all(starters);
}

main().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
