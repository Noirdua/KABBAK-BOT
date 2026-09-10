const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
  MatrixClient,
  MatrixAuth,
  SimpleFsStorageProvider,
  AutojoinRoomsMixin,
} = require('matrix-bot-sdk');
const { accountId } = require('../lib/user-store');
const { asList, truncate } = require('../lib/cards');
const { parseCommand, defaultPrefixes } = require('../lib/text-command');
const { dispatch, completeApiLogin, answerQuiz } = require('../lib/commands');

const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'matrix');
const SESSION_PATH = path.join(STORAGE_DIR, 'session.json');
const LOGIN_TTL_MS = 5 * 60 * 1000;
const SKIP_OLDER_MS = 5 * 60 * 1000;
const QUIZ_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

const pendingLogins = new Map();
const quizByEvent = new Map();
const encryptedWarned = new Map();
const dmRooms = new Map();

function env(name, ...aliases) {
  for (const key of [name, ...aliases]) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function homeserverUrl() {
  return env('MATRIX_HOMESERVER', 'MATRIX_URL').replace(/\/+$/, '');
}

function configured() {
  const hs = homeserverUrl();
  if (!hs) return false;
  return Boolean(env('MATRIX_ACCESS_TOKEN') || env('MATRIX_PASSWORD') || readSession()?.accessToken);
}

function commandPrefix() {
  return env('MATRIX_PREFIX') || '!kabbak';
}

function prefixes() {
  return defaultPrefixes();
}

function userIdFrom(mxid) {
  return accountId('matrix', mxid);
}

function readSession() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    if (data?.accessToken) return data;
  } catch (_error) {
    // no saved session
  }
  return null;
}

function writeSession(session) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const tmp = `${SESSION_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`);
  try {
    fs.renameSync(tmp, SESSION_PATH);
  } catch (_error) {
    fs.copyFileSync(tmp, SESSION_PATH);
    try { fs.unlinkSync(tmp); } catch (_cleanup) { /* ignore */ }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdToHtml(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/```([^`]+)```/g, '<pre>$1</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

function cardToPlain(payload) {
  const lines = [payload.title || 'KABBAK'];
  if (payload.description) lines.push(payload.description);
  for (const field of payload.fields || []) {
    if (field.name) lines.push(`${field.name}: ${field.value || ''}`.trim());
  }
  if (payload.footer) lines.push(payload.footer);
  return truncate(lines.filter(Boolean).join('\n'), 4000);
}

function cardToHtml(payload) {
  const parts = [`<h3>${escapeHtml(payload.title || 'KABBAK')}</h3>`];
  if (payload.description) parts.push(`<p>${mdToHtml(payload.description)}</p>`);
  for (const field of payload.fields || []) {
    parts.push(`<p><strong>${escapeHtml(field.name)}</strong><br/>${mdToHtml(field.value)}</p>`);
  }
  if (payload.footer) parts.push(`<p><em>${escapeHtml(payload.footer)}</em></p>`);
  return parts.join('');
}

async function resolveCredentials() {
  const homeserver = homeserverUrl();
  if (!homeserver) {
    throw new Error('Set MATRIX_HOMESERVER (or MATRIX_URL) to log the bot into Matrix.');
  }
  const fromEnv = env('MATRIX_ACCESS_TOKEN');
  if (fromEnv) {
    return {
      homeserver,
      accessToken: fromEnv,
      userId: env('MATRIX_USER_ID', 'MATRIX_USERNAME'),
    };
  }
  const saved = readSession();
  if (saved?.accessToken) {
    return {
      homeserver: saved.homeserver || homeserver,
      accessToken: saved.accessToken,
      userId: saved.userId || env('MATRIX_USER_ID', 'MATRIX_USERNAME'),
    };
  }
  const username = loginLocalpart(env('MATRIX_USER_ID', 'MATRIX_USERNAME'));
  const password = env('MATRIX_PASSWORD');
  if (!username || !password) {
    throw new Error('Set MATRIX_ACCESS_TOKEN, or MATRIX_USER_ID / MATRIX_USERNAME plus MATRIX_PASSWORD.');
  }
  const auth = new MatrixAuth(homeserver);
  const loggedIn = await auth.passwordLogin(username, password, 'KABBAK Bot');
  const userId = await loggedIn.getUserId().catch(() => env('MATRIX_USER_ID', 'MATRIX_USERNAME'));
  const session = {
    homeserver,
    userId,
    accessToken: loggedIn.accessToken,
  };
  writeSession(session);
  console.log('[matrix] logged in with password; access token saved under storage/matrix/session.json');
  console.log('[matrix] you can remove MATRIX_PASSWORD from .env after this');
  return session;
}

function loginLocalpart(raw) {
  const value = String(raw || '').trim();
  if (value.startsWith('@')) {
    const colon = value.indexOf(':');
    if (colon > 1) return value.slice(1, colon);
  }
  return value;
}

async function roomIsEncrypted(client, roomId) {
  try {
    await client.getRoomStateEvent(roomId, 'm.room.encryption', '');
    return true;
  } catch (_error) {
    return false;
  }
}

async function joinedMembers(client, roomId) {
  try {
    const members = await client.getJoinedRoomMembers(roomId);
    if (Array.isArray(members)) return members;
    if (members?.joined && typeof members.joined === 'object') return Object.keys(members.joined);
  } catch (_error) {
    // ignore
  }
  return [];
}

async function isDirectRoom(client, roomId, botUserId, otherUserId) {
  const members = await joinedMembers(client, roomId);
  if (members.length !== 2) return false;
  if (otherUserId) {
    return members.includes(botUserId) && members.includes(otherUserId);
  }
  return members.includes(botUserId);
}

async function ensureLoginRoom(client, botUserId, userId) {
  const remembered = dmRooms.get(userId);
  if (remembered) {
    try {
      const joined = await client.getJoinedRooms();
      if (joined.includes(remembered) && !(await roomIsEncrypted(client, remembered))) {
        return remembered;
      }
    } catch (_error) {
      dmRooms.delete(userId);
    }
  }
  const rooms = await client.getJoinedRooms();
  for (const roomId of rooms) {
    if (await isDirectRoom(client, roomId, botUserId, userId) && !(await roomIsEncrypted(client, roomId))) {
      dmRooms.set(userId, roomId);
      return roomId;
    }
  }
  const roomId = await client.createRoom({
    name: 'KABBAK API login',
    topic: 'Paste your KABBAK API key here. The bot redacts it.',
    preset: 'trusted_private_chat',
    visibility: 'private',
    invite: [userId],
    is_direct: true,
    initial_state: [],
  });
  dmRooms.set(userId, roomId);
  return roomId;
}

async function sendNotice(client, roomId, plain, html) {
  return client.sendMessage(roomId, {
    msgtype: 'm.notice',
    body: plain,
    format: 'org.matrix.custom.html',
    formatted_body: html || escapeHtml(plain).replace(/\n/g, '<br/>'),
  });
}

async function uploadBuffer(client, buffer, name, contentType) {
  return client.uploadContent(buffer, contentType || 'application/octet-stream', name || 'file.bin');
}

async function sendImage(client, roomId, { buffer, name, contentType, url }) {
  let mxc = '';
  let mime = contentType || 'image/jpeg';
  let filename = name || 'image.jpg';
  let size = buffer?.length || 0;
  if (buffer?.length) {
    mxc = await uploadBuffer(client, buffer, filename, mime);
  } else if (/^https?:\/\//i.test(String(url || ''))) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 8_000_000 });
    const data = Buffer.from(res.data);
    mime = String(res.headers['content-type'] || mime).split(';')[0];
    size = data.length;
    mxc = await uploadBuffer(client, data, filename, mime);
  }
  if (!mxc) return null;
  return client.sendMessage(roomId, {
    msgtype: 'm.image',
    body: filename,
    url: mxc,
    info: { mimetype: mime, size },
  });
}

async function sendCard(client, roomId, payload) {
  const imageUrl = String(payload.imageUrl || '');
  const remote = imageUrl && !imageUrl.startsWith('attachment://') ? imageUrl : '';
  const hasImage = Boolean(payload.attachment?.buffer || remote);
  if (payload.imageOnly && hasImage) {
    try {
      return await sendImage(client, roomId, {
        buffer: payload.attachment?.buffer,
        name: payload.attachment?.name,
        contentType: payload.attachment?.contentType,
        url: remote,
      });
    } catch (error) {
      console.error('[matrix] image send failed:', error?.message || error);
    }
  }
  const eventId = await sendNotice(client, roomId, cardToPlain(payload), cardToHtml(payload));
  if (hasImage && !payload.imageOnly) {
    try {
      await sendImage(client, roomId, {
        buffer: payload.attachment?.buffer,
        name: payload.attachment?.name,
        contentType: payload.attachment?.contentType,
        url: remote,
      });
    } catch (error) {
      console.error('[matrix] image send failed:', error?.message || error);
    }
  }
  return eventId;
}

async function addQuizReactions(client, roomId, eventId, count) {
  const n = Math.min(count, QUIZ_EMOJIS.length);
  for (let i = 0; i < n; i += 1) {
    try {
      await client.sendEvent(roomId, 'm.reaction', {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: eventId,
          key: QUIZ_EMOJIS[i],
        },
      });
    } catch (error) {
      console.error('[matrix] reaction failed:', error?.message || error);
      break;
    }
  }
}

async function sendResult(client, roomId, result) {
  const items = asList(result).filter((item) => item && item.type !== 'collect-secret');
  let lastId = null;
  for (const item of items) {
    lastId = await sendCard(client, roomId, item);
    if (item.type === 'quiz' && item.buttons?.length) {
      quizByEvent.set(lastId, item);
      await addQuizReactions(client, roomId, lastId, item.buttons.length);
    }
  }
  return lastId;
}

function rememberDm(roomId, sender, botUserId, memberCount) {
  if (memberCount === 2 && sender && sender !== botUserId) {
    dmRooms.set(sender, roomId);
  }
}

async function beginApiLogin(client, { roomId, sender, botUserId, result }) {
  const targetRoom = await ensureLoginRoom(client, botUserId, sender);
  pendingLogins.set(sender, { roomId: targetRoom, expiresAt: Date.now() + LOGIN_TTL_MS });
  const prompt = result?.description
    || 'Paste your KABBAK API key as the next message. Say cancel to abort. The bot will redact it.';
  await sendNotice(client, targetRoom, prompt);
  if (targetRoom !== roomId) {
    await sendNotice(
      client,
      roomId,
      'I opened a private chat — paste your API key there, not in this room.',
    );
  }
}

async function finishApiLogin(client, roomId, event, sender, rawKey) {
  pendingLogins.delete(sender);
  try {
    await client.redactEvent(roomId, event.event_id, 'API key collected');
  } catch (error) {
    console.warn('[matrix] could not redact API key message:', error?.message || error);
  }
  try {
    const result = await completeApiLogin(userIdFrom(sender), rawKey, { prefix: commandPrefix() });
    await sendResult(client, roomId, result);
  } catch (error) {
    await sendNotice(client, roomId, error.message || 'Could not save that API key.');
  }
}

async function handleCommand(client, roomId, sender, body) {
  const parsed = parseCommand(body, prefixes());
  if (!parsed) return false;
  const result = await dispatch({
    userId: userIdFrom(sender),
    group: parsed.group,
    subcommand: parsed.subcommand,
    args: parsed.args,
    prefix: commandPrefix(),
  });
  if (result?.type === 'collect-secret') {
    const botUserId = await client.getUserId();
    await beginApiLogin(client, { roomId, sender, botUserId, result });
    return true;
  }
  if (result?.ephemeral) {
    const botUserId = await client.getUserId();
    const members = await joinedMembers(client, roomId);
    const privateRoom = members.length <= 2
      ? roomId
      : await ensureLoginRoom(client, botUserId, sender);
    await sendResult(client, privateRoom, result);
    if (privateRoom !== roomId) {
      await sendNotice(client, roomId, 'Sent that privately.');
    }
    return true;
  }
  await sendResult(client, roomId, result);
  return true;
}

async function handleText(client, roomId, event, botUserId) {
  if (event?.unsigned?.redacted_because) return;
  const sender = event.sender;
  if (!sender || sender === botUserId) return;
  const ts = Number(event.origin_server_ts || 0);
  if (ts && Date.now() - ts > SKIP_OLDER_MS) return;
  const content = event.content || {};
  if (content.msgtype && content.msgtype !== 'm.text') return;
  if (content['m.relates_to']?.rel_type === 'm.replace') return;
  const body = String(content.body || '').trim();
  if (!body) return;

  const members = await joinedMembers(client, roomId);
  rememberDm(roomId, sender, botUserId, members.length);

  const pending = pendingLogins.get(sender);
  if (pending && pending.expiresAt > Date.now() && pending.roomId === roomId) {
    if (/^cancel$/i.test(body) || parseCommand(body, prefixes())) {
      pendingLogins.delete(sender);
      if (/^cancel$/i.test(body)) {
        await sendNotice(client, roomId, 'Login cancelled.');
        return;
      }
    } else {
      await finishApiLogin(client, roomId, event, sender, body);
      return;
    }
  } else if (pending && pending.expiresAt <= Date.now()) {
    pendingLogins.delete(sender);
  }

  try {
    await handleCommand(client, roomId, sender, body);
  } catch (error) {
    console.error('[matrix] command failed:', error?.message || error);
    await sendNotice(client, roomId, `Error: ${error.message || 'command failed'}`).catch(() => {});
  }
}

async function handleReaction(client, roomId, event, botUserId) {
  if (event.sender === botUserId) return;
  const relates = event.content?.['m.relates_to'] || {};
  if (relates.rel_type !== 'm.annotation' || !relates.event_id) return;
  const quiz = quizByEvent.get(relates.event_id);
  if (!quiz) return;
  const index = QUIZ_EMOJIS.indexOf(String(relates.key || ''));
  if (index < 0) return;
  const match = /^quiz:([a-f0-9]+):(\d+)$/.exec(String(quiz.buttons?.[index]?.id || ''));
  const quizId = match?.[1] || quiz.quizId;
  if (!quizId) return;
  quizByEvent.delete(relates.event_id);
  const result = answerQuiz(quizId, index, event.sender, { prefix: commandPrefix() });
  await sendResult(client, roomId, result);
}

async function warnEncrypted(client, roomId, event, botUserId) {
  if (event.sender === botUserId) return;
  const last = encryptedWarned.get(roomId) || 0;
  if (Date.now() - last < 30 * 60 * 1000) return;
  encryptedWarned.set(roomId, Date.now());
  await sendNotice(
    client,
    roomId,
    'This room is encrypted and I cannot read it yet. Invite me to an unencrypted room, then use !kabbak help. For API login, run !kabbak api login there and I will open a private unencrypted chat.',
  ).catch(() => {});
}

async function start() {
  if (!configured()) return null;
  const creds = await resolveCredentials();
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const storage = new SimpleFsStorageProvider(path.join(STORAGE_DIR, 'bot.json'));
  const client = new MatrixClient(creds.homeserver, creds.accessToken, storage);
  AutojoinRoomsMixin.setupOnClient(client);

  client.on('room.message', async (roomId, event) => {
    try {
      const botUserId = await client.getUserId();
      if (event?.type === 'm.room.encrypted') {
        await warnEncrypted(client, roomId, event, botUserId);
        return;
      }
      await handleText(client, roomId, event, botUserId);
    } catch (error) {
      console.error('[matrix] room.message error:', error?.message || error);
    }
  });

  client.on('room.event', async (roomId, event) => {
    try {
      const botUserId = await client.getUserId();
      if (event?.type === 'm.room.encrypted') {
        await warnEncrypted(client, roomId, event, botUserId);
        return;
      }
      if (event?.type !== 'm.reaction') return;
      await handleReaction(client, roomId, event, botUserId);
    } catch (error) {
      console.error('[matrix] room.event error:', error?.message || error);
    }
  });

  await client.start();
  const who = await client.getUserId();
  console.log(`[matrix] ready as ${who} on ${creds.homeserver}`);
  return client;
}

module.exports = { start, configured };
