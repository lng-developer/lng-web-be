function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toSubmissionDto(sub) {
  if (!sub) return null;
  return {
    id: toId(sub._id || sub.id),
    shopId: toId(sub.shopId),
    agentId: toId(sub.agentId),
    commandId: toId(sub.commandId),
    shipmentIds: (sub.shipmentIds || []).map(toId),
    filename: sub.filename,
    rowCount: sub.rowCount,
    checksum: sub.checksum,
    status: sub.status,
    amazonBatchId: sub.amazonBatchId || null,
    result: sub.result || { importedCount: 0, failedCount: 0, diagnostics: [] },
    submittedAt: sub.submittedAt || null,
    completedAt: sub.completedAt || null,
    errorMessage: sub.errorMessage || null,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  };
}

function toSubmissionDetailDto(sub) {
  if (!sub) return null;
  return {
    ...toSubmissionDto(sub),
    tsv: sub.tsv,
    rows: (sub.rows || []).map((row) => ({
      shipmentId: toId(row.shipmentId),
      orderId: toId(row.orderId),
      externalOrderId: row.externalOrderId,
      shipDate: row.shipDate,
      carrierCode: row.carrierCode,
      trackingNumber: row.trackingNumber,
      shipMethod: row.shipMethod,
    })),
  };
}

function toLeasedPayloadDto(sub) {
  if (!sub) return null;
  return {
    submissionId: toId(sub._id || sub.id),
    filename: sub.filename,
    tsv: sub.tsv,
    rowCount: sub.rowCount,
    checksum: sub.checksum,
  };
}

module.exports = {
  toSubmissionDto,
  toSubmissionDetailDto,
  toLeasedPayloadDto,
};
