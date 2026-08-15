const { toOrderWorkbenchDto } = require('../dtos/order.dto');
const orderQueryService = require('./orderQuery.service');

const ORDER_EXPORT_COLUMNS = Object.freeze([
  ['orderId', 'Order ID'],
  ['channel', 'Channel'],
  ['shop', 'Shop'],
  ['asinOrListingId', 'ASIN / Listing ID'],
  ['sku', 'SKU'],
  ['status', 'Status'],
  ['orderedAt', 'Ordered at'],
  ['customer', 'Customer'],
  ['country', 'Country'],
  ['total', 'Total'],
  ['currency', 'Currency'],
  ['mappingStatus', 'Mapping status'],
  ['selectionMode', 'Selection mode'],
  ['vendor', 'Vendor'],
  ['vendorProduct', 'Vendor product'],
  ['costCenter', 'Cost center'],
  ['costCenterSku', 'Cost center SKU'],
  ['baseCost', 'Base cost'],
  ['totalCost', 'Total cost'],
  ['tracking', 'Tracking'],
]);

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toItemRows(row) {
  const order = row.order || {};
  const items = row.items?.length ? row.items : [{}];

  return items.map((entry) => {
    const item = entry.item || {};
    const listing = entry.listing || {};
    const mapping = entry.mapping || {};
    const costCenter = mapping.vendorCostCenter || {};
    const tracking = entry.tracking || {};
    const pricing = entry.pricing || order.pricing || {};

    return {
      orderId: order.externalOrderId,
      channel: order.salesChannelCode,
      shop: order.shop?.name,
      asinOrListingId: item.asin || listing.etsyListingId || listing.sku || item.listingId,
      sku: item.sku,
      status: item.status || order.status,
      orderedAt: order.orderedAt,
      customer: order.buyer?.name,
      country: order.shippingAddress?.countryCode || order.shippingAddress?.country,
      total: pricing.customerPaidAmount,
      currency: pricing.currency,
      mappingStatus: mapping.status,
      selectionMode: mapping.selectionMode,
      vendor: mapping.vendor?.name,
      vendorProduct: mapping.vendorProduct?.name,
      costCenter: costCenter.code || costCenter.name,
      costCenterSku: costCenter.sku || costCenter.lngCode,
      baseCost: pricing.baseCostAmount,
      totalCost: pricing.totalCostAmount,
      tracking: tracking.trackingNumber,
    };
  });
}

function toCsv(rows) {
  const headers = ORDER_EXPORT_COLUMNS.map(([, label]) => label);
  const keys = ORDER_EXPORT_COLUMNS.map(([key]) => key);
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(',')),
  ].join('\r\n').concat('\r\n');
}

async function exportOrdersCsv(query = {}, authContext = {}) {
  const result = await orderQueryService.listOrderWorkbench(
    { ...query, page: 1, limit: query.limit || 5000 },
    authContext,
  );
  const dto = toOrderWorkbenchDto(result);
  const rows = dto.items.flatMap(toItemRows);

  return {
    filename: `orders-export-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(rows),
  };
}

module.exports = {
  exportOrdersCsv,
  csvCell,
};
