const productionTaskService = require('./services/productionTask.service');

const publicPort = {
  assignDesignTask: productionTaskService.assignDesignTask,
  bulkAssignDesignTasks: productionTaskService.bulkAssignDesignTasks,
  claimDesignTask: productionTaskService.claimDesignTask,
  createOrRecheckTaskForOrderItem: productionTaskService.createOrRecheckTaskForOrderItem,
  getTaskById: productionTaskService.getTaskById,
  getTaskByOrderItem: productionTaskService.getTaskByOrderItem,
  listTasks: productionTaskService.listTasks,
  listTaskSummariesByOrderItemIds: productionTaskService.listTaskSummariesByOrderItemIds,
  markSentToVendor: productionTaskService.markSentToVendor,
  submitQc: productionTaskService.submitQc,
  updateDesignNote: productionTaskService.updateDesignNote,
  uploadScaledFile: productionTaskService.uploadScaledFile,
};

module.exports = publicPort;
