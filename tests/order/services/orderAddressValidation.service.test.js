const mockSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  startSession: jest.fn(async () => mockSession),
}));

jest.mock('../../../src/shared/clients/smartyClient', () => ({
  validateUsStreetAddress: jest.fn(),
}));

jest.mock('../../../src/modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateAddressValidation: jest.fn(),
  updateShippingAddress: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderCase.service', () => ({
  ensureOpenOrderCase: jest.fn(),
  resolveOpenOrderCaseByType: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderProductionRecheck.service', () => ({
  recheckProductionForOrder: jest.fn(),
}));

jest.mock('../../../src/modules/production/public', () => ({
  syncOrderAddressSnapshot: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({
  updateOrderWorkbenchOrder: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));

const smartyClient = require('../../../src/shared/clients/smartyClient');
const orderRepository = require('../../../src/modules/order/repositories/order.repository');
const orderTimelineService = require('../../../src/modules/order/services/orderTimeline.service');
const orderCaseService = require('../../../src/modules/order/services/orderCase.service');
const orderProductionRecheckService = require('../../../src/modules/order/services/orderProductionRecheck.service');
const productionPublic = require('../../../src/modules/production/public');
const orderWorkbenchProjectionService = require('../../../src/modules/order/services/orderWorkbenchProjection.service');
const auditPublic = require('../../../src/modules/audit/public');
const service = require('../../../src/modules/order/services/orderAddressValidation.service');

describe('orderAddressValidation.service', () => {
  const orderId = '660000000000000000000301';
  const updatedAt = new Date('2026-07-29T00:00:00.000Z');

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
      updatedAt,
    });
    orderRepository.updateAddressValidation.mockImplementation(async (id, patch) => ({
      _id: id,
      shopId: '660000000000000000000201',
      ...patch,
    }));
    orderRepository.updateShippingAddress.mockImplementation(async (id, patch) => ({
      _id: id,
      shopId: '660000000000000000000201',
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
    }), { session: mockSession, expectedUpdatedAt: updatedAt });
    expect(result.addressValidationStatus).toBe('VALID');
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      shopId: '660000000000000000000201',
      eventType: 'ADDRESS_VALIDATED',
    }), { session: mockSession });
    expect(productionPublic.syncOrderAddressSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      _id: orderId,
      addressValidationStatus: 'VALID',
    }));
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ADDRESS_VALIDATED',
      source: 'SYSTEM',
      changes: { fields: ['addressValidationStatus', 'shippingAddress'] },
      metadata: { status: 'VALID', skipped: false },
    }), { session: mockSession });
  });

  test('non-US address skips Smarty, remains not checked, and syncs production', async () => {
    const shopId = '660000000000000000000201';
    orderRepository.findById.mockResolvedValueOnce({
      _id: orderId,
      shopId,
      shippingAddress: { countryCode: 'CA', addressLine1: '1 Main St' },
      externalData: {},
      updatedAt,
    });

    const result = await service.validateAddress(orderId);

    expect(smartyClient.validateUsStreetAddress).not.toHaveBeenCalled();
    expect(result.addressValidationStatus).toBe('NOT_CHECKED');
    expect(productionPublic.syncOrderAddressSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ addressValidationStatus: 'NOT_CHECKED' }),
    );
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ADDRESS_VALIDATED',
      changes: { fields: ['addressValidationStatus'] },
      metadata: { status: 'NOT_CHECKED', skipped: true },
    }), { session: mockSession });
  });

  test('does not audit a validation result that was not persisted', async () => {
    orderRepository.updateAddressValidation.mockResolvedValueOnce(null);

    await expect(service.validateAddress(orderId)).rejects.toMatchObject({ statusCode: 409 });
    expect(auditPublic.record).not.toHaveBeenCalled();
    expect(productionPublic.syncOrderAddressSnapshot).not.toHaveBeenCalled();
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
    expect(orderCaseService.ensureOpenOrderCase).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      caseType: 'ADDRESS',
      severity: 'MEDIUM',
    }), { system: true });
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
    expect(orderCaseService.ensureOpenOrderCase).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      caseType: 'ADDRESS',
      severity: 'HIGH',
    }), { system: true });
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
    }), { session: mockSession, expectedUpdatedAt: updatedAt });
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      shopId: '660000000000000000000201',
      eventType: 'SHIPPING_ADDRESS_UPDATED',
    }), { session: mockSession });
    expect(result.addressValidationStatus).toBe('NOT_CHECKED');
    expect(orderWorkbenchProjectionService.updateOrderWorkbenchOrder).toHaveBeenCalledWith(orderId, {
      addressValidationStatus: 'NOT_CHECKED',
      'order.addressValidationStatus': 'NOT_CHECKED',
      'order.shippingAddress': expect.objectContaining({ addressLine1: '103 Bluebonnet Cir' }),
    }, { source: 'ORDER_SHIPPING_ADDRESS' });
  });

  test('overrideAddressValidation marks address overridden without calling Smarty', async () => {
    const result = await service.overrideAddressValidation(orderId, { reason: 'CS approved address' });

    expect(smartyClient.validateUsStreetAddress).not.toHaveBeenCalled();
    expect(orderRepository.updateAddressValidation).toHaveBeenCalledWith(orderId, expect.objectContaining({
      addressValidationStatus: 'OVERRIDDEN',
      'externalData.addressValidation': expect.objectContaining({
        provider: 'manual',
        status: 'OVERRIDDEN',
        reason: 'CS approved address',
      }),
    }), { session: mockSession, expectedUpdatedAt: updatedAt });
    expect(productionPublic.syncOrderAddressSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      _id: orderId,
      addressValidationStatus: 'OVERRIDDEN',
    }));
    expect(orderWorkbenchProjectionService.updateOrderWorkbenchOrder).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        addressValidationStatus: 'OVERRIDDEN',
        'order.addressValidationStatus': 'OVERRIDDEN',
      }),
      { source: 'ORDER_ADDRESS_VALIDATION' },
    );
    expect(orderCaseService.ensureOpenOrderCase).not.toHaveBeenCalled();
    expect(orderCaseService.resolveOpenOrderCaseByType).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      caseType: 'ADDRESS',
      resolutionNote: 'CS approved address',
    }), expect.any(Object));
    expect(orderProductionRecheckService.recheckProductionForOrder).toHaveBeenCalledWith(
      orderId,
      expect.any(Object),
      'ADDRESS_OVERRIDDEN',
    );
    expect(result.addressValidationStatus).toBe('OVERRIDDEN');
  });

  test('overrideAddressValidation lets resolved address case trigger production recheck once', async () => {
    orderCaseService.resolveOpenOrderCaseByType.mockResolvedValueOnce({ id: 'case-1' });

    await service.overrideAddressValidation(orderId, { reason: 'CS approved address' });

    expect(orderProductionRecheckService.recheckProductionForOrder).not.toHaveBeenCalled();
  });

  test('does not audit or append timeline when a shipping-address CAS loses', async () => {
    orderRepository.updateShippingAddress.mockResolvedValueOnce(null);

    await expect(service.updateShippingAddress(orderId, { city: 'Austin' }))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('keeps address mutation, timeline, and audit in the same transaction', async () => {
    await service.updateShippingAddress(orderId, { city: 'Austin' });

    expect(orderRepository.updateShippingAddress).toHaveBeenCalledWith(orderId, expect.any(Object), {
      session: mockSession, expectedUpdatedAt: updatedAt,
    });
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.any(Object), { session: mockSession });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.any(Object), { session: mockSession });
  });
});
