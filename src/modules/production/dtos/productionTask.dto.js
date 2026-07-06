function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toFileCheckDto(check = {}) {
  return {
    id: toId(check._id || check.id),
    slotKey: check.slotKey,
    slotLabel: check.slotLabel || null,
    required: Boolean(check.required),
    sourceType: check.sourceType,
    inputAssetId: toId(check.inputAssetId),
    outputAssetId: toId(check.outputAssetId),
    scaleStatus: check.scaleStatus,
    qcStatus: check.qcStatus,
    blockers: check.blockers || [],
    note: check.note || null,
  };
}

function designAssignmentStatus(task = {}) {
  if (['QC_PENDING', 'QC_REJECTED', 'READY_TO_SEND_VENDOR', 'SENT_TO_VENDOR'].includes(task.status)) {
    return 'OUTPUT_UPLOADED';
  }
  return task.assignedDesignUserId ? 'ASSIGNED' : 'UNASSIGNED';
}

function toProductionTaskDto(task) {
  if (!task) return null;
  return {
    id: toId(task),
    orderId: toId(task.orderId),
    shopId: toId(task.shopId),
    orderItemId: toId(task.orderItemId),
    fulfillmentPlanId: toId(task.fulfillmentPlanId),
    orderItem: task.orderItemSnapshot || null,
    listing: task.listingSnapshot || null,
    internalTemplate: task.templateSnapshot || null,
    vendorProduct: task.vendorProductSnapshot || null,
    vendorCostCenter: task.vendorCostCenterSnapshot || null,
    fulfillQty: task.fulfillQty,
    status: task.status,
    scaleStatus: task.scaleStatus,
    qcStatus: task.qcStatus,
    blockers: task.blockers || [],
    fileChecks: (task.fileChecks || []).map(toFileCheckDto),
    assignedDesignUserId: toId(task.assignedDesignUserId),
    assignedAt: task.assignedAt || null,
    designNote: task.designNote || null,
    designAssignmentStatus: designAssignmentStatus(task),
    qcBy: toId(task.qcBy),
    qcAt: task.qcAt || null,
    readyAt: task.readyAt || null,
    sentToVendorAt: task.sentToVendorAt || null,
    vendorSubmissionId: toId(task.vendorSubmissionId),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function toProductionTaskSummaryDto(task) {
  if (!task) return null;
  return {
    id: toId(task),
    orderItemId: toId(task.orderItemId),
    orderItem: task.orderItemSnapshot || null,
    productionStatus: task.status,
    scaleStatus: task.scaleStatus,
    qcStatus: task.qcStatus,
    blockers: task.blockers || [],
    fulfillQty: task.fulfillQty,
    assignedDesignUserId: toId(task.assignedDesignUserId),
    scaleBy: toId(task.assignedDesignUserId),
    qcBy: toId(task.qcBy),
    assignedAt: task.assignedAt || null,
    designNote: task.designNote || null,
    designAssignmentStatus: designAssignmentStatus(task),
    readyAt: task.readyAt || null,
    sentToVendorAt: task.sentToVendorAt || null,
  };
}

module.exports = {
  designAssignmentStatus,
  toFileCheckDto,
  toId,
  toProductionTaskDto,
  toProductionTaskSummaryDto,
};
