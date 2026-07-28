const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../../../modules/auth/public', () => ({
  filterAssignableAccountIds: jest.fn(async (accountIds = []) => accountIds.map(String)),
}));

const Announcement = require('../../../modules/hr/models/announcement.model');
const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const Notification = require('../../../modules/notification/models/notification.model');
const authPublic = require('../../../modules/auth/public');
const service = require('../../../modules/hr/services/announcement.service');

const authorId = new mongoose.Types.ObjectId('682000000000000000000001');
const accountOneId = new mongoose.Types.ObjectId('682000000000000000000002');
const accountTwoId = new mongoose.Types.ObjectId('682000000000000000000003');
const accountThreeId = new mongoose.Types.ObjectId('682000000000000000000004');
const profileOneId = new mongoose.Types.ObjectId('682000000000000000000005');
const profileTwoId = new mongoose.Types.ObjectId('682000000000000000000006');
const profileThreeId = new mongoose.Types.ObjectId('682000000000000000000007');
const departmentOneId = new mongoose.Types.ObjectId('682000000000000000000008');
const departmentTwoId = new mongoose.Types.ObjectId('682000000000000000000009');

let mongo;
jest.setTimeout(120000);

describe('announcement persisted audience and delivery', () => {
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { dbName: 'task7_announcement_test' } });
    await mongoose.connect(mongo.getUri('task7_announcement_test'));
    await Promise.all([Announcement.init(), EmployeeProfile.init(), Notification.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Announcement.deleteMany({}), EmployeeProfile.deleteMany({}), Notification.deleteMany({}),
    ]);
    await EmployeeProfile.insertMany([
      { _id: profileOneId, accountId: accountOneId, employeeCode: 'ANN-ONE', fullName: 'One', departmentId: departmentOneId, status: 'ACTIVE' },
      { _id: profileTwoId, accountId: accountTwoId, employeeCode: 'ANN-TWO', fullName: 'Two', departmentId: departmentTwoId, status: 'ACTIVE' },
      { _id: profileThreeId, accountId: accountThreeId, employeeCode: 'ANN-THREE', fullName: 'Three', departmentId: departmentTwoId, status: 'PROBATION' },
    ]);
  });

  test('scheduled publication and reminder notify only the eligible audience once with distinct keys', async () => {
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + 60_000);
    const remindAt = new Date(now.getTime() + 120_000);
    const announcement = await service.createAnnouncement({
      title: 'Quarterly town hall',
      content: 'Join the company update.',
      category: 'EVENT',
      status: 'SCHEDULED',
      scheduledAt,
      remindAt,
      sendToAll: false,
      targetDepartmentIds: [String(departmentOneId)],
      targetProfileIds: [String(profileThreeId)],
      eventDetails: { startDate: new Date(now.getTime() + 3_600_000), isMandatory: true },
    }, { accountId: String(authorId) });

    await service.processDueAnnouncements(new Date(now.getTime() + 90_000));
    await service.processDueAnnouncements(new Date(now.getTime() + 90_000));
    expect(await Notification.find({}).sort({ recipientAccountId: 1 }).lean()).toHaveLength(2);

    await service.processDueAnnouncements(new Date(now.getTime() + 180_000));
    await service.processDueAnnouncements(new Date(now.getTime() + 180_000));

    const notifications = await Notification.find({}).sort({ recipientAccountId: 1, deduplicationKey: 1 }).lean();
    expect(notifications.map((item) => String(item.recipientAccountId)).sort()).toEqual([
      String(accountOneId), String(accountOneId), String(accountThreeId), String(accountThreeId),
    ].sort());
    expect(notifications.map((item) => item.deduplicationKey).sort()).toEqual([
      `announcement:${announcement.id}:publish:${accountOneId}`,
      `announcement:${announcement.id}:publish:${accountThreeId}`,
      `announcement:${announcement.id}:reminder:${accountOneId}`,
      `announcement:${announcement.id}:reminder:${accountThreeId}`,
    ].sort());
    await expect(Announcement.findById(announcement.id).lean()).resolves.toMatchObject({
      status: 'PUBLISHED',
      publishedAt: expect.any(Date),
      publishedNotifiedAt: expect.any(Date),
      reminderSentAt: expect.any(Date),
    });
  });

  test('employee readers see only published announcements addressed to their profile or department', async () => {
    const visible = await Announcement.create({
      title: 'Department notice', content: 'For department one.', authorAccountId: authorId,
      status: 'PUBLISHED', publishedAt: new Date(), sendToAll: false,
      targetDepartmentIds: [departmentOneId], targetProfileIds: [],
    });
    await Announcement.create({
      title: 'Draft notice', content: 'Managers only.', authorAccountId: authorId,
      status: 'DRAFT', sendToAll: true,
    });

    const ownDepartment = await service.listAnnouncements({}, { accountId: String(accountOneId), permissions: ['HR_ANNOUNCEMENTS:READ'] });
    const otherDepartment = await service.listAnnouncements({}, { accountId: String(accountTwoId), permissions: ['HR_ANNOUNCEMENTS:READ'] });
    const manager = await service.listAnnouncements({}, { accountId: String(authorId), permissions: ['HR_ANNOUNCEMENTS:WRITE'] });

    expect(ownDepartment.items.map((item) => item.id)).toEqual([String(visible._id)]);
    expect(otherDepartment.items).toEqual([]);
    expect(manager.items).toHaveLength(2);
  });

  test('recipient resolution failure does not roll back a published announcement', async () => {
    authPublic.filterAssignableAccountIds.mockRejectedValueOnce(new Error('Auth temporarily unavailable'));

    const created = await service.createAnnouncement({
      title: 'Published safely', content: 'The transition must commit.', status: 'PUBLISHED', sendToAll: true,
    }, { accountId: String(authorId) });

    expect(created).toMatchObject({ title: 'Published safely', status: 'PUBLISHED' });
    await expect(Announcement.countDocuments({ status: 'PUBLISHED' })).resolves.toBe(1);
  });
});
