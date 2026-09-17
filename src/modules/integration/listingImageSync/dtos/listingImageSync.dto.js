function jobDto(job) {
  if (!job) return null;
  const count = (status) => job.items.filter((item) => item.status === status).length;
  return { id: String(job._id), shopId: String(job.shopId), agentId: String(job.agentId), status: job.status,
    total: job.items.length, processed: job.items.length - count('PENDING'), updated: count('SUCCEEDED'), unchanged: count('UNCHANGED'), skipped: count('SKIPPED'), failed: count('FAILED'),
    createdAt: job.createdAt, updatedAt: job.updatedAt, errorMessage: job.errorMessage || null };
}
function scheduleDto(row) { return { id: String(row._id), shopId: String(row.shopId), agentId: String(row.agentId), enabled: row.enabled, nextRunAt: row.nextRunAt, lastError: row.lastError || null }; }
function itemDto(item) { return { id: String(item._id), listingId: String(item.listingId), asin: item.asin, marketplaceCode: item.marketplaceCode }; }
module.exports = { jobDto, scheduleDto, itemDto };
