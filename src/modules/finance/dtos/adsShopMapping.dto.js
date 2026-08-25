function toAdsShopMappingDto(mapping) {
  return {
    id: String(mapping._id),
    advertiserAccountId: mapping.advertiserAccountId,
    matchType: mapping.matchType,
    externalId: mapping.externalId,
    shopId: String(mapping.shopId),
    salesChannelCode: mapping.salesChannelCode,
    marketplaceCode: mapping.marketplaceCode,
    active: mapping.active,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
  };
}

module.exports = { toAdsShopMappingDto };
