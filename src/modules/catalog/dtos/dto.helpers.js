function toId(value) {
  return value === undefined || value === null ? null : String(value);
}

function toCompactProductTypeGroup(value) {
  if (!value) return null;
  if (typeof value === 'object' && (value.code || value.name)) {
    return {
      id: toId(value._id || value.id),
      code: value.code,
      name: value.name,
      status: value.status,
    };
  }
  return { id: toId(value) };
}

function toCompactInternalTemplate(value) {
  if (!value) return null;
  if (typeof value === 'object' && (value.code || value.name)) {
    return {
      id: toId(value._id || value.id),
      code: value.code,
      name: value.name,
      status: value.status,
    };
  }
  return { id: toId(value) };
}

function toPaginatedResponse(result, mapper) {
  return {
    items: result.items.map(mapper),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  toCompactInternalTemplate,
  toCompactProductTypeGroup,
  toId,
  toPaginatedResponse,
};
