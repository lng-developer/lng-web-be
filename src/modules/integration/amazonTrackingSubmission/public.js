const service = require('./services/amazonTrackingSubmission.service');

module.exports = {
  createSubmission: service.createSubmission,
  failSubmissionByCommandId: service.failSubmissionByCommandId,
  getSubmission: service.getSubmission,
  listSubmissions: service.listSubmissions,
};
