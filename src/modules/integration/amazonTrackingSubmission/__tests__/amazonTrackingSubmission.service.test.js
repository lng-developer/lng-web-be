jest.mock('../../../shipment/public', () => ({ listTrackingCandidatesByIds: jest.fn() }));
jest.mock('../../../order/public', () => ({ findItemById: jest.fn() }));
jest.mock('../repositories/amazonTrackingSubmission.repository');

const shipmentPublic = require('../../../shipment/public');
const orderPublic = require('../../../order/public');
const repository = require('../repositories/amazonTrackingSubmission.repository');
const service = require('../services/amazonTrackingSubmission.service');

const shopId = '507f1f77bcf86cd799439011';
const shipmentId = '507f1f77bcf86cd799439012';

describe('Amazon tracking submission snapshot', () => {
  beforeEach(() => {
    shipmentPublic.listTrackingCandidatesByIds.mockResolvedValue([{
      _id: shipmentId, shopId, status: 'SHIPPED', carrier: 'USPS', trackingNumber: '9400',
      orderItemId: '507f1f77bcf86cd799439013', externalOrderId: '114-1234567-1234567', shippedAt: '2026-09-28T12:00:00.000Z',
    }]);
    orderPublic.findItemById.mockResolvedValue({ salesChannelCode: 'AMAZON' });
  });

  test('creates a checksum-bound TSV only for an eligible Amazon shipment', async () => {
    const snapshot = await service.buildSnapshot({ shopId, shipmentIds: [shipmentId] });

    expect(snapshot).toEqual(expect.objectContaining({ rowCount: 1, checksum: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(snapshot.tsv).toContain('114-1234567-1234567\t2026-09-28\tUSPS\t9400\tStandard');
  });

  test.each([
    [{ shopId: 'other-shop' }, { salesChannelCode: 'AMAZON' }],
    [{ status: 'TRACKING_PENDING' }, { salesChannelCode: 'AMAZON' }],
    [{}, { salesChannelCode: 'ETSY' }],
  ])('rejects shipments outside the authorized Amazon tracking set', async (shipmentPatch, item) => {
    shipmentPublic.listTrackingCandidatesByIds.mockResolvedValue([{ _id: shipmentId, shopId, status: 'SHIPPED', carrier: 'USPS', trackingNumber: '9400', orderItemId: 'item-1', ...shipmentPatch }]);
    orderPublic.findItemById.mockResolvedValue(item);

    await expect(service.buildSnapshot({ shopId, shipmentIds: [shipmentId] })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('persists the immutable snapshot without exposing TSV through the result', async () => {
    repository.create.mockResolvedValue({ _id: 'submission-1', tsv: 'hidden', checksum: 'checksum' });

    const created = await service.createSubmission({ shopId, agentId: 'agent-1', commandId: 'command-1', shipmentIds: [shipmentId] });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ rowCount: 1, tsv: expect.any(String), checksum: expect.any(String) }));
    expect(created).toEqual(expect.not.objectContaining({ tsv: expect.anything() }));
  });

  test('rejects a terminal result before Amazon acknowledgement', async () => {
    repository.findById.mockResolvedValue({ _id: 'submission-1', status: 'QUEUED' });

    await expect(service.markTerminal({ submissionId: 'submission-1', status: 'SUCCEEDED', result: { importedCount: 1 } }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('records acknowledgement before moving the submission to Amazon waiting', async () => {
    repository.findById
      .mockResolvedValueOnce({ _id: 'submission-1', status: 'QUEUED' })
      .mockResolvedValueOnce({ _id: 'submission-1', status: 'SUBMITTED' });
    repository.updateById.mockImplementation(async (_id, patch) => patch);

    await expect(service.markSubmitted({ submissionId: 'submission-1' })).resolves.toEqual(expect.objectContaining({ status: 'SUBMITTED' }));
    await expect(service.markWaiting({ submissionId: 'submission-1' })).resolves.toEqual(expect.objectContaining({ status: 'WAITING_AMAZON' }));
  });
});
