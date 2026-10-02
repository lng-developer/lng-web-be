const repository = require('../repositories/designRequest.repository');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { designRequestStatuses, designRequestTypes } = require('../constants/design.constants');
const { toDesignRequestDto } = require('../dtos/designRequest.dto');

function toSafeSnapshot(snapshot = {}) {
  return {
    sku: snapshot.sku || null,
    title: snapshot.title || null,
    listingId: snapshot.listingId || null,
    listingVariantId: snapshot.listingVariantId || null,
  };
}

async function createOrderDesignRequest(payload = {}) {
  const requestType = designRequestTypes.PSD_TEMPLATE;
  const existing = await repository.findActiveByOrderItemAndType(payload.orderItemId, requestType);
  if (existing) {
    return toDesignRequestDto(existing);
  }

  try {
    const request = await repository.create({
      ...payload,
      requestType,
      status: designRequestStatuses.PENDING_ASSIGNMENT,
      listingSnapshot: toSafeSnapshot(payload.listingSnapshot),
    });
    return toDesignRequestDto(request);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const duplicate = await repository.findActiveByOrderItemAndType(payload.orderItemId, requestType);
    return toDesignRequestDto(duplicate);
  }
}

function fail(message, statusCode, code) {
  throw new AppError(message, statusCode, true, code);
}

function forbidden() {
  fail('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function isLeader(auth = {}) {
  return authPublic.canAccessScope(auth, 'DESIGN:REQUEST_ASSIGN', { scopeType: 'global', scopeId: null });
}

function canWork(request, auth = {}) {
  return isLeader(auth) || (
    authPublic.canAccessScope(auth, 'DESIGN:REQUEST_WORK', { scopeType: 'own', scopeId: null })
    && String(request.assignedDesignerAccountId) === String(auth.accountId)
  );
}

async function listDesignRequests(auth = {}) {
  const query = isLeader(auth) ? {} : { assignedDesignerAccountId: auth.accountId };
  return (await repository.list(query)).map(toDesignRequestDto);
}

async function assignDesignRequest(id, assignedDesignerAccountId, auth = {}) {
  if (!isLeader(auth)) forbidden();
  const source = await organizationPublic.listRoleAssignmentSource();
  const team = (source.teams || []).find((row) => String(row.code).toUpperCase() === 'DES');
  const valid = (source.memberships || []).some((row) => (
    row.status === 'active'
    && String(row.teamId) === String(team?.id || team?._id)
    && String(row.accountId) === String(assignedDesignerAccountId)
  ));
  if (!valid) fail('Assignee must be an active DES member', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  const request = await repository.findById(id);
  if (!request) fail('Design request not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  if (['COMPLETED', 'CANCELLED'].includes(request.status)) fail('Design request is terminal', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  return toDesignRequestDto(await repository.update(id, {
    assignedDesignerAccountId,
    status: designRequestStatuses.ASSIGNED,
  }));
}

async function updateDesignRequestStatus(id, status, auth = {}) {
  const request = await repository.findById(id);
  if (!request) fail('Design request not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  if (!canWork(request, auth)) forbidden();
  const transitions = {
    PENDING_ASSIGNMENT: ['ASSIGNED'],
    ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  };
  if (!(transitions[request.status] || []).includes(status)) fail('Invalid design request status transition', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  return toDesignRequestDto(await repository.update(id, { status }));
}
module.exports = {
  createOrderDesignRequest,
  listDesignRequests,
  assignDesignRequest,
  updateDesignRequestStatus,
};
