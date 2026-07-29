process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const ScopeRegistry = require('../../modules/auth/models/scopeRegistry.model');
const Department = require('../../modules/organization/models/department.model');
const Shop = require('../../modules/shop/models/shop.model');
const auditPublic = require('../../modules/audit/public');
const organizationService = require('../../modules/organization/services/organization.service');
const shopService = require('../../modules/shop/services/shop.service');

let database;
jest.setTimeout(120000);

describe('scope source mutations share the auth audit transaction', () => {
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri('lng_web_be_scope_source_audit_test'));
    await Promise.all([AuditEvent.init(), ScopeRegistry.init(), Department.init(), Shop.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([
      AuditEvent.deleteMany({}), ScopeRegistry.deleteMany({}),
      Department.deleteMany({}), Shop.deleteMany({}),
    ]);
  });

  test('rolls back Shop create when scope audit fails', async () => {
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(shopService.createShop({ name: 'Rollback shop', currency: 'USD' }))
      .rejects.toThrow('audit unavailable');

    await expect(Shop.countDocuments({ name: 'Rollback shop' })).resolves.toBe(0);
    await expect(ScopeRegistry.countDocuments({ scopeType: 'shop' })).resolves.toBe(0);
  });

  test('rolls back Shop update when scope audit fails', async () => {
    const shop = await Shop.create({ name: 'Stable shop', currency: 'USD', status: 'ACTIVE' });
    await ScopeRegistry.create({ scopeType: 'shop', scopeId: shop._id, name: shop.name, status: 'active' });
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(shopService.updateShopStatus(shop._id, 'SUSPENDED'))
      .rejects.toThrow('audit unavailable');

    await expect(Shop.findById(shop._id).lean()).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(ScopeRegistry.findOne({ scopeType: 'shop', scopeId: shop._id }).lean())
      .resolves.toMatchObject({ status: 'active' });
  });

  test('rolls back Organization create when scope audit fails', async () => {
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(organizationService.createDepartment({ name: 'Rollback department', code: 'rollback' }))
      .rejects.toThrow('audit unavailable');

    await expect(Department.countDocuments({ code: 'ROLLBACK' })).resolves.toBe(0);
    await expect(ScopeRegistry.countDocuments({ scopeType: 'department' })).resolves.toBe(0);
  });

  test('rolls back Organization update when scope audit fails', async () => {
    const department = await Department.create({ name: 'Before', code: 'OPS', status: 'active' });
    await ScopeRegistry.create({
      scopeType: 'department', scopeId: department._id, name: department.name, status: 'active',
    });
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(organizationService.updateDepartment(department._id, { name: 'After' }))
      .rejects.toThrow('audit unavailable');

    await expect(Department.findById(department._id).lean()).resolves.toMatchObject({ name: 'Before' });
    await expect(ScopeRegistry.findOne({ scopeType: 'department', scopeId: department._id }).lean())
      .resolves.toMatchObject({ name: 'Before' });
  });
});
