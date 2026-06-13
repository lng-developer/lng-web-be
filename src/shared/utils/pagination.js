function normalizePagination(input = {}, options = {}) {
  const defaultPage = options.defaultPage || 1;
  const defaultLimit = options.defaultLimit || 20;
  const maxLimit = options.maxLimit || 100;

  const page = Math.max(Number(input.page) || defaultPage, 1);
  const limit = Math.min(Math.max(Number(input.limit) || defaultLimit, 1), maxLimit);

  return { page, limit };
}

function getPaginationOffset({ page, limit }) {
  return (page - 1) * limit;
}

function toPaginatedResult({ items, total, page, limit }) {
  return {
    items,
    total,
    page,
    limit,
  };
}

function toPaginatedResponse(result, itemMapper = (item) => item) {
  return {
    items: result.items.map(itemMapper),
    total: result.total,
    page: result.page,
    limit: result.limit,
  };
}

module.exports = {
  normalizePagination,
  getPaginationOffset,
  toPaginatedResult,
  toPaginatedResponse,
};
