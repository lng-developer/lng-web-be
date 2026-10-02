const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const notificationPublic = require('../../notification/public');
const organizationPublic = require('../../organization/public');
const authPublic = require('../../auth/public');
const orderRepository = require('../repositories/order.repository');
const orderAccess = require('./orderAccess.service');
const orderWorkbenchProjectionService = require('./orderWorkbenchProjection.service');
const { recordOrderOperation, withOrderOperation } = require('./orderOperationAudit.service');

function notFound() {
  return new AppError('Order not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict() {
  return new AppError('Order was changed by another request', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

function validationError(message) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
}

function assertCanAssignOrders(authContext = {}) {
  if (!authPublic.canAccessScope(authContext, 'ORDERS:ASSIGN', { scopeType: 'global', scopeId: null })) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

async function assertActiveSalesAssignees(assignedStaffIds = []) {
  if (!assignedStaffIds.length) return;
  const source = await organizationPublic.listRoleAssignmentSource();
  const salesTeam = (source.teams || []).find((team) => String(team.code || '').toUpperCase() === 'SALE1');
  if (!salesTeam) throw validationError('SALE1 team is not configured');
  const salesTeamId = String(salesTeam.id || salesTeam._id);
  const activeAccountIds = new Set((source.memberships || [])
    .filter((membership) => membership.status === 'active' && String(membership.teamId) === salesTeamId)
    .map((membership) => String(membership.accountId)));
  if (assignedStaffIds.some((accountId) => !activeAccountIds.has(String(accountId)))) {
    throw validationError('Assignees must be active SALE1 members');
  }
}

async function assignStaff(orderId, assignedStaffIds, authContext = {}) {
  assertValidObjectId(orderId, 'orderId');
  (assignedStaffIds || []).forEach((assignedStaffId) => assertValidObjectId(assignedStaffId, 'assignedStaffIds'));

  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound();

  const previousIds = (order.assignedStaffIds || []).map(String).sort();
  const nextIds = [...new Set((assignedStaffIds || []).map(String))].sort();
  assertCanAssignOrders(authContext);
  await assertActiveSalesAssignees(nextIds);
  if (previousIds.join(',') === nextIds.join(',')) return order;

  const updated = await withOrderOperation(async (session) => {
    const updated = await orderRepository.updateAssignedStaffIds(orderId, nextIds, {
      session,
      expectedUpdatedAt: order.updatedAt,
    });
    if (!updated) throw conflict();
    await orderWorkbenchProjectionService.updateOrderWorkbenchOrder(orderId, {
      assignedStaffIds: updated.assignedStaffIds || [],
      'order.assignedStaffIds': updated.assignedStaffIds || [],
    }, { source: 'ORDER_ASSIGNMENT', session });
    await recordOrderOperation({
      action: 'ORDER_ASSIGNED', entityType: 'ORDER', entityId: orderId,
      shopId: order.shopId, authContext, session,
      changes: { assignedStaffIds: { from: previousIds, to: nextIds } },
    });
    return updated;
  });
  for (const recipientAccountId of updated.assignedStaffIds || []) {
    const resourceId = String(updated._id || updated.id);
    const version = updated.updatedAt ? new Date(updated.updatedAt).toISOString() : 'unknown';
    await notificationPublic.notify({
      recipientAccountId,
      type: 'ORDER_ASSIGNED',
      title: 'Order assigned',
      message: 'You were assigned an order that needs processing.',
      relatedResource: { type: 'order', id: resourceId },
      deduplicationKey: `ORDER_ASSIGNED:${resourceId}:${recipientAccountId}:${version}`,
    });
  }
  return updated;
}

module.exports = {
  assignStaff,
};
