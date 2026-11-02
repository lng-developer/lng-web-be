const amazonTrackingSubmissionStatuses = Object.freeze({
  PENDING: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  WAITING_AMAZON: 'WAITING_AMAZON',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
});

function normalizeCarrierCode(carrier) {
  if (!carrier) return 'Other';
  const clean = String(carrier).trim().toUpperCase();
  if (clean.includes('USPS')) return 'USPS';
  if (clean.includes('UPS')) return 'UPS';
  if (clean.includes('FEDEX')) return 'FedEx';
  if (clean.includes('DHL EXPRESS')) return 'DHL Express';
  if (clean.includes('DHL')) return 'DHL';
  if (clean.includes('ONTRAC')) return 'OnTrac';
  if (clean.includes('LASERSHIP')) return 'LaserShip';
  if (clean.includes('OSM')) return 'OSM Worldwide';
  if (clean.includes('YUN')) return 'YunExpress';
  if (clean.includes('4PX')) return '4PX';
  return String(carrier).trim();
}

module.exports = {
  amazonTrackingSubmissionStatuses,
  normalizeCarrierCode,
};
