const service = require('./services/workScore.service');

module.exports = {
  findSourceScore: service.findSourceScore,
  overrideScore: service.overrideScore,
  recordDesignSubmissionScore: service.recordDesignSubmissionScore,
  recordProductionScaleScores: service.recordProductionScaleScores,
  voidObsoleteSourceScore: service.voidObsoleteSourceScore,
  voidScore: service.voidScore,
};
