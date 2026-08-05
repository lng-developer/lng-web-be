const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const DesignSubmissionScore = require('../../design/models/designSubmissionScore.model');
const DesignTask = require('../../design/models/designTask.model');
const repository = require('../repositories/workScore.repository');
const { workScoreSourceTypes } = require('../constants/workScore.constants');

function sourceKey(score) {
  return {
    sourceType: workScoreSourceTypes.DESIGN_SUBMISSION,
    sourceTaskId: score.taskId,
    sourceUnitId: score.submissionId,
    assetId: score.assetId,
  };
}

function legacyAdjustments(score) {
  const rows = [];
  if (score.override?.overriddenAt) rows.push({
    type: 'OVERRIDE',
    oldPoints: score.basePoints,
    newPoints: score.finalPoints,
    oldScoreLevel: score.scoreLevel,
    newScoreLevel: score.scoreLevel,
    oldStatus: 'ACTIVE',
    newStatus: 'ACTIVE',
    actorId: score.override.overriddenBy || null,
    reason: score.override.reason || 'Legacy override',
    adjustedAt: score.override.overriddenAt,
  });
  if (score.status === 'VOIDED') rows.push({
    type: 'VOID',
    oldPoints: score.finalPoints,
    newPoints: score.finalPoints,
    oldScoreLevel: score.scoreLevel,
    newScoreLevel: score.scoreLevel,
    oldStatus: 'ACTIVE',
    newStatus: 'VOIDED',
    actorId: score.voidedBy || null,
    reason: score.voidReason || 'Legacy void',
    adjustedAt: score.voidedAt || score.updatedAt || new Date(),
  });
  return rows;
}

function toWorkScore(score, task) {
  return {
    ...sourceKey(score),
    shopId: task.shopId,
    workerId: score.designerId,
    workerName: score.designerName || null,
    teamId: score.teamId || null,
    teamName: score.teamName || null,
    departmentId: score.departmentId || null,
    departmentName: score.departmentName || null,
    contextSnapshot: {
      taskType: score.taskType || task.taskType,
      priority: task.priority || null,
      listingId: task.listingId || null,
      ...task.listingSnapshot,
    },
    basePoints: score.basePoints,
    finalPoints: score.finalPoints,
    scoreLevel: score.scoreLevel,
    status: score.status,
    ruleSnapshot: score.ruleSnapshot || null,
    scoredBy: score.scoredBy || null,
    scoredAt: score.scoredAt,
    adjustments: legacyAdjustments(score),
  };
}

async function migrateDesignSubmissionScores({ dryRun = false, limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be between 1 and 1000');
  const scores = await DesignSubmissionScore.find({}).limit(limit).lean();
  const tasks = await DesignTask.find({ _id: { $in: scores.map((row) => row.taskId) } })
    .select('_id shopId taskType priority listingId listingSnapshot')
    .lean();
  const tasksById = new Map(tasks.map((task) => [String(task._id), task]));
  const result = { eligible: scores.length, migrated: 0, skipped: 0, failed: 0 };

  for (const score of scores) {
    const task = tasksById.get(String(score.taskId));
    if (!task || !score.assetId) { result.failed += 1; continue; }
    if (await repository.findBySourceKey(sourceKey(score))) { result.skipped += 1; continue; }
    if (!dryRun) {
      try {
        await repository.upsertSourceScore(toWorkScore(score, task));
        result.migrated += 1;
      } catch (_error) {
        result.failed += 1;
      }
    }
  }
  return result;
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 100;
  await connectDatabase();
  try {
    process.stdout.write(`${JSON.stringify(await migrateDesignSubmissionScores({
      dryRun: process.argv.includes('--dry-run'), limit,
    }))}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { legacyAdjustments, migrateDesignSubmissionScores, toWorkScore };
