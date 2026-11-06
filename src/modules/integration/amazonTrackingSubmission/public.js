const service = require('./services/amazonTrackingSubmission.service');

module.exports = {
  createSubmission: service.createSubmission,
  getSubmission: service.getSubmission,
  listSubmissions: service.listSubmissions,
};
