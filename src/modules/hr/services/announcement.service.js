const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const notificationPublic = require('../../notification/public');
const logger = require('../../../shared/utils/logger');
const { hrPermissions } = require('../constants/hr.constants');
const { toAnnouncementDto, toAnnouncementListDto } = require('../dtos/announcement.dto');
const employeeProfileRepository = require('../repositories/employeeProfile.repository');
const repository = require('../repositories/announcement.repository');
const { buildCaseInsensitiveContainsRegex } = require('../../../shared/utils/search');

function notFound() {
  return new AppError('Announcement not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function isManager(authContext = {}) {
  return (authContext.permissions || []).includes(hrPermissions.ANNOUNCEMENTS_WRITE);
}

function validateLifecycle(payload) {
  if (payload.status === 'SCHEDULED' && !payload.scheduledAt) {
    throw new AppError('scheduledAt is required for a scheduled announcement', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  if (payload.status === 'SCHEDULED' && new Date(payload.scheduledAt) <= new Date()) {
    throw new AppError('scheduledAt must be in the future', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  if (payload.sendToAll === false && !payload.targetDepartmentIds?.length && !payload.targetProfileIds?.length) {
    throw new AppError('A targeted announcement requires an audience', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

async function resolveRecipientAccountIds(announcement) {
  const profiles = await repository.listAudienceProfiles(announcement);
  const accountIds = [...new Set(profiles.map(({ accountId }) => String(accountId)).filter(Boolean))];
  if (!accountIds.length) return [];
  const activeProfiles = await authPublic.listAssignableProfiles({ accountIds, limit: accountIds.length });
  return [...new Set(activeProfiles.map(({ accountId }) => String(accountId)).filter(Boolean))];
}

async function deliver(announcement, kind, occurredAt) {
  const recipientAccountIds = await resolveRecipientAccountIds(announcement);
  const reminder = kind === 'reminder';
  const results = await notificationPublic.notifyMany({
    recipientAccountIds,
    type: reminder ? 'ANNOUNCEMENT_REMINDER' : 'ANNOUNCEMENT',
    title: reminder ? `Reminder: ${announcement.title}` : `Announcement: ${announcement.title}`,
    message: reminder
      ? (announcement.category === 'EVENT' ? `Event "${announcement.title}" is coming up.` : `Reminder: ${announcement.title}`)
      : `A new ${String(announcement.category).toLowerCase()} announcement is available.`,
    relatedResource: { type: 'announcement', id: String(announcement._id || announcement.id) },
    deduplicationKeyPrefix: `announcement:${announcement._id || announcement.id}:${kind}`,
  });
  if (results.every(({ delivered }) => delivered)) {
    if (reminder) await repository.markReminderSent(announcement._id || announcement.id, occurredAt);
    else await repository.markPublishedNotified(announcement._id || announcement.id, occurredAt);
  }
  return { recipients: recipientAccountIds.length, delivered: results.filter((item) => item.delivered).length };
}

async function deliverSafely(announcement, kind, occurredAt) {
  try {
    return await deliver(announcement, kind, occurredAt);
  } catch (error) {
    logger.warn('announcement_notification_failed', {
      announcementId: String(announcement._id || announcement.id),
      kind,
      error,
    });
    return { recipients: 0, delivered: 0 };
  }
}

async function createAnnouncement(payload, authContext = {}) {
  validateLifecycle(payload);
  const now = new Date();
  const announcement = await repository.create({
    ...payload,
    authorAccountId: authContext.accountId,
    scheduledAt: payload.status === 'SCHEDULED' ? payload.scheduledAt : null,
    publishedAt: payload.status === 'PUBLISHED' ? now : null,
  });
  if (announcement.status === 'PUBLISHED') await deliverSafely(announcement, 'publish', now);
  return toAnnouncementDto(await repository.findById(announcement._id));
}

function audienceFilter(profile) {
  if (!profile) return { sendToAll: true };
  const choices = [{ sendToAll: true }, { targetProfileIds: profile._id }];
  if (profile.departmentId) choices.push({ targetDepartmentIds: profile.departmentId });
  return { $or: choices };
}

async function listAnnouncements(query = {}, authContext = {}) {
  const manager = isManager(authContext);
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.search) filter.$or = [
    { title: buildCaseInsensitiveContainsRegex(query.search) },
    { content: buildCaseInsensitiveContainsRegex(query.search) },
  ];
  if (manager && query.status) filter.status = query.status;
  if (!manager) {
    const profile = await employeeProfileRepository.findByAccountId(authContext.accountId);
    filter.$and = [
      ...(filter.$or ? [{ $or: filter.$or }] : []),
      { status: 'PUBLISHED' },
      audienceFilter(profile),
    ];
    delete filter.$or;
  }
  return toAnnouncementListDto(
    await repository.list({ filter, page: query.page, limit: query.limit }),
    { update: manager, delete: manager },
  );
}

async function getAnnouncement(id, authContext = {}) {
  const announcement = await repository.findById(id);
  if (!announcement) throw notFound();
  if (!isManager(authContext)) {
    const profile = await employeeProfileRepository.findByAccountId(authContext.accountId);
    const visible = announcement.status === 'PUBLISHED' && (
      announcement.sendToAll
      || (profile && announcement.targetProfileIds.some((value) => String(value) === String(profile._id)))
      || (profile?.departmentId && announcement.targetDepartmentIds.some((value) => String(value) === String(profile.departmentId)))
    );
    if (!visible) throw notFound();
  }
  return toAnnouncementDto({ ...announcement, capabilities: { update: isManager(authContext), delete: isManager(authContext) } });
}

async function updateAnnouncement(id, payload) {
  const existing = await repository.findById(id);
  if (!existing) throw notFound();
  validateLifecycle({ ...existing, ...payload });
  const now = new Date();
  const patch = { ...payload };
  if (payload.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') {
    Object.assign(patch, { publishedAt: now, scheduledAt: null, publishedNotifiedAt: null });
  } else if (payload.status === 'SCHEDULED') {
    Object.assign(patch, { publishedAt: null, publishedNotifiedAt: null });
  } else if (payload.status === 'DRAFT') {
    Object.assign(patch, { scheduledAt: null, publishedAt: null, publishedNotifiedAt: null });
  }
  const updated = await repository.update(id, patch);
  if (updated.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') await deliverSafely(updated, 'publish', now);
  return toAnnouncementDto(await repository.findById(id));
}

async function deleteAnnouncement(id) {
  const deleted = await repository.softDelete(id, new Date());
  if (!deleted) throw notFound();
  return { deleted: true };
}

async function processDueAnnouncements(now = new Date()) {
  let published = 0;
  for (; published < 100; published += 1) {
    if (!await repository.claimDueScheduled(now)) break;
  }
  const publications = await repository.listPendingPublicationNotifications();
  for (const announcement of publications) await deliverSafely(announcement, 'publish', now);
  const reminders = await repository.listDueReminders(now);
  for (const announcement of reminders) await deliverSafely(announcement, 'reminder', now);
  return { published, publicationsProcessed: publications.length, remindersProcessed: reminders.length };
}

module.exports = {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAnnouncements,
  processDueAnnouncements,
  updateAnnouncement,
};
