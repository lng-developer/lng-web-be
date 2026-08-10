const crypto = require('crypto');

jest.mock('../../../src/modules/auth/public', () => ({
  filterAssignableAccountIds: jest.fn(async (accountIds = []) => accountIds),
}));
jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
}));
jest.mock('../../../src/modules/notification/public', () => ({
  notifyMany: jest.fn(),
}));
jest.mock('../../../src/modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
}));
jest.mock('../../../src/modules/hr/repositories/announcement.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  listAudienceProfiles: jest.fn(),
  update: jest.fn(),
}));

const auditPublic = require('../../../src/modules/audit/public');
const notificationPublic = require('../../../src/modules/notification/public');
const repository = require('../../../src/modules/hr/repositories/announcement.repository');
const service = require('../../../src/modules/hr/services/announcement.service');

describe('announcement audit service', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
    notificationPublic.notifyMany.mockResolvedValue([{ delivered: true }]);
    repository.listAudienceProfiles.mockResolvedValue([{ accountId: '660000000000000000000051' }]);
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

  test('audits an immediately published announcement before failed delivery', async () => {
    const id = '660000000000000000000043';
    const published = {
      _id: id,
      title: 'Immediate publish',
      content: 'Private',
      status: 'PUBLISHED',
      category: 'GENERAL',
      priority: 'NORMAL',
      sendToAll: true,
      targetDepartmentIds: [],
      targetProfileIds: [],
      publishedAt: new Date('2026-07-29T05:00:00.000Z'),
      isDeleted: false,
    };
    repository.create.mockResolvedValue(published);
    repository.findById.mockResolvedValue(published);
    notificationPublic.notifyMany.mockRejectedValueOnce(new Error('delivery unavailable'));

    await expect(service.createAnnouncement({
      title: published.title,
      content: published.content,
      status: 'PUBLISHED',
      sendToAll: true,
    }, { accountId: '660000000000000000000001' })).resolves.toMatchObject({ status: 'PUBLISHED' });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_ANNOUNCEMENT_CREATED', entityId: id,
    }), {});
    expect(auditPublic.record.mock.invocationCallOrder[0])
      .toBeLessThan(notificationPublic.notifyMany.mock.invocationCallOrder[0]);
  });

  test('audits a publish-now transition before failed delivery', async () => {
    const id = '660000000000000000000044';
    const draft = {
      _id: id,
      title: 'Publish now',
      content: 'Private',
      status: 'DRAFT',
      category: 'GENERAL',
      priority: 'NORMAL',
      sendToAll: true,
      targetDepartmentIds: [],
      targetProfileIds: [],
      isDeleted: false,
    };
    const published = { ...draft, status: 'PUBLISHED', publishedAt: new Date('2026-07-29T05:00:00.000Z') };
    repository.findById.mockResolvedValueOnce(draft).mockResolvedValueOnce(published);
    repository.update.mockResolvedValue(published);
    notificationPublic.notifyMany.mockRejectedValueOnce(new Error('delivery unavailable'));

    await expect(service.updateAnnouncement(id, { status: 'PUBLISHED' }, {
      accountId: '660000000000000000000001', permissions: ['HR_ANNOUNCEMENTS:WRITE'],
    })).resolves.toMatchObject({ status: 'PUBLISHED' });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_ANNOUNCEMENT_PUBLISHED', entityId: id,
    }), {});
    expect(auditPublic.record.mock.invocationCallOrder[0])
      .toBeLessThan(notificationPublic.notifyMany.mock.invocationCallOrder[0]);
  });
});
