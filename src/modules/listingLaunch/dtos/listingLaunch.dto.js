const toId = (value) => (value == null ? null : String(value));

function toListingLaunchDto(launch) {
  return {
    id: toId(launch._id),
    shopId: toId(launch.shopId),
    salesChannelCode: launch.salesChannelCode,
    marketplaceCode: launch.marketplaceCode,
    brief: launch.brief,
    workingTitle: launch.workingTitle ?? null,
    productTypeGroupId: toId(launch.productTypeGroupId),
    internalTemplateId: toId(launch.internalTemplateId),
    referenceAssetIds: (launch.referenceAssetIds || []).map(toId),
    state: launch.state,
    selectedBy: toId(launch.selectedBy),
    selectedAt: launch.selectedAt || null,
    createdBy: toId(launch.createdBy),
    createdAt: launch.createdAt,
    updatedAt: launch.updatedAt,
  };
}

module.exports = { toListingLaunchDto };
