jest.mock('../../../src/config', () => ({ listingMockupAnalysis: { enabled: true, model: 'vision-test' }, listingContent: { apiKey: 'mock-key', timeoutMs: 90000 } }));
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
const result = { detectedText: 'Cat', theme: 'Accounting', designDescription: 'A cat', suggestedKeyword: 'Cat accountant', warnings: [] };
test('sends exactly one image, strict schema, no tools and no provider persistence', async () => {
  const { analyzeMockup } = require('../../../src/modules/listingLaunch/adapters/openaiMockup.adapter');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }) });
  expect(await analyzeMockup({ buffer: Buffer.from('image'), model: 'vision-test' })).toMatchObject({ result });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.store).toBe(false);
  expect(body.tools).toBeUndefined();
  expect(body.input[1].content.filter(x => x.type === 'input_image')).toEqual([{ type: 'input_image', image_url: 'data:image/jpeg;base64,aW1hZ2U=', detail: 'high' }]);
  expect(body.text.format).toMatchObject({ strict: true, schema: { additionalProperties: false } });
});
test('rejects extra fields rather than inferring garment facts', () => {
  const { validateMockupAnalysis } = require('../../../src/modules/listingLaunch/services/listingMockupValidation');
  expect(() => validateMockupAnalysis({ ...result, material: 'cotton' })).toThrow();
  expect(() => validateMockupAnalysis({ ...result, theme: '🙂'.repeat(301) })).toThrow();
  expect(validateMockupAnalysis({ ...result, detectedText: '', warnings: ['UNREADABLE_TEXT'] })).toMatchObject({ detectedText: '' });
});
test('90 second deadline includes body read and does not retry', async () => {
  const { analyzeMockup } = require('../../../src/modules/listingLaunch/adapters/openaiMockup.adapter');
  jest.useFakeTimers();
  global.fetch = jest.fn().mockImplementation((url, { signal }) => Promise.resolve({ ok: true, headers: new Headers(), json: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) }));
  const pending = expect(analyzeMockup({ buffer: Buffer.from('image') })).rejects.toMatchObject({ code: 'MOCKUP_PROVIDER_TIMEOUT' });
  await jest.advanceTimersByTimeAsync(90000);
  await pending;
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
