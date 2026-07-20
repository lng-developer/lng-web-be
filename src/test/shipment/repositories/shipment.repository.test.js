const Shipment = require('../../../modules/shipment/models/shipment.model');
const repository = require('../../../modules/shipment/repositories/shipment.repository');

describe('shipment.repository', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('buildFilter supports operator-facing ids and tracking number', () => {
    const filter = repository.buildFilter({
      id: '660000000000000000130001',
      externalOrderId: '112-1234567-1234567',
      vendorExternalOrderId: 'MZ-ORDER-1',
      trackingNumber: '9214490411375403131206',
    });

    expect(String(filter._id)).toBe('660000000000000000130001');
    expect(filter.externalOrderId).toEqual(/112-1234567-1234567/i);
    expect(filter.vendorExternalOrderId).toEqual(/MZ-ORDER-1/i);
    expect(filter.trackingNumber).toEqual(/9214490411375403131206/i);
  });

  test('updates tracking only while shipment is tracking pending or shipped', async () => {
    const shipmentId = '660000000000000000130001';
    const patch = { carrier: 'USPS', trackingNumber: '940011189922385' };
    const updated = { _id: shipmentId, ...patch, status: 'SHIPPED' };
    const lean = jest.fn().mockResolvedValue(updated);
    jest.spyOn(Shipment, 'findOneAndUpdate').mockReturnValue({ lean });

    await expect(repository.updateTrackingIfNotDelivered(shipmentId, patch)).resolves.toEqual(updated);
    expect(Shipment.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: shipmentId, status: { $in: ['TRACKING_PENDING', 'SHIPPED'] } },
      { $set: patch },
      { returnDocument: 'after', runValidators: true },
    );
    expect(lean).toHaveBeenCalledTimes(1);
  });

  test('finds a cancelled shipment before creating another for the same vendor submission', async () => {
    const lean = jest.fn().mockResolvedValue(null);
    jest.spyOn(Shipment, 'findOne').mockReturnValue({ lean });

    await repository.findActiveByVendorSubmission('660000000000000000130002');

    expect(Shipment.findOne).toHaveBeenCalledWith({
      vendorSubmissionId: '660000000000000000130002',
    });
  });

  test('updates status only when the expected current status still matches', async () => {
    const shipmentId = '660000000000000000130001';
    const patch = { status: 'RETURNED' };
    const lean = jest.fn().mockResolvedValue({ _id: shipmentId, ...patch });
    jest.spyOn(Shipment, 'findOneAndUpdate').mockReturnValue({ lean });

    await repository.updateStatusIfCurrent(shipmentId, 'SHIPPED', patch);

    expect(Shipment.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: shipmentId, status: 'SHIPPED' },
      { $set: patch },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
