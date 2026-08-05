const service = require('./services/designTask.service');

module.exports = {
  createPsdTemplateTaskFromListingVariant: service.createPsdTemplateTaskFromListingVariant,
  getTask: service.getTask,
  listWorkScoreCandidates: service.listWorkScoreCandidates,
  resolveActivePsdTaskForListing: service.resolveActivePsdTaskForListing,
};
