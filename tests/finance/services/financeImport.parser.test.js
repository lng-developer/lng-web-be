const {
  moneyToMinor,
  parseAdsCsv,
  parseSettlementTxt,
  parseTransactionCsv,
} = require('../../../src/modules/finance/services/financeImport.parser');

describe('financeImport.parser', () => {
  test('transaction CSV skips preamble and parses quoted rows', () => {
    const rows = parseTransactionCsv([
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

  test('settlement TXT parses tab separated header and rows', () => {
    const rows = parseSettlementTxt([
      'settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tsku\torder-item-code',
      '263\t2026-04-17 02:37:57 UTC\t2026-05-01 02:37:58 UTC\t2026-05-03 02:37:58 UTC\t-12988.06\tUSD\t\t\t\t\t\t\t',
      '263\t\t\t\t\t\tOrder\t113-1\tItemPrice\tPrincipal\t51.80\tSKU-1\t158',
    ].join('\n'));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ settlementId: '263', isHeader: true, totalAmount: -1298806 });
    expect(rows[1]).toMatchObject({ settlementId: '263', transactionType: 'Order', externalOrderId: '113-1', amount: 5180 });
  });

  test('ads CSV maps money and percentages', () => {
    const rows = parseAdsCsv([
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
    const [row] = parseAdsCsv([
      'Date,Campaign Name,Spend',
      '"Apr 15, 2026",J2522-AT,$3.93',
    ].join('\n'));

    expect(row.reportDate.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  test('ads CSV attributes sellers from campaign, then portfolio, or leaves them unassigned', () => {
    const rows = parseAdsCsv([
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
