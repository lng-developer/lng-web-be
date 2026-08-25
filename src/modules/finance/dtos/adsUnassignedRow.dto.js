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
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

module.exports = { toAdsUnassignedRowDto };
