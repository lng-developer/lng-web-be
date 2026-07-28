const mongoose = require('mongoose');
const { BSON } = require('mongodb');

jest.mock('../../modules/audit/repositories/auditEvent.repository', () => ({
  upsertByDeduplicationKey: jest.fn(),
}));

const repository = require('../../modules/audit/repositories/auditEvent.repository');
const auditPublic = require('../../modules/audit/public');

const accountId = new mongoose.Types.ObjectId();

function event(overrides = {}) {
  return {
    actorType: 'ACCOUNT',
    actorAccountId: accountId,
    action: 'ACCOUNT_UPDATED',
    entityType: 'AUTH_ACCOUNT',
    entityId: String(accountId),
    outcome: 'SUCCEEDED',
    source: 'HTTP',
    deduplicationKey: `auth:account:${accountId}:updated`,
    ...overrides,
  };
}

describe('audit event service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    repository.upsertByDeduplicationKey.mockImplementation(async (payload) => ({
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      ...payload,
    }));
  });

  test.each([
    ['ACCOUNT', { actorAccountId: accountId }],
    ['SYSTEM', { actorAccountId: undefined }],
    ['ANONYMOUS', { actorAccountId: undefined }],
  ])('records a valid %s event', async (actorType, actor) => {
    await expect(auditPublic.record(event({ actorType, ...actor }))).resolves.toMatchObject({
      actorType,
      action: 'ACCOUNT_UPDATED',
      outcome: 'SUCCEEDED',
      source: 'HTTP',
    });
  });

  test.each([
    ['actorType', 'ROBOT'],
    ['action', 'account.updated'],
    ['entityType', 'auth-account'],
    ['outcome', 'OK'],
    ['source', 'API'],
    ['actorAccountId', 'not-an-object-id'],
    ['entityId', '   '],
    ['scopeId', '   '],
  ])('rejects invalid %s', async (field, value) => {
    await expect(auditPublic.record(event({ [field]: value }))).rejects.toThrow();
    expect(repository.upsertByDeduplicationKey).not.toHaveBeenCalled();
  });

  test.each(['actorType', 'outcome', 'source'])('rejects missing required %s', async (field) => {
    const payload = event();
    delete payload[field];

    await expect(auditPublic.record(payload)).rejects.toThrow();
    expect(repository.upsertByDeduplicationKey).not.toHaveBeenCalled();
  });

  test('removes secret and dangerous keys recursively before persistence', async () => {
    const metadata = JSON.parse('{"safe":"keep","password":"drop","nested":{"accessToken":"drop","authorization":"drop","cookie":"drop","secret":"drop","constructor":"drop","prototype":"drop","__proto__":"drop","value":7}}');

    const result = await auditPublic.record(event({ metadata }));

    expect(result.metadata).toEqual({ safe: 'keep', nested: { value: 7 } });
    expect(repository.upsertByDeduplicationKey.mock.calls[0][0].metadata).toEqual(result.metadata);
  });

  test('removes BSON and JSON serialization hooks before size checks or persistence', async () => {
    const metadata = {
      safe: 'keep',
      toJSON() { return { password: 'leaked-by-json-hook' }; },
      toBSON() { return { secret: 'leaked-by-bson-hook' }; },
    };

    const result = await auditPublic.record(event({ metadata }));

    expect(result.metadata).toEqual({ safe: 'keep' });
    expect(repository.upsertByDeduplicationKey.mock.calls[0][0].metadata).toEqual({ safe: 'keep' });
  });

  test('cannot use a serialization hook to hide oversized metadata', async () => {
    const metadata = {
      value: 'x'.repeat(17 * 1024),
      toJSON() { return {}; },
    };

    await expect(auditPublic.record(event({ metadata }))).rejects.toThrow(/metadata/i);
    expect(repository.upsertByDeduplicationKey).not.toHaveBeenCalled();
  });

  test.each([
    ['function', () => 'hidden'],
    ['symbol', Symbol('hidden')],
    ['class instance', new (class Unsupported { constructor() { this.safe = true; } })()],
  ])('rejects non-plain %s metadata values', async (_label, value) => {
    await expect(auditPublic.record(event({ metadata: { value } }))).rejects.toThrow(/plain|metadata/i);
    expect(repository.upsertByDeduplicationKey).not.toHaveBeenCalled();
  });

  test('accepts null-prototype objects, arrays, dates, and ObjectIds as plain audit data', async () => {
    const nested = Object.assign(Object.create(null), { safe: true });
    const occurredAt = new Date('2026-07-28T00:00:00.000Z');
    const referenceId = new mongoose.Types.ObjectId();

    const result = await auditPublic.record(event({
      metadata: { nested, list: [true, 'value', 7], occurredAt, referenceId },
    }));
    expect(result).toMatchObject({ metadata: { nested: { safe: true }, occurredAt, referenceId } });
    expect(result.metadata.list.map(String)).toEqual(['true', 'value', '7']);
  });

  test('copies supported Date and ObjectId values without own serialization hooks', async () => {
    const occurredAt = new Date('2026-07-28T00:00:00.000Z');
    occurredAt.toJSON = () => ({ password: 'date-hook-secret' });
    const referenceId = new mongoose.Types.ObjectId();
    referenceId.toBSON = () => ({ secret: 'object-id-hook-secret' });

    await auditPublic.record(event({ metadata: { occurredAt, referenceId } }));

    const persisted = repository.upsertByDeduplicationKey.mock.calls[0][0].metadata;
    expect(persisted.occurredAt).toBeInstanceOf(Date);
    expect(Object.hasOwn(persisted.occurredAt, 'toJSON')).toBe(false);
    expect(persisted.referenceId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(Object.hasOwn(persisted.referenceId, 'toBSON')).toBe(false);
  });

  test('inherited toJSON cannot hide oversized nested array metadata', async () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value() { return {}; },
    });
    try {
      await expect(auditPublic.record(event({
        metadata: { list: ['x'.repeat(100 * 1024)] },
      }))).rejects.toThrow(/metadata/i);
      expect(repository.upsertByDeduplicationKey).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'toJSON', original);
      else delete Object.prototype.toJSON;
    }
  });

  test('inherited toBSON cannot replace metadata with forbidden data', async () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toBSON');
    Object.defineProperty(Object.prototype, 'toBSON', {
      configurable: true,
      value() { return Object.assign(Object.create(null), { password: 'prototype-secret' }); },
    });
    let result;
    let metadata;
    try {
      result = await auditPublic.record(event({ metadata: { safe: 'keep' } }));
      const payload = repository.upsertByDeduplicationKey.mock.calls[0][0];
      metadata = payload.metadata;
      expect(Object.getPrototypeOf(metadata)).toBeNull();
      expect(metadata.toBSON).toBeUndefined();
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'toBSON', original);
      else delete Object.prototype.toBSON;
    }

    const wrapper = Object.assign(Object.create(null), { metadata });
    const persisted = BSON.deserialize(BSON.serialize(wrapper));
    expect(persisted.metadata).toEqual({ safe: 'keep' });
    expect(JSON.parse(JSON.stringify(result)).metadata).toEqual({ safe: 'keep' });
  });

  test('rejects metadata beyond the depth and serialized-size bounds', async () => {
    const tooDeep = { one: { two: { three: { four: { five: { six: true } } } } } };
    await expect(auditPublic.record(event({ metadata: tooDeep }))).rejects.toThrow(/metadata/i);
    await expect(auditPublic.record(event({ metadata: { value: 'x'.repeat(17 * 1024) } })))
      .rejects.toThrow(/metadata/i);
  });

  test('returns the persisted event from the atomic idempotent write', async () => {
    const existing = { _id: new mongoose.Types.ObjectId(), ...event() };
    repository.upsertByDeduplicationKey.mockResolvedValueOnce(existing);

    await expect(auditPublic.record(event())).resolves.toMatchObject({ id: String(existing._id) });
    expect(repository.upsertByDeduplicationKey).toHaveBeenCalledTimes(1);
  });

  test('passes a supplied Mongoose session through the atomic repository boundary', async () => {
    const session = { id: 'session' };
    await auditPublic.record(event(), { session });
    expect(repository.upsertByDeduplicationKey.mock.calls[0][1]).toEqual({ session });
  });
});
