const {
  toOrderExpandedDto,
  toOrderSummaryDto,
  toOrderListDto,
  toPaginatedOrderDto,
} = require('../../../modules/order/dtos/order.dto');

describe('order.dto', () => {
  test('maps table-ready order list fields', () => {
    const dto = toOrderListDto({
      _id: '660000000000000000000301',
      externalOrderId: '114-1',
      orderedAt: new Date('2026-06-01T00:00:00.000Z'),
      buyer: { name: 'Buyer' },
      itemsCount: 2,
      totalAmount: 3530,
      customerPaidAmount: 3530,
      currency: 'USD',
      itemsSummary: [
        {
          orderItemId: '660000000000000000000401',
          sku: 'SKU-1',
          title: 'Custom Shirt',
          quantity: 1,
        },
      ],
      status: 'IMPORTED',
      shopId: '660000000000000000000201',
      externalAccountId: 'SELLER-1',
      assignedStaffId: '660000000000000000000901',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      importSources: ['MANUAL_EXCEL'],
      lastImportedAt: new Date('2026-06-01T01:00:00.000Z'),
      deliveredAt: new Date('2026-06-05T01:00:00.000Z'),
      costCenterStatus: 'MISSING',
      psdStatus: 'PRESENT',
      paymentStatus: 'PENDING',
      caseStatus: 'OPEN',
    });

    expect(dto).toEqual(expect.objectContaining({
      id: '660000000000000000000301',
      externalOrderId: '114-1',
      buyer: { name: 'Buyer' },
      itemsCount: 2,
      totalAmount: 3530,
      customerPaidAmount: 3530,
      currency: 'USD',
      itemsSummary: [expect.objectContaining({
        sku: 'SKU-1',
        title: 'Custom Shirt',
      })],
      externalAccountId: 'SELLER-1',
      assignedStaffId: '660000000000000000000901',
      importSources: ['MANUAL_EXCEL'],
      lastImportedAt: new Date('2026-06-01T01:00:00.000Z'),
      deliveredAt: new Date('2026-06-05T01:00:00.000Z'),
      flags: {
        missingCostCenter: true,
        missingPsd: false,
        awaitingPayment: true,
        openCase: true,
        delivered: true,
      },
      actions: expect.any(Array),
    }));
  });

  test('keeps tabCounts in paginated list response', () => {
    const dto = toPaginatedOrderDto({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      tabCounts: { ALL: 0, NEW_ORDER: 0 },
    });

    expect(dto).toEqual({
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
      tabCounts: { ALL: 0, NEW_ORDER: 0 },
    });
  });

  test('maps header and expanded order response fields', () => {
    expect(toOrderSummaryDto({ tabCounts: { ALL: 2 } })).toEqual({ tabCounts: { ALL: 2 } });

    const expanded = toOrderExpandedDto({
      order: {
        _id: '660000000000000000000301',
        shopId: '660000000000000000000201',
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        externalOrderId: '114-1',
        externalAccountId: 'SELLER-1',
        status: 'IMPORTED',
        orderedAt: new Date('2026-06-01T00:00:00.000Z'),
        shipByDate: new Date('2026-06-05T00:00:00.000Z'),
        buyer: { name: 'Buyer', emailMasked: 'buyer@example.test' },
        shippingAddress: { city: 'Harrison' },
        shippingService: { level: 'Standard' },
        addressValidationStatus: 'VALID',
        externalData: {
          amazon: {
            shouldNotLeak: true,
            isPrime: 'TRUE',
            isBusinessOrder: 'FALSE',
            isReplacementOrder: 'FALSE',
            isExchangeOrder: 'FALSE',
            isBuyerRequestedCancellation: 'TRUE',
          },
        },
        importedAt: new Date('2026-06-01T01:00:00.000Z'),
      },
      items: [{
        item: {
          _id: '660000000000000000000401',
          orderId: '660000000000000000000301',
          externalItemId: 'item-1',
          salesChannelCode: 'AMAZON',
          sku: 'SKU-1',
          asin: 'B000TEST01',
          externalListingId: 'LISTING-1',
          externalProductId: 'PRODUCT-1',
          externalVariantId: 'VARIANT-1',
          title: 'Custom Shirt',
          quantity: 1,
          status: 'FULFILLMENT_READY',
          customizationRawSummary: {
            customizedUrl: 'https://zme-caps.amazon.com/t/token?secret=do-not-leak',
          },
          price: {
            itemPriceAmount: 1000,
            itemTaxAmount: 100,
            shippingPriceAmount: 500,
            shippingTaxAmount: 50,
            itemPromotionDiscountAmount: 25,
            currency: 'USD',
          },
          externalData: {
            amazon: {
              shouldNotLeak: true,
              giftMessageText: 'Happy birthday',
              giftWrapType: 'Gift Bag',
            },
          },
          importedAt: new Date('2026-06-01T01:00:00.000Z'),
        },
        fulfillmentPlan: {
          costEstimate: {
            currency: 'USD',
            totalAmount: 1894,
            lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 1200 }],
            signals: { configCode: 'TS1S', twoSided: false, embroidery: false, priority: true },
          },
        },
        production: {
          id: '660000000000000000000601',
          productionStatus: 'BLOCKED',
          scaleStatus: 'NEED_SCALE',
          qcStatus: 'NOT_READY',
          blockers: ['PSD_MISSING'],
          assignedDesignUserId: '660000000000000000000903',
          assignedAt: new Date('2026-07-05T01:00:00.000Z'),
          designNote: 'Waiting for PSD',
          designAssignmentStatus: 'ASSIGNED',
          readyAt: null,
          sentToVendorAt: null,
        },
        customization: {
          payloadId: '660000000000000000000501',
          customerInputs: { texts: [{ label: 'Custom Name', value: 'NURSE' }] },
          imageAssets: [{ secureUrl: 'https://example.test/a.png' }],
        },
      }],
    });

    expect(expanded).toMatchObject({
      order: {
        id: '660000000000000000000301',
        shopId: '660000000000000000000201',
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        externalOrderId: '114-1',
        status: 'IMPORTED',
        orderedAt: new Date('2026-06-01T00:00:00.000Z'),
        shipByDate: new Date('2026-06-05T00:00:00.000Z'),
        addressValidationStatus: 'VALID',
      },
      platform: {
        channel: 'AMAZON',
        marketplace: 'AMAZON_US',
        sellerAccountId: 'SELLER-1',
        flags: {
          isPrime: true,
          isBusinessOrder: false,
          isReplacementOrder: false,
          isExchangeOrder: false,
          isBuyerRequestedCancellation: true,
        },
      },
      buyer: { name: 'Buyer', emailMasked: 'buyer@example.test' },
      shipping: {
        address: { city: 'Harrison' },
        service: { level: 'Standard' },
      },
      items: [{
        item: {
          id: '660000000000000000000401',
          externalItemId: 'item-1',
          sku: 'SKU-1',
          quantity: 1,
          status: 'FULFILLMENT_READY',
          title: 'Custom Shirt',
        },
        platform: {
          channel: 'AMAZON',
          asin: 'B000TEST01',
          externalListingId: 'LISTING-1',
          externalProductId: 'PRODUCT-1',
          externalVariantId: 'VARIANT-1',
          flags: {
            hasGiftMessage: true,
            giftWrapType: 'Gift Bag',
          },
        },
        pricing: {
          currency: 'USD',
          itemPriceAmount: 1000,
          taxAmount: 150,
          shippingAmount: 500,
          giftWrapAmount: 0,
          discountAmount: 25,
          customerPaidAmount: 1625,
          baseCostAmount: 1894,
          baseCostStatus: 'PRESENT',
          costEstimate: {
            currency: 'USD',
            totalAmount: 1894,
            lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 1200 }],
            signals: { configCode: 'TS1S', twoSided: false, embroidery: false, priority: true },
          },
        },
        production: {
          taskId: '660000000000000000000601',
          status: 'BLOCKED',
          scaleStatus: 'NEED_SCALE',
          qcStatus: 'NOT_READY',
          blockers: ['PSD_MISSING'],
          assignedDesignUserId: '660000000000000000000903',
          assignedAt: new Date('2026-07-05T01:00:00.000Z'),
          designNote: 'Waiting for PSD',
          designAssignmentStatus: 'ASSIGNED',
          readyAt: null,
          sentToVendorAt: null,
        },
        customization: {
          payloadId: '660000000000000000000501',
          customerInputs: { texts: [{ label: 'Custom Name', value: 'NURSE' }] },
          imageAssets: [{ secureUrl: 'https://example.test/a.png' }],
        },
      }],
    });
    expect(JSON.stringify(expanded)).not.toContain('externalData');
    expect(JSON.stringify(expanded)).not.toContain('customizationRawSummary');
    expect(JSON.stringify(expanded)).not.toContain('do-not-leak');
    expect(JSON.stringify(expanded)).not.toContain('importedAt');
  });
});
