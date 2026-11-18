function toAdsUnassignedRowDto(row) {
  return {
    id: String(row._id),
    sourceRef: row.sourceRef,
    reportDate: row.reportDate,
    advertiserAccountId: row.advertiserAccountId,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    portfolioId: row.portfolioId,
    portfolioName: row.portfolioName,
    salesChannelCode: row.salesChannelCode,
    marketplaceCode: row.marketplaceCode,
    status: row.status,
    sourceType: row.sourceType || 'SHOP_MAPPING',
    canMap: row.canMap ?? Boolean(row.advertiserAccountId && (row.campaignId || row.portfolioId)),
    reason: row.reason || (
      !row.advertiserAccountId
        ? 'Advertiser account ID is missing.'
        : !(row.campaignId || row.portfolioId)
          ? 'Campaign or portfolio ID is missing.'
          : 'No active shop mapping matches this campaign or portfolio.'
    ),
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

module.exports = { toAdsUnassignedRowDto };
