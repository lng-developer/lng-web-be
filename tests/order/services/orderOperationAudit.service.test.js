const mockSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  startSession: jest.fn(async () => mockSession),
}));

jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn(),
}));
jest.mock('../../../src/shared/utils/logger', () => ({ warn: jest.fn() }));

const auditPublic = require('../../../src/modules/audit/public');
const logger = require('../../../src/shared/utils/logger');
const { recordOrderOperation } = require('../../../src/modules/order/services/orderOperationAudit.service');

describe('orderOperationAudit.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['ACCOUNT', { accountId: '660000000000000000000901', auditContext: {} }, 'HTTP'],
    ['SYSTEM', { system: true }, 'SYSTEM'],
  ])('records a sanitized %s shop-scoped operation', async (actorType, authContext, source) => {
    auditPublic.record.mockResolvedValue({ id: 'event-1' });

    await recordOrderOperation({
      action: 'ORDER_CASE_UPDATED',
      entityType: 'ORDER_CASE',
      entityId: '660000000000000000000701',
      shopId: '660000000000000000000201',
      authContext,
      changes: { fields: ['severity'] },
      metadata: { noteChanged: true },
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType,
      actorAccountId: authContext.accountId || null,
      action: 'ORDER_CASE_UPDATED',
      entityType: 'ORDER_CASE',
      entityId: '660000000000000000000701',
      scopeType: 'SHOP',
      scopeId: '660000000000000000000201',
      outcome: 'SUCCEEDED',
      source,
      changes: { fields: ['severity'] },
      metadata: { noteChanged: true },
      deduplicationKey: expect.stringMatching(/^operations:order_case_updated:660000000000000000000701:/),
    }), { session: null });
  });

  test('does not turn a committed mutation into a 500 when audit storage is unavailable', async () => {
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(recordOrderOperation({
      action: 'ORDER_ASSIGNED',
      entityType: 'ORDER',
      entityId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      authContext: { accountId: '660000000000000000000901' },
    })).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('Operation audit write failed after mutation commit', expect.objectContaining({
      action: 'ORDER_ASSIGNED',
      entityId: '660000000000000000000301',
    }));
  });

  test('preserves explicit actor and source provenance from an internal caller', async () => {
    await recordOrderOperation({
      action: 'ORDER_ADDRESS_VALIDATED',
      entityType: 'ORDER',
      entityId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      authContext: { actorType: 'SYSTEM', source: 'IMPORT' },
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'SYSTEM',
      actorAccountId: null,
      source: 'IMPORT',
    }), { session: null });
  });

  test.each([
    [{ system: true, accountId: '660000000000000000000901' }, 'SYSTEM'],
    [{ worker: true, accountId: '660000000000000000000901' }, 'WORKER'],
    [{ import: true, accountId: '660000000000000000000901' }, 'IMPORT'],
  ])('records flagged internal work with %j provenance while retaining its initiating account', async (authContext, source) => {
    await recordOrderOperation({
      action: 'ORDER_ADDRESS_VALIDATED',
      entityType: 'ORDER',
      entityId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      authContext,
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'SYSTEM',
      actorAccountId: '660000000000000000000901',
      source,
    }), { session: null });
  });

  test('ignores a domain source that is not accepted by the audit contract', async () => {
    await recordOrderOperation({
      action: 'ORDER_REPLACEMENT_CREATED',
      entityType: 'ORDER',
      entityId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      authContext: {
        accountId: '660000000000000000000901',
        source: 'ORDER_REPLACEMENT',
        auditContext: {},
      },
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({ source: 'HTTP' }), { session: null });
  });
});
