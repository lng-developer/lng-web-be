const workflowOwners = Object.freeze({
  CS: 'CS',
  DESIGN: 'DESIGN',
  MAPPING: 'MAPPING',
  OPERATIONS: 'OPERATIONS',
  SCALE: 'SCALE',
  VENDOR: 'VENDOR',
  SHIPPING: 'SHIPPING',
  SYSTEM: 'SYSTEM',
});

const terminalItemStatuses = new Set(['CANCELLED', 'FAILED', 'REFUNDED']);
const readyCustomizationStatuses = new Set(['PARSED', 'APPROVED', 'READY', 'NOT_REQUIRED']);
const readyMappingStatuses = new Set(['READY', 'CONFIRMED']);

function stage(stage, owner, blockers = [], nextActions = []) {
  return { stage, owner, blockers: blockers.map((code) => ({ code })), nextActions };
}

function hasRequiredCustomization(item = {}, customization = {}) {
  return Boolean(item?.customizationRawSummary?.hasCustomization || customization?.required);
}

function hasReadyMapping(mapping = {}) {
  return readyMappingStatuses.has(String(mapping?.status || '').toUpperCase())
    && Boolean(mapping?.vendorProduct?.id || mapping?.vendorProduct?._id)
    && Boolean(mapping?.vendorCostCenter?.id || mapping?.vendorCostCenter?._id);
}

function hasPsd(listing = {}, production = {}) {
  const blockers = production?.blockers || [];
  if (blockers.includes('PSD_MISSING')) return false;
  if (listing?.psdReadiness) return listing.psdReadiness.status !== 'MISSING';
  if (String(listing?.psdStatus || '').toUpperCase() === 'MISSING') return false;
  return Boolean(listing?.psdTemplateAssetId || listing?.psdTemplate?.assetId);
}

function deriveOrderItemWorkflow({
  item = {},
  order = {},
  customization = {},
  mapping = {},
  listing = {},
  production = null,
  shipment = null,
} = {}) {
  const itemStatus = String(item?.status || '').toUpperCase();
  const productionStatus = String(production?.status || production?.productionStatus || '').toUpperCase();
  const qcStatus = String(production?.qcStatus || '').toUpperCase();
  const shipmentStatus = String(shipment?.status || '').toUpperCase();
  const blockers = production?.blockers || [];

  if (terminalItemStatuses.has(itemStatus)) return stage(itemStatus, workflowOwners.SYSTEM);
  if (shipmentStatus === 'DELIVERED') return stage('DELIVERED', workflowOwners.SYSTEM);
  if (shipmentStatus === 'SHIPPED' || itemStatus === 'SHIPPED') return stage('SHIPPED', workflowOwners.SYSTEM);
  if (shipmentStatus === 'TRACKING_PENDING' || itemStatus === 'TRACKING_PENDING') {
    return stage('TRACKING_PENDING', workflowOwners.SHIPPING, [], ['RECHECK_TRACKING']);
  }
  if (productionStatus === 'SENT_TO_VENDOR' || itemStatus === 'SENT_TO_VENDOR') {
    return stage('SENT_TO_VENDOR', workflowOwners.SHIPPING, [], ['RECHECK_TRACKING']);
  }
  if (productionStatus === 'READY_TO_SEND_VENDOR' || itemStatus === 'READY_TO_SEND_VENDOR') {
    return stage('READY_TO_SEND_VENDOR', workflowOwners.VENDOR, [], ['SUBMIT_TO_VENDOR']);
  }
  if (qcStatus === 'REJECTED' || productionStatus === 'QC_REJECTED' || blockers.includes('QC_REJECTED')) {
    return stage('QC_REJECTED', workflowOwners.SCALE, ['QC_REJECTED'], ['RESCALE']);
  }
  if (order?.addressValidationStatus && order.addressValidationStatus !== 'VALID' && order.addressValidationStatus !== 'OVERRIDDEN') {
    return stage('NEED_ADDRESS', workflowOwners.CS, ['ADDRESS_NOT_VALID'], ['VALIDATE_ADDRESS']);
  }
  if (hasRequiredCustomization(item, customization)
    && !readyCustomizationStatuses.has(String(customization.status || '').toUpperCase())) {
    return stage('NEED_CUSTOMIZATION', workflowOwners.CS, ['CUSTOMIZATION_NOT_READY'], ['RECHECK_CUSTOMIZATION']);
  }
  if (!hasReadyMapping(mapping)) {
    return stage('NEED_MAPPING', workflowOwners.MAPPING, ['MAPPING_NOT_READY'], ['RECHECK_MAPPING']);
  }
  if (mapping?.checks?.internalTemplate?.ok === false || blockers.includes('TEMPLATE_NOT_FOUND')) {
    return stage('NEED_TEMPLATE', workflowOwners.DESIGN, ['TEMPLATE_NOT_FOUND'], ['CREATE_TEMPLATE']);
  }
  if (!hasPsd(listing, production)) {
    return stage('NEED_PSD', workflowOwners.DESIGN, ['PSD_MISSING'], ['CREATE_PSD_TASK']);
  }
  if (blockers.includes('CUSTOMER_IMAGE_MISSING')) {
    return stage('NEED_CUSTOMER_IMAGE', workflowOwners.CS, ['CUSTOMER_IMAGE_MISSING'], ['REQUEST_CUSTOMER_IMAGE']);
  }
  if (!production) return stage('NEED_PRODUCTION', workflowOwners.OPERATIONS, [], ['CREATE_PRODUCTION_TASK']);
  if (qcStatus === 'PENDING' || productionStatus === 'QC_PENDING') {
    return stage('QC_PENDING', workflowOwners.SCALE, [], ['REVIEW_QC']);
  }
  if (productionStatus === 'NEED_SCALE' || production?.scaleStatus === 'NEED_SCALE') {
    return production.assignedDesignUserId
      ? stage('IN_SCALE', workflowOwners.SCALE, [], ['UPLOAD_SCALE_OUTPUT'])
      : stage('READY_FOR_SCALE', workflowOwners.SCALE, [], ['ASSIGN_SCALE']);
  }
  return stage('NEEDS_ATTENTION', workflowOwners.OPERATIONS, blockers, ['RECHECK_ORDER_ITEM']);
}

module.exports = {
  deriveOrderItemWorkflow,
  workflowOwners,
};
