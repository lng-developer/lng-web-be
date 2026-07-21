const { extractEmployeeCode } = require('../../../shared/utils/sku');

function parseDelimitedLine(line, delimiter = ',') {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function key(value) {
  return String(value || '').trim().toLowerCase();
}

function rowObject(headers, values) {
  return headers.reduce((row, header, index) => {
    row[key(header)] = values[index] === undefined ? '' : values[index];
    return row;
  }, {});
}

function moneyToMinor(value) {
  const cleaned = String(value ?? '')
    .replace(/[$,\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!cleaned) return 0;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function percentToBps(value) {
  const cleaned = String(value ?? '').replace('%', '').trim();
  if (!cleaned) return 0;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function ratioToBps(value) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) ? Math.round(number * 10000) : 0;
}

function parseDate(value) {
  const date = new Date(String(value || '').trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTransactionRow(raw, importKey) {
  return {
    importKey,
    raw,
    postedAt: parseDate(raw['date/time']),
    settlementId: raw['settlement id'] || null,
    transactionType: raw.type || null,
    transactionStatus: raw['transaction status'] || null,
    externalOrderId: raw['order id'] || null,
    sku: raw.sku || null,
    description: raw.description || null,
    quantityPurchased: raw.quantity ? Number(raw.quantity) : null,
    currency: 'USD',
    productSalesAmount: moneyToMinor(raw['product sales']),
    shippingCreditsAmount: moneyToMinor(raw['shipping credits']),
    promotionalRebatesAmount: moneyToMinor(raw['promotional rebates']),
    marketplaceWithheldTaxAmount: moneyToMinor(raw['marketplace withheld tax']),
    sellingFeesAmount: moneyToMinor(raw['selling fees']),
    fbaFeesAmount: moneyToMinor(raw['fba fees']),
    otherTransactionFeesAmount: moneyToMinor(raw['other transaction fees']),
    otherAmount: moneyToMinor(raw.other),
    totalAmount: moneyToMinor(raw.total),
  };
}

function parseTransactionCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => key(parseDelimitedLine(line)[0]) === 'date/time');
  if (headerIndex < 0) return [];
  const headers = parseDelimitedLine(lines[headerIndex]);

  return lines.slice(headerIndex + 1).map((line, index) => {
    const raw = rowObject(headers, parseDelimitedLine(line));
    return toTransactionRow(raw, `transaction:${headerIndex + index + 2}`);
  });
}

function toSettlementRow(raw, importKey) {
  const transactionType = raw['transaction-type'] || null;
  return {
    importKey,
    raw,
    isHeader: !transactionType && !!raw['settlement-start-date'],
    settlementId: raw['settlement-id'] || null,
    periodStartAt: parseDate(raw['settlement-start-date']),
    periodEndAt: parseDate(raw['settlement-end-date']),
    depositAt: parseDate(raw['deposit-date']),
    totalAmount: moneyToMinor(raw['total-amount']),
    currency: raw.currency || 'USD',
    transactionType,
    externalOrderId: raw['order-id'] || null,
    externalItemId: raw['order-item-code'] || null,
    sku: raw.sku || null,
    amountType: raw['amount-type'] || null,
    amountDescription: raw['amount-description'] || null,
    amount: moneyToMinor(raw.amount),
    quantityPurchased: raw['quantity-purchased'] ? Number(raw['quantity-purchased']) : null,
    postedAt: parseDate(raw['posted-date-time'] || raw['posted-date']),
  };
}

function parseSettlementTxt(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseDelimitedLine(lines[0], '\t');
  return lines.slice(1).map((line, index) => {
    const raw = rowObject(headers, parseDelimitedLine(line, '\t'));
    return toSettlementRow(raw, `settlement:${index + 2}`);
  });
}

function toAdsRow(raw, importKey) {
  const portfolioSellerEmployeeCode = extractEmployeeCode(raw['portfolio name']);
  const campaignSellerEmployeeCode = extractEmployeeCode(raw['campaign name']);
  const sellerEmployeeCode = campaignSellerEmployeeCode || portfolioSellerEmployeeCode;
  const sellerAttributionSource = campaignSellerEmployeeCode
    ? 'CAMPAIGN_NAME'
    : portfolioSellerEmployeeCode ? 'PORTFOLIO_NAME' : 'UNASSIGNED';

  return {
    importKey,
    raw,
    reportDate: parseDate(raw.date),
    portfolioName: raw['portfolio name'] || null,
    sellerEmployeeCode,
    sellerAttributionSource,
    programType: raw['program type'] || null,
    campaignName: raw['campaign name'] || null,
    retailer: raw.retailer || null,
    country: raw.country || null,
    status: raw.status || null,
    currency: raw.currency || 'USD',
    budgetAmount: moneyToMinor(raw['budget amount']),
    spendAmount: moneyToMinor(raw.spend),
    attributedSalesAmount: moneyToMinor(raw['7 day total sales']),
    impressions: Number(raw.impressions || 0),
    clicks: Number(raw.clicks || 0),
    orders7d: Number(raw['7 day total orders (#)'] || 0),
    ctrBps: percentToBps(raw['click-thru rate (ctr)']),
    acosBps: percentToBps(raw['total advertising cost of sales (acos)']),
    roasBps: ratioToBps(raw['total return on advertising spend (roas)']),
    cpcAmount: moneyToMinor(raw['cost per click (cpc)']),
  };
}

function parseAdsCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseDelimitedLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const raw = rowObject(headers, parseDelimitedLine(line));
    return toAdsRow(raw, `ads:${index + 2}`);
  });
}

module.exports = {
  key,
  moneyToMinor,
  parseAdsCsv,
  parseDate,
  parseDelimitedLine,
  parseSettlementTxt,
  parseTransactionCsv,
  percentToBps,
  rowObject,
  toAdsRow,
  toSettlementRow,
  toTransactionRow,
};
