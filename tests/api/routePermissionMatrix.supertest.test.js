const express = require('express');
const request = require('supertest');
const errorHandler = require('../../src/middlewares/errorHandler');
const designRouter = require('../../src/modules/design/routes');
const orderRouter = require('../../src/modules/order/routes');
const workScoreRouter = require('../../src/modules/workScore/routes');
const productionRouter = require('../../src/modules/production/routes');
const catalogRouter = require('../../src/modules/catalog/routes');

const designPermission = 'DESIGN:READ';
const designWorkPermission = 'DESIGN:WORK';
const orderReadPermission = 'ORDERS:READ';
const orderWritePermission = 'ORDERS:WRITE';
const orderFulfillmentPermission = 'ORDERS:FULFILL';
const workScoreReadPermission = 'WORK_SCORES:READ';
const workScoreAdjustPermission = 'WORK_SCORES:ADJUST';
const productionReadPermission = 'PRODUCTION:READ';
const productionWritePermission = 'PRODUCTION:WRITE';
const productionScaleWorkPermission = 'PRODUCTION:SCALE_WORK';
const productionScaleAssignPermission = 'PRODUCTION:SCALE_ASSIGN';
const productionQcReviewPermission = 'PRODUCTION:QC_REVIEW';
const catalogReadPermission = 'CATALOG:READ';
const catalogWritePermission = 'CATALOG:WRITE';

jest.mock('../../src/modules/auth/public', () => ({
  authenticate: (req, res, next) => {
    const rawAuth = req.headers['x-auth-context'];
    req.auth = rawAuth ? JSON.parse(rawAuth) : { permissions: [], scopes: [] };
    next();
  },
  authorizeAnyPermission: (...permissions) => (req, res, next) => {
    const granted = [
      ...(req.auth.permissions || []),
      ...(req.auth.scopes || []).flatMap((scope) => scope.permissions || []),
    ];
    if (granted.includes('SUPER_ADMIN')) return next();
    if (permissions.some((permission) => granted.includes(permission))) return next();
    const error = new Error('Forbidden');
    error.statusCode = 403;
    error.code = 'AUTHORIZATION_ERROR';
    next(error);
  },
  authorizePermissions: (permission) => (req, res, next) => {
    const granted = [
      ...(req.auth.permissions || []),
      ...(req.auth.scopes || []).flatMap((scope) => scope.permissions || []),
    ];
    if (granted.includes('SUPER_ADMIN')) return next();
    if (granted.includes(permission)) return next();
    const error = new Error('Forbidden');
    error.statusCode = 403;
    error.code = 'AUTHORIZATION_ERROR';
    next(error);
  },
}));

const makeHandler = (statusCode = 200) => jest.fn((req, res) => res.status(statusCode).json({ success: true, data: {} }));

jest.mock('../../src/modules/design/controllers/designTask.controller', () => ({
  listTasks: makeHandler(200),
  getWorkload: makeHandler(200),
  summarizeScores: makeHandler(200),
  summarizeTasks: makeHandler(200),
  listSubmissionScores: makeHandler(200),
  listPsdFiles: makeHandler(200),
  getAssignees: makeHandler(200),
  createPsdTemplateTaskFromListingVariant: makeHandler(201),
  createTask: makeHandler(201),
  uploadAsset: makeHandler(201),
  bulkAssignTasks: makeHandler(200),
  getTask: makeHandler(200),
  listSubmissions: makeHandler(200),
  assignTask: makeHandler(200),
  startTask: makeHandler(200),
  submitTask: makeHandler(200),
  approveTask: makeHandler(200),
  rejectTask: makeHandler(200),
  reopenTask: makeHandler(200),
  cancelTask: makeHandler(200),
  removeSubmission: makeHandler(200),
  overrideSubmissionScore: makeHandler(200),
  voidSubmissionScore: makeHandler(200),
}));

jest.mock('../../src/modules/order/controllers/order.controller', () => ({
  listOrders: makeHandler(200),
  getOrderSummary: makeHandler(200),
  listOrderWorkbench: makeHandler(200),
  listCustomerExceptions: makeHandler(200),
  listOrderCases: makeHandler(200),
  createOrderCase: makeHandler(201),
  getOrderCase: makeHandler(200),
  updateOrderCase: makeHandler(200),
  resolveOrderCase: makeHandler(200),
  cancelOrderCase: makeHandler(200),
  addOrderCaseComment: makeHandler(201),
  listOrderItemTimeline: makeHandler(200),
  getOrderItemReadiness: makeHandler(200),
  getOrderItem: makeHandler(200),
  getOrderTimeline: makeHandler(200),
  getExpandedOrder: makeHandler(200),
  listOrderItems: makeHandler(200),
  updateShippingAddress: makeHandler(200),
  updateBuyer: makeHandler(200),
  updateShippingService: makeHandler(200),
  validateAddress: makeHandler(200),
  overrideAddress: makeHandler(200),
  assignStaff: makeHandler(200),
  getOrder: makeHandler(200),
  createReplacementForItem: makeHandler(201),
  createReplacementForOrder: makeHandler(201),
  getOrder: makeHandler(200),
  cancelOrderItem: makeHandler(200),
  updateOrderItemCsNote: makeHandler(200),
  recheckOrderItem: makeHandler(200),
  markFulfillmentReady: makeHandler(200),
}));

jest.mock('../../src/modules/workScore/controllers/workScore.controller', () => ({
  listScores: makeHandler(200),
  summarizeScores: makeHandler(200),
  listRules: makeHandler(200),
  upsertRule: makeHandler(200),
  getScore: makeHandler(200),
  overrideScore: makeHandler(200),
  voidScore: makeHandler(200),
}));

jest.mock('../../src/modules/production/controllers/productionTask.controller', () => ({
  listTasks: makeHandler(200),
  summarizeTasks: makeHandler(200),
  getScaleAssignees: makeHandler(200),
  getCsAssignees: makeHandler(200),
  bulkAssignDesignTasks: makeHandler(200),
  bulkPushVendor: makeHandler(200),
  exportQcTasks: makeHandler(200),
  recheckPsdBlockedTasks: makeHandler(200),
  getTaskById: makeHandler(200),
  assignDesignTask: makeHandler(200),
  assignCsTask: makeHandler(200),
  claimDesignTask: makeHandler(200),
  updateDesignNote: makeHandler(200),
  updateCsNote: makeHandler(200),
  updateCsStatus: makeHandler(200),
  getTaskByOrderItem: makeHandler(200),
  recheckTask: makeHandler(200),
  addManualFileCheck: makeHandler(200),
  addManualScaledOutputFile: makeHandler(200),
  uploadScaledFile: makeHandler(200),
  uploadScaledOutputFile: makeHandler(200),
  submitQc: makeHandler(200),
  submitScaleForQc: makeHandler(200),
  markSentToVendor: makeHandler(200),
}));

jest.mock('../../src/modules/catalog/controllers/catalog.controller', () => ({
  listProductTypeGroups: makeHandler(200),
  createProductTypeGroup: makeHandler(201),
  updateProductTypeGroup: makeHandler(200),
  listInternalTemplates: makeHandler(200),
  createInternalTemplate: makeHandler(201),
  getInternalTemplate: makeHandler(200),
  updateInternalTemplate: makeHandler(200),
  getListingOptions: makeHandler(200),
  uploadCatalogAsset: makeHandler(201),
  listListings: makeHandler(200),
  createListing: makeHandler(201),
  getListingSummary: makeHandler(200),
  getListing: makeHandler(200),
  listListingVariants: makeHandler(200),
  createListingVariant: makeHandler(201),
  updateListingVariant: makeHandler(200),
  requestListingPsd: makeHandler(201),
  requestListingVariantPsd: makeHandler(200),
  approveListing: makeHandler(200),
  rejectListing: makeHandler(200),
  updateListing: makeHandler(200),
}));

function createServer(router, mount) {
  const app = express();
  app.use(express.json());
  if (mount) {
    app.use(mount, router);
  } else {
    app.use(router);
  }
  app.use(errorHandler);
  return request(app);
}

const roleContexts = {
  admin: {
    permissions: ['SUPER_ADMIN'],
  },
  designRead: {
    permissions: [designPermission],
  },
  designWorkWithScope: {
    permissions: [],
    accountId: '660000000000000000000600',
    scopes: [{ scopeType: 'team', scopeId: '660000000000000000000700', permissions: [designPermission] }],
  },
  designWork: {
    permissions: [designWorkPermission],
    accountId: '660000000000000000000600',
    scopes: [],
  },
};

describe('API permission matrix - design', () => {
  const design = createServer(designRouter);

  test('GET /design/tasks denies when no design permission', async () => {
    const response = await design.get('/tasks')
      .set('X-Auth-Context', JSON.stringify({ permissions: [] }));

    expect(response.status).toBe(403);
  });

  test('GET /design/tasks allows SUPER_ADMIN role', async () => {
    const response = await design.get('/tasks')
      .set('X-Auth-Context', JSON.stringify({ permissions: roleContexts.admin.permissions }));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('GET /design/tasks allows DESIGN:READ global role', async () => {
    const response = await design.get('/tasks')
      .set('X-Auth-Context', JSON.stringify(roleContexts.designRead));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('GET /design/tasks allows DESIGN:WORK self filter', async () => {
    const response = await design.get('/tasks')
      .set('X-Auth-Context', JSON.stringify(roleContexts.designWork));

    expect(response.status).toBe(200);
    expect(response.body.data).toBeDefined();
  });

  test('GET /design/tasks allows team scoped DESIGN:READ', async () => {
    const response = await design.get('/tasks')
      .set('X-Auth-Context', JSON.stringify(roleContexts.designWorkWithScope));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

describe('API permission matrix - order', () => {
  const order = createServer(orderRouter);

  test('GET /orders/summary requires ORDERS read permission', async () => {
    const denied = await order.get('/summary')
      .set('X-Auth-Context', JSON.stringify({ permissions: [] }));
    expect(denied.status).toBe(403);

    const allowed = await order.get('/summary')
      .set('X-Auth-Context', JSON.stringify({ permissions: [orderReadPermission] }));
    expect(allowed.status).toBe(200);
  });

  test('POST /orders/items/:orderItemId/recheck requires fulfillment permission', async () => {
    const denied = await order.post('/items/660000000000000000000401/recheck')
      .set('X-Auth-Context', JSON.stringify({ permissions: [orderReadPermission] }));
    expect(denied.status).toBe(403);

    const writeOnly = await order.post('/items/660000000000000000000401/recheck')
      .set('X-Auth-Context', JSON.stringify({ permissions: [orderWritePermission] }));
    expect(writeOnly.status).toBe(403);

    const allowed = await order.post('/items/660000000000000000000401/recheck')
      .set('X-Auth-Context', JSON.stringify({ permissions: [orderFulfillmentPermission] }));
    expect(allowed.status).toBe(200);
  });
});

describe('API permission matrix - work score', () => {
  const workScore = createServer(workScoreRouter);

  test('GET /work-scores requires read/adjust permission', async () => {
    const denied = await workScore.get('/')
      .set('X-Auth-Context', JSON.stringify({ permissions: [] }));
    expect(denied.status).toBe(403);

    const allowedRead = await workScore.get('/')
      .set('X-Auth-Context', JSON.stringify({ permissions: [workScoreReadPermission] }));
    expect(allowedRead.status).toBe(200);

    const allowedAdjust = await workScore.get('/')
      .set('X-Auth-Context', JSON.stringify({ permissions: [workScoreAdjustPermission] }));
    expect(allowedAdjust.status).toBe(200);
  });

  test('PATCH /work-scores/:scoreId/override requires adjust permission', async () => {
    const denied = await workScore.patch('/660000000000000000000901/override')
      .send({ points: 1, scoreLevel: 'BASIC', overrideReason: 'ok' })
      .set('X-Auth-Context', JSON.stringify({ permissions: [workScoreReadPermission] }));
    expect(denied.status).toBe(403);

    const allowed = await workScore.patch('/660000000000000000000901/override')
      .send({ points: 1, scoreLevel: 'BASIC', overrideReason: 'ok' })
      .set('X-Auth-Context', JSON.stringify({ permissions: [workScoreAdjustPermission] }));
    expect(allowed.status).toBe(200);
  });
});

describe('API permission matrix - production', () => {
  const production = createServer(productionRouter);

  test('GET /production/tasks requires read-like permission', async () => {
    const denied = await production.get('/tasks')
      .set('X-Auth-Context', JSON.stringify({ permissions: [] }));
    expect(denied.status).toBe(403);

    const allowed = await production.get('/tasks')
      .set('X-Auth-Context', JSON.stringify({ permissions: [productionReadPermission] }));
    expect(allowed.status).toBe(200);
  });

  test('PATCH /production/tasks/bulk-assign requires write permission', async () => {
    const denied = await production.patch('/tasks/bulk-assign')
      .set('X-Auth-Context', JSON.stringify({ permissions: [productionReadPermission] }))
      .send({ taskIds: ['1', '2'], assigneeId: '660000000000000000000900' });
    expect(denied.status).toBe(403);

    const allowed = await production.patch('/tasks/bulk-assign')
      .set('X-Auth-Context', JSON.stringify({ permissions: [productionWritePermission] }))
      .send({ taskIds: ['1', '2'], assigneeId: '660000000000000000000900' });
    expect(allowed.status).toBe(200);
  });

  test('scale work, assignment, and QC routes each require their narrow permission', async () => {
    const taskId = '660000000000000000100001';
    const fileCheckId = '660000000000000000100002';
    const mediaAssetId = '660000000000000000000901';
    const csAssigneeId = '660000000000000000000905';

    const scaleWork = await production.patch(`/tasks/${taskId}/file-checks/${fileCheckId}/scaled-output`)
      .set('X-Auth-Context', JSON.stringify({ permissions: [productionScaleWorkPermission] }))
      .send({ mediaAssetId });
    expect(scaleWork.status).toBe(200);

    const scaleWorkCannotAssign = await production.patch(`/tasks/${taskId}/assign-cs`)
      .set('X-Auth-Context', JSON.stringify({ permissions: [productionScaleWorkPermission] }))
      .send({ csAssigneeId });
    expect(scaleWorkCannotAssign.status).toBe(403);

    const scaleLeaderAssigns = await production.patch(`/tasks/${taskId}/assign-cs`)
      .set('X-Auth-Context', JSON.stringify({ permissions: [productionScaleAssignPermission] }))
      .send({ csAssigneeId });
    expect(scaleLeaderAssigns.status).toBe(200);

    const scaleLeaderCannotReview = await production.patch(`/tasks/${taskId}/qc`)
      .set('X-Auth-Context', JSON.stringify({ permissions: [productionScaleAssignPermission] }))
      .send({ decision: 'PASSED' });
    expect(scaleLeaderCannotReview.status).toBe(403);

    const qcReview = await production.patch(`/tasks/${taskId}/qc`)
      .set('X-Auth-Context', JSON.stringify({ permissions: [productionQcReviewPermission] }))
      .send({ decision: 'PASSED' });
    expect(qcReview.status).toBe(200);
  });
});

describe('API permission matrix - catalog', () => {
  const catalog = createServer(catalogRouter);

  test('GET /catalog/listings requires catalog read or write', async () => {
    const denied = await catalog.get('/listings')
      .set('X-Auth-Context', JSON.stringify({ permissions: [] }));
    expect(denied.status).toBe(403);

    const allowedRead = await catalog.get('/listings')
      .set('X-Auth-Context', JSON.stringify({ permissions: [catalogReadPermission] }));
    expect(allowedRead.status).toBe(200);
  });

  test('POST /catalog/listings requires catalog write', async () => {
    const denied = await catalog.post('/listings')
      .set('X-Auth-Context', JSON.stringify({ permissions: [catalogReadPermission] }))
      .send({ shopId: '660000000000000000000201', sku: 'SKU-TEST', title: 'shirt' });
    expect(denied.status).toBe(403);

    const allowed = await catalog.post('/listings')
      .set('X-Auth-Context', JSON.stringify({ permissions: [catalogWritePermission] }))
      .send({ shopId: '660000000000000000000201', sku: 'SKU-TEST', title: 'shirt' });
    expect(allowed.status).toBe(201);
  });
});
