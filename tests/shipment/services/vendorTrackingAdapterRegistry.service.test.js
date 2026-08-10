const {
  getTrackingAdapter,
  normalizeLenfulTracking,
  normalizePrintwayTracking,
} = require('../../../src/modules/shipment/services/vendorTrackingAdapterRegistry.service');
const printwayAdapter = require('../../../src/modules/shipment/services/vendorTrackingAdapters/printway.adapter');

describe('vendorTrackingAdapterRegistry.service', () => {
  test('normalizes Printway order list tracking payload', () => {
    const result = normalizePrintwayTracking('4095267035', {
      data: [{
        order_name: '4095267035',
        trackings: [{
          trackingNumber: '9214490416422001622522',
          trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=9214490416422001622522',
          carrierName: 'USPS',
        }],
      }],
    });

    expect(result).toEqual({
      provider: 'PRINTWAY',
      externalOrderId: '4095267035',
      carrier: 'USPS',
      trackingNumber: '9214490416422001622522',
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=9214490416422001622522',
      vendorStatus: '',
      rawStatus: '',
    });
  });

  test('returns Printway fetch adapter for provider aliases', () => {
    expect(getTrackingAdapter('print way').fetchTrackingByExternalOrderId).toEqual(expect.any(Function));
  });

  test('builds Printway order lookup date range from current time by default', () => {
    const result = printwayAdapter.buildPrintwayOrderListBody(
      '4095267035',
      new Date('2026-07-17T00:00:00.000Z'),
    );

    expect(result).toEqual({
      created_at_min: '2024-07-17 00:00:00',
      created_at_max: '2026-07-17 00:00:00',
      limit: 1,
      page: 1,
      search: '4095267035',
    });
  });

  test('builds Printway order lookup date range from normalized recheck dates', () => {
    const result = printwayAdapter.buildPrintwayOrderListBody('4095267035', {
      dateFrom: new Date('2026-06-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-17T23:59:59.999Z'),
    });

    expect(result).toMatchObject({
      created_at_min: '2026-06-01 00:00:00',
      created_at_max: '2026-07-17 23:59:59',
      search: '4095267035',
    });
  });

  test('normalizes Lenful tracking payload by exact order number', () => {
    const result = normalizeLenfulTracking('111-9039002-8646662', {
      data: [
        {
          order_number: '111-9039002-8646662-X',
          company: 'UPS',
          number: 'NEARMATCH123456',
          status: 'Shipped',
        },
        {
          order_number: '111-9039002-8646662',
          company: '',
          translation: { name: 'USPS' },
          number: '9214490411387004216060',
          status: 'NoActive',
        },
      ],
    });

    expect(result).toEqual({
      provider: 'LENFUL',
      externalOrderId: '111-9039002-8646662',
      carrier: 'USPS',
      trackingNumber: '9214490411387004216060',
      trackingUrl: '',
      vendorStatus: 'NOACTIVE',
      rawStatus: 'NoActive',
    });
  });

  test('returns Lenful fetch adapter for provider aliases', () => {
    expect(getTrackingAdapter('lenful').fetchTrackingByExternalOrderId).toEqual(expect.any(Function));
  });

  test('Printway adapter requires configured base url and token', async () => {
    const oldBaseUrl = process.env.PRINTWAY_API_BASE_URL;
    const oldToken = process.env.PRINTWAY_ACCESS_TOKEN;
    delete process.env.PRINTWAY_API_BASE_URL;
    delete process.env.PRINTWAY_ACCESS_TOKEN;

    await expect(getTrackingAdapter('PRINTWAY').fetchTrackingByExternalOrderId('4095267035'))
      .rejects.toThrow('PRINTWAY tracking credentials are not configured');

    if (oldBaseUrl) process.env.PRINTWAY_API_BASE_URL = oldBaseUrl;
    if (oldToken) process.env.PRINTWAY_ACCESS_TOKEN = oldToken;
  });

  test('Lenful adapter requires configured base url and token', async () => {
    const oldBaseUrl = process.env.LENFUL_API_BASE_URL;
    const oldToken = process.env.LENFUL_ACCESS_TOKEN;
    delete process.env.LENFUL_API_BASE_URL;
    delete process.env.LENFUL_ACCESS_TOKEN;

    await expect(getTrackingAdapter('LENFUL').fetchTrackingByExternalOrderId('111-9039002-8646662'))
      .rejects.toThrow('LENFUL tracking credentials are not configured');

    if (oldBaseUrl) process.env.LENFUL_API_BASE_URL = oldBaseUrl;
    if (oldToken) process.env.LENFUL_ACCESS_TOKEN = oldToken;
  });

  test('tracking adapters never fall back to shared environment credentials', async () => {
    process.env.MERCHIZE_API_BASE_URL = 'https://shared-env.invalid';
    process.env.MERCHIZE_ACCESS_TOKEN = 'shared-token';
    await expect(getTrackingAdapter('MERCHIZE').fetchTrackingByExternalOrderId('MZ-1'))
      .rejects.toThrow('MERCHIZE tracking credentials are not configured');
    delete process.env.MERCHIZE_API_BASE_URL;
    delete process.env.MERCHIZE_ACCESS_TOKEN;
  });
});
