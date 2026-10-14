jest.mock('../../../src/modules/catalog/services/listing.service', () => ({
  requestListingPsd: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/services/listingVariant.service', () => ({
  requestListingVariantPsd: jest.fn(),
}));

const listingService = require('../../../src/modules/catalog/services/listing.service');
const variantService = require('../../../src/modules/catalog/services/listingVariant.service');
const listingController = require('../../../src/modules/catalog/controllers/listing.controller');
const variantController = require('../../../src/modules/catalog/controllers/listingVariant.controller');

function response() {
  return {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

describe('Catalog PSD request controllers', () => {
  test('returns 200 with the existing listing PSD task', async () => {
    listingService.requestListingPsd.mockResolvedValue({
      task: { id: '660000000000000000000801' },
      created: false,
    });
    const res = response();

    await listingController.requestListingPsd({
      params: { id: '660000000000000000000701' },
      body: {},
      auth: { accountId: '660000000000000000000901' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: '660000000000000000000801' },
    });
  });

  test('returns 200 with the existing listing variant PSD task', async () => {
    variantService.requestListingVariantPsd.mockResolvedValue({
      task: { id: '660000000000000000000801' },
      created: false,
    });
    const res = response();

    await variantController.requestListingVariantPsd({
      params: {
        id: '660000000000000000000701',
        variantId: '660000000000000000000702',
      },
      auth: { accountId: '660000000000000000000901' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: '660000000000000000000801' },
    });
  });
});
