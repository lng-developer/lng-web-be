const {
  bulkPushVendorSchema,
  listTasksQuerySchema,
  qcSchema,
  recheckPsdBlockedSchema,
  validate,
} = require('../../../src/modules/production/validators/productionTask.validator');

describe('production task validators', () => {
  test('validates design type and server-side pending assignment filters', () => {
    expect(validate(listTasksQuerySchema, { designType: 'custom_image', unassigned: 'true' })).toEqual({
      value: { designType: 'CUSTOM_IMAGE', unassigned: true },
    });
    expect(validate(listTasksQuerySchema, { designType: 'UNCLASSIFIED' }).details).toBeUndefined();
    expect(validate(listTasksQuerySchema, { designType: 'TYPO' }).details).toBeDefined();
  });
  test('rejects unknown production queue enums', () => {
    const result = validate(listTasksQuerySchema, {
      status: 'TYPO', scaleStatus: 'TYPO', qcStatus: 'TYPO', blocker: 'TYPO',
    });

    expect(result.details).toHaveLength(4);
  });

  test('accepts explicit Scale and QC queue views', () => {
    expect(validate(listTasksQuerySchema, { view: 'scale', psdReadyOnly: 'true' })).toEqual({
      value: { view: 'SCALE', psdReadyOnly: true },
    });
    expect(validate(listTasksQuerySchema, { view: 'qc' })).toEqual({
      value: { view: 'QC' },
    });
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

  test('caps synchronous production batches at 25 tasks', () => {
    const taskIds = Array.from({ length: 26 }, (_, index) => `660000000000000000${String(index).padStart(6, '0')}`);

    expect(validate(bulkPushVendorSchema, { taskIds }).details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['taskIds'], type: 'array.max' }),
    ]));
    expect(validate(recheckPsdBlockedSchema, { limit: 26 }).details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['limit'] }),
    ]));
  });
});
