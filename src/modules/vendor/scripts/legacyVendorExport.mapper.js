const { recordStatuses } = require('../constants/vendor.constants');

function unwrapExtendedJson(value) {
  if (value && typeof value === 'object') {
    if (value.$oid) return value.$oid;
    if (value.$date) return value.$date;
  }
  return value;
}

function toCode(value, fallback = 'UNKNOWN') {
  const code = String(value || '')
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return code || fallback;
}

function normalizeStatus(value) {
  return String(value || '').toLowerCase() === 'inactive'
    ? recordStatuses.INACTIVE
    : recordStatuses.ACTIVE;
}

function moneyToMinorUnits(value) {
  if (value === undefined || value === null || value === '') return 0;
  const normalized = String(value).trim().replace(/,/g, '');
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [dollars = '0', cents = ''] = unsigned.split('.');
  const amount = (Number.parseInt(dollars || '0', 10) * 100)
    + Number.parseInt(cents.padEnd(2, '0').slice(0, 2) || '0', 10);
  return negative ? -amount : amount;
}

function mapLegacyVendor(rawVendor) {
  return {
    legacyId: unwrapExtendedJson(rawVendor._id),
    code: toCode(rawVendor.name),
    name: String(rawVendor.name || '').trim(),
    providerKey: toCode(rawVendor.name),
    fulfillmentType: 'POD',
    legacyFulfillmentType: rawVendor.fulfillment_type || null,
    status: normalizeStatus(rawVendor.status),
  };
}

function buildProductTypeGroupLookup(groups = []) {
  const lookup = new Map();
  for (const group of groups) {
    const groupCode = toCode(group.code || group.name);
    for (const item of group.items || []) {
      const productId = unwrapExtendedJson(item.vendor_product);
      if (productId && !lookup.has(productId)) lookup.set(productId, groupCode);
    }
  }
  return lookup;
}

function mapLegacyProduct(rawProduct, { vendorCodeById, productTypeGroupCodeByProductId } = {}) {
  const legacyId = unwrapExtendedJson(rawProduct._id);
  const externalProductId = rawProduct.product_id ? String(rawProduct.product_id).trim() : '';
  const productTypeGroupCode = productTypeGroupCodeByProductId && productTypeGroupCodeByProductId.get(legacyId) || '';
  return {
    legacyId,
    legacyVendorId: unwrapExtendedJson(rawProduct.vendor_id),
    vendorCode: vendorCodeById && vendorCodeById.get(unwrapExtendedJson(rawProduct.vendor_id)) || '',
    code: externalProductId ? toCode(`PRODUCT_${externalProductId}`) : toCode(rawProduct.product_name),
    name: String(rawProduct.product_name || '').trim(),
    externalProductId,
    productTypeGroupCode,
    migrationAction: productTypeGroupCode ? '' : 'MERGE_REVIEW',
    productUrl: '',
    imageUrl: rawProduct.image || '',
    designTemplateUrl: '',
    minProductionDays: '',
    maxProductionDays: '',
    baseCostAmount: 0,
    currency: 'USD',
    status: normalizeStatus(rawProduct.status),
  };
}

function mapLegacyCostCenter(rawCostCenter, { productCodeById } = {}) {
  const productId = unwrapExtendedJson(rawCostCenter.vendor_product);
  const productCode = productCodeById && productCodeById.get(productId) || '';
  const code = toCode([
    productCode,
    rawCostCenter.standard_size || rawCostCenter.vendor_size,
    rawCostCenter.standard_color || rawCostCenter.vendor_color,
    rawCostCenter.sku,
  ].filter(Boolean).join('_'));

  return {
    legacyId: unwrapExtendedJson(rawCostCenter._id),
    legacyVendorProductId: productId,
    vendorProductCode: productCode,
    code,
    name: [
      rawCostCenter.standard_size || rawCostCenter.vendor_size,
      rawCostCenter.standard_color || rawCostCenter.vendor_color,
    ].filter(Boolean).join(' / ') || code,
    vendorSize: rawCostCenter.vendor_size || '',
    vendorColor: rawCostCenter.vendor_color || '',
    standardSize: rawCostCenter.standard_size || '',
    standardColor: rawCostCenter.standard_color || '',
    printMethod: ['DTF', 'DTG'].includes(String(rawCostCenter.printing_method || '').trim().toUpperCase())
      ? String(rawCostCenter.printing_method).trim().toUpperCase()
      : '',
    sku: rawCostCenter.sku || '',
    lngCode: rawCostCenter.lng_code || '',
    weight: '',
    weightUnit: '',
    width: '',
    length: '',
    height: '',
    dimensionUnit: '',
    baseCostAmount: moneyToMinorUnits(rawCostCenter.base_cost),
    currency: 'USD',
    domesticEconomyAmount: moneyToMinorUnits(rawCostCenter.dosmetic && rawCostCenter.dosmetic.economy),
    domesticAdditionalAmount: moneyToMinorUnits(rawCostCenter.dosmetic && rawCostCenter.dosmetic.additional),
    internationalEconomyAmount: moneyToMinorUnits(rawCostCenter.international && rawCostCenter.international.economy),
    internationalAdditionalAmount: moneyToMinorUnits(rawCostCenter.international && rawCostCenter.international.additional),
    priorityEconomyAmount: moneyToMinorUnits(rawCostCenter.priority && rawCostCenter.priority.economy),
    priorityAdditionalAmount: moneyToMinorUnits(rawCostCenter.priority && rawCostCenter.priority.additional),
    importTaxAmount: 0,
    embroideryAmount: moneyToMinorUnits(rawCostCenter.additional_costs && rawCostCenter.additional_costs.embroidery),
    twoSidedPrintAmount: moneyToMinorUnits(rawCostCenter.additional_costs && rawCostCenter.additional_costs.two_sided_print),
    twoPositionPrintAmount: moneyToMinorUnits(rawCostCenter.additional_costs && rawCostCenter.additional_costs.two_position_print),
    status: normalizeStatus(rawCostCenter.status),
  };
}

module.exports = {
  buildProductTypeGroupLookup,
  mapLegacyCostCenter,
  mapLegacyProduct,
  mapLegacyVendor,
  moneyToMinorUnits,
  toCode,
  unwrapExtendedJson,
};
