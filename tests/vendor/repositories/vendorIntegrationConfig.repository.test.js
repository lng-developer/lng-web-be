const VendorIntegrationConfig = require('../../../src/modules/vendor/models/vendorIntegrationConfig.model');
const repository = require('../../../src/modules/vendor/repositories/vendorIntegrationConfig.repository');

describe('vendorIntegrationConfig.repository', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('atomically increments the persisted mutation version on upsert', async () => {
    const payload = {
      vendorId: '660000000000000000000501',
      providerKey: 'PRINTWAY',
      status: 'CONNECTED',
    };
    const lean = jest.fn().mockResolvedValue({ _id: '660000000000000000000801', __v: 1 });
    jest.spyOn(VendorIntegrationConfig, 'findOneAndUpdate').mockReturnValue({ lean });

    await repository.upsertByVendorAndProvider(payload);

    expect(VendorIntegrationConfig.findOneAndUpdate).toHaveBeenCalledWith(
      { vendorId: payload.vendorId, providerKey: payload.providerKey },
      { $set: payload, $inc: { __v: 1 } },
      {
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        upsert: true,
      },
    );
  });

  test('atomically increments the persisted mutation version on credential update', async () => {
    const configId = '660000000000000000000801';
    const lean = jest.fn().mockResolvedValue({ _id: configId, __v: 2 });
    jest.spyOn(VendorIntegrationConfig, 'findByIdAndUpdate').mockReturnValue({ lean });

    await repository.update(configId, { status: 'CONNECTED' });

    expect(VendorIntegrationConfig.findByIdAndUpdate).toHaveBeenCalledWith(
      configId,
      { $set: { status: 'CONNECTED' }, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
