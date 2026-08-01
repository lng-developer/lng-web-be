function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toImportJobDto(job) {
  if (!job) return null;
  return {
    id: toId(job),
    source: job.source,
    sourceType: job.sourceType,
    shopId: toId(job.shopId),
    shopConnectionId: toId(job.shopConnectionId),
    salesChannelCode: job.salesChannelCode,
    marketplaceCode: job.marketplaceCode,
    externalAccountId: job.externalAccountId,
    sourceFileId: toId(job.sourceFileId),
    status: job.status,
    totalRecords: job.totalRecords,
    parsedCount: job.parsedCount,
    importedCount: job.importedCount,
    skippedCount: job.skippedCount,
    failedCount: job.failedCount,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    triggeredBy: toId(job.triggeredBy),
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    summary: job.summary || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toIssueDto(issue) {
  if (!issue) return null;
  return {
    id: toId(issue),
    importJobId: toId(issue.importJobId),
    shopId: toId(issue.shopId),
    rawRecordId: toId(issue.rawRecordId),
    source: issue.source,
    externalOrderId: issue.externalOrderId,
    externalItemId: issue.externalItemId,
    rowNumber: issue.rowNumber,
    issueType: issue.issueType,
    severity: issue.severity,
    status: issue.status,
    errorCode: issue.errorCode,
    errorMessage: issue.errorMessage,
    details: issue.details || {},
    resolvedBy: toId(issue.resolvedBy),
    resolvedAt: issue.resolvedAt,
    resolutionNote: issue.resolutionNote,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

function toRawRecordDto(rawRecord) {
  if (!rawRecord) return null;
  return {
    id: toId(rawRecord),
    importJobId: toId(rawRecord.importJobId),
    source: rawRecord.source,
    rowNumber: rawRecord.rowNumber,
    externalOrderId: rawRecord.externalOrderId,
    externalItemId: rawRecord.externalItemId,
    asin: rawRecord.asin,
    sku: rawRecord.sku,
    normalizeStatus: rawRecord.normalizeStatus,
    importStatus: rawRecord.importStatus,
    postImportStatus: rawRecord.postImportStatus,
    postImportAttempts: rawRecord.postImportAttempts,
    postImportQueuedAt: rawRecord.postImportQueuedAt,
    postImportStartedAt: rawRecord.postImportStartedAt,
    postImportFinishedAt: rawRecord.postImportFinishedAt,
    postImportErrorCode: rawRecord.postImportErrorCode,
    postImportErrorMessage: rawRecord.postImportErrorMessage,
    orderId: toId(rawRecord.orderId),
    orderItemId: toId(rawRecord.orderItemId),
    errorCode: rawRecord.errorCode,
    errorMessage: rawRecord.errorMessage,
    createdAt: rawRecord.createdAt,
    updatedAt: rawRecord.updatedAt,
  };
}

function toPaginatedDto(result = {}, mapper) {
  return {
    items: (result.items || []).map(mapper),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  toImportJobDto,
  toIssueDto,
  toRawRecordDto,
  toPaginatedDto,
};
