jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const service = require('../../src/modules/auth/services/authAdmin.service');
const Role = require('../../src/modules/auth/models/role.model');
const Permission = require('../../src/modules/auth/models/permission.model');
const Assignment = require('../../src/modules/auth/models/accessAssignment.model');
const Scope = require('../../src/modules/auth/models/scopeRegistry.model');
const Rule = require('../../src/modules/auth/models/scopedRolePermission.model');
const Shop = require('../../src/modules/shop/models/shop.model');
const Department = require('../../src/modules/organization/models/department.model');
const Team = require('../../src/modules/organization/models/team.model');

let database;
let queryCount = 0;
const id = () => new mongoose.Types.ObjectId();
jest.setTimeout(90000);
beforeAll(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), { dbName: 'auth_list_performance_test', autoIndex: false, monitorCommands: true });
  mongoose.connection.getClient().on('commandStarted', (event) => {
    if (['find', 'aggregate', 'getMore'].includes(event.commandName)) queryCount += 1;
  });
});
afterAll(async () => { await mongoose.disconnect(); await database.stop(); });
beforeEach(async () => {
  if (mongoose.connection.name !== 'auth_list_performance_test') throw new Error('Unsafe cleanup target');
  await Promise.all([Role, Permission, Assignment, Scope, Rule, Shop, Department, Team].map((model) => model.deleteMany({})));
});

test('permission usage counts documents once, includes inactive references, and uses bounded queries', async () => {
  const permissions = Array.from({ length: 12 }, (_, i) => ({ _id: id(), code: `TEST:${String(i).padStart(2, '0')}`, name: 'Test' }));
  const p = permissions[0]._id;
  await Permission.collection.insertMany(permissions);
  await Role.collection.insertOne({ _id: id(), code: 'TEST', permissions: [p, p] });
  await Rule.collection.insertOne({ _id: id(), permissions: [p], roleId: id(), scopeType: 'shop', scopeId: id() });
  await Assignment.collection.insertMany([
    { _id: id(), status: 'active', customPermissions: [p, p], overridePermissions: [p] },
    { _id: id(), status: 'inactive', overridePermissions: [p] },
  ]);
  queryCount = 0;
  const result = await service.listPermissions({ limit: 100 });
  expect(result.items[0]).toMatchObject({ roleCount: 1, scopedRoleCount: 1, directAssignmentCount: 2, usageCount: 4, deletable: false });
  expect(result.items[1]).toMatchObject({ usageCount: 0, deletable: true });
  expect(queryCount).toBeLessThanOrEqual(5);
});

test('role counts preserve inactive assignments and zero usage without per-role queries', async () => {
  const roles = Array.from({ length: 12 }, (_, i) => ({ _id: id(), code: `ROLE_${i}`, permissions: [] }));
  await Role.collection.insertMany(roles);
  await Assignment.collection.insertMany(['active', 'inactive'].map((status) => ({ _id: id(), roleId: roles[0]._id, status })));
  queryCount = 0;
  const result = await service.listRoles({ limit: 100 });
  expect(result.items.find((role) => role.code === 'ROLE_0')).toMatchObject({ userCount: 2, deletable: false });
  expect(result.items.find((role) => role.code === 'ROLE_1')).toMatchObject({ userCount: 0, deletable: true });
  expect(queryCount).toBeLessThanOrEqual(3);
});

test('scope and rule lists preserve metadata while batching repeated scope lookups', async () => {
  const shopId = id();
  await Shop.collection.insertOne({ _id: shopId, name: 'Test shop' });
  await Scope.collection.insertOne({ _id: id(), scopeType: 'shop', scopeId: shopId, name: 'Shop scope', status: 'active' });
  await Assignment.collection.insertMany(['active', 'inactive'].map((status) => ({ _id: id(), scopeType: 'shop', scopeId: shopId, status })));
  const roles = Array.from({ length: 12 }, (_, i) => ({ _id: id(), code: `ROLE_${i}`, permissions: [] }));
  await Role.collection.insertMany(roles);
  await Rule.collection.insertMany(roles.map((role) => ({ _id: id(), roleId: role._id, scopeType: 'shop', scopeId: shopId, permissions: [] })));
  const scopes = await service.listScopes({ limit: 100 });
  expect(scopes.items[0]).toMatchObject({ assignmentCount: 1, resource: { name: 'Test shop' } });
  queryCount = 0;
  const rules = await service.listScopedRolePermissions({ limit: 100 });
  expect(rules.items).toHaveLength(12);
  expect(rules.items[0].scope).toMatchObject({ name: 'Shop scope', resource: { name: 'Test shop' } });
  expect(queryCount).toBeLessThanOrEqual(7);
});

test('scope batches retain team parents, inactive resources and missing-resource fallback', async () => {
  const departmentId = id();
  const teamId = id();
  await Department.collection.insertOne({ _id: departmentId, name: 'Parent', code: 'PARENT', status: 'inactive' });
  await Team.collection.insertOne({ _id: teamId, departmentId, name: 'Team', status: 'inactive' });
  const scopes = [
    { _id: id(), scopeType: 'department', scopeId: departmentId, name: 'Department' },
    { _id: id(), scopeType: 'team', scopeId: teamId, name: 'Team' },
    ...Array.from({ length: 12 }, (_, index) => ({ _id: id(), scopeType: 'shop', scopeId: id(), name: `Missing ${index}` })),
  ];
  await Scope.collection.insertMany(scopes);
  queryCount = 0;
  const result = await service.listScopes({ limit: 100 });
  expect(result.items.find((scope) => scope.scopeType === 'team')).toMatchObject({
    resource: { name: 'Team', status: 'inactive' }, parentDepartment: { name: 'Parent' }, assignmentCount: 0,
  });
  expect(result.items.find((scope) => scope.scopeType === 'shop')).toMatchObject({ resource: null, parentDepartment: null });
  expect(queryCount).toBeLessThanOrEqual(10);
});

test('empty lists retain pagination without enrichment queries', async () => {
  for (const name of ['listRoles', 'listPermissions', 'listScopes', 'listScopedRolePermissions']) {
    queryCount = 0;
    const result = await service[name]({ limit: 100 });
    expect(result).toMatchObject({ items: [], total: 0 });
    expect(queryCount).toBe(2);
  }
});
