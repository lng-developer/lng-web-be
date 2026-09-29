const {
  createCommandSchema,
  manualAdsImportSchema,
  completeSchema,
  renewSchema,
  upsertOrderScheduleSchema,
  upsertFinanceScheduleSchema,
  validate,
} = require('../validators/extensionCommand.validator');

describe('extension command validation', () => {
  test('renew requires a bounded lease token and a valid optional batch id', () => {
    expect(validate(renewSchema, { leaseToken: 'x'.repeat(24), importJobId: '507f1f77bcf86cd799439011' }).details).toBeUndefined();
    expect(validate(renewSchema, { leaseToken: 'x'.repeat(24), importJobId: 'bad-id' }).details).toBeDefined();
    expect(validate(renewSchema, {}).details).toBeDefined();
  });
  test.each([
    [{ dateFrom: '2026-09-01', dateTo: '2026-09-14' }, true],
    [{ dateFrom: '2026-09-01' }, false],
    [{ dateFrom: '2026-09-14', dateTo: '2026-09-01' }, false],
  ])('validates manual settlement periods %j', (dates, valid) => {
    const result = validate(createCommandSchema, { type: 'IMPORT_SETTLEMENTS', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012', ...dates });
    expect(!result.details).toBe(valid);
  });
  test('accepts import and connection-test command types with bounded completion payload', () => {
    expect(validate(createCommandSchema, {
      type: 'IMPORT_NEW_ORDERS', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012',
    }).details).toBeUndefined();
    expect(validate(createCommandSchema, {
      type: 'TEST_CONNECTION', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012',
    }).details).toBeUndefined();
    expect(validate(createCommandSchema, {
      type: 'IMPORT_ADS_SPEND', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012',
      dateFrom: '2026-08-01', dateTo: '2026-08-22',
    }).details).toBeUndefined();
    expect(validate(createCommandSchema, {
      type: 'IMPORT_ADS_SPEND', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012',
      dateFrom: '2026-08-22', dateTo: '2026-08-01',
    }).details).toBeDefined();
    expect(validate(createCommandSchema, {
      type: 'IMPORT_TRANSACTIONS', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012',
      dateFrom: '2026-08-22', dateTo: '2026-08-22',
    }).details).toBeUndefined();
    expect(validate(createCommandSchema, {
      type: 'IMPORT_SETTLEMENTS', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012',
    }).details).toBeUndefined();
    expect(validate(createCommandSchema, {
      type: 'UPLOAD_TRACKING', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012',
    }).details).toBeDefined();
    expect(validate(completeSchema, { leaseToken: 'x'.repeat(20), success: false, errorMessage: 'x'.repeat(1001) }).details).toBeDefined();
  });

  test('keeps the reported API base URL for agent observability', () => {
    const result = validate(require('../validators/extensionCommand.validator').heartbeatSchema, {
      clientId: 'rdc-1', label: 'RDC 1', apiBaseUrl: 'https://dev-api.lngmerch.co',
    });
    expect(result.value.apiBaseUrl).toBe('https://dev-api.lngmerch.co');
  });

  test('accepts an Ads range of at most 120 days requested by an extension agent', () => {
    const result = validate(manualAdsImportSchema, {
      clientId: 'rdc-1', label: 'RDC 1', dateFrom: '2026-01-01', dateTo: '2026-04-30',
    });
    expect(result.details).toBeUndefined();
    expect(result.value.dateFrom).toBe('2026-01-01');
    expect(result.value.dateTo).toBe('2026-04-30');
  });

  test('rejects an Ads range longer than 120 days requested by an extension agent', () => {
    const result = validate(manualAdsImportSchema, {
      clientId: 'rdc-1', label: 'RDC 1', dateFrom: '2026-01-01', dateTo: '2026-05-01',
    });
    expect(result.details).toBeDefined();
  });

  test('accepts only safe order schedule intervals', () => {
    expect(validate(upsertOrderScheduleSchema, { enabled: true, intervalMinutes: 120 }).details).toBeUndefined();
    expect(validate(upsertOrderScheduleSchema, { enabled: true, intervalMinutes: 30 }).details).toBeDefined();
  });

  test('accepts only an enabled flag for a finance schedule', () => {
    expect(validate(upsertFinanceScheduleSchema, { enabled: true }).value).toEqual({ enabled: true });
    expect(validate(upsertFinanceScheduleSchema, { enabled: true, intervalMinutes: 60 }).value).toEqual({ enabled: true });
  });
});
