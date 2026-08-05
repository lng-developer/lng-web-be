const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const designPublic = require('../../design/public');
const productionPublic = require('../../production/public');
const workScorePublic = require('../public');
const repository = require('../repositories/workScore.repository');
const { workScoreSourceTypes } = require('../constants/workScore.constants');

function designKey(row) {
  return {
    sourceType: workScoreSourceTypes.DESIGN_SUBMISSION,
    sourceTaskId: row.designTaskId,
    sourceUnitId: row.submissionId,
    assetId: row.assetId,
  };
}

function scaleKey(task, output) {
  return {
    sourceType: workScoreSourceTypes.PRODUCTION_SCALE,
    sourceTaskId: task.productionTaskId,
    sourceUnitId: output.fileCheckId,
    assetId: output.assetId,
  };
}

async function backfillWorkScores({ dryRun = false, limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be between 1 and 1000');
  const [designRows, productionTasks] = await Promise.all([
    designPublic.listWorkScoreCandidates({ limit }, { system: true }),
    productionPublic.listWorkScoreCandidates({ limit }, { system: true }),
  ]);
  const result = {
    eligible: designRows.length + productionTasks.reduce((sum, task) => sum + task.outputs.length, 0),
    created: 0, skipped: 0, voided: 0, failed: 0,
  };

  for (const row of designRows) {
    if (await repository.findBySourceKey(designKey(row))) { result.skipped += 1; continue; }
    if (dryRun) continue;
    try {
      await workScorePublic.recordDesignSubmissionScore(row);
      result.created += 1;
    } catch (_error) {
      result.failed += 1;
    }
  }

  for (const task of productionTasks) {
    const currentByUnit = new Map(task.outputs.map((output) => [String(output.fileCheckId), String(output.assetId)]));
    const active = await repository.list({
      sourceType: workScoreSourceTypes.PRODUCTION_SCALE,
      sourceTaskId: task.productionTaskId,
      scoreStatus: 'ACTIVE',
      page: 1,
      limit: 100,
    });
    for (const score of active.items || []) {
      const currentAsset = currentByUnit.get(String(score.sourceUnitId));
      if (currentAsset && currentAsset !== String(score.assetId) && !dryRun) {
        try {
          await workScorePublic.voidObsoleteSourceScore(String(score._id || score.id), score.__v || 0);
          result.voided += 1;
        } catch (_error) {
          result.failed += 1;
        }
      }
    }

    const missing = [];
    for (const output of task.outputs) {
      if (await repository.findBySourceKey(scaleKey(task, output))) result.skipped += 1;
      else missing.push(output);
    }
    if (dryRun || !missing.length) continue;
    try {
      await workScorePublic.recordProductionScaleScores({ ...task, outputs: missing });
      result.created += missing.length;
    } catch (_error) {
      result.failed += missing.length;
    }
  }
  return result;
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 100;
  await connectDatabase();
  try {
    process.stdout.write(`${JSON.stringify(await backfillWorkScores({
      dryRun: process.argv.includes('--dry-run'), limit,
    }))}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { backfillWorkScores };
