const repository = require('../repositories/vendorOrderId.repository');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');

async function allocate(submission, provider, vendorId) {
  const snapshot = submission.payloadSnapshot || {};
  const base = String(snapshot.orderItem?.externalOrderId || snapshot.orderItemSnapshot?.externalOrderId
    || snapshot.externalOrderId || submission.orderId);
  const history = await repository.listHistory(submission.orderId, provider, vendorId);
  const submissionId = String(submission._id || submission.id);
  if (history.some((row) => String(row._id) !== submissionId
    && (['SUBMITTING', 'NEEDS_REVIEW'].includes(row.status)
      || (row.status === 'SUBMITTED' && row.payloadSnapshot?.bundledSubmissionIds?.some((id) => String(id) === submissionId))))) {
    throw new AppError('Another submission for this order needs vendor reconciliation', 409, true, errorCodes.CONFLICT_ERROR);
  }
  const usedIds = new Set();
  let floor = 0;
  for (const row of history) {
    const saved = row.payloadSnapshot?.vendorClientOrderId || row.payloadSnapshot?.mangoteeExternalOrderId
      || row.payloadSnapshot?.merchizeExternalOrderId;
    const priorAttempts = (row.submitAttemptCount || 0)
      - (String(row._id) === String(submission._id || submission.id) ? 1 : 0);
    const used = saved || row.vendorExternalOrderId
      || (priorAttempts > 0 ? (provider === 'MANGOTEE' ? base : row.submitOperationKey) : null);
    if (!used) continue;
    usedIds.add(used);
    if (used === base) floor = Math.max(floor, 1);
    if (used.startsWith(`${base}-R`)) {
      const suffix = used.slice(base.length + 2);
      if (/^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(Number(suffix))) {
        floor = Math.max(floor, Number(suffix));
      }
    }
  }
  const sequence = await repository.nextSequence([provider, String(vendorId), base], Math.max(floor, usedIds.size));
  return sequence === 1 ? base : `${base}-R${sequence}`;
}

module.exports = { allocate };
