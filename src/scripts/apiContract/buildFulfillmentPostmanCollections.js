const fs = require('fs');
const path = require('path');
const { buildRouteInventory } = require('./routeInventory');

const root = path.resolve(__dirname, '../../..');
const modules = ['design', 'production', 'vendorSubmission', 'shipment'];
const oid = (name) => `{{${name}}}`;
const variables = [
  ['baseUrl', 'http://localhost:3000'], ['accessToken', ''],
  ['listingId', '64e000000000000000000001'], ['variantId', '64e000000000000000000002'],
  ['taskId', '64e000000000000000000003'], ['submissionId', '64e000000000000000000004'],
  ['assetId', '64e000000000000000000005'], ['scoreId', '64e000000000000000000006'],
  ['designerId', '64e000000000000000000007'], ['orderItemId', '64e000000000000000000008'],
  ['fileCheckId', '64e000000000000000000009'], ['productionTaskId', '64e00000000000000000000a'],
  ['vendorSubmissionId', '64e00000000000000000000b'], ['id', '64e00000000000000000000c'],
  ['provider', 'PRINTWAY'], ['vendorWebhookSecret', 'replace-locally'],
];

const bodyByRoute = {
  'POST /api/design/tasks': { listingId: oid('listingId'), taskType: 'IDEA', brief: 'Create a new personalized hoodie design.', expectedOutputs: ['PSD_TEMPLATE', 'MOCKUP'], priority: 'NORMAL' },
  'POST /api/design/tasks/from-listings/:listingId/variants/:variantId/psd-template': {},
  'PATCH /api/design/tasks/bulk-assign': { taskIds: [oid('taskId')], assignedDesignerId: oid('designerId') },
  'PATCH /api/design/tasks/:taskId/assign': { assignedDesignerId: oid('designerId'), note: 'Assigned from design workbench.' },
  'PATCH /api/design/tasks/:taskId/start': { note: 'Started working on the PSD.' },
  'PATCH /api/design/tasks/:taskId/submit': { submittedAssetIds: [oid('assetId')], note: 'PSD ready for review.' },
  'PATCH /api/design/tasks/:taskId/approve': { approvedAssetId: oid('assetId') },
  'PATCH /api/design/tasks/:taskId/reject': { rejectReason: 'Please correct the safe print area.' },
  'PATCH /api/design/tasks/:taskId/cancel': { cancelReason: 'Listing is no longer active.' },
  'PATCH /api/design/submission-scores/:scoreId/override': { points: 8, scoreLevel: 'STANDARD', overrideReason: 'Manual review correction.' },
  'PATCH /api/design/tasks/:taskId/submissions/:submissionId/assets/:assetId/score/void': { voidReason: 'Submission asset was replaced.' },
  'PATCH /api/production/tasks/bulk-assign': { taskIds: [oid('taskId')], assignedDesignUserId: oid('designerId'), designNote: 'Scale for the selected variant.' },
  'POST /api/production/tasks/bulk-push-vendor': { taskIds: [oid('taskId')], vendorSubmissionIdsByTaskId: {} },
  'POST /api/production/tasks/recheck-psd-blocked': { limit: 50 },
  'PATCH /api/production/tasks/:taskId/assign': { assignedDesignUserId: oid('designerId'), designNote: 'Prepare production artwork.' },
  'PATCH /api/production/tasks/:taskId/assign-cs': { csAssigneeId: oid('designerId'), csNote: 'Confirm customer request.' },
  'PATCH /api/production/tasks/:taskId/claim': {},
  'PATCH /api/production/tasks/:taskId/design-note': { designNote: 'Use approved ListingVariant PSD.' },
  'PATCH /api/production/tasks/:taskId/cs-note': { csNote: 'Customer details verified.' },
  'PATCH /api/production/tasks/:taskId/cs-status': { csStatus: 'DONE' },
  'POST /api/production/tasks/:taskId/file-checks/manual': { slotKey: 'FRONT_PRINT', slotLabel: 'Front print', sourceType: 'CUSTOMER_IMAGE', inputAssetId: oid('assetId') },
  'PATCH /api/production/tasks/:taskId/file-checks/:fileCheckId/scaled-output': { mediaAssetId: oid('assetId') },
  'PATCH /api/production/tasks/:taskId/qc': { decision: 'PASSED', note: 'Artwork and dimensions verified.' },
  'PATCH /api/production/tasks/:taskId/sent-to-vendor': { vendorSubmissionId: oid('vendorSubmissionId') },
  'POST /api/vendor-submissions/recheck-ready-production-tasks': { limit: 50 },
  'POST /api/vendor-submissions/:id/submit-to-vendor': { provider: 'PRINTWAY', dryRun: true },
  'POST /api/vendor-submissions/:id/reconcile': { outcome: 'REMOTE_FOUND', vendorExternalOrderId: 'VENDOR-ORDER-001', reason: 'Confirmed in vendor dashboard.' },
  'POST /api/vendor-submissions/:id/mark-failed': { failureReason: 'Vendor rejected the payload.' },
  'POST /api/vendor-submissions/:id/retry': { reason: 'Vendor credentials refreshed.' },
  'POST /api/vendor-submissions/:id/cancel': { cancelReason: 'Order cancelled before submission.' },
  'PATCH /api/shipments/:id/tracking': { carrier: 'USPS', trackingNumber: '9400111899560000000000', trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899560000000000', note: 'Tracking received from vendor.' },
  'PATCH /api/shipments/:id/status': { status: 'DELIVERED', note: 'Confirmed delivered by carrier.' },
  'POST /api/shipments/vendor-tracking/recheck': { provider: 'PRINTWAY', vendorSubmissionId: oid('vendorSubmissionId') },
  'POST /api/shipments/vendor-tracking/recheck-submitted': { provider: 'PRINTWAY', limit: 50 },
  'POST /api/shipments/vendor-webhooks/:provider': { vendorSubmissionId: oid('vendorSubmissionId'), tracking: { trackingNumber: '9400111899560000000000', carrierName: 'USPS', url: 'https://tools.usps.com/' }, status: 'shipped' },
};

const queryByRoute = {
  'GET /api/design/tasks': { page: '1', limit: '20', sortBy: 'createdAt', sortOrder: 'desc' },
  'GET /api/design/submission-scores': { page: '1', limit: '20', scoreStatus: 'ACTIVE' },
  'GET /api/design/psd-files': { page: '1', limit: '20', role: 'APPROVED' },
  'GET /api/production/tasks': { page: '1', limit: '20', sort: '-createdAt' },
  'GET /api/production/tasks/qc/export': { view: 'QC' },
  'GET /api/vendor-submissions': { page: '1', limit: '20' },
  'GET /api/shipments': { page: '1', limit: '20' },
  'GET /api/shipments/vendor-webhooks/logs': { page: '1', limit: '20' },
};

function routeId(route) { return `${route.method} ${route.path}`; }
function requestFor(route) {
  const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const rendered = route.path.replace(/:([A-Za-z0-9_]+)/g, '{{$1}}');
  const query = Object.entries(queryByRoute[routeId(route)] || {}).map(([key, value]) => ({ key, value }));
  const request = {
    description: route.authenticated ? `Bearer token required.${route.permissions.length ? ` Permissions (${route.authorizationMode}): ${route.permissions.join(', ')}.` : ''}` : 'Public endpoint.',
    method: route.method, header: [],
    url: { raw: `${oid('baseUrl')}${rendered}${query.length ? `?${query.map(({ key, value }) => `${key}=${value}`).join('&')}` : ''}`, host: [oid('baseUrl')], path: rendered.split('/').filter(Boolean), ...(query.length && { query }), ...(params.length && { variable: params.map((key) => ({ key, value: oid(key) })) }) },
  };
  if (route.authenticated) request.auth = { type: 'bearer', bearer: [{ key: 'token', value: oid('accessToken'), type: 'string' }] };
  const isFileUpload = route.method === 'POST' && (route.path === '/api/design/assets' || route.path.endsWith('/scaled-output-file'));
  if (isFileUpload) request.body = { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: [] }] };
  else if (Object.hasOwn(bodyByRoute, routeId(route))) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(bodyByRoute[routeId(route)], null, 2), options: { raw: { language: 'json' } } };
  }
  if (route.path.includes('/vendor-webhooks/:provider')) request.header.push({ key: 'x-vendor-webhook-secret', value: oid('vendorWebhookSecret') });
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
  return { info: { name: `LNG Web BE - ${moduleName}`, description: 'Complete fulfillment workflow API routes with frontend-ready request examples.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: variables.map(([key, value]) => ({ key, value })), item: [...groups].map(([name, item]) => ({ name, item })) };
}

function main() {
  for (const moduleName of modules) fs.writeFileSync(path.join(root, `docs/api/postman/${moduleName}.postman_collection.json`), `${JSON.stringify(buildCollection(moduleName), null, 2)}\n`);
}
if (require.main === module) main();
module.exports = { buildCollection };
