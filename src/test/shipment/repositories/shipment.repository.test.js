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

  test('updates tracking only while shipment is not delivered', async () => {
    const shipmentId = '660000000000000000130001';
    const patch = { carrier: 'USPS', trackingNumber: '940011189922385' };
    const updated = { _id: shipmentId, ...patch, status: 'SHIPPED' };
    const lean = jest.fn().mockResolvedValue(updated);
    jest.spyOn(Shipment, 'findOneAndUpdate').mockReturnValue({ lean });

    await expect(repository.updateTrackingIfNotDelivered(shipmentId, patch)).resolves.toEqual(updated);
    expect(Shipment.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: shipmentId, status: { $ne: 'DELIVERED' } },
      { $set: patch },
      { returnDocument: 'after', runValidators: true },
    );
    expect(lean).toHaveBeenCalledTimes(1);
  });
});
