const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const DesignTask = require('../models/designTask.model');
const DesignSubmissionScore = require('../models/designSubmissionScore.model');

function buildAssetIdBackfill(score, task) {
  const submission = (task?.submissions || []).find((item) => String(item._id) === String(score.submissionId));
  return submission?.approvedAssetId ? { assetId: submission.approvedAssetId } : { unresolved: String(score._id) };
}

async function migrateSubmissionScoreAssetIds({ apply = false } = {}) {
  const scores = await DesignSubmissionScore.find({ assetId: { $exists: false } }).lean();
  const tasks = await DesignTask.find({ _id: { $in: scores.map((score) => score.taskId) } }).select('_id submissions').lean();
  const tasksById = new Map(tasks.map((task) => [String(task._id), task]));
  const resolved = [];
  const unresolved = [];

  for (const score of scores) {
    const result = buildAssetIdBackfill(score, tasksById.get(String(score.taskId)));
    if (result.assetId) resolved.push({ id: score._id, assetId: result.assetId });
    else unresolved.push(result.unresolved);
  }

  if (!apply) return { scanned: scores.length, resolved: resolved.length, unresolved };
  if (unresolved.length) throw new Error('Cannot apply score asset migration with unresolved scores');
  if (resolved.length) await DesignSubmissionScore.bulkWrite(resolved.map(({ id, assetId }) => ({ updateOne: { filter: { _id: id }, update: { $set: { assetId } } } })));
  await DesignSubmissionScore.collection.dropIndex('taskId_1_submissionId_1').catch((error) => {
    if (error.codeName !== 'IndexNotFound') throw error;
  });
  await DesignSubmissionScore.collection.createIndex({ taskId: 1, submissionId: 1, assetId: 1 }, { unique: true, name: 'taskId_1_submissionId_1_assetId_1' });
  return { scanned: scores.length, resolved: resolved.length, unresolved };
}

async function main() {
  await connectDatabase();
  try {
    const result = await migrateSubmissionScoreAssetIds({ apply: process.argv.includes('--apply') });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { buildAssetIdBackfill, migrateSubmissionScoreAssetIds };
