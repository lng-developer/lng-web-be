jest.mock('../../../src/modules/order/services/orderQuery.service', () => ({
  listOrderWorkbench: jest.fn(),
}));

const orderQueryService = require('../../../src/modules/order/services/orderQuery.service');
const orderExportService = require('../../../src/modules/order/services/orderExport.service');

describe('orderExport.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports order workbench rows as escaped CSV', async () => {
    orderQueryService.listOrderWorkbench.mockResolvedValue({
      items: [{
        order: {
          _id: '660000000000000000000001',
          externalOrderId: 'J2605',
          salesChannelCode: 'AMAZON',
          orderedAt: '2026-08-15T00:00:00.000Z',
          buyer: { name: 'Rich, Kim' },
          shippingAddress: { countryCode: 'US' },
        },
        shop: { _id: '660000000000000000000002', name: 'Shop "A"' },
        items: [{
          item: {
            _id: '660000000000000000000003',
            sku: 'SKU-1',
            asin: 'B0TEST',
            quantity: 1,
            price: { itemPriceAmount: 1299, currency: 'USD' },
          },
          fulfillmentPlan: {
            status: 'READY',
            selectionMode: 'VARIANT',
            vendor: { name: 'Vendor A' },
            vendorProduct: { name: 'Shirt' },
            vendorCostCenter: { code: 'CC-1', sku: 'CC-SKU-1' },
            costEstimate: { totalAmount: 899, currency: 'USD', lines: [{ code: 'BASE_COST', amount: 799 }] },
          },
          tracking: { trackingNumber: '1Z999' },
        }],
      }],
      total: 1,
      page: 1,
      limit: 5000,
    });

    const result = await orderExportService.exportOrdersCsv({ search: 'J2605' }, { accountId: 'a1' });

    expect(orderQueryService.listOrderWorkbench).toHaveBeenCalledWith(
      { search: 'J2605', page: 1, limit: 5000 },
      { accountId: 'a1' },
    );
    expect(result.filename).toMatch(/^orders-export-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.csv).toContain('Order ID,Channel,Shop,ASIN / Listing ID,SKU');
    expect(result.csv).toContain('Mapping status,Selection mode,Vendor,Vendor product,Cost center');
    expect(result.csv).toContain('J2605,AMAZON,"Shop ""A""",B0TEST,SKU-1');
    expect(result.csv).toContain('READY,VARIANT,Vendor A,Shirt,CC-1,CC-SKU-1,799,899');
    expect(result.csv).toContain('"Rich, Kim"');
  });
});
