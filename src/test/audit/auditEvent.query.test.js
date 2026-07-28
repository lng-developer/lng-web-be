const mongoose = require('mongoose');

jest.mock('../../modules/audit/models/auditEvent.model', () => ({
  find: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(),
}));
jest.mock('../../modules/auth/public', () => ({
  canAccessScope: jest.fn((authContext, permission, scope) => (
    (authContext.scopes || []).some((grant) => (
      grant.scopeType === scope.scopeType && String(grant.scopeId) === String(scope.scopeId)
      && (grant.permissions || []).includes(permission)
    ))
  )),
}));

const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const authPublic = require('../../modules/auth/public');
const repository = require('../../modules/audit/repositories/auditEvent.repository');
const service = require('../../modules/audit/services/auditEvent.service');
const { toAuditEventListDto } = require('../../modules/audit/dtos/auditEvent.dto');

const firstId = new mongoose.Types.ObjectId('660000000000000000000301');
const secondId = new mongoose.Types.ObjectId('660000000000000000000302');
const shopOne = '660000000000000000000201';
const shopTwo = '660000000000000000000202';

function rawEvent(overrides = {}) {
  return {
    _id: firstId, actorType: 'SYSTEM', actorAccountId: null, actorSnapshot: {},
    action: 'ORDER_IMPORTED', entityType: 'ORDER', entityId: 'order-1',
    scopeType: 'SHOP', scopeId: shopOne, outcome: 'SUCCEEDED', source: 'IMPORT',
    requestId: null, ipAddress: null, userAgent: null, changes: null,
    metadata: { safe: true }, deduplicationKey: 'order:1:imported',
    createdAt: new Date('2026-07-28T02:00:00.000Z'), privateField: 'never-return',
    ...overrides,
  };
}

function queryChain(rows) {
  const chain = { sort: jest.fn(), limit: jest.fn(), lean: jest.fn().mockResolvedValue(rows) };
  chain.sort.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

describe('audit event query persistence', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses a lean descending createdAt/_id cursor query and returns an opaque next cursor', async () => {
    const chain = queryChain([
      rawEvent(),
      rawEvent({ _id: secondId, createdAt: new Date('2026-07-28T01:00:00.000Z') }),
    ]);
    AuditEvent.find.mockReturnValue(chain);
    const result = await repository.list({
      action: 'ORDER_IMPORTED',
      cursor: { createdAt: new Date('2026-07-28T03:00:00.000Z'), id: secondId },
      limit: 1,
    }, null);

    expect(AuditEvent.find).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_IMPORTED',
      $and: expect.arrayContaining([{ $or: [
        { createdAt: { $lt: new Date('2026-07-28T03:00:00.000Z') } },
        { createdAt: new Date('2026-07-28T03:00:00.000Z'), _id: { $lt: secondId } },
      ] }]),
    }));
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.limit).toHaveBeenCalledWith(2);
    expect(chain.lean).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  test('adds exact authorized scope constraints and never admits unscoped events', async () => {
    const chain = queryChain([]);
    AuditEvent.find.mockReturnValue(chain);
    await repository.list({ limit: 20 }, [{ scopeType: 'SHOP', scopeId: shopOne }]);
    expect(AuditEvent.find).toHaveBeenCalledWith({
      $and: [{ $or: [{ scopeType: 'SHOP', scopeId: shopOne }] }],
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
      authContext, 'AUDIT:READ', { scopeType: 'shop', scopeId: shopOne },
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
      permissions: [], scopes: [{ scopeType: 'shop', scopeId: shopOne, permissions: ['AUDIT:READ'] }],
    })).rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
    expect(repository.findById).toHaveBeenCalledWith(String(firstId), [
      { scopeType: 'SHOP', scopeId: shopOne },
    ]);
  });

  test('list DTO serialization ignores inherited toJSON pollution', () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true, value() { return { polluted: true }; },
    });
    let serialized;
    try {
      serialized = JSON.stringify(toAuditEventListDto({ items: [rawEvent()], nextCursor: null }));
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'toJSON', original);
      else delete Object.prototype.toJSON;
    }
    expect(JSON.parse(serialized)).toMatchObject({
      items: [{ id: String(firstId), action: 'ORDER_IMPORTED' }], nextCursor: null,
    });
    expect(serialized).not.toContain('polluted');
  });
});
