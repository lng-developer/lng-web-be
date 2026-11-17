const service = require('./services/amazonTrackingSubmission.service');

module.exports = {
  createSubmission: service.createSubmission,
  previewSubmission: service.previewSubmission,
  failSubmissionByCommandId: service.failSubmissionByCommandId,
  getSubmission: service.getSubmission,
  listSubmissions: service.listSubmissions,
};
