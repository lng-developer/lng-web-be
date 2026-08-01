const vendorSubmissionStatuses = Object.freeze({
  DRAFT: 'DRAFT',
  READY: 'READY',
  SUBMITTING: 'SUBMITTING',
  SUBMITTED: 'SUBMITTED',
  FAILED: 'FAILED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  CANCELLED: 'CANCELLED',
});

const vendorSubmissionPermissions = Object.freeze({
  READ: 'VENDOR_SUBMISSIONS:READ',
  WRITE: 'VENDOR_SUBMISSIONS:WRITE',
});

module.exports = {
  vendorSubmissionPermissions,
  vendorSubmissionStatuses,
};
