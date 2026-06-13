function toShopDto(shop) {
  if (!shop) {
    return null;
  }

  return {
    id: String(shop._id || shop.id),
    name: shop.name,
    currency: shop.currency,
    status: shop.status,
    createdAt: shop.createdAt,
    updatedAt: shop.updatedAt,
  };
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
  toShopDto,
  toPaginatedResponse,
};
