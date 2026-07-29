const crypto = require('crypto');

jest.mock('../../../modules/auth/public', () => ({
  filterAssignableAccountIds: jest.fn(),
}));
jest.mock('../../../modules/audit/public', () => ({
  record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
}));
jest.mock('../../../modules/notification/public', () => ({
  notifyMany: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/announcement.repository', () => ({
  findById: jest.fn(),
  update: jest.fn(),
}));

const auditPublic = require('../../../modules/audit/public');
const repository = require('../../../modules/hr/repositories/announcement.repository');
const service = require('../../../modules/hr/services/announcement.service');

describe('announcement audit service', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('gives same-timestamp announcement updates distinct server mutation identities', async () => {
    const id = '660000000000000000000041';
    const persisted = {
      _id: id,
      title: 'Collision proof',
      content: 'Private',
      status: 'DRAFT',
      priority: 'NORMAL',
      category: 'GENERAL',
      sendToAll: true,
      targetDepartmentIds: [],
      targetProfileIds: [],
      isDeleted: false,
      updatedAt: new Date('2026-07-29T04:00:00.000Z'),
    };
    jest.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000041')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000042');
    repository.findById.mockResolvedValue(persisted);
    repository.update.mockResolvedValue(persisted);
    const auth = { accountId: '660000000000000000000001', permissions: ['HR_ANNOUNCEMENTS:WRITE'] };

    await service.updateAnnouncement(id, { priority: 'HIGH' }, auth);
    await service.updateAnnouncement(id, { priority: 'NORMAL' }, auth);

    expect(auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey)).toEqual([
      `hr:hr_announcement_updated:${id}:00000000-0000-4000-8000-000000000041`,
      `hr:hr_announcement_updated:${id}:00000000-0000-4000-8000-000000000042`,
    ]);
  });
});
