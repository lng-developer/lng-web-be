const fs = require('fs');
const path = require('path');
const { toCsv } = require('./convertLegacyVendorExport');

const vendorHeaders = [
  'legacyId',
  'code',
  'name',
  'providerKey',
  'fulfillmentType',
  'legacyFulfillmentType',
  'status',
];

const vendorProductHeaders = [
  'legacyId',
  'legacyVendorId',
  'vendorCode',
  'code',
  'name',
  'externalProductId',
  'productTypeGroupCode',
  'productUrl',
  'imageUrl',
  'designTemplateUrl',
  'minProductionDays',
  'maxProductionDays',
  'baseCostAmount',
  'currency',
  'status',
];

const vendorCostCenterHeaders = [
  'legacyId',
  'legacyVendorProductId',
  'vendorProductCode',
  'code',
  'name',
  'vendorSize',
  'vendorColor',
  'standardSize',
  'standardColor',
  'weight',
  'weightUnit',
  'width',
  'length',
  'height',
  'dimensionUnit',
  'sku',
  'lngCode',
  'baseCostAmount',
  'currency',
  'domesticEconomyAmount',
  'domesticAdditionalAmount',
  'internationalEconomyAmount',
  'internationalAdditionalAmount',
  'priorityEconomyAmount',
  'priorityAdditionalAmount',
  'importTaxAmount',
  'embroideryAmount',
  'twoSidedPrintAmount',
  'twoPositionPrintAmount',
  'status',
];

function writeVendorTemplateCsv({ outDir, vendors = [], vendorProducts = [], vendorCostCenters = [] }) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'vendors.csv'), toCsv(vendors, vendorHeaders));
  fs.writeFileSync(path.join(outDir, 'vendor_products.csv'), toCsv(vendorProducts, vendorProductHeaders));
  fs.writeFileSync(path.join(outDir, 'vendor_cost_centers.csv'), toCsv(vendorCostCenters, vendorCostCenterHeaders));
}

module.exports = {
  vendorHeaders,
  vendorProductHeaders,
  vendorCostCenterHeaders,
  writeVendorTemplateCsv,
};
