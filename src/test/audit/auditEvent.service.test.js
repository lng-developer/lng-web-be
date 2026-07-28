const mongoose = require('mongoose');

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
