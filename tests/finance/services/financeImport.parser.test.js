const {
  moneyToMinor,
  parseAdsCsv,
  parseSettlementTxt,
  parseTransactionCsv,
} = require('../../../src/modules/finance/services/financeImport.parser');

describe('financeImport.parser', () => {
  test('settlement TXT returns a row error instead of coercing a missing settlement id', () => {
    const result = parseSettlementTxt([
      'settlement-id\tsettlement-start-date\tsettlement-end-date\ttransaction-type\tamount',
      '\t\t\tOrder\t51.80',
    ].join('\n'));

    expect(result).toEqual({
      rows: [],
      errors: [{ row: 2, field: 'settlement-id', message: 'settlement-id is required' }],
    });
  });

  test('transaction CSV skips preamble and parses quoted rows', () => {
    const { rows } = parseTransactionCsv([
      '"Includes Amazon Marketplace"',
      '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
      '"Apr 15, 2026 3:48:00 AM PDT","26225499581","Order","114-1","J2508-TS1S","-3.25","-1.00","48.03"',
    ].join('\n'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      settlementId: '26225499581',
      transactionType: 'Order',
      externalOrderId: '114-1',
      sku: 'J2508-TS1S',
      sellingFeesAmount: -325,
      otherTransactionFeesAmount: -100,
    });
  });

  test('transaction CSV accepts Amazon Transaction View table export columns', () => {
    const { rows: [row] } = parseTransactionCsv([
      '"Date","Transaction Status","Transaction type","Order ID","Product Details","Total product charges","Total promotional rebates","Amazon fees","Other","Total (USD)"',
      '"7/8/2026","Released","Service Fees","---","Cost of Advertising","0","0","-11.07","0","-11.07"',
    ].join('\n'));

    expect(row).toMatchObject({
      postedAt: new Date('2026-07-08T00:00:00.000Z'),
      transactionStatus: 'Released',
      transactionType: 'Service Fees',
      externalOrderId: '---',
      description: 'Cost of Advertising',
      sellingFeesAmount: -1107,
      totalAmount: -1107,
    });
  });

  test('settlement TXT parses tab separated header and rows', () => {
    const { rows } = parseSettlementTxt([
      'settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tsku\torder-item-code',
      '263\t2026-04-17 02:37:57 UTC\t2026-05-01 02:37:58 UTC\t2026-05-03 02:37:58 UTC\t-12988.06\tUSD\t\t\t\t\t\t\t',
      '263\t\t\t\t\t\tOrder\t113-1\tItemPrice\tPrincipal\t51.80\tSKU-1\t158',
    ].join('\n'));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ settlementId: '263', isHeader: true, totalAmount: -1298806 });
    expect(rows[1]).toMatchObject({ settlementId: '263', transactionType: 'Order', externalOrderId: '113-1', amount: 5180 });
  });

  test('ads CSV maps money and percentages', () => {
    const { rows } = parseAdsCsv([
      'Date,Portfolio name,Program Type,Campaign Name,Retailer,Country,Status,Currency,Budget Amount,Impressions,Clicks,Click-Thru Rate (CTR),Spend,Cost Per Click (CPC),7 Day Total Orders (#),Total Advertising Cost of Sales (ACOS) ,Total Return on Advertising Spend (ROAS),7 Day Total Sales ',
      '"Apr 15, 2026",J2522,Sponsored Products,J2522-AT,Amazon,United States,ENABLED,USD,$50.0,278,12,4.317%,$3.93,$0.3275,0,12.34%,2.5,$9.99',
    ].join('\n'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      campaignName: 'J2522-AT',
      budgetAmount: 5000,
      spendAmount: 393,
      cpcAmount: 33,
      ctrBps: 432,
      acosBps: 1234,
      roasBps: 25000,
      attributedSalesAmount: 999,
    });
  });

  test('ads report dates remain on the Amazon calendar day across server timezones', () => {
    const { rows: [row] } = parseAdsCsv([
      'Date,Campaign Name,Spend',
      '"Apr 15, 2026",J2522-AT,$3.93',
    ].join('\n'));

    expect(row.reportDate.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  test('ads CSV accepts Amazon Reporting Total cost as spend', () => {
    const { rows: [row] } = parseAdsCsv([
      'Date,Campaign Name,Total cost',
      '"Apr 15, 2026",J2522-AT,"$3.93"',
    ].join('\n'));

    expect(row.spendAmount).toBe(393);
  });

  test('ads CSV accepts the native scheduled-report columns', () => {
    const { rows: [row] } = parseAdsCsv([
      'Date range,Budget currency,Campaign name,Campaign ID,Advertiser account ID,Portfolio ID,Total cost',
      '"Aug 24, 2026 - Aug 24, 2026",USD,J2605-AT,"=""45411814103490""","=""amzn1.ads-account.g.llc""","=""portfolio-1""",4.25',
    ].join('\n'));

    expect(row).toMatchObject({
      reportDate: new Date('2026-08-24T00:00:00.000Z'),
      campaignId: '45411814103490',
      advertiserAccountId: 'amzn1.ads-account.g.llc',
      portfolioId: 'portfolio-1',
      campaignName: 'J2605-AT',
      currency: 'USD',
      spendAmount: 425,
    });
  });

  test('ads CSV attributes sellers from campaign, then portfolio, or leaves them unassigned', () => {
    const { rows } = parseAdsCsv([
      'Date,Portfolio name,Campaign Name',
      '2026-04-15,Brand J2522 US J9999,J9999-Campaign',
      '2026-04-16,No seller,J2523-Campaign',
      '2026-04-17,No seller,No seller campaign',
      '2026-04-18,Brand j2525 US,No seller campaign',
      '2026-04-19,No seller,Campaign j2526',
    ].join('\n'));

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sellerEmployeeCode: 'J9999', sellerAttributionSource: 'CAMPAIGN_NAME' }),
      expect.objectContaining({ sellerEmployeeCode: 'J2523', sellerAttributionSource: 'CAMPAIGN_NAME' }),
      expect.objectContaining({ sellerEmployeeCode: null, sellerAttributionSource: 'UNASSIGNED' }),
      expect.objectContaining({ sellerEmployeeCode: 'J2525', sellerAttributionSource: 'PORTFOLIO_NAME' }),
      expect.objectContaining({ sellerEmployeeCode: 'J2526', sellerAttributionSource: 'CAMPAIGN_NAME' }),
    ]));
  });

  test('moneyToMinor handles currency strings', () => {
    expect(moneyToMinor('$1,234.56')).toBe(123456);
    expect(moneyToMinor('-3.25')).toBe(-325);
  });
});
