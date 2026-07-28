const mockSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  startSession: jest.fn(async () => mockSession),
}));

jest.mock('../../../modules/audit/public', () => ({
  record: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ warn: jest.fn() }));

const auditPublic = require('../../../modules/audit/public');
const logger = require('../../../shared/utils/logger');
const { recordOrderOperation } = require('../../../modules/order/services/orderOperationAudit.service');

describe('orderOperationAudit.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['ACCOUNT', { accountId: '660000000000000000000901' }, 'HTTP'],
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
});
