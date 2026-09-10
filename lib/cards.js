function truncate(str, len = 1024) {
  if (!str) return '';
  const value = String(str);
  return value.length > len ? `${value.slice(0, len - 3)}...` : value;
}

function card(title, description = '', fields = [], extras = {}) {
  return {
    type: extras.type || 'card',
    title: String(title || ''),
    description: description ? String(description) : '',
    fields: Array.isArray(fields) ? fields.map((field) => ({
      name: String(field?.name || ''),
      value: String(field?.value || ''),
      inline: !!field?.inline,
    })) : [],
    imageUrl: String(extras.imageUrl || ''),
    color: Number.isFinite(Number(extras.color)) ? Number(extras.color) : 0x6b4e71,
    footer: String(extras.footer || ''),
    ephemeral: extras.ephemeral === true,
    buttons: Array.isArray(extras.buttons) ? extras.buttons : [],
    quizId: String(extras.quizId || ''),
    imageOnly: extras.imageOnly === true,
    attachment: extras.attachment && extras.attachment.buffer
      ? {
        name: String(extras.attachment.name || 'image.jpg'),
        buffer: extras.attachment.buffer,
        contentType: String(extras.attachment.contentType || 'image/jpeg'),
      }
      : null,
  };
}

function asList(result) {
  if (result == null) return [];
  return Array.isArray(result) ? result : [result];
}

function commandPrefix(ctx = {}) {
  return String(ctx.prefix || '/kabbak').trim() || '/kabbak';
}

function cmd(ctx, path = '') {
  const prefix = commandPrefix(ctx);
  const rest = String(path || '').trim();
  return rest ? `${prefix} ${rest}` : prefix;
}

module.exports = {
  truncate,
  card,
  asList,
  commandPrefix,
  cmd,
};
