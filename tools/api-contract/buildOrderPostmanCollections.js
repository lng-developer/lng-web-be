const fs = require('fs');
const path = require('path');
const { buildRouteInventory } = require('./routeInventory');

const root = path.resolve(__dirname, '../..');
const modules = ['order', 'customization', 'integration'];
const legacyFiles = {
  order: 'docs/order/postman/LNG_Web_BE_Order_Customization.postman_collection.json',
  customization: 'docs/order/postman/LNG_Web_BE_Order_Customization.postman_collection.json',
  integration: 'docs/integration/postman/LNG_Web_BE_External_Order_Import.postman_collection.json',
};
const oid = (name) => `{{${name}}}`;
const variables = [
  ['baseUrl', 'http://localhost:3000'], ['accessToken', ''],
  ['orderId', '64d000000000000000000001'], ['orderItemId', '64d000000000000000000002'],
  ['caseId', '64d000000000000000000003'], ['payloadId', '64d000000000000000000004'],
  ['shopId', '64d000000000000000000005'], ['staffId', '64d000000000000000000006'],
  ['jobId', '64d000000000000000000007'], ['issueId', '64d000000000000000000008'],
  ['orderCaseId', '64d000000000000000000009'], ['rawRecordId', '64d00000000000000000000a'],
  ['marketplaceCode', 'US'], ['etsyMarketplaceCode', 'US'],
  ['externalOrderId', '113-0000000-0000000'], ['externalItemId', 'ITEM-001'],
  ['dateFrom', '2026-08-01'], ['dateTo', '2026-08-31'],
];

const bodyByRoute = {
  'PATCH /api/orders/:orderId/assigned-staff': { assignedStaffIds: [oid('staffId')] },
  'PATCH /api/orders/:orderId/buyer': { name: 'Jane Customer', emailMasked: 'j***@example.com' },
  'POST /api/orders/:orderId/replacement': { reason: 'Damaged item', items: [{ orderItemId: oid('orderItemId'), quantity: 1 }] },
  'PATCH /api/orders/:orderId/shipping-address': { name: 'Jane Customer', addressLine1: '123 Main Street', city: 'Austin', stateOrProvinceCode: 'TX', postalCode: '78701', countryCode: 'US' },
  'PATCH /api/orders/:orderId/shipping-service': { level: 'STANDARD', name: 'Standard Shipping' },
  'POST /api/orders/:orderId/validate-address': {},
  'POST /api/orders/cases': { orderId: oid('orderId'), orderItemId: oid('orderItemId'), caseType: 'OTHER', severity: 'MEDIUM', title: 'Customer requested review', description: 'Review order details before fulfillment.' },
  'PATCH /api/orders/cases/:caseId': { severity: 'HIGH', title: 'Updated customer case' },
  'POST /api/orders/cases/:caseId/cancel': { cancelReason: 'Issue no longer applies' },
  'POST /api/orders/cases/:caseId/comments': { body: 'Customer confirmed the updated details.' },
  'POST /api/orders/cases/:caseId/resolve': { resolutionNote: 'Resolved after customer confirmation.' },
  'POST /api/orders/items/:orderItemId/cancel': { reason: 'Customer requested cancellation' },
  'PATCH /api/orders/items/:orderItemId/cs-note': { csNote: 'Confirmed personalization details with customer.' },
  'POST /api/orders/items/:orderItemId/mark-fulfillment-ready': {},
  'POST /api/orders/items/:orderItemId/recheck': {},
  'POST /api/orders/items/:orderItemId/replacement': { reason: 'Print defect', quantity: 1 },
  'POST /api/customizations/pending': { orderItemId: oid('orderItemId'), orderId: oid('orderId'), shopId: oid('shopId'), source: 'MANUAL_EXCEL', rawCustomization: { productType: 'Unisex Hoodie', color: 'Black', size: 'L' }, assets: [] },
  'PATCH /api/customizations/:payloadId/failed': { errorCode: 'ASSET_DOWNLOAD_FAILED', errorMessage: 'Source asset could not be downloaded.' },
  'PATCH /api/customizations/:payloadId/needs-review': { reason: 'Product type could not be normalized.' },
  'PATCH /api/customizations/:payloadId/parsed': { parsedData: { productType: 'Unisex Hoodie', color: 'Black', size: 'L' } },
  'POST /api/customizations/:payloadId/retry': {},
  'POST /api/customizations/order-items/:orderItemId/download-assets': { retryFailed: true },
  'POST /api/customizations/order-items/:orderItemId/inspect-zip': { maxEntries: 50, maxTotalUncompressedBytes: 52428800, maxSingleEntryUncompressedBytes: 20971520 },
  'POST /api/customizations/order-items/:orderItemId/extract-zip-images': {},
  'PATCH /api/integration/external-order-imports/issues/:issueId': { status: 'RESOLVED', note: 'Corrected source data and verified the order.' },
  'POST /api/hr/integrations/sql-attendance/sync': { limit: 500 },
};

const queryByRoute = {
  'GET /api/orders': { page: '1', limit: '20', sort: '-orderedAt' },
  'GET /api/orders/:orderId/items': { page: '1', limit: '20' },
  'GET /api/orders/cases': { page: '1', limit: '20' },
  'GET /api/orders/customer-exceptions': { page: '1', limit: '20' },
  'GET /api/orders/workbench': { page: '1', limit: '20' },
  'GET /api/customizations': { page: '1', limit: '20', blockedOnly: 'true' },
  'GET /api/customizations/summary': { blockedOnly: 'true' },
  'GET /api/integration/external-order-imports': { page: '1', limit: '20' },
  'GET /api/integration/external-order-imports/issues': { page: '1', limit: '20' },
  'GET /api/integration/external-order-imports/:jobId/issues': { page: '1', limit: '20' },
  'GET /api/integration/external-order-imports/:jobId/raw-records': { page: '1', limit: '20' },
};

function flatten(items = []) { return items.flatMap((item) => item.request ? [item] : flatten(item.item || [])); }
function normalized(raw = '') {
  const pathname = raw.replace(/^\{\{baseUrl\}\}/, '').replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  return `/${pathname.split('/').filter(Boolean).map((part) => (/^(:|\{\{)/.test(part) ? ':param' : part)).join('/')}`;
}
function routeId(route) { return `${route.method} ${route.path}`; }
function key(method, routePath) { return `${method.toUpperCase()} ${normalized(routePath)}`; }
function oldRequests(moduleName) {
  const collection = JSON.parse(fs.readFileSync(path.join(root, legacyFiles[moduleName]), 'utf8'));
  return new Map(flatten(collection.item).map((item) => [key(item.request.method, item.request.url.raw || item.request.url), item.request]));
}

function generatedRequest(route) {
  const names = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const rendered = route.path.replace(/:([A-Za-z0-9_]+)/g, '{{$1}}');
  const query = Object.entries(queryByRoute[routeId(route)] || {}).map(([key, value]) => ({ key, value }));
  const request = {
    description: route.authenticated ? `Bearer token required.${route.permissions.length ? ` Permissions (${route.authorizationMode}): ${route.permissions.join(', ')}.` : ''}` : 'Public endpoint.',
    method: route.method,
    header: [],
    url: { raw: `${oid('baseUrl')}${rendered}${query.length ? `?${query.map(({ key, value }) => `${key}=${value}`).join('&')}` : ''}`, host: [oid('baseUrl')], path: rendered.split('/').filter(Boolean), ...(query.length && { query }), ...(names.length && { variable: names.map((name) => ({ key: name, value: oid(name) })) }) },
  };
  if (route.authenticated) request.auth = { type: 'bearer', bearer: [{ key: 'token', value: oid('accessToken'), type: 'string' }] };
  if (route.method === 'POST' && ['/manual-excel', '/etsy-sold-order-items'].some((suffix) => route.path.endsWith(suffix))) {
    request.body = { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: [] }, { key: 'shopId', value: oid('shopId'), type: 'text' }, { key: 'marketplaceCode', value: 'US', type: 'text' }] };
  } else if (Object.hasOwn(bodyByRoute, routeId(route))) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(bodyByRoute[routeId(route)], null, 2), options: { raw: { language: 'json' } } };
  }
  return request;
}

function folder(routePath) { return (routePath.split('/')[3] || 'health').split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '); }
function buildCollection(moduleName) {
  const legacy = oldRequests(moduleName);
  const groups = new Map();
  for (const route of buildRouteInventory().filter(({ module }) => module === moduleName)) {
    const folderName = folder(route.path);
    if (!groups.has(folderName)) groups.set(folderName, []);
    groups.get(folderName).push({ name: routeId(route), request: legacy.get(key(route.method, route.path)) || generatedRequest(route) });
  }
  return { info: { name: `LNG Web BE - ${moduleName[0].toUpperCase()}${moduleName.slice(1)}`, description: 'Complete registered API routes with frontend-ready path, query, body, auth, and multipart examples.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: variables.map(([key, value]) => ({ key, value })), item: [...groups].map(([name, item]) => ({ name, item })) };
}

function main() {
  for (const moduleName of modules) fs.writeFileSync(path.join(root, `docs/api/postman/${moduleName}.postman_collection.json`), `${JSON.stringify(buildCollection(moduleName), null, 2)}\n`);
}
if (require.main === module) main();
module.exports = { buildCollection };
