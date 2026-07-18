jest.mock('../../../shared/clients/smartyClient', () => ({
  validateUsStreetAddress: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateAddressValidation: jest.fn(),
  updateShippingAddress: jest.fn(),
}));

jest.mock('../../../modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  syncOrderAddressSnapshot: jest.fn(),
}));

const smartyClient = require('../../../shared/clients/smartyClient');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderTimelineService = require('../../../modules/order/services/orderTimeline.service');
const productionPublic = require('../../../modules/production/public');
const service = require('../../../modules/order/services/orderAddressValidation.service');

describe('orderAddressValidation.service', () => {
  const orderId = '660000000000000000000301';

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue({
      _id: orderId,
      shopId: '660000000000000000000201',
      shippingAddress: {
        name: 'Buyer',
        addressLine1: '102 BLUEBONNET CIR',
        addressLine2: null,
        city: 'SUNNYVALE',
        stateOrProvince: 'TEXAS',
        postalCode: '75182-5007',
        countryCode: 'US',
      },
      externalData: {},
    });
    orderRepository.updateAddressValidation.mockImplementation(async (id, patch) => ({
      _id: id,
      ...patch,
    }));
    orderRepository.updateShippingAddress.mockImplementation(async (id, patch) => ({
      _id: id,
      ...patch,
    }));
    orderTimelineService.appendTimeline.mockResolvedValue({});
  });

  test('valid smarty candidate marks address valid and normalizes shipping address', async () => {
    smartyClient.validateUsStreetAddress.mockResolvedValue([
      {
        delivery_line_1: '102 Bluebonnet Cir',
        last_line: 'Sunnyvale TX 75182-5007',
        components: {
          city_name: 'Sunnyvale',
          state_abbreviation: 'TX',
          zipcode: '75182',
          plus4_code: '5007',
        },
        analysis: {
          enhanced_match: 'postal-match',
          dpv_match_code: 'Y',
        },
      },
    ]);

    const result = await service.validateAddress(orderId);

    expect(smartyClient.validateUsStreetAddress).toHaveBeenCalledWith(expect.objectContaining({
      addressLine1: '102 BLUEBONNET CIR',
    }));
    expect(orderRepository.updateAddressValidation).toHaveBeenCalledWith(orderId, expect.objectContaining({
      addressValidationStatus: 'VALID',
      shippingAddress: expect.objectContaining({
        addressLine1: '102 Bluebonnet Cir',
        city: 'Sunnyvale',
        stateOrProvinceCode: 'TX',
        postalCode: '75182-5007',
      }),
      'externalData.addressValidation': expect.objectContaining({
        provider: 'smarty',
        status: 'VALID',
      }),
    }));
    expect(result.addressValidationStatus).toBe('VALID');
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      shopId: '660000000000000000000201',
      eventType: 'ADDRESS_VALIDATED',
    }));
    expect(productionPublic.syncOrderAddressSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      _id: orderId,
      addressValidationStatus: 'VALID',
    }));
  });

  test('non-US address skips Smarty, remains not checked, and syncs production', async () => {
    const shopId = '660000000000000000000201';
    orderRepository.findById.mockResolvedValueOnce({
      _id: orderId,
      shopId,
      shippingAddress: { countryCode: 'CA', addressLine1: '1 Main St' },
      externalData: {},
    });

    const result = await service.validateAddress(orderId);

    expect(smartyClient.validateUsStreetAddress).not.toHaveBeenCalled();
    expect(result.addressValidationStatus).toBe('NOT_CHECKED');
    expect(productionPublic.syncOrderAddressSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ addressValidationStatus: 'NOT_CHECKED' }),
    );
  });

  test('missing secondary marks warning and keeps original shipping address', async () => {
    smartyClient.validateUsStreetAddress.mockResolvedValue([
      {
        delivery_line_1: '1 Main St',
        components: { city_name: 'Austin', state_abbreviation: 'TX', zipcode: '78701' },
        analysis: { enhanced_match: 'postal-match;missing-secondary' },
      },
    ]);

    await service.validateAddress(orderId);

    expect(orderRepository.updateAddressValidation.mock.calls[0][1]).toEqual(expect.objectContaining({
      addressValidationStatus: 'WARNING',
    }));
    expect(orderRepository.updateAddressValidation.mock.calls[0][1]).not.toHaveProperty('shippingAddress');
  });

  test('no candidate marks address invalid', async () => {
    smartyClient.validateUsStreetAddress.mockResolvedValue([]);

    await service.validateAddress(orderId);

    expect(orderRepository.updateAddressValidation.mock.calls[0][1]).toEqual(expect.objectContaining({
      addressValidationStatus: 'INVALID',
      'externalData.addressValidation': expect.objectContaining({
        reason: 'No candidate returned',
      }),
    }));
  });

  test('updateShippingAddress merges address, resets validation, and appends timeline', async () => {
    const result = await service.updateShippingAddress(orderId, {
      addressLine1: '103 Bluebonnet Cir',
      postalCode: '75182',
    });

    expect(orderRepository.updateShippingAddress).toHaveBeenCalledWith(orderId, expect.objectContaining({
      shippingAddress: expect.objectContaining({
        name: 'Buyer',
        addressLine1: '103 Bluebonnet Cir',
        addressLine2: null,
        postalCode: '75182',
        countryCode: 'US',
      }),
      addressValidationStatus: 'NOT_CHECKED',
      'externalData.addressValidation': expect.objectContaining({
        status: 'NOT_CHECKED',
        reason: 'Shipping address updated manually',
      }),
    }));
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      shopId: '660000000000000000000201',
      eventType: 'SHIPPING_ADDRESS_UPDATED',
    }));
    expect(result.addressValidationStatus).toBe('NOT_CHECKED');
  });
});
