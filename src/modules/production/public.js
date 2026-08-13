const productionTaskService = require('./services/productionTask.service');

const publicPort = {
  assignCsTask: productionTaskService.assignCsTask,
  assignDesignTask: productionTaskService.assignDesignTask,
  bulkAssignDesignTasks: productionTaskService.bulkAssignDesignTasks,
  canReadTaskById: productionTaskService.canReadTaskById,
  claimDesignTask: productionTaskService.claimDesignTask,
  createOrRecheckTaskForOrderItem: productionTaskService.createOrRecheckTaskForOrderItem,
  getCsAssignees: productionTaskService.getCsAssignees,
  getTaskById: productionTaskService.getTaskById,
  getTaskByOrderItem: productionTaskService.getTaskByOrderItem,
  listPsdBlockedTasksByListing: productionTaskService.listPsdBlockedTasksByListing,
  listPsdBlockedTasksByExternalOrderId: productionTaskService.listPsdBlockedTasksByExternalOrderId,
  listTasks: productionTaskService.listTasks,
  listWorkScoreCandidates: productionTaskService.listWorkScoreCandidates,
  listTaskSummariesByOrderItemIds: productionTaskService.listTaskSummariesByOrderItemIds,
  listWorkbenchTaskSummariesByOrderItemIds: productionTaskService.listWorkbenchTaskSummariesByOrderItemIds,
  markSentToVendor: productionTaskService.markSentToVendor,
  prepareForMappingOverride: productionTaskService.prepareForMappingOverride,
  recheckPsdBlockedTasks: productionTaskService.recheckPsdBlockedTasks,
  recheckPsdBlockedTasksByListing: productionTaskService.recheckPsdBlockedTasksByListing,
  submitQc: productionTaskService.submitQc,
  updateCsNote: productionTaskService.updateCsNote,
  syncCsNoteFromOrderItem: productionTaskService.syncCsNoteFromOrderItem,
  updateCsStatus: productionTaskService.updateCsStatus,
  summarizeTasks: productionTaskService.summarizeTasks,
  syncOrderAddressSnapshot: productionTaskService.syncOrderAddressSnapshot,
  updateDesignNote: productionTaskService.updateDesignNote,
  uploadScaledFile: productionTaskService.uploadScaledFile,
};

module.exports = publicPort;
