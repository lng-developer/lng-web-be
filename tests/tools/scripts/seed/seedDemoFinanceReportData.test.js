const {
  DEMO_DATABASE_NAME,
  assertDemoSeedAllowed,
  databaseNameFromUri,
  parseCliArguments,
  buildDemoFinanceRows,
  buildDemoAds,
  buildDemoSettlements,
  buildDemoLedger,
  seedDemoFinanceReportData,
  resetDemoFinanceReportData,
} = require('../../../../tools/scripts/seed/seedDemoFinanceReportData');

describe('demo finance report seed guard', () => {
  test('accepts only the isolated demo database with explicit non-production opt-in', () => {
    expect(() => assertDemoSeedAllowed(
      { NODE_ENV: 'development', ALLOW_ANALYTICS_DEMO_SEED: 'true' },
      'mongodb://user:secret@localhost:27017/lng_web_be_demo?retryWrites=true',
    )).not.toThrow();

    expect(DEMO_DATABASE_NAME).toBe('lng_web_be_demo');
  });

  test.each([
    ['production', { NODE_ENV: 'production', ALLOW_ANALYTICS_DEMO_SEED: 'true' }, 'mongodb://localhost/lng_web_be_demo', 'disabled in production'],
    ['missing opt-in', { NODE_ENV: 'test' }, 'mongodb://localhost/lng_web_be_demo', 'ALLOW_ANALYTICS_DEMO_SEED=true'],
    ['primary database', { NODE_ENV: 'test', ALLOW_ANALYTICS_DEMO_SEED: 'true' }, 'mongodb://localhost/lng_web_be', 'lng_web_be_demo'],
    ['similarly named database', { NODE_ENV: 'test', ALLOW_ANALYTICS_DEMO_SEED: 'true' }, 'mongodb://localhost/lng_web_be_demo_backup', 'lng_web_be_demo'],
    ['database-less URI', { NODE_ENV: 'test', ALLOW_ANALYTICS_DEMO_SEED: 'true' }, 'mongodb://localhost/?retryWrites=true', 'lng_web_be_demo'],
  ])('rejects %s without exposing the URI', (_name, env, uri, message) => {
    expect(() => assertDemoSeedAllowed(env, uri)).toThrow(message);
    expect(() => assertDemoSeedAllowed(env, uri)).not.toThrow('secret');
  });

  test('extracts only the decoded database path', () => {
    expect(databaseNameFromUri('mongodb+srv://user:pass@cluster.example/lng_web_be_demo?retryWrites=true')).toBe('lng_web_be_demo');
    expect(databaseNameFromUri('mongodb://user:pass@host-a:27017,host-b:27017/lng_web_be_demo?replicaSet=demo')).toBe('lng_web_be_demo');
    expect(databaseNameFromUri('mongodb://localhost/')).toBeNull();
  });

  test('defaults to dry-run and requires apply before reset can mutate', () => {
    expect(parseCliArguments([])).toEqual({ apply: false, reset: false });
    expect(parseCliArguments(['--reset'])).toEqual({ apply: false, reset: true });
    expect(parseCliArguments(['--apply', '--reset'])).toEqual({ apply: true, reset: true });
  });

  test('creates attributed and unassigned ads with usable campaign variations', () => {
    const ads = buildDemoAds(buildDemoFinanceRows(new Date('2026-10-05T12:00:00.000Z')));
    expect(new Set(ads.map((ad) => ad.status))).toEqual(new Set(['ENABLED', 'PAUSED', 'ARCHIVED']));
    expect(ads.some((ad) => ad.sellerAttributionSource === 'UNASSIGNED')).toBe(true);
    expect(ads.some((ad) => ad.sellerEmployeeCode)).toBe(true);
    expect(ads.every((ad) => Number.isInteger(ad.spendAmount) && Number.isInteger(ad.roasBps))).toBe(true);
  });

  test('creates linked settlement activities and a small explicit unlinked population', () => {
    const rows = buildDemoFinanceRows(new Date('2026-10-05T12:00:00.000Z'));
    const settlements = buildDemoSettlements(rows);
    const ledger = buildDemoLedger(rows, settlements);
    const knownOrders = new Set(rows.map((row) => row.order.externalOrderId));
    const unlinked = ledger.filter((row) => row.externalOrderId.startsWith('DEMO-UNLINKED-'));

    expect(settlements).not.toHaveLength(0);
    expect(ledger.filter((row) => !row.externalOrderId.startsWith('DEMO-UNLINKED-')).every((row) => knownOrders.has(row.externalOrderId))).toBe(true);
    expect(unlinked.length / ledger.length).toBeLessThan(0.05);
    expect(ledger.every((row) => row.rawReference.dedupKey)).toBe(true);
  });
});

describe('demo finance report fixtures', () => {
  test('cover all order lifecycle states with synthetic identities and integer money', () => {
    const rows = buildDemoFinanceRows(new Date('2026-10-05T12:00:00.000Z'));
    expect(rows).toHaveLength(90);
    expect(new Set(rows.map((row) => row.order.status))).toEqual(new Set([
      'IMPORTED', 'ON_HOLD', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED', 'REFUNDED', 'FAILED',
    ]));
    expect(rows.every((row) => row.order.externalOrderId.startsWith('DEMO-FIN-'))).toBe(true);
    expect(rows.every((row) => Number.isInteger(row.snapshot.customerPaidAmount))).toBe(true);
    expect(rows.every((row) => row.snapshot.departmentId === '660000000000000000000001')).toBe(true);
  });
});

describe('demo finance report persistence boundary', () => {
  const demoEnv = { NODE_ENV: 'test', ALLOW_ANALYTICS_DEMO_SEED: 'true' };
  const demoUri = 'mongodb://localhost/lng_web_be_demo';

  test('dry-run returns complete fixture counts without opening a database connection', async () => {
    const connectDatabase = jest.fn();
    await expect(seedDemoFinanceReportData({
      env: demoEnv,
      dependencies: { databaseUri: demoUri, connectDatabase },
    })).resolves.toMatchObject({
      apply: false,
      orderCount: 90,
      adsCount: 180,
      sourceRef: 'demo-finance-report-seed',
    });
    expect(connectDatabase).not.toHaveBeenCalled();
  });

  test('apply writes only stable demo identities after the guard passes', async () => {
    const rows = buildDemoFinanceRows();
    const orders = rows.map((row, index) => ({ _id: `order-${index}`, externalOrderId: row.order.externalOrderId, shopId: row.order.shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US' }));
    const items = rows.map((row, index) => ({ _id: `item-${index}`, orderId: `order-${index}`, externalOrderId: row.order.externalOrderId, externalItemId: row.item.externalItemId, shopId: row.order.shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US' }));
    const query = (value) => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) });
    const dependencies = {
      databaseUri: demoUri, connectDatabase: jest.fn(), disconnectDatabase: jest.fn(), upsertDemoShops: jest.fn(),
      Order: { bulkWrite: jest.fn(), find: jest.fn(() => query(orders)) },
      OrderItem: { bulkWrite: jest.fn(), find: jest.fn(() => query(items)) },
      FinanceSnapshot: { bulkWrite: jest.fn() }, AdsSpendDaily: { bulkWrite: jest.fn() },
      MarketplaceSettlement: { bulkWrite: jest.fn() }, MarketplaceSettlementLedgerLine: { bulkWrite: jest.fn() },
    };

    await expect(seedDemoFinanceReportData({ apply: true, env: demoEnv, dependencies })).resolves.toMatchObject({ apply: true, orderCount: 90, ledgerCount: expect.any(Number) });
    expect(dependencies.Order.bulkWrite).toHaveBeenCalledTimes(1);
    expect(dependencies.OrderItem.bulkWrite).toHaveBeenCalledTimes(1);
    expect(dependencies.MarketplaceSettlementLedgerLine.bulkWrite).toHaveBeenCalledTimes(1);
    expect(dependencies.disconnectDatabase).toHaveBeenCalledTimes(1);
  });

  test('reset selects only demo-tagged records and deletes dependents before orders', async () => {
    const query = (value) => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) });
    const dependencies = {
      Order: { find: jest.fn(() => query([{ _id: 'demo-order' }])), deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) },
      OrderItem: { find: jest.fn(() => query([{ _id: 'demo-item' }])), deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) },
      FinanceSnapshot: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) },
      AdsSpendDaily: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) },
      MarketplaceSettlement: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) },
      MarketplaceSettlementLedgerLine: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) },
    };
    await expect(resetDemoFinanceReportData(dependencies)).resolves.toMatchObject({ deletedOrders: 1, deletedLedger: 1 });
    expect(dependencies.Order.find).toHaveBeenCalledWith({ externalOrderId: { $regex: '^DEMO-FIN-' } });
    expect(dependencies.MarketplaceSettlementLedgerLine.deleteMany).toHaveBeenCalledWith({ sourceRef: 'demo-finance-report-seed' });
    expect(dependencies.FinanceSnapshot.deleteMany).toHaveBeenCalledWith({ orderItemId: { $in: ['demo-item'] } });
  });
});
