const service = require('./services/vendorSubmission.service');

const publicPort = {
  getById: service.getSubmission,
  getByOrderItemId: service.getByOrderItemId,
  getByProductionTaskId: service.getByProductionTaskId,
};

module.exports = publicPort;
