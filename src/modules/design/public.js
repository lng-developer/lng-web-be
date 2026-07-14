const service = require('./services/designTask.service');

module.exports = {
  createPsdTemplateTaskFromListing: service.createPsdTemplateTaskFromListing,
  getTask: service.getTask,
};
