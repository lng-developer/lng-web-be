function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toImportBatchDto(batch) {
  if (!batch) return null;
  return {
    id: toId(batch._id || batch.id),
    sourceType: batch.sourceType,
    originalFilename: batch.originalFilename,
    sourceRef: batch.sourceRef,
    dryRun: batch.dryRun,
    shopId: toId(batch.shopId),
    salesChannelCode: batch.salesChannelCode,
    marketplaceCode: batch.marketplaceCode,
    importedBy: toId(batch.importedBy),
    status: batch.status,
    processedRows: batch.processedRows,
    validRows: batch.validRows,
    skippedRows: batch.skippedRows,
    unlinkedRows: batch.unlinkedRows,
    upserted: batch.upserted || {},
    errorCount: batch.errorCount,
    errors: batch.errors || [],
    finishedAt: batch.finishedAt || null,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

function toImportedDataDto(row) {
  if (!row) return null;
  const { _id, __v, rawReference, ...data } = row;
  return { id: toId(_id || row.id), ...data };
}

function toPaginatedImportResponse(result = {}, itemMapper) {
  return {
    items: (result.items || []).map(itemMapper),
    total: result.total,
    page: result.page,
    limit: result.limit,
  };
}

module.exports = {
  toImportBatchDto,
  toImportedDataDto,
  toPaginatedImportResponse,
};
