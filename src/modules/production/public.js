const productionTaskService = require('./services/productionTask.service');

const publicPort = {
  assignDesignTask: productionTaskService.assignDesignTask,
  bulkAssignDesignTasks: productionTaskService.bulkAssignDesignTasks,
  claimDesignTask: productionTaskService.claimDesignTask,
  createOrRecheckTaskForOrderItem: productionTaskService.createOrRecheckTaskForOrderItem,
  getTaskById: productionTaskService.getTaskById,
  getTaskByOrderItem: productionTaskService.getTaskByOrderItem,
  listPsdBlockedTasksByListing: productionTaskService.listPsdBlockedTasksByListing,
  listTasks: productionTaskService.listTasks,
  listTaskSummariesByOrderItemIds: productionTaskService.listTaskSummariesByOrderItemIds,
  markSentToVendor: productionTaskService.markSentToVendor,
  recheckPsdBlockedTasks: productionTaskService.recheckPsdBlockedTasks,
  submitQc: productionTaskService.submitQc,
  summarizeTasks: productionTaskService.summarizeTasks,
  updateDesignNote: productionTaskService.updateDesignNote,
  uploadScaledFile: productionTaskService.uploadScaledFile,
};

module.exports = publicPort;
