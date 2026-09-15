const { toListingContentRunDto } = require('../../../src/modules/listingLaunch/dtos/listingContent.dto');

test('run DTO exposes safe metadata and validation errors without provider bodies or snapshots', () => {
  const dto = toListingContentRunDto({
    _id: 'run', launchId: 'launch', shopId: 'shop', requestedBy: 'actor', status: 'FAILED',
    requestHash: 'private command hash', inputSnapshot: { keyword: 'Private facts' }, resultVersionId: 'reserved',
    provider: 'OPENAI', model: 'test-model', profileVersion: 1, promptVersion: 1,
    providerRequestId: 'req_123', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, raw: 'secret' },
    errorCode: 'CONTENT_VALIDATION_FAILED', errorMessage: 'Generated content did not pass validation',
    validationErrors: [{ field: 'recommendedColors[0].code', code: 'COLOR_NOT_ALLOWED', message: 'Color must be allowed', raw: 'secret' }],
    apiKey: 'secret', rawProviderBody: 'secret', stack: 'secret',
  });
  expect(dto).toMatchObject({
    resultVersionId: null, provider: 'OPENAI', model: 'test-model', profileVersion: 1, promptVersion: 1,
    providerRequestId: 'req_123', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    errorCode: 'CONTENT_VALIDATION_FAILED', errorMessage: 'Generated content did not pass validation',
    validationErrors: [{ field: 'recommendedColors[0].code', code: 'COLOR_NOT_ALLOWED', message: 'Color must be allowed' }],
  });
  for (const key of ['requestHash', 'inputSnapshot', 'apiKey', 'rawProviderBody', 'stack']) expect(dto).not.toHaveProperty(key);
  expect(JSON.stringify(dto)).not.toContain('secret');
  expect(toListingContentRunDto({ _id: 'run', status: 'SUCCEEDED', resultVersionId: 'published' }).resultVersionId).toBe('published');
});
