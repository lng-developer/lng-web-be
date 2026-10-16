const service = require('./services/designTask.service');

module.exports = {
  canReadSellerAsset: service.canReadSellerAsset,
  createPsdTemplateTask: service.createPsdTemplateTask,
  createPsdTemplateTaskFromListing: service.createPsdTemplateTaskFromListing,
  createPsdTemplateTaskFromListingVariant: service.createPsdTemplateTaskFromListingVariant,
  findActivePsdListingIds: service.findActivePsdListingIds,
  getTask: service.getTask,
  listWorkScoreCandidates: service.listWorkScoreCandidates,
  resolveActivePsdTaskForListing: service.resolveActivePsdTaskForListing,
};
