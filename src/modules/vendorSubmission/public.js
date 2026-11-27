const service = require('./services/vendorSubmission.service');

const publicPort = {
  previewCostForOrderItem: service.previewCostForOrderItem,
  cancel: service.cancel,
  cancelAfterExternalCancellation: service.cancelAfterExternalCancellation,
  createAndSubmitFromProductionTask: service.createAndSubmitFromProductionTask,
  createAndSubmitFulfillmentOrderFromProductionTask: service.createAndSubmitFulfillmentOrderFromProductionTask,
  createFromProductionTask: service.createFromProductionTask,
  getById: service.getSubmission,
  getByOrderItemId: service.getByOrderItemId,
  getByProviderExternalOrderId: service.getByProviderExternalOrderId,
  getByProductionTaskId: service.getByProductionTaskId,
  listLatestByProductionTaskIds: service.listLatestByProductionTaskIds,
  listSubmittedForTracking: service.listSubmittedForTracking,
  listTrackingDiscoveryPage: service.listTrackingDiscoveryPage,
  recheckReadyProductionTasks: service.recheckReadyProductionTasks,
  summarizePerformance: service.summarizePerformance,
  summarizePerformancePage: service.summarizePerformancePage,
};

module.exports = publicPort;
