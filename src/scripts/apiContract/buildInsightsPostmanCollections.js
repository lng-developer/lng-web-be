const fs = require('fs');
const path = require('path');
const { buildRouteInventory } = require('./routeInventory');

const root = path.resolve(__dirname, '../../..');
const modules = ['finance', 'report', 'audit', 'notification', 'workScore'];
const oid = (name) => `{{${name}}}`;
const variables = [
  ['baseUrl', 'http://localhost:3000'], ['accessToken', ''],
  ['shopId', '64f000000000000000000001'], ['orderId', '64f000000000000000000002'],
  ['orderItemId', '64f000000000000000000003'], ['batchId', '64f000000000000000000004'],
  ['eventId', '64f000000000000000000005'], ['id', '64f000000000000000000006'],
  ['scoreId', '64f000000000000000000007'], ['sourceType', 'transactions'],
];

const bodyByRoute = {
  'PATCH /api/work-scores/:scoreId/override': { points: 8, scoreLevel: 'STANDARD', reason: 'Corrected after manual review.', expectedVersion: 0 },
  'PATCH /api/work-scores/:scoreId/void': { reason: 'Source task was cancelled.', expectedVersion: 0 },
};

const queryByRoute = {
  'GET /api/finance/import-batches': { page: '1', limit: '20' },
  'GET /api/finance/imported-data/:sourceType': { page: '1', limit: '20' },
  'GET /api/finance/snapshots': { page: '1', limit: '20', dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  'GET /api/audit/events': { dateFrom: '2026-08-01', dateTo: '2026-08-31', limit: '20' },
  'GET /api/notifications': { unreadOnly: 'false', page: '1', limit: '20' },
  'GET /api/work-scores': { scoreStatus: 'ACTIVE', page: '1', limit: '20', sortBy: 'scoredAt', sortOrder: 'desc' },
};

function reportQuery(routePath) {
  if (!routePath.startsWith('/api/reports/') || routePath.endsWith('/health') || routePath.endsWith('/filter-options')) return {};
  return routePath.endsWith('/vendor/performance')
    ? { dateFrom: '2026-08-01', dateTo: '2026-08-31', page: '1', limit: '20' }
    : { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
}

function routeId(route) { return `${route.method} ${route.path}`; }
function requestFor(route) {
  const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const rendered = route.path.replace(/:([A-Za-z0-9_]+)/g, '{{$1}}');
  const queryObject = queryByRoute[routeId(route)] || reportQuery(route.path);
  const query = Object.entries(queryObject).map(([key, value]) => ({ key, value }));
  const request = {
    description: route.authenticated ? `Bearer token required.${route.permissions.length ? ` Permissions (${route.authorizationMode}): ${route.permissions.join(', ')}.` : ''}` : 'Public endpoint.',
    method: route.method, header: [],
    url: { raw: `${oid('baseUrl')}${rendered}${query.length ? `?${query.map(({ key, value }) => `${key}=${value}`).join('&')}` : ''}`, host: [oid('baseUrl')], path: rendered.split('/').filter(Boolean), ...(query.length && { query }), ...(params.length && { variable: params.map((key) => ({ key, value: oid(key) })) }) },
  };
  if (route.authenticated) request.auth = { type: 'bearer', bearer: [{ key: 'token', value: oid('accessToken'), type: 'string' }] };
  if (route.method === 'POST' && route.path.startsWith('/api/finance/imports/')) {
    request.body = { mode: 'formdata', formdata: [
      { key: 'file', type: 'file', src: [] },
      { key: 'shopId', value: oid('shopId'), type: 'text' },
      { key: 'salesChannelCode', value: 'AMAZON', type: 'text' },
      { key: 'marketplaceCode', value: 'US', type: 'text' },
      { key: 'sourceRef', value: 'postman-import', type: 'text' },
      { key: 'dryRun', value: 'true', type: 'text' },
    ] };
  } else if (Object.hasOwn(bodyByRoute, routeId(route))) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(bodyByRoute[routeId(route)], null, 2), options: { raw: { language: 'json' } } };
  }
  return request;
}

function folder(routePath) { return (routePath.split('/')[3] || 'health').split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '); }
function buildCollection(moduleName) {
  const groups = new Map();
  for (const route of buildRouteInventory().filter(({ module }) => module === moduleName)) {
    const name = folder(route.path);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ name: routeId(route), request: requestFor(route) });
  }
  return { info: { name: `LNG Web BE - ${moduleName}`, description: 'Complete reporting and operational insight API routes with frontend-ready request examples.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: variables.map(([key, value]) => ({ key, value })), item: [...groups].map(([name, item]) => ({ name, item })) };
}

function main() {
  for (const moduleName of modules) fs.writeFileSync(path.join(root, `docs/api/postman/${moduleName}.postman_collection.json`), `${JSON.stringify(buildCollection(moduleName), null, 2)}\n`);
}
if (require.main === module) main();
module.exports = { buildCollection };
