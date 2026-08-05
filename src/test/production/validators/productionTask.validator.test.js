const {
  listTasksQuerySchema,
  qcSchema,
  validate,
} = require('../../../modules/production/validators/productionTask.validator');

describe('production task validators', () => {
  test('rejects unknown production queue enums', () => {
    const result = validate(listTasksQuerySchema, {
      status: 'TYPO', scaleStatus: 'TYPO', qcStatus: 'TYPO', blocker: 'TYPO',
    });

    expect(result.details).toHaveLength(4);
  });

  test('accepts per-file QC decisions with a required rejection reason', () => {
    const fileCheckId = '660000000000000000100002';
    expect(validate(qcSchema, {
      fileDecisions: [{ fileCheckId, decision: 'REJECTED', note: 'Outside safe area' }],
    })).toEqual({
      value: { fileDecisions: [{ fileCheckId, decision: 'REJECTED', note: 'Outside safe area' }] },
    });

    expect(validate(qcSchema, {
      fileDecisions: [{ fileCheckId, decision: 'REJECTED' }],
    }).details).toBeDefined();
  });
});
