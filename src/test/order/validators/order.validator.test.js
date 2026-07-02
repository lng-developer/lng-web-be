const {
  buyerSchema,
  caseStatusSchema,
  listOrdersQuerySchema,
  shippingServiceSchema,
  validate,
} = require('../../../modules/order/validators/order.validator');

describe('order.validator listOrdersQuerySchema', () => {
  test('accepts order list filters and multi-sort', () => {
    const { value, details } = validate(listOrdersQuerySchema, {
      tab: 'NO_COST_CENTER',
      orderId: '114',
      search: 'buyer or sku',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-06-30T23:59:59.000Z',
      shopId: '660000000000000000000201',
      seller: 'SELLER-1',
      status: 'IMPORTED',
      assignedStaffId: '660000000000000000000901',
      sort: '-orderedAt,externalOrderId',
    });

    expect(details).toBeNull();
    expect(value.tab).toBe('NO_COST_CENTER');
    expect(value.search).toBe('buyer or sku');
    expect(value.sort).toBe('-orderedAt,externalOrderId');
  });

  test('rejects unknown sort field', () => {
    const { details } = validate(listOrdersQuerySchema, {
      sort: '-orderedAt,total',
    });

    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'any.invalid' }),
    ]));
  });

  test('strips removed exact order/date alias filters', () => {
    const { value, details } = validate(listOrdersQuerySchema, {
      orderId: '114',
      externalOrderId: '114-1',
      orderedAtFrom: '2026-06-01T00:00:00.000Z',
      orderedAtTo: '2026-06-30T23:59:59.000Z',
    });

    expect(details).toBeNull();
    expect(value).toEqual({ orderId: '114' });
  });

  test('validates order page action payloads', () => {
    expect(validate(buyerSchema, {
      name: 'Buyer',
      emailMasked: 'buyer@example.test',
      phoneMasked: '+1 555',
    }).details).toBeNull();
    expect(validate(shippingServiceSchema, { level: 'Express', name: 'UPS' }).details).toBeNull();
    expect(validate(caseStatusSchema, { caseStatus: 'OPEN' }).details).toBeNull();
  });
});
