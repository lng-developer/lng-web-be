function profitStages(row, adSpendAmount = null, complete = true) {
  const before = row.profitBeforeAdsAmount ?? row.grossProfitAmount ?? null;
  const after = before === null || adSpendAmount === null || !complete ? null : before - adSpendAmount;
  return {
    profitBeforeAdsAmount: before,
    profitAfterAdsAmount: after,
    profitAfterOperatingCostsAmount: after === null || row.operatingCostCoverage === 'MISSING' ? null : after - (row.operatingCostAmount || 0),
    adsCoverage: adSpendAmount === null ? 'MISSING' : complete ? 'RECORDED' : 'PARTIAL',
  };
}
module.exports = { profitStages };
