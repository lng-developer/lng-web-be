const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn((authContext, permission, scope) => (
    (authContext.scopes || []).some((grant) => (
      grant.scopeType === scope.scopeType
      && String(grant.scopeId) === String(scope.scopeId)
      && (grant.permissions || []).includes(permission)
    ))
  )),
}));

const AuditEvent = require('../../src/modules/audit/models/auditEvent.model');
const authPublic = require('../../src/modules/auth/public');
const repository = require('../../src/modules/audit/repositories/auditEvent.repository');
const service = require('../../src/modules/audit/services/auditEvent.service');
const { toAuditEventListDto } = require('../../src/modules/audit/dtos/auditEvent.dto');
const { listAuditEventsQuerySchema } = require('../../src/modules/audit/validators/auditEventQuery.validator');

const firstId = new mongoose.Types.ObjectId('660000000000000000000301');
const secondId = new mongoose.Types.ObjectId('660000000000000000000302');
const shopOne = '660000000000000000000201';
const shopTwo = '660000000000000000000202';
let database;

function planStages(node, stages = []) {
  if (Array.isArray(node)) node.forEach((value) => planStages(value, stages));
  else if (node && typeof node === 'object') {
    if (node.stage) stages.push(node.stage);
    Object.values(node).forEach((value) => planStages(value, stages));
  }
  return stages;
}

function rawEvent(overrides = {}) {
  return {
    _id: firstId,
    actorType: 'SYSTEM',
    actorAccountId: null,
    actorSnapshot: {},
    action: 'ORDER_IMPORTED',
    entityType: 'ORDER',
    entityId: 'order-1',
    scopeType: 'SHOP',
    scopeId: shopOne,
    outcome: 'SUCCEEDED',
    source: 'IMPORT',
    requestId: null,
    ipAddress: null,
    userAgent: null,
    changes: null,
    metadata: { safe: true },
    deduplicationKey: 'order:1:imported',
    createdAt: new Date('2026-07-28T02:00:00.000Z'),
    privateField: 'never-return',
    ...overrides,
  };
}

beforeAll(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri('lng_web_be_audit_query_test'));
  await AuditEvent.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await database.stop();
});

afterEach(async () => AuditEvent.deleteMany({}));

describe('audit event query persistence', () => {
  test('default descending pagination uses the managed timeline index without blocking work', async () => {
    await AuditEvent.collection.insertMany(Array.from({ length: 50 }, (_, index) => rawEvent({
      _id: new mongoose.Types.ObjectId(),
      entityId: `order-${index}`,
      deduplicationKey: `query:explain:${index}`,
      createdAt: new Date(Date.UTC(2026, 6, 28, 0, index)),
    })));

    const explain = await AuditEvent.find({})
      .sort({ createdAt: -1, _id: -1 })
      .limit(20)
      .explain('queryPlanner');
    const stages = planStages(explain.queryPlanner.winningPlan);

    expect(stages).toContain('IXSCAN');
    expect(stages).not.toContain('COLLSCAN');
    expect(stages).not.toContain('SORT');
  });

  test('paginates by descending createdAt then _id without gaps at timestamp ties', async () => {
    const tiedHigherId = new mongoose.Types.ObjectId('660000000000000000000303');
    const oldestId = new mongoose.Types.ObjectId('660000000000000000000300');
    await AuditEvent.collection.insertMany([
      rawEvent({ _id: firstId, createdAt: new Date('2026-07-28T03:00:00.000Z'), deduplicationKey: 'query:order:1' }),
      rawEvent({ _id: secondId, createdAt: new Date('2026-07-28T02:00:00.000Z'), deduplicationKey: 'query:order:2' }),
      rawEvent({ _id: tiedHigherId, createdAt: new Date('2026-07-28T02:00:00.000Z'), deduplicationKey: 'query:order:3' }),
      rawEvent({ _id: oldestId, createdAt: new Date('2026-07-28T01:00:00.000Z'), deduplicationKey: 'query:order:4' }),
    ]);

    const firstPage = await repository.list({ limit: 2 }, null);
    const { error, value } = listAuditEventsQuerySchema.validate({ cursor: firstPage.nextCursor, limit: 2 });
    expect(error).toBeUndefined();
    const secondPage = await repository.list(value, null);

    expect(firstPage.items.map((event) => String(event._id))).toEqual([String(firstId), String(tiedHigherId)]);
    expect(secondPage.items.map((event) => String(event._id))).toEqual([String(secondId), String(oldestId)]);
    expect(secondPage.nextCursor).toBeNull();
  });

  test('exact scope queries exclude other scopes and genuinely unscoped system events', async () => {
    await AuditEvent.collection.insertMany([
      rawEvent({ _id: firstId, deduplicationKey: 'query:scope:1' }),
      rawEvent({ _id: secondId, scopeId: shopTwo, deduplicationKey: 'query:scope:2' }),
      rawEvent({
        _id: new mongoose.Types.ObjectId(),
        scopeType: undefined,
        scopeId: undefined,
        action: 'SYSTEM_MAINTENANCE',
        entityType: 'SYSTEM_JOB',
        entityId: 'maintenance-1',
        source: 'SYSTEM',
        deduplicationKey: 'query:system:unscoped',
      }),
    ]);

    const result = await repository.list({ limit: 20 }, [{ scopeType: 'SHOP', scopeId: shopOne }]);

    expect(result.items.map((event) => event.deduplicationKey)).toEqual(['query:scope:1']);
  });

  test('global queries include a genuinely unscoped system event', async () => {
    await AuditEvent.collection.insertMany([
      rawEvent({ _id: firstId, deduplicationKey: 'query:global:scoped' }),
      rawEvent({
        _id: secondId,
        scopeType: undefined,
        scopeId: undefined,
        action: 'SYSTEM_MAINTENANCE',
        entityType: 'SYSTEM_JOB',
        entityId: 'maintenance-2',
        source: 'SYSTEM',
        deduplicationKey: 'query:global:unscoped',
      }),
    ]);

    const result = await repository.list({ limit: 20 }, null);

    expect(result.items.map((event) => event.deduplicationKey)).toEqual(expect.arrayContaining([
      'query:global:scoped',
      'query:global:unscoped',
    ]));
  });

  test('out-of-scope detail is absent from the authorized persistence query', async () => {
    await AuditEvent.collection.insertOne(rawEvent({ _id: secondId, scopeId: shopTwo, deduplicationKey: 'query:detail:2' }));

    await expect(repository.findById(String(secondId), [{ scopeType: 'SHOP', scopeId: shopOne }]))
      .resolves.toBeNull();
  });

  test('applies representative actor, action, entity, outcome, source, request, and date filters', async () => {
    const actorAccountId = new mongoose.Types.ObjectId();
    await AuditEvent.collection.insertMany([
      rawEvent({
        _id: firstId,
        actorType: 'ACCOUNT',
        actorAccountId,
        action: 'ORDER_CANCELLED',
        entityType: 'ORDER',
        entityId: 'order-filter-match',
        outcome: 'FAILED',
        source: 'HTTP',
        requestId: 'request-filter-match',
        createdAt: new Date('2026-07-15T12:00:00.000Z'),
        deduplicationKey: 'query:filters:match',
      }),
      rawEvent({
        _id: secondId,
        actorType: 'ACCOUNT',
        actorAccountId,
        action: 'ORDER_CANCELLED',
        entityType: 'ORDER',
        entityId: 'order-filter-match',
        outcome: 'SUCCEEDED',
        source: 'HTTP',
        requestId: 'request-filter-match',
        createdAt: new Date('2026-07-15T12:00:00.000Z'),
        deduplicationKey: 'query:filters:wrong-outcome',
      }),
      rawEvent({
        _id: new mongoose.Types.ObjectId(),
        actorType: 'ACCOUNT',
        actorAccountId,
        action: 'ORDER_CANCELLED',
        entityType: 'ORDER',
        entityId: 'order-filter-match',
        outcome: 'FAILED',
        source: 'HTTP',
        requestId: 'request-filter-match',
        createdAt: new Date('2026-06-15T12:00:00.000Z'),
        deduplicationKey: 'query:filters:outside-date',
      }),
    ]);

    const result = await repository.list({
      actorAccountId: String(actorAccountId),
      action: 'ORDER_CANCELLED',
      entityType: 'ORDER',
      entityId: 'order-filter-match',
      outcome: 'FAILED',
      source: 'HTTP',
      requestId: 'request-filter-match',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-31T23:59:59.999Z'),
      limit: 20,
    }, null);

    expect(result.items.map((event) => event.deduplicationKey)).toEqual(['query:filters:match']);
  });

  test('enriches technical references with readable account, employee, and scope labels', async () => {
    const actorAccountId = new mongoose.Types.ObjectId();
    const shopId = new mongoose.Types.ObjectId(shopOne);
    await Promise.all([
      AuditEvent.collection.insertOne(rawEvent({ actorType: 'ACCOUNT', actorAccountId, entityType: 'AUTH_ACCOUNT', entityId: String(actorAccountId) })),
      mongoose.connection.collection('accounts').insertOne({ _id: actorAccountId, email: 'staff@lng.co' }),
      mongoose.connection.collection('employeeprofiles').insertOne({ accountId: actorAccountId, fullName: 'Nguyễn Văn A', employeeCode: 'J2501' }),
      mongoose.connection.collection('scoperegistries').insertOne({ scopeType: 'SHOP', scopeId: shopId, name: 'Amazon US' }),
    ]);

    const result = await repository.list({ limit: 20 }, null);

    expect(result.items[0]).toMatchObject({
      actorLabel: 'Nguyễn Văn A',
      actorEmail: 'staff@lng.co',
      actorEmployeeCode: 'J2501',
      entityLabel: 'Nguyễn Văn A',
      scopeLabel: 'Amazon US',
    });
  });
});

describe('audit event query authorization and DTOs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(repository, 'list').mockResolvedValue({ items: [rawEvent()], nextCursor: null });
    jest.spyOn(repository, 'findById').mockResolvedValue(rawEvent());
  });

  afterEach(() => jest.restoreAllMocks());

  test('global readers may list unscoped system events without a scope restriction', async () => {
    await service.listEvents({ limit: 20 }, { permissions: ['AUDIT:READ'], scopes: [] });
    expect(repository.list).toHaveBeenCalledWith({ limit: 20 }, null);
  });

  test('scoped readers receive only their authorized scopes and DTO-safe fields', async () => {
    const authContext = {
      permissions: [],
      scopes: [
        { scopeType: 'shop', scopeId: shopOne, permissions: ['AUDIT:READ'] },
        { scopeType: 'shop', scopeId: shopTwo, permissions: ['ORDERS:READ'] },
      ],
    };
    const result = await service.listEvents({ limit: 20 }, authContext);
    expect(authPublic.canAccessScope).toHaveBeenCalledWith(
      authContext,
      'AUDIT:READ',
      { scopeType: 'shop', scopeId: shopOne },
    );
    expect(repository.list).toHaveBeenCalledWith({ limit: 20 }, [
      { scopeType: 'SHOP', scopeId: shopOne },
    ]);
    expect(result.items[0]).not.toHaveProperty('privateField');
    expect(Object.getPrototypeOf(result.items[0])).toBeNull();
  });

  test('rejects a scoped list request for another scope', async () => {
    await expect(service.listEvents(
      { scopeType: 'SHOP', scopeId: shopTwo, limit: 20 },
      { permissions: [], scopes: [{ scopeType: 'shop', scopeId: shopOne, permissions: ['AUDIT:READ'] }] },
    )).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(repository.list).not.toHaveBeenCalled();
  });

  test('returns not found when scoped detail is absent from the authorized persistence query', async () => {
    repository.findById.mockResolvedValueOnce(null);
    await expect(service.getEvent(String(firstId), {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopOne, permissions: ['AUDIT:READ'] }],
    })).rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
    expect(repository.findById).toHaveBeenCalledWith(String(firstId), [
      { scopeType: 'SHOP', scopeId: shopOne },
    ]);
  });

  test('list DTO serialization ignores inherited toJSON pollution', () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value() { return { polluted: true }; },
    });
    let serialized;
    try {
      serialized = JSON.stringify(toAuditEventListDto({ items: [rawEvent()], nextCursor: null }));
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'toJSON', original);
      else delete Object.prototype.toJSON;
    }
    expect(JSON.parse(serialized)).toMatchObject({
      items: [{ id: String(firstId), action: 'ORDER_IMPORTED' }],
      nextCursor: null,
    });
    expect(serialized).not.toContain('polluted');
  });
});
