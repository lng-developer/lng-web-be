const toId = (value) => (value == null ? null : String(value));

function toListingLaunchBaseDto(launch) {
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

function toListingLaunchDto(launch, review = {}) {
  return {
    ...toListingLaunchBaseDto(launch),
    contentInputs: launch.contentInputs ? {
      profileCode: launch.contentInputs.profileCode,
      keyword: launch.contentInputs.keyword,
      language: launch.contentInputs.language,
      productFacts: {
        brand: launch.contentInputs.productFacts.brand,
        productName: launch.contentInputs.productFacts.productName,
        material: launch.contentInputs.productFacts.material,
        features: [...launch.contentInputs.productFacts.features],
        personalization: launch.contentInputs.productFacts.personalization ?? null,
        careInstructions: launch.contentInputs.productFacts.careInstructions ?? null,
      },
      availableColors: launch.contentInputs.availableColors.map(({ code, label }) => ({ code, label })),
      factsConfirmed: launch.contentInputs.factsConfirmed,
      confirmedBy: toId(launch.contentInputs.confirmedBy),
      confirmedAt: launch.contentInputs.confirmedAt,
    } : null,
    contentInputVersion: launch.contentInputVersion ?? 0,
    contentVersionCounter: launch.contentVersionCounter ?? 0,
    ...(Object.hasOwn(review, 'latestRun') && { latestRun: review.latestRun }),
    ...(Object.hasOwn(review, 'isStale') && { isStale: review.isStale, approvedContentUsable: review.approvedContentUsable }),
    approvedContent: launch.approvedContent ? {
      versionId: toId(launch.approvedContent.versionId),
      inputVersion: launch.approvedContent.inputVersion,
      inputHash: launch.approvedContent.inputHash,
      selectedColorCodes: [...launch.approvedContent.selectedColorCodes],
      approvedBy: toId(launch.approvedContent.approvedBy),
      approvedAt: launch.approvedContent.approvedAt,
    } : null,
  };
}

function toListingLaunchListItemDto(launch) {
  return {
    ...toListingLaunchBaseDto(launch),
    contentInputVersion: launch.contentInputVersion ?? 0,
    contentVersionCounter: launch.contentVersionCounter ?? 0,
    hasContentInputs: Boolean(launch.contentInputs),
    hasApprovedContent: Boolean(launch.approvedContent),
  };
}

module.exports = { toListingLaunchDto, toListingLaunchListItemDto };
