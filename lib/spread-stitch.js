const { fetchAssetBuffer } = require('./kabbak-api');
const { renderSpreadPrint } = require('./spread-print');
const { listTemplates, resolveTemplate } = require('./spread-templates');

async function loadCardBuffers(items) {
  const list = Array.isArray(items) ? items : [];
  return Promise.all(list.map(async (item) => {
    let buffer = null;
    try {
      if (item?.imageUrl) buffer = await fetchAssetBuffer(item.imageUrl);
    } catch (error) {
      console.warn('[stitch] card image failed:', item?.name || item?.label || 'card', error?.message || error);
    }
    return { ...item, buffer };
  }));
}

async function stitchSpreadImages(items, {
  spreadId = '',
  title = '',
  description = '',
  footer = '',
  template = '',
} = {}) {
  const loaded = await loadCardBuffers(items);
  if (!loaded.length) return null;
  const resolved = resolveTemplate(template);
  return renderSpreadPrint(loaded, {
    spreadId,
    title,
    description,
    footer,
    template: resolved,
  });
}

function listPrintTemplates() {
  return listTemplates().map((template) => ({
    id: template.id,
    name: template.name,
    kind: template.kind,
    source: template.sourceLabel || template.kind,
  }));
}

module.exports = {
  stitchSpreadImages,
  listPrintTemplates,
};
