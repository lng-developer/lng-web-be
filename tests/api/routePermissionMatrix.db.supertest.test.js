const request = require('supertest');
const createApp = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Account = require('../../src/modules/auth/models/account.model');
const config = require('../../src/config');
const jwt = require('jsonwebtoken');
const authManager = require('../../src/modules/auth/services/authManager.service');

const testPermissions = {
  designUser: 'j2523@demo.lng.co',
  salesStaff: 'j2514@demo.lng.co',
  salesLeader: 'j2506@demo.lng.co',
  csUser: 'j2515@demo.lng.co',
  shopSeller: 'j2531@demo.lng.co',
};

const describeIfDb = process.env.RUN_DB_RBAC_TESTS === 'true' ? describe : describe.skip;

jest.mock('../../src/modules/design/controllers/designTask.controller', () => ({
  listTasks: (req, res) => res.status(200).json({ success: true, data: {} }),
  getWorkload: (req, res) => res.status(200).json({ success: true, data: {} }),
  summarizeScores: (req, res) => res.status(200).json({ success: true, data: {} }),
  summarizeTasks: (req, res) => res.status(200).json({ success: true, data: {} }),
  listSubmissionScores: (req, res) => res.status(200).json({ success: true, data: {} }),
  listPsdFiles: (req, res) => res.status(200).json({ success: true, data: {} }),
  getAssignees: (req, res) => res.status(200).json({ success: true, data: [] }),
  createPsdTemplateTaskFromListingVariant: (req, res) => res.status(201).json({ success: true, data: {} }),
  createTask: (req, res) => res.status(201).json({ success: true, data: {} }),
  uploadAsset: (req, res) => res.status(201).json({ success: true, data: {} }),
  bulkAssignTasks: (req, res) => res.status(200).json({ success: true, data: {} }),
  getTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  listSubmissions: (req, res) => res.status(200).json({ success: true, data: [] }),
  assignTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  startTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  submitTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  approveTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  rejectTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  cancelTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  removeSubmission: (req, res) => res.status(200).json({ success: true, data: {} }),
  overrideSubmissionScore: (req, res) => res.status(200).json({ success: true, data: {} }),
  voidSubmissionScore: (req, res) => res.status(200).json({ success: true, data: {} }),
}));

jest.mock('../../src/modules/order/controllers/order.controller', () => ({
  listOrders: (req, res) => res.status(200).json({ success: true, data: [] }),
  getOrderSummary: (req, res) => res.status(200).json({ success: true, data: {} }),
  listOrderWorkbench: (req, res) => res.status(200).json({ success: true, data: {} }),
  listCustomerExceptions: (req, res) => res.status(200).json({ success: true, data: {} }),
  listOrderCases: (req, res) => res.status(200).json({ success: true, data: [] }),
  createOrderCase: (req, res) => res.status(201).json({ success: true, data: {} }),
  getOrderCase: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateOrderCase: (req, res) => res.status(200).json({ success: true, data: {} }),
  resolveOrderCase: (req, res) => res.status(200).json({ success: true, data: {} }),
  cancelOrderCase: (req, res) => res.status(200).json({ success: true, data: {} }),
  addOrderCaseComment: (req, res) => res.status(201).json({ success: true, data: {} }),
  listOrderItemTimeline: (req, res) => res.status(200).json({ success: true, data: [] }),
  getOrderItemReadiness: (req, res) => res.status(200).json({ success: true, data: {} }),
  getOrderItem: (req, res) => res.status(200).json({ success: true, data: {} }),
  getOrderTimeline: (req, res) => res.status(200).json({ success: true, data: [] }),
  getExpandedOrder: (req, res) => res.status(200).json({ success: true, data: {} }),
  listOrderItems: (req, res) => res.status(200).json({ success: true, data: [] }),
  assignStaff: (req, res) => res.status(200).json({ success: true, data: {} }),
  getOrder: (req, res) => res.status(200).json({ success: true, data: {} }),
  createReplacementForItem: (req, res) => res.status(201).json({ success: true, data: {} }),
  createReplacementForOrder: (req, res) => res.status(201).json({ success: true, data: {} }),
  cancelOrderItem: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateOrderItemCsNote: (req, res) => res.status(200).json({ success: true, data: {} }),
  recheckOrderItem: (req, res) => res.status(200).json({ success: true, data: {} }),
  markFulfillmentReady: (req, res) => res.status(200).json({ success: true, data: {} }),
  getOrder: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateShippingAddress: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateBuyer: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateShippingService: (req, res) => res.status(200).json({ success: true, data: {} }),
  validateAddress: (req, res) => res.status(200).json({ success: true, data: {} }),
  overrideAddress: (req, res) => res.status(200).json({ success: true, data: {} }),
}));

jest.mock('../../src/modules/workScore/controllers/workScore.controller', () => ({
  listScores: (req, res) => res.status(200).json({ success: true, data: [] }),
  summarizeScores: (req, res) => res.status(200).json({ success: true, data: {} }),
  listRules: (req, res) => res.status(200).json({ success: true, data: [] }),
  upsertRule: (req, res) => res.status(200).json({ success: true, data: {} }),
  getScore: (req, res) => res.status(200).json({ success: true, data: {} }),
  overrideScore: (req, res) => res.status(200).json({ success: true, data: {} }),
  voidScore: (req, res) => res.status(200).json({ success: true, data: {} }),
}));

jest.mock('../../src/modules/production/controllers/productionTask.controller', () => ({
  listTasks: (req, res) => res.status(200).json({ success: true, data: [] }),
  summarizeTasks: (req, res) => res.status(200).json({ success: true, data: {} }),
  getScaleAssignees: (req, res) => res.status(200).json({ success: true, data: [] }),
  getCsAssignees: (req, res) => res.status(200).json({ success: true, data: [] }),
  bulkAssignDesignTasks: (req, res) => res.status(200).json({ success: true, data: {} }),
  bulkPushVendor: (req, res) => res.status(200).json({ success: true, data: {} }),
  exportQcTasks: (req, res) => res.status(200).json({ success: true, data: [] }),
  recheckPsdBlockedTasks: (req, res) => res.status(200).json({ success: true, data: {} }),
  getTaskById: (req, res) => res.status(200).json({ success: true, data: {} }),
  assignDesignTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  assignCsTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  claimDesignTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateDesignNote: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateCsNote: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateCsStatus: (req, res) => res.status(200).json({ success: true, data: {} }),
  getTaskByOrderItem: (req, res) => res.status(200).json({ success: true, data: {} }),
  recheckTask: (req, res) => res.status(200).json({ success: true, data: {} }),
  addManualFileCheck: (req, res) => res.status(200).json({ success: true, data: {} }),
  addManualScaledOutputFile: (req, res) => res.status(200).json({ success: true, data: {} }),
  uploadScaledFile: (req, res) => res.status(200).json({ success: true, data: {} }),
  uploadScaledOutputFile: (req, res) => res.status(200).json({ success: true, data: {} }),
  submitQc: (req, res) => res.status(200).json({ success: true, data: {} }),
  markSentToVendor: (req, res) => res.status(200).json({ success: true, data: {} }),
}));

jest.mock('../../src/modules/catalog/controllers/catalog.controller', () => ({
  listProductTypeGroups: (req, res) => res.status(200).json({ success: true, data: [] }),
  createProductTypeGroup: (req, res) => res.status(201).json({ success: true, data: {} }),
  updateProductTypeGroup: (req, res) => res.status(200).json({ success: true, data: {} }),
  listInternalTemplates: (req, res) => res.status(200).json({ success: true, data: [] }),
  createInternalTemplate: (req, res) => res.status(201).json({ success: true, data: {} }),
  getInternalTemplate: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateInternalTemplate: (req, res) => res.status(200).json({ success: true, data: {} }),
  getListingOptions: (req, res) => res.status(200).json({ success: true, data: {} }),
  uploadCatalogAsset: (req, res) => res.status(201).json({ success: true, data: {} }),
  listListings: (req, res) => res.status(200).json({ success: true, data: [] }),
  createListing: (req, res) => res.status(201).json({ success: true, data: {} }),
  getListingSummary: (req, res) => res.status(200).json({ success: true, data: {} }),
  getListing: (req, res) => res.status(200).json({ success: true, data: {} }),
  listListingVariants: (req, res) => res.status(200).json({ success: true, data: [] }),
  createListingVariant: (req, res) => res.status(201).json({ success: true, data: {} }),
  updateListingVariant: (req, res) => res.status(200).json({ success: true, data: {} }),
  setDefaultListingVariant: (req, res) => res.status(200).json({ success: true, data: {} }),
  requestListingVariantPsd: (req, res) => res.status(200).json({ success: true, data: {} }),
  approveListing: (req, res) => res.status(200).json({ success: true, data: {} }),
  rejectListing: (req, res) => res.status(200).json({ success: true, data: {} }),
  updateListing: (req, res) => res.status(200).json({ success: true, data: {} }),
}));

const app = createApp();
const api = request(app);

async function login(email) {
  const account = await Account.findOne({ email }).lean();
  if (!account) return null;
  const authModel = await authManager.getCurrentAccount(String(account._id), account.tokenVersion || 0);
  return jwt.sign(
    {
      sub: String(authModel.account._id),
      email: authModel.account.email,
      tokenVersion: authModel.account.tokenVersion || 0,
    },
    config.auth.jwtAccessSecret,
    {
      expiresIn: config.auth.jwtAccessExpiresIn,
    },
  );
}

async function bootTokens() {
  const tokens = {};
  const missingAccounts = [];
  for (const [key, email] of Object.entries(testPermissions)) {
    const account = await Account.findOne({ email }).lean();
    if (!account) {
      missingAccounts.push(email);
      continue;
    }
    tokens[key] = await login(email);
  }

  if (missingAccounts.length > 0) {
    return { missing: missingAccounts, ...tokens };
  }

  const adminEmail = config.auth.bootstrapAdminEmail;
  const adminPassword = config.auth.bootstrapAdminPassword;
  if (adminEmail && adminPassword) {
    const adminAccount = await Account.findOne({ email: adminEmail }).lean();
    if (adminAccount) {
      const response = await api
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });
      if (response.status === 200) {
        tokens.admin = response.body.data.accessToken;
      }
    }
  }

  return tokens;
}

describeIfDb('API permission matrix - real DB accounts', () => {
  let tokens;
  let missingAccounts = [];

  beforeAll(async () => {
    await connectDatabase();
    const result = await bootTokens();
    tokens = result;
    missingAccounts = result.missing || [];
    if (missingAccounts.length > 0) {
      throw new Error(`[routePermissionMatrix.db] Missing seeded demo accounts: ${missingAccounts.join(', ')}. Run npm run seed:demo:full`);
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  test('designUser: can read design module', async () => {
    if (missingAccounts.includes(testPermissions.designUser)) return;
    const response = await api
      .get('/api/design/assignees')
      .set('Authorization', `Bearer ${tokens.designUser}`);

    expect(response.status).toBe(200);
  });

  test('salesStaff: cannot read design module', async () => {
    if (missingAccounts.includes(testPermissions.salesStaff)) return;
    const response = await api
      .get('/api/design/assignees')
      .set('Authorization', `Bearer ${tokens.salesStaff}`);

    expect(response.status).toBe(403);
  });

  test('salesStaff: can read orders', async () => {
    if (missingAccounts.includes(testPermissions.salesStaff)) return;
    const response = await api
      .get('/api/orders/summary')
      .set('Authorization', `Bearer ${tokens.salesStaff}`);

    expect(response.status).toBe(200);
  });

  test('designUser: cannot read orders', async () => {
    if (missingAccounts.includes(testPermissions.designUser)) return;
    const response = await api
      .get('/api/orders/summary')
      .set('Authorization', `Bearer ${tokens.designUser}`);

    expect(response.status).toBe(403);
  });

  test('csUser: can write production tasks', async () => {
    if (missingAccounts.includes(testPermissions.csUser)) return;
    const response = await api
      .patch('/api/production/tasks/bulk-assign')
      .set('Authorization', `Bearer ${tokens.csUser}`)
      .send({ taskIds: ['660000000000000000001001'], assigneeId: '660000000000000000001002' });

    expect(response.status).toBe(200);
  });

  test('salesStaff: cannot write production tasks', async () => {
    if (missingAccounts.includes(testPermissions.salesStaff)) return;
    const response = await api
      .patch('/api/production/tasks/bulk-assign')
      .set('Authorization', `Bearer ${tokens.salesStaff}`)
      .send({ taskIds: ['660000000000000000001001'], assigneeId: '660000000000000000001002' });

    expect(response.status).toBe(403);
  });

  test('designUser: can read work-score', async () => {
    if (missingAccounts.includes(testPermissions.designUser)) return;
    const response = await api
      .get('/api/work-scores')
      .set('Authorization', `Bearer ${tokens.designUser}`);

    expect(response.status).toBe(200);
  });

  test('shopSeller: can read catalog, cannot write', async () => {
    if (missingAccounts.includes(testPermissions.shopSeller)) return;
    const readResponse = await api
      .get('/api/catalog/listings')
      .set('Authorization', `Bearer ${tokens.shopSeller}`);

    expect(readResponse.status).toBe(200);

    const writeResponse = await api
      .post('/api/catalog/listings')
      .set('Authorization', `Bearer ${tokens.shopSeller}`)
      .send({ shopId: '660000000000000000000201', sku: 'DB-TEST-01', title: 'x' });

    expect(writeResponse.status).toBe(403);
  });

  test('admin token (if bootstrap provided) can write catalog listing', async () => {
    if (!tokens.admin) return;
    const response = await api
      .post('/api/catalog/listings')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ shopId: '660000000000000000000201', sku: 'DB-TEST-02', title: 'x' });

    expect(response.status).toBe(201);
  });

  test('unauthorized access is blocked', async () => {
    const response = await api
      .get('/api/design/assignees');

    expect(response.status).toBe(401);
  });
});
