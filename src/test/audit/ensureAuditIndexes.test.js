jest.mock('../../config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../../modules/audit/models/auditEvent.model', () => ({
  aggregate: jest.fn(),
  collection: { indexes: jest.fn(), createIndex: jest.fn(), dropIndex: jest.fn() },
}));

const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const { ensureAuditIndexes } = require('../../modules/audit/scripts/ensureAuditIndexes');

const target = { host: 'mongo.internal', port: 27017, database: 'lng_portal' };

describe('ensure Audit indexes script', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    AuditEvent.aggregate.mockResolvedValue([]);
    AuditEvent.collection.indexes.mockResolvedValue([{ name: '_id_', key: { _id: 1 } }]);
    AuditEvent.collection.createIndex.mockImplementation(async (_key, options) => options.name);
  });

  test('preflights duplicate deduplication keys before creating indexes', async () => {
    AuditEvent.aggregate.mockResolvedValue([{ _id: 'duplicate:key', count: 2 }]);

    await expect(ensureAuditIndexes(target)).rejects.toThrow(/duplicate deduplication keys/i);
    expect(AuditEvent.collection.createIndex).not.toHaveBeenCalled();
  });

  test('creates all missing definitions and is rerunnable with safe proof output', async () => {
    const first = await ensureAuditIndexes(target);
    expect(first).toMatchObject({ target, created: expect.any(Array), verified: expect.any(Array) });
    expect(first.created).toHaveLength(5);
    expect(JSON.stringify(first)).not.toMatch(/duplicate:key|mongodb:|password|username/i);

    AuditEvent.collection.indexes.mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      ...AuditEvent.collection.createIndex.mock.calls.map(([key, options]) => ({ key, ...options })),
    ]);
    AuditEvent.collection.createIndex.mockClear();

    const replay = await ensureAuditIndexes(target);
    expect(replay.created).toEqual([]);
    expect(replay.verified).toHaveLength(5);
    expect(AuditEvent.collection.createIndex).not.toHaveBeenCalled();
  });

  test('refuses conflicting definitions without deleting or rebuilding them', async () => {
    AuditEvent.collection.indexes.mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      { name: 'audit_deduplication_unique', key: { deduplicationKey: 1 }, unique: false },
    ]);

    await expect(ensureAuditIndexes(target)).rejects.toThrow(/conflicting audit index/i);
    expect(AuditEvent.collection.createIndex).not.toHaveBeenCalled();
    expect(AuditEvent.collection.dropIndex).not.toHaveBeenCalled();
  });

  test.each([
    ['partial filter', { partialFilterExpression: { outcome: 'SUCCEEDED' } }],
    ['sparse option', { sparse: true }],
    ['non-default collation', { collation: { locale: 'en', strength: 2 } }],
  ])('refuses a required index with a %s variant', async (_label, options) => {
    AuditEvent.collection.indexes.mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      {
        name: 'audit_entity_timeline',
        key: { entityType: 1, entityId: 1, createdAt: -1, _id: -1 },
        ...options,
      },
    ]);

    await expect(ensureAuditIndexes(target)).rejects.toThrow(/conflicting audit index/i);
    expect(AuditEvent.collection.createIndex).not.toHaveBeenCalled();
    expect(AuditEvent.collection.dropIndex).not.toHaveBeenCalled();
  });
});
