const workScoreSourceTypes = Object.freeze({
  DESIGN_SUBMISSION: 'DESIGN_SUBMISSION',
  PRODUCTION_SCALE: 'PRODUCTION_SCALE',
});

const workScoreStatuses = Object.freeze({ ACTIVE: 'ACTIVE', VOIDED: 'VOIDED' });
const workScoreAdjustmentTypes = Object.freeze({
  OVERRIDE: 'OVERRIDE',
  VOID: 'VOID',
  SYSTEM_VOID: 'SYSTEM_VOID',
});
const workScoreLevels = Object.freeze({
  BASIC: 'BASIC',
  STANDARD: 'STANDARD',
  HARD: 'HARD',
  BONUS: 'BONUS',
});
const workScorePermissions = Object.freeze({
  READ: 'WORK_SCORES:READ',
  ADJUST: 'WORK_SCORES:ADJUST',
});

module.exports = {
  workScoreAdjustmentTypes,
  workScoreLevels,
  workScorePermissions,
  workScoreSourceTypes,
  workScoreStatuses,
};
