const service = require('./services/vendorSubmission.service');

const publicPort = {
  createFromProductionTask: service.createFromProductionTask,
  getById: service.getSubmission,
  getByOrderItemId: service.getByOrderItemId,
  getByProviderExternalOrderId: service.getByProviderExternalOrderId,
  getByProductionTaskId: service.getByProductionTaskId,
  listLatestByProductionTaskIds: service.listLatestByProductionTaskIds,
  listSubmittedForTracking: service.listSubmittedForTracking,
  summarizePerformance: service.summarizePerformance,
  summarizePerformancePage: service.summarizePerformancePage,
};

module.exports = publicPort;
