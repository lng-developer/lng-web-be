const { createCommandSchema, completeSchema, validate } = require('../validators/extensionCommand.validator');

describe('extension command validation', () => {
  test('accepts only the Phase 1 command type and bounded completion payload', () => {
    expect(validate(createCommandSchema, {
      type: 'IMPORT_NEW_ORDERS', shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012',
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
});
