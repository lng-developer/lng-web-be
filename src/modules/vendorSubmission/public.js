const service = require('./services/vendorSubmission.service');

const publicPort = {
  createFromProductionTask: service.createFromProductionTask,
  getById: service.getSubmission,
  getByOrderItemId: service.getByOrderItemId,
  getByProductionTaskId: service.getByProductionTaskId,
  listLatestByProductionTaskIds: service.listLatestByProductionTaskIds,
  summarizePerformance: service.summarizePerformance,
  summarizePerformancePage: service.summarizePerformancePage,
};

module.exports = publicPort;
