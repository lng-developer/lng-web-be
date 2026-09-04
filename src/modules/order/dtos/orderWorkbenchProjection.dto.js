function toOrderWorkbenchRow(projection = {}) {
  return {
    order: projection.order || {},
    shop: projection.shop || null,
    case: projection.case || null,
    items: (projection.items || []).map(({ orderItemId, ...item }) => item),
  };
}

module.exports = { toOrderWorkbenchRow };
