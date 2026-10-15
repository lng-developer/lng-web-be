const rawRepository = require('../repositories/externalOrderRawRecord.repository');
const issueRepository = require('../repositories/externalOrderImportIssue.repository');
async function enrichJobs(jobs = []) {
  if (!jobs.length) return jobs;
  const ids = jobs.map(job => String(job._id || job.id));
  const [outcomes, issues] = await Promise.all([
    rawRepository.summarizeOutcomes(ids), issueRepository.summarizeOpenIssues(ids),
  ]);
  const outcomeMap = new Map(outcomes.map(row => [String(row._id), row]));
  const issueMap = new Map(issues.map(row => [String(row._id), row]));
  return jobs.map(job => {
    const id = String(job._id || job.id);
    const counts = outcomeMap.get(id);
    const known = counts && counts.unknownOrders === 0;
    return { ...job, resultSummary: {
      createdOrders: known ? counts.createdOrders : null,
      updatedOrders: known ? counts.updatedOrders : null,
      openIssues: issueMap.get(id)?.openIssues || 0,
      addressIssues: issueMap.get(id)?.addressIssues || 0,
    } };
  });
}
module.exports = { enrichJobs };
