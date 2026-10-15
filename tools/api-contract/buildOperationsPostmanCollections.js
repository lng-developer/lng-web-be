const fs = require('fs');
const path = require('path');
const { buildRouteInventory } = require('./routeInventory');

const root = path.resolve(__dirname, '../..');
const modules = ['catalog', 'mapping', 'vendor', 'media'];
const legacyFiles = {
  catalog: 'docs/catalog/postman/LNG_Web_BE_Catalog.postman_collection.json',
  mapping: 'docs/mapping/postman/LNG_Web_BE_Mapping.postman_collection.json',
  vendor: 'docs/vendor/postman/LNG_Web_BE_Vendor.postman_collection.json',
};
const ids = ['id', 'variantId', 'orderItemId', 'vendorId', 'vendorProductId', 'productId', 'costCenterId', 'assetId'];
const variables = [['baseUrl', 'http://localhost:3000'], ['accessToken', ''], ...ids.map((key, index) => [key, `64c0000000000000000000${String(index + 1).padStart(2, '0')}`]), ['ruleType', 'semanticRules'], ['vendorCostCenterId', '64c000000000000000000009'], ['sku', 'SKU-DEMO-001'], ['etsyListingId', '1234567890']];
const oid = (name) => `{{${name}}}`;

const bodyByRoute = {
  'POST /api/catalog/listings/:id/variants': { productTypeGroupId: oid('productTypeGroupId'), internalTemplateId: oid('internalTemplateId'), status: 'ACTIVE' },
  'PATCH /api/catalog/listings/:id/variants/:variantId': { internalTemplateId: oid('internalTemplateId'), status: 'ACTIVE' },
  'POST /api/mapping/normalization-rules': { semanticRole: 'PRODUCT_TYPE', matchTarget: 'LABEL', matchType: 'CONTAINS', matchValue: 'Product Type', normalizedValue: 'PRODUCT_TYPE', priority: 100, status: 'ACTIVE' },
  'PATCH /api/mapping/normalization-rules/:id': { normalizedValue: 'PRODUCT_TYPE', priority: 90 },
  'POST /api/mapping/semantic-rules': { semanticRole: 'PRODUCT_TYPE', matchValue: 'Product Type', normalizedValue: 'PRODUCT_TYPE', priority: 100, status: 'ACTIVE' },
  'PATCH /api/mapping/semantic-rules/:id': { matchValue: 'Style', priority: 90 },
  'POST /api/mapping/value-aliases': { semanticRole: 'PRODUCT_TYPE', matchValue: 'Unisex Hoodie', normalizedValue: 'UNISEX_HOODIE', priority: 100, status: 'ACTIVE' },
  'PATCH /api/mapping/value-aliases/:id': { normalizedValue: 'UNISEX_HOODIE', priority: 90 },
  'PATCH /api/mapping/vendor-routing-rules/reorder': { productTypeGroupId: oid('productTypeGroupId'), vendorRanks: [{ vendorId: oid('vendorId'), priority: 1 }] },
  'POST /api/mapping/order-items/:orderItemId/vendor-candidates/search': { q: 'hoodie', productTypeGroupId: oid('productTypeGroupId'), manualBrowse: true, page: 1, limit: 20 },
  'POST /api/mapping/recheck-unmatched': { limit: 10 },
  'POST /api/mapping/rule-preview': { ruleType: 'valueAliases', rule: { semanticRole: 'PRODUCT_TYPE', matchValue: 'Unisex Hoodie', normalizedValue: 'UNISEX_HOODIE' }, samples: ['Unisex Hoodie'] },
  'POST /api/mapping/rule-conflicts': { ruleType: 'valueAliases', rule: { semanticRole: 'PRODUCT_TYPE', matchValue: 'Unisex Hoodie', normalizedValue: 'UNISEX_HOODIE' }, samples: [] },
  'PATCH /api/vendors/:vendorId/integration': { providerKey: 'MERCHIZE', baseUrl: 'https://api.example.com', authType: 'API_KEY', accessToken: '', status: 'DISCONNECTED' },
  'POST /api/vendors/:vendorId/integration/refresh': { providerKey: 'MERCHIZE' },
};

const queryByRoute = {
  'GET /api/catalog/listings/:id/variants': {},
  'GET /api/mapping/:ruleType/:id/history': { page: '1', limit: '20' },
  'GET /api/mapping/order-items/unmatched': { page: '1', limit: '20', includePreview: 'true' },
  'GET /api/mapping/summary': { limit: '50' },
  'GET /api/mapping/vendors': { q: 'vendor', limit: '20' },
  'GET /api/mapping/vendor-products': { q: 'napkin', page: '1', limit: '20' },
  'GET /api/mapping/vendors/:vendorId/products': { q: 'hoodie', limit: '20' },
  'GET /api/mapping/vendor-products/:vendorProductId/options': { size: 'L', color: 'Black' },
  'GET /api/media/assets': { page: '1', limit: '20', status: 'ACTIVE' },
};

function flatten(items = []) { return items.flatMap((item) => item.request ? [item] : flatten(item.item || [])); }
function normalized(raw = '') {
  const pathname = raw.replace(/^\{\{baseUrl\}\}/, '').replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  return `/${pathname.split('/').filter(Boolean).map((part) => (/^(:|\{\{)/.test(part) ? ':param' : part)).join('/')}`;
}
function key(method, routePath) { return `${method.toUpperCase()} ${normalized(routePath)}`; }
function routeId(route) { return `${route.method} ${route.path}`; }

function legacyRequests(moduleName) {
  if (!legacyFiles[moduleName]) return new Map();
  const collection = JSON.parse(fs.readFileSync(path.join(root, legacyFiles[moduleName]), 'utf8'));
  return new Map(flatten(collection.item).map((item) => [key(item.request.method, item.request.url.raw || item.request.url), item.request]));
}

function generatedRequest(route) {
  const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const rendered = route.path.replace(/:([A-Za-z0-9_]+)/g, '{{$1}}');
  const isList = route.method === 'GET' && !route.path.includes(':')
    && !route.path.endsWith('/health') && !route.path.endsWith('/listing-options')
    && !route.path.endsWith('/authorable-shops');
  const query = Object.entries(queryByRoute[routeId(route)] || (isList ? { page: '1', limit: '20' } : {})).map(([key, value]) => ({ key, value }));
  const request = {
    description: route.authenticated ? `Bearer token required.${route.permissions.length ? ` Permissions (${route.authorizationMode}): ${route.permissions.join(', ')}.` : ''}` : 'Public endpoint.',
    method: route.method,
    header: [],
    url: { raw: `${oid('baseUrl')}${rendered}${query.length ? `?${query.map(({ key, value }) => `${key}=${value}`).join('&')}` : ''}`, host: [oid('baseUrl')], path: rendered.split('/').filter(Boolean), ...(query.length && { query }), ...(params.length && { variable: params.map((name) => ({ key: name, value: oid(name) })) }) },
  };
  if (route.authenticated) request.auth = { type: 'bearer', bearer: [{ key: 'token', value: oid('accessToken'), type: 'string' }] };
  if ((route.path === '/api/catalog/assets' || route.path === '/api/media/assets') && route.method === 'POST') {
    request.body = { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: [] }] };
  } else if (Object.hasOwn(bodyByRoute, routeId(route))) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(bodyByRoute[routeId(route)], null, 2), options: { raw: { language: 'json' } } };
  }
  return request;
}

function folder(routePath) { return (routePath.split('/')[3] || 'health').split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '); }
function buildCollection(moduleName) {
  const old = legacyRequests(moduleName);
  const groups = new Map();
  for (const route of buildRouteInventory().filter(({ module }) => module === moduleName)) {
    const name = folder(route.path);
    if (!groups.has(name)) groups.set(name, []);
    const request = old.get(key(route.method, route.path)) || generatedRequest(route);
    groups.get(name).push({ name: routeId(route), request });
  }
  return { info: { name: `LNG Web BE - ${moduleName[0].toUpperCase()}${moduleName.slice(1)}`, description: 'Complete registered API routes. Existing request examples are preserved and new routes are synchronized from the Express inventory.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: [...variables, ['productTypeGroupId', '64c000000000000000000020'], ['internalTemplateId', '64c000000000000000000021']].map(([key, value]) => ({ key, value })), item: [...groups].map(([name, item]) => ({ name, item })) };
}

function main() {
  for (const moduleName of modules) fs.writeFileSync(path.join(root, `docs/api/postman/${moduleName}.postman_collection.json`), `${JSON.stringify(buildCollection(moduleName), null, 2)}\n`);
}
if (require.main === module) main();
module.exports = { buildCollection };
