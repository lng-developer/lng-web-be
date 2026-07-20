const { buildDemoRows, DEMO_DAYS, ORDERS_PER_DAY_CHANNEL } = require('./seedAnalyticsDemo');

describe('analytics demo rows', () => {
  it('creates a stable 90-day Amazon and Etsy dataset with repeat buyers', () => {
    const rows = buildDemoRows(new Date('2026-07-20T12:00:00.000Z'));

    expect(rows).toHaveLength(DEMO_DAYS * 2 * ORDERS_PER_DAY_CHANNEL);
    expect(rows.every((row) => row.externalOrderId.startsWith('DASH-DEMO-'))).toBe(true);
    expect(rows.every((row) => row.item.externalItemId.startsWith('DASH-DEMO-ITEM-'))).toBe(true);
    expect(new Set(rows.map((row) => row.order.buyer.externalBuyerId)).size).toBeLessThan(rows.length);
    expect(new Set(rows.map((row) => row.order.salesChannelCode))).toEqual(new Set(['AMAZON', 'ETSY']));
  });

  it('uses minor-unit values and the analytics seed marker for ad data', () => {
    const [row] = buildDemoRows(new Date('2026-07-20T12:00:00.000Z'));

    expect(Number.isInteger(row.item.price.itemPriceAmount)).toBe(true);
    expect(row.item.price.itemPriceAmount).toBeGreaterThan(0);
    expect(row.ad.sourceRef).toBe('analytics-demo-seed');
    expect(row.ad.spendAmount).toBeGreaterThan(0);
    expect(row.ad.impressions).toBeGreaterThan(row.ad.clicks);
  });
});
