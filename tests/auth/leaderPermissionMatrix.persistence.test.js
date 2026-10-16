const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Role = require('../../src/modules/auth/models/role.model');
const Permission = require('../../src/modules/auth/models/permission.model');
const Assignment = require('../../src/modules/auth/models/accessAssignment.model');
const Scoped = require('../../src/modules/auth/models/scopedRolePermission.model');
const AuditEvent = require('../../src/modules/audit/models/auditEvent.model');
const audit = require('../../src/modules/audit/public');
const authManager = require('../../src/modules/auth/services/authManager.service');
const { runLeaderPermissionMigration } = require('../../src/modules/auth/scripts/migrateLeaderPermissionMatrix');
let db;
let leader;
let sales;
let hrIds;
let report;
const objectId = () => new mongoose.Types.ObjectId();
jest.setTimeout(120000);
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('leader_matrix_test'));
  await Promise.all([Role, Permission, Assignment, Scoped, AuditEvent].map(model => model.init()));
});
afterAll(async () => { await mongoose.disconnect(); await db.stop(); });
beforeEach(async () => {
  jest.spyOn(authManager, 'invalidatePermissionCache').mockResolvedValue();
  const hr = ['HR_EMPLOYEES:READ', 'HR_SCHEDULE:READ', 'HR_ATTENDANCE:READ', 'HR_LEAVE:READ', 'HR_LEAVE:APPROVE', 'HR_OVERTIME:READ', 'HR_OVERTIME:APPROVE', 'HR_CALENDAR:READ', 'HR_SATURDAY_ROTATION:WRITE'];
  const docs = await Permission.create([...hr, 'REPORTS:READ'].map(code => ({ code, name: code })));
  hrIds = docs.slice(0, hr.length).map(p => p._id);
  report = docs[hr.length]._id;
  leader = await Role.create({ code: 'LEADER', name: 'Leader', permissions: [...hrIds, report] });
  sales = await Role.create({ code: 'SALES_LEADER', name: 'Sales leader', permissions: [] });
});
afterEach(async () => {
  jest.restoreAllMocks();
  for (const model of [Role, Permission, Assignment, Scoped, AuditEvent]) await model.deleteMany({});
});
test('dry-run leaves database unchanged; apply is audited and rerun is a no-op', async () => {
  const team = objectId();
  const account = objectId();
  const grant = await Assignment.create({ accountId: account, roleId: leader._id, scopeType: 'team', scopeId: team, customPermissions: [report] });
  const scoped = await Scoped.create({ roleId: leader._id, scopeType: 'team', scopeId: team, permissions: [report] });
  const dryRun = await runLeaderPermissionMigration();
  expect(dryRun.apply).toBe(false);
  expect((await Role.findById(leader._id).lean()).permissions.map(String)).toContain(String(report));
  expect(await AuditEvent.countDocuments()).toBe(0);
  await runLeaderPermissionMigration({ apply: true, expectedDatabase: 'leader_matrix_test' });
  expect((await Role.findById(leader._id).lean()).permissions.map(String)).toEqual(hrIds.map(String));
  expect((await Scoped.findById(scoped._id).lean()).permissions.map(String)).toEqual(hrIds.map(String));
  expect((await Assignment.findById(grant._id).lean()).customPermissions).toEqual([]);
  expect((await Role.findById(sales._id).lean()).permissions.map(String)).toEqual([String(report)]);
  const auditCount = await AuditEvent.countDocuments();
  expect(auditCount).toBe(4);
  expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(String(account), { strict: true });
  expect((await runLeaderPermissionMigration({ apply: true, expectedDatabase: 'leader_matrix_test' })).changes).toEqual([]);
  expect(await AuditEvent.countDocuments()).toBe(auditCount);
});
test('audit failure rolls back every permission change', async () => {
  jest.spyOn(audit, 'record').mockRejectedValue(new Error('audit failed'));
  await expect(runLeaderPermissionMigration({ apply: true, expectedDatabase: 'leader_matrix_test' })).rejects.toThrow('audit failed');
  expect((await Role.findById(leader._id).lean()).permissions.map(String)).toContain(String(report));
  expect((await Role.findById(sales._id).lean()).permissions).toEqual([]);
});
test('reports committed DB changes on cache failure and allows no-op retry', async () => {
  await Assignment.create({ accountId: objectId(), roleId: leader._id, scopeType: 'team', scopeId: objectId() });
  authManager.invalidatePermissionCache.mockRejectedValueOnce(new Error('cache offline'));
  await expect(runLeaderPermissionMigration({ apply: true, expectedDatabase: 'leader_matrix_test' })).rejects.toThrow('Database committed; permission cache invalidation failed');
  expect((await Role.findById(leader._id).lean()).permissions.map(String)).toEqual(hrIds.map(String));
  expect((await runLeaderPermissionMigration({ apply: true, expectedDatabase: 'leader_matrix_test' })).changes).toEqual([]);
});
test('apply rejects a wrong database and non-team active assignments without writes', async () => {
  await expect(runLeaderPermissionMigration({ apply: true, expectedDatabase: 'production' })).rejects.toThrow('Database confirmation');
  await Assignment.create({ accountId: objectId(), roleId: leader._id, scopeType: 'global' });
  await expect(runLeaderPermissionMigration({ apply: true, expectedDatabase: 'leader_matrix_test' })).rejects.toThrow('NON_TEAM_ASSIGNMENT');
  expect((await Role.findById(leader._id).lean()).permissions.map(String)).toContain(String(report));
});
