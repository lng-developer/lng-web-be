jest.mock('../../src/modules/auth/public', () => ({
  getAccountStatusCounts: jest.fn(),
  isSuperAdmin: jest.fn(),
}));
jest.mock('../../src/modules/audit/public', () => ({ listEvents: jest.fn() }));
jest.mock('../../src/modules/system/services/systemHealth.service', () => ({ getHealth: jest.fn() }));

const authPublic = require('../../src/modules/auth/public');
const auditPublic = require('../../src/modules/audit/public');
const systemHealth = require('../../src/modules/system/services/systemHealth.service');
const service = require('../../src/modules/system/services/systemDashboard.service');

describe('system dashboard service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    authPublic.isSuperAdmin.mockReturnValue(false);
    authPublic.getAccountStatusCounts.mockResolvedValue({ total: 12, active: 10 });
    auditPublic.listEvents.mockResolvedValue({ items: [{ id: 'audit-1' }], nextCursor: null });
    systemHealth.getHealth.mockResolvedValue({ status: 'ok' });
  });

  test('returns only sections permitted globally', async () => {
    await expect(service.getDashboard({ permissions: ['AUTH:READ'] })).resolves.toEqual({
      accounts: { total: 12, active: 10 },
    });
    expect(systemHealth.getHealth).not.toHaveBeenCalled();
    expect(auditPublic.listEvents).not.toHaveBeenCalled();
  });

  test('returns health and recent audit evidence to audit readers', async () => {
    await expect(service.getDashboard({ permissions: ['AUDIT:READ'] })).resolves.toEqual({
      health: { status: 'ok' },
      recentAudit: { items: [{ id: 'audit-1' }], nextCursor: null },
    });
    expect(auditPublic.listEvents).toHaveBeenCalledWith({ limit: 5 }, { permissions: ['AUDIT:READ'] });
  });
});
