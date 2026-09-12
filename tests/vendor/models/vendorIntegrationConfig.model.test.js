const mongoose = require('mongoose');
const VendorIntegrationConfig = require('../../../src/modules/vendor/models/vendorIntegrationConfig.model');

describe('VendorIntegrationConfig model', () => {
  test('allows Manual mode without endpoint or credentials', async () => {
    await expect(new VendorIntegrationConfig({
      vendorId: new mongoose.Types.ObjectId(),
      mode: 'MANUAL',
    }).validate()).resolves.toBeUndefined();
  });

  test('requires an adapterKey for a new Native mode config', async () => {
    await expect(new VendorIntegrationConfig({
      vendorId: new mongoose.Types.ObjectId(),
      mode: 'NATIVE',
      baseUrl: 'https://vendor.example',
      authType: 'API_KEY',
    }).validate()).rejects.toMatchObject({
      errors: { adapterKey: expect.anything() },
    });
  });
});
