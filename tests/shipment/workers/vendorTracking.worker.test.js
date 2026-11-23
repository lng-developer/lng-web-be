jest.mock('../../../src/modules/shipment/repositories/vendorTrackingPoll.repository', () => ({
  claim: jest.fn(), finish: jest.fn(), renew: jest.fn(),
}));
jest.mock('../../../src/modules/shipment/services/shipment.service', () => ({
  recheckVendorTracking: jest.fn(), shouldSkipShipment: jest.fn(),
}));
const worker = require('../../../src/modules/shipment/workers/vendorTracking.worker');
const polls = require('../../../src/modules/shipment/repositories/vendorTrackingPoll.repository');
const shipment = require('../../../src/modules/shipment/services/shipment.service');
const job = { data: { vendorSubmissionId: 'submission' } };
beforeEach(() => {
  jest.resetAllMocks();
  polls.claim.mockResolvedValue({ attempt: 2 });
  polls.finish.mockResolvedValue(true);
});

test('duplicate notification cannot poll an owned or not-due submission', async () => {
  polls.claim.mockResolvedValue(null);
  await expect(worker.processTrackingCheck(job)).resolves.toEqual({ outcome: 'NOT_DUE' });
  expect(shipment.recheckVendorTracking).not.toHaveBeenCalled();
});

test.each([
  [{ reason: 'NO_LONGER_ELIGIBLE' }, 'COMPLETE', null],
  [{ reason: 'TRACKING_NOT_FOUND' }, 'TRACKING_NOT_FOUND', 3600000],
])('records terminal or hourly schedule after result %j', async (result, outcome, delay) => {
  shipment.recheckVendorTracking.mockResolvedValue(result);
  expect(await worker.processTrackingCheck(job)).toEqual({ outcome });
  const [, , , next, now] = polls.finish.mock.calls[0];
  expect(next === null ? null : next - now).toBe(delay);
});

test('repair failure leaves stored update pending and retry receives that same intent', async () => {
  const pendingUpdate = { trackingNumber: 'stored' };
  polls.claim.mockResolvedValue({ attempt: 0, pendingUpdate });
  shipment.recheckVendorTracking.mockRejectedValueOnce(new Error('workbench write failed'))
    .mockResolvedValueOnce({ reason: 'NO_LONGER_ELIGIBLE' });
  expect((await worker.processTrackingCheck(job)).outcome).toBe('TRANSIENT_FAILURE');
  expect(polls.finish.mock.calls[0][6]).toBe(false);
  expect((await worker.processTrackingCheck(job)).outcome).toBe('COMPLETE');
  expect(shipment.recheckVendorTracking.mock.calls[1][2].pending).toEqual(pendingUpdate);
  expect(polls.finish.mock.calls[1][6]).toBe(true);
});

test('lost lease suppresses completion', async () => {
  shipment.recheckVendorTracking.mockResolvedValue({ reason: 'LEASE_LOST' });
  expect(await worker.processTrackingCheck(job)).toEqual({ outcome: 'LEASE_LOST' });
  expect(polls.finish).not.toHaveBeenCalled();
});

test('honors Retry-After, backs off transient errors and defers invalid references', () => {
  expect(worker.classifyError({ details: { statusCode: 429 }, retryMs: 123000 }, 2))
    .toEqual({ outcome: 'RATE_LIMITED', delay: 123000, attempt: 3 });
  const timeout = worker.classifyError(new Error('timeout'), 2);
  expect(timeout.delay).toBeGreaterThanOrEqual(120000);
  expect(timeout.delay).toBeLessThan(150000);
  expect(worker.classifyError({ statusCode: 400 }, 2).outcome).toBe('INVALID_REFERENCE');
});
