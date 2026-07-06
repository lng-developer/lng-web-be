const vendorSubmissionStatuses = Object.freeze({
  DRAFT: 'DRAFT',
  READY: 'READY',
  SUBMITTED: 'SUBMITTED',
  FAILED: 'FAILED',
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
