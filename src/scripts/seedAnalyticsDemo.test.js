const {
  ANALYTICS_SOURCE_REF,
  buildAnalyticsAds,
  buildAnalyticsRows,
  DEMO_DAYS,
  ORDERS_PER_DAY_CHANNEL,
} = require('./seedAnalyticsDemo');

const DEMO_NOW = new Date('2026-07-20T12:00:00.000Z');

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function moneyValues(row) {
  return [
    ...Object.values(row.item.price).filter((value) => typeof value === 'number'),
    ...Object.values(row.snapshot).filter((value) => typeof value === 'number'),
  ];
}

describe('commercial analytics demo builders', () => {
  it('creates 90 UTC days of deterministic Amazon and Etsy orders', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);
    const orderedDays = [...new Set(rows.map((row) => utcDay(row.order.orderedAt)))].sort();

    expect(rows).toHaveLength(DEMO_DAYS * 2 * ORDERS_PER_DAY_CHANNEL);
    expect(orderedDays).toHaveLength(DEMO_DAYS);
    expect(orderedDays[0]).toBe('2026-04-22');
    expect(orderedDays.at(-1)).toBe('2026-07-20');
    expect(rows.every((row) => row.order.externalOrderId.startsWith('DASH-DEMO-'))).toBe(true);
    expect(new Set(rows.map((row) => row.order.salesChannelCode))).toEqual(new Set(['AMAZON', 'ETSY']));
  });

  it('uses one fixed 120-buyer pool repeatedly across the order volume', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);
    const buyerIds = rows.map((row) => row.order.buyer.externalBuyerId);
    const datesByBuyer = new Map();

    rows.forEach((row) => {
      const buyerId = row.order.buyer.externalBuyerId;
      const dates = datesByBuyer.get(buyerId) || new Set();
      dates.add(utcDay(row.order.orderedAt));
      datesByBuyer.set(buyerId, dates);
    });

    expect(buyerIds).toHaveLength(720);
    expect(new Set(buyerIds).size).toBe(120);
    expect([...datesByBuyer.values()].some((dates) => dates.size > 1)).toBe(true);
  });

  it('uses integer minor units and includes delivered operations items', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);

    expect(rows.every((row) => moneyValues(row).every(Number.isInteger))).toBe(true);
    expect(rows.some((row) => row.item.status === 'DELIVERED')).toBe(true);
  });

  it('creates branded and prospecting ads once per day and channel', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);
    const ads = buildAnalyticsAds(rows);
    const campaignsByDayAndChannel = new Map();

    ads.forEach((ad) => {
      const key = `${utcDay(ad.reportDate)}:${ad.salesChannelCode}`;
      const campaigns = campaignsByDayAndChannel.get(key) || [];
      campaigns.push(ad.campaignName);
      campaignsByDayAndChannel.set(key, campaigns);
    });

    expect(ads).toHaveLength(DEMO_DAYS * 2 * 2);
    expect(ads.every((ad) => ad.sourceRef === ANALYTICS_SOURCE_REF)).toBe(true);
    expect([...campaignsByDayAndChannel.values()].every((campaigns) => (
      campaigns.length === 2
      && campaigns.some((campaign) => campaign.includes('BRANDED'))
      && campaigns.some((campaign) => campaign.includes('PROSPECTING'))
    ))).toBe(true);
    expect(ads.every((ad) => [
      ad.budgetAmount,
      ad.spendAmount,
      ad.attributedSalesAmount,
      ad.cpcAmount,
    ].every(Number.isInteger))).toBe(true);
  });
});
