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
      externalItemId: row.externalItemId || null,
      quantity: row.quantity !== undefined && row.quantity !== null ? String(row.quantity) : null,
      shipDate: row.shipDate,
      carrier: row.carrier || null,
      carrierCode: row.carrierCode,
      carrierName: row.carrierName || null,
      trackingNumber: row.trackingNumber,
      shipMethod: row.shipMethod,
    })),
  };
}

function toPreviewDto(data) {
  if (!data) return null;
  return {
    items: (data.items || []).map((r) => ({
      key: r.key || `${r.externalOrderId}__${r.trackingNumber || r.shipmentId}`,
      shipmentId: toId(r.shipmentId),
      orderId: toId(r.orderId),
      orderItemId: toId(r.orderItemId),
      shipmentIds: (r.shipmentIds || []).map(toId),
      externalOrderId: r.externalOrderId || '',
      externalItemId: r.externalItemId || '',
      quantity: r.quantity !== undefined && r.quantity !== null && r.quantity !== '' ? String(r.quantity) : '',
      shipDate: r.shipDate || '',
      carrier: r.carrier || '',
      carrierCode: r.carrierCode || '',
      carrierName: r.carrierName || '',
      trackingNumber: r.trackingNumber || '',
      shipMethod: r.shipMethod || '',
      itemCount: r.itemCount || 1,
      marketplaceConfirmationStatus: r.marketplaceConfirmationStatus || 'PENDING',
      marketplaceConfirmedAt: r.marketplaceConfirmedAt || null,
      isReady: r.isReady !== false,
      issues: r.issues || [],
    })),
    tsv: data.tsv || '',
    rowCount: data.rowCount || 0,
    summary: data.summary || {
      totalOrders: 0,
      totalShipments: 0,
      readyOrders: 0,
      readyShipments: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
    },
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
  toPreviewDto,
};
