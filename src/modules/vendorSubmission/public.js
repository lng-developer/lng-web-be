const service = require('./services/vendorSubmission.service');

const publicPort = {
  cancel: service.cancel,
  createAndSubmitFromProductionTask: service.createAndSubmitFromProductionTask,
  createFromProductionTask: service.createFromProductionTask,
  getById: service.getSubmission,
  getByOrderItemId: service.getByOrderItemId,
  getByProviderExternalOrderId: service.getByProviderExternalOrderId,
  getByProductionTaskId: service.getByProductionTaskId,
  listLatestByProductionTaskIds: service.listLatestByProductionTaskIds,
  listSubmittedForTracking: service.listSubmittedForTracking,
  recheckReadyProductionTasks: service.recheckReadyProductionTasks,
  summarizePerformance: service.summarizePerformance,
  summarizePerformancePage: service.summarizePerformancePage,
};

module.exports = publicPort;
