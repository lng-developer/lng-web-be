function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toAssetDownloadUrl(assetId) {
  const id = toId(assetId);
  return id ? `/api/media/assets/${id}/download` : null;
}

function outputStatus(check = {}) {
  if (check.outputAssetId) return 'UPLOADED';
  return check.required ? 'MISSING' : 'NOT_REQUIRED';
}

function toFileCheckDto(check = {}) {
  const inputAssetId = toId(check.inputAssetId);
  const outputAssetId = toId(check.outputAssetId);
  return {
    id: toId(check._id || check.id),
    slotKey: check.slotKey,
    slotLabel: check.slotLabel || null,
    required: Boolean(check.required),
    sourceType: check.sourceType,
    inputAssetId,
    inputAssetDownloadUrl: toAssetDownloadUrl(inputAssetId),
    inputSourceLabel: check.inputSourceLabel || null,
    inputSlotKey: check.inputSlotKey || null,
    inputImageName: check.inputImageName || null,
    outputAssetId,
    outputAssetDownloadUrl: toAssetDownloadUrl(outputAssetId),
    outputStatus: outputStatus(check),
    scaleStatus: check.scaleStatus,
    qcStatus: check.qcStatus,
    blockers: check.blockers || [],
    note: check.note || null,
  };
}

function toTemplateRefDto(template) {
  if (!template) return null;
  if (typeof template !== 'object') return { id: toId(template) };
  return {
    id: toId(template),
    code: template.code || null,
    name: template.name || null,
    productTypeGroupId: toId(template.productTypeGroupId),
    status: template.status || null,
  };
}

function toOrderItemDto(snapshot) {
  if (!snapshot) return null;
  return {
    externalOrderId: snapshot.externalOrderId || null,
    externalItemId: snapshot.externalItemId || null,
    externalAccountId: snapshot.externalAccountId || null,
    salesChannelCode: snapshot.salesChannelCode || null,
    marketplaceCode: snapshot.marketplaceCode || null,
    asin: snapshot.asin || null,
    sku: snapshot.sku || null,
    title: snapshot.title || null,
    status: snapshot.status || null,
    groupId: snapshot.groupId || null,
    groupType: snapshot.groupType || null,
  };
}

function toOrderItemSummaryDto(snapshot) {
  if (!snapshot) return null;
  return {
    externalOrderId: snapshot.externalOrderId || null,
    externalItemId: snapshot.externalItemId || null,
    asin: snapshot.asin || null,
    sku: snapshot.sku || null,
    title: snapshot.title || null,
    status: snapshot.status || null,
  };
}

function toOrderDto(snapshot) {
  if (!snapshot) return null;
  return {
    id: toId(snapshot.id || snapshot._id),
    status: snapshot.status || null,
    assignedStaffId: toId(snapshot.assignedStaffId),
    externalAccountId: snapshot.externalAccountId || null,
  };
}

function toListingDto(snapshot) {
  if (!snapshot) return null;
  return {
    id: toId(snapshot),
    shopId: toId(snapshot.shopId),
    salesChannelCode: snapshot.salesChannelCode || null,
    marketplaceCode: snapshot.marketplaceCode || null,
    sku: snapshot.sku || null,
    asin: snapshot.asin || null,
    etsyListingId: snapshot.etsyListingId || null,
    title: snapshot.title || null,
    productTypeGroupId: toId(snapshot.productTypeGroupId),
    internalTemplate: toTemplateRefDto(snapshot.internalTemplateId),
    psdTemplateAssetId: toId(snapshot.psdTemplateAssetId),
    costCenterStatus: snapshot.costCenterStatus || null,
    psdStatus: snapshot.psdStatus || null,
    status: snapshot.status || null,
    qcStatus: snapshot.qcStatus || null,
  };
}

function toScaleListingDto(snapshot) {
  if (!snapshot) return null;
  return {
    id: toId(snapshot),
    sku: snapshot.sku || null,
    asin: snapshot.asin || null,
    title: snapshot.title || null,
    psdStatus: snapshot.psdStatus || null,
    costCenterStatus: snapshot.costCenterStatus || null,
  };
}

function toInternalTemplateDto(snapshot) {
  if (!snapshot) return null;
  return {
    id: toId(snapshot),
    code: snapshot.code || null,
    name: snapshot.name || null,
    productTypeGroupId: toId(snapshot.productTypeGroupId),
    artworkSlots: snapshot.artworkSlots || [],
    designAssets: snapshot.designAssets || [],
    requiredFields: snapshot.requiredFields || [],
    status: snapshot.status || null,
  };
}

function toCustomizationAssetDto(asset = {}) {
  const assetId = toId(asset.assetId || asset.id || asset._id);
  return {
    assetId,
    assetDownloadUrl: toAssetDownloadUrl(assetId),
    secureUrl: asset.secureUrl || null,
    filename: asset.filename || asset.originalFilename || null,
    mimeType: asset.mimeType || null,
    size: asset.size || null,
  };
}

function toCustomizationDto(snapshot) {
  if (!snapshot) return null;
  return {
    payloadId: toId(snapshot.payloadId),
    status: snapshot.status || null,
    needsReview: Boolean(snapshot.needsReview),
    customerInputs: snapshot.customerInputs || null,
    imageAssets: (snapshot.imageAssets || []).map(toCustomizationAssetDto),
    failedImages: snapshot.failedImages || [],
  };
}

function toVendorProductDto(snapshot) {
  if (!snapshot) return null;
  return {
    id: toId(snapshot),
    code: snapshot.code || null,
    name: snapshot.name || null,
    vendor: snapshot.vendor || null,
  };
}

function toVendorCostCenterDto(snapshot) {
  if (!snapshot) return null;
  return {
    id: toId(snapshot),
    code: snapshot.code || null,
    name: snapshot.name || null,
    baseCostAmount: snapshot.baseCostAmount ?? null,
    currency: snapshot.currency || null,
  };
}

function toVendorSubmissionDto(submission) {
  if (!submission) return null;
  return {
    id: toId(submission),
    status: submission.status || null,
    submittedAt: submission.submittedAt || null,
    failedAt: submission.failedAt || null,
    failureReason: submission.failureReason || null,
    updatedAt: submission.updatedAt,
  };
}

function missingRequirement(code, message) {
  return { code, message };
}

function toAssetUseDto(check = {}) {
  const inputAssetId = toId(check.inputAssetId);
  const outputAssetId = toId(check.outputAssetId);
  return {
    fileCheckId: toId(check._id || check.id),
    slotKey: check.slotKey,
    slotLabel: check.slotLabel || null,
    sourceType: check.sourceType,
    inputAssetId,
    inputAssetDownloadUrl: toAssetDownloadUrl(inputAssetId),
    inputSourceLabel: check.inputSourceLabel || null,
    inputSlotKey: check.inputSlotKey || null,
    inputImageName: check.inputImageName || null,
    outputAssetId,
    outputAssetDownloadUrl: toAssetDownloadUrl(outputAssetId),
    outputStatus: outputStatus(check),
    scaleStatus: check.scaleStatus,
    qcStatus: check.qcStatus,
    blockers: check.blockers || [],
  };
}

function toPsdTemplateUseDto(task = {}, listing = null, fileChecks = []) {
  const psdCheck = fileChecks.find((check) => check.sourceType === 'PSD_TEMPLATE' || check.slotKey === 'PSD_TEMPLATE');
  const assetId = toId(psdCheck?.inputAssetId || listing?.psdTemplateAssetId);
  return {
    assetId,
    assetDownloadUrl: toAssetDownloadUrl(assetId),
    fileCheckId: toId(psdCheck?._id || psdCheck?.id),
    status: task.blockers?.includes('PSD_MISSING') ? 'MISSING' : (assetId ? 'READY' : 'UNKNOWN'),
  };
}

function toScaleContextDto(task = {}) {
  const blockers = task.blockers || [];
  const rawListing = toListingDto(task.listingSnapshot);
  const listing = toScaleListingDto(task.listingSnapshot);
  const internalTemplate = toInternalTemplateDto(task.templateSnapshot);
  const customization = toCustomizationDto(task.customizationSnapshot);
  const vendorProduct = toVendorProductDto(task.vendorProductSnapshot);
  const vendorCostCenter = toVendorCostCenterDto(task.vendorCostCenterSnapshot);
  const fileChecks = task.fileChecks || [];
  const scaleSlots = fileChecks
    .filter((check) => check.sourceType === 'CUSTOMER_IMAGE')
    .map(toAssetUseDto);
  const requirements = [];

  if (blockers.includes('MAPPING_NOT_READY') || !vendorProduct || !vendorCostCenter) {
    requirements.push(missingRequirement('VENDOR_MAPPING', 'Vendor product or cost center is missing.'));
  }
  if (blockers.includes('TEMPLATE_NOT_FOUND') || !internalTemplate) {
    requirements.push(missingRequirement('INTERNAL_TEMPLATE', 'Internal template is missing.'));
  }
  if (blockers.includes('PSD_MISSING')) {
    requirements.push(missingRequirement('PSD_TEMPLATE', 'PSD template asset is missing.'));
  }
  if (blockers.includes('CUSTOMER_IMAGE_MISSING')) {
    requirements.push(missingRequirement('CUSTOMER_IMAGE', 'Customer image asset is missing.'));
  }

  const canScale = requirements.length === 0
    && scaleSlots.some((slot) => slot.inputAssetId && !slot.outputAssetId);
  const hasOutput = scaleSlots.some((slot) => slot.outputAssetId);
  const status = requirements.length > 0
    ? 'BLOCKED'
    : (canScale ? 'READY_TO_SCALE' : ((task.scaleStatus === 'SCALED' || hasOutput) ? 'OUTPUT_UPLOADED' : 'NO_SCALE_REQUIRED'));

  return {
    status,
    canScale,
    missingRequirements: requirements,
    use: {
      listing,
      template: internalTemplate,
      psdTemplate: toPsdTemplateUseDto(task, rawListing, fileChecks),
      scaleSlots,
    },
  };
}

function designAssignmentStatus(task = {}) {
  if (['QC_PENDING', 'QC_REJECTED', 'READY_TO_SEND_VENDOR', 'SENT_TO_VENDOR'].includes(task.status)) {
    return 'OUTPUT_UPLOADED';
  }
  return task.assignedDesignUserId ? 'ASSIGNED' : 'UNASSIGNED';
}

function toUserSummaryDto(profile, fallbackId) {
  const id = toId(profile?.accountId || fallbackId);
  if (!id) return null;
  return {
    id,
    fullName: profile?.fullName || null,
    employeeCode: profile?.employeeCode || null,
  };
}

function parseEmployeeCodeFromSku(sku) {
  const [employeeCode] = String(sku || '').trim().split('-');
  return employeeCode || null;
}

function toSellerDto(task = {}) {
  const employeeCode = parseEmployeeCodeFromSku(task.orderItemSnapshot?.sku);
  if (!employeeCode) return null;
  return {
    employeeCode,
    name: task.sellerUser?.fullName || null,
  };
}

function toShopDto(task = {}) {
  const id = toId(task.shop?._id || task.shop?.id || task.shopId);
  if (!id) return null;
  return {
    id,
    name: task.shop?.name || null,
  };
}

function orderStatus(task = {}) {
  return task.orderSnapshot?.status || task.orderItemSnapshot?.orderStatus || null;
}

function shippingType(task = {}) {
  return task.orderSnapshot?.shippingService?.level
    || task.orderSnapshot?.shippingService?.name
    || null;
}

function fulfillName(task = {}) {
  return task.orderSnapshot?.shippingAddress?.name
    || task.orderSnapshot?.buyer?.name
    || null;
}

function commonTaskFields(task = {}) {
  const salesChannelCode = task.orderItemSnapshot?.salesChannelCode || task.salesChannelCode || null;
  const marketplaceCode = task.orderItemSnapshot?.marketplaceCode || task.marketplaceCode || null;
  const groupId = task.groupId || task.orderItemSnapshot?.groupId || null;
  const groupType = task.groupType || task.orderItemSnapshot?.groupType || null;
  const ownerId = toId(task.orderSnapshot?.assignedStaffId || task.orderOwnerUser?.accountId);
  const shop = toShopDto(task);
  return {
    shopId: toId(task.shopId),
    shopName: shop?.name || null,
    shop,
    salesChannelCode,
    marketplaceCode,
    orderDate: task.orderSnapshot?.orderedAt || task.createdAt || null,
    shippingType: shippingType(task),
    fulfillName: fulfillName(task),
    productImageUrl: task.orderItemSnapshot?.productImageUrl || task.listingSnapshot?.productImageUrl || null,
    orderStatus: orderStatus(task),
    orderOwner: toUserSummaryDto(task.orderOwnerUser, ownerId),
    seller: toSellerDto(task),
    ...(groupId ? { groupId } : {}),
    ...(groupType ? { groupType } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function assignmentUserFields(task = {}) {
  const assignedDesigner = toUserSummaryDto(task.scaleByUser, task.assignedDesignUserId);
  const qcUser = toUserSummaryDto(task.qcByUser, task.qcBy);
  const csAssignee = toUserSummaryDto(task.csAssigneeUser, task.csAssigneeId);
  return {
    ...(assignedDesigner ? { assignedDesigner } : {}),
    ...(qcUser ? { qcUser } : {}),
    ...(csAssignee ? { csAssignee } : {}),
  };
}

function csWorkflowFields(task = {}) {
  return {
    csAssigneeId: toId(task.csAssigneeId),
    csAssignedBy: toId(task.csAssignedBy),
    csAssignedAt: task.csAssignedAt || null,
    csStatus: task.csStatus || 'UNASSIGNED',
    csNote: task.csNote || null,
  };
}

function toProductionTaskDto(task) {
  if (!task) return null;
  return {
    id: toId(task),
    orderId: toId(task.orderId),
    shopId: toId(task.shopId),
    orderItemId: toId(task.orderItemId),
    fulfillmentPlanId: toId(task.fulfillmentPlanId),
    orderItem: toOrderItemDto(task.orderItemSnapshot),
    order: toOrderDto(task.orderSnapshot),
    listing: toListingDto(task.listingSnapshot),
    internalTemplate: toInternalTemplateDto(task.templateSnapshot),
    customization: toCustomizationDto(task.customizationSnapshot),
    vendorProduct: toVendorProductDto(task.vendorProductSnapshot),
    vendorCostCenter: toVendorCostCenterDto(task.vendorCostCenterSnapshot),
    fulfillQty: task.fulfillQty,
    status: task.status,
    scaleStatus: task.scaleStatus,
    qcStatus: task.qcStatus,
    blockers: task.blockers || [],
    fileChecks: (task.fileChecks || []).map(toFileCheckDto),
    scaleContext: toScaleContextDto(task),
    assignedDesignUserId: toId(task.assignedDesignUserId),
    assignedAt: task.assignedAt || null,
    designNote: task.designNote || null,
    designAssignmentStatus: designAssignmentStatus(task),
    ...csWorkflowFields(task),
    qcBy: toId(task.qcBy),
    ...assignmentUserFields(task),
    qcAt: task.qcAt || null,
    readyAt: task.readyAt || null,
    sentToVendorAt: task.sentToVendorAt || null,
    vendorSubmissionId: toId(task.vendorSubmissionId),
    vendorSubmission: toVendorSubmissionDto(task.vendorSubmission),
    ...commonTaskFields(task),
  };
}

function toProductionTaskSummaryDto(task) {
  if (!task) return null;
  return {
    id: toId(task),
    orderItemId: toId(task.orderItemId),
    fulfillmentPlanId: toId(task.fulfillmentPlanId),
    orderItem: toOrderItemSummaryDto(task.orderItemSnapshot),
    customization: toCustomizationDto(task.customizationSnapshot),
    vendorProduct: toVendorProductDto(task.vendorProductSnapshot),
    vendorCostCenter: toVendorCostCenterDto(task.vendorCostCenterSnapshot),
    productionStatus: task.status,
    scaleStatus: task.scaleStatus,
    qcStatus: task.qcStatus,
    blockers: task.blockers || [],
    fulfillQty: task.fulfillQty,
    scaleContext: toScaleContextDto(task),
    assignedDesignUserId: toId(task.assignedDesignUserId),
    qcBy: toId(task.qcBy),
    ...assignmentUserFields(task),
    assignedAt: task.assignedAt || null,
    designNote: task.designNote || null,
    designAssignmentStatus: designAssignmentStatus(task),
    ...csWorkflowFields(task),
    readyAt: task.readyAt || null,
    sentToVendorAt: task.sentToVendorAt || null,
    vendorSubmission: toVendorSubmissionDto(task.vendorSubmission),
    ...commonTaskFields(task),
  };
}

module.exports = {
  designAssignmentStatus,
  toFileCheckDto,
  toId,
  toProductionTaskDto,
  toProductionTaskSummaryDto,
};
