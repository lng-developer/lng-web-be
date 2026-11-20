const crypto = require('crypto');
const AddressValidationCache = require('../models/addressValidationCache.model');

const US_STATE_CODE_MAP = {
  al: 'AL', alabama: 'AL',
  ak: 'AK', alaska: 'AK',
  az: 'AZ', arizona: 'AZ',
  ar: 'AR', arkansas: 'AR',
  ca: 'CA', california: 'CA',
  co: 'CO', colorado: 'CO',
  ct: 'CT', connecticut: 'CT',
  de: 'DE', delaware: 'DE',
  dc: 'DC', 'district of columbia': 'DC',
  fl: 'FL', florida: 'FL',
  ga: 'GA', georgia: 'GA',
  hi: 'HI', hawaii: 'HI',
  id: 'ID', idaho: 'ID',
  il: 'IL', illinois: 'IL',
  in: 'IN', indiana: 'IN',
  ia: 'IA', iowa: 'IA',
  ks: 'KS', kansas: 'KS',
  ky: 'KY', kentucky: 'KY',
  la: 'LA', louisiana: 'LA',
  me: 'ME', maine: 'ME',
  md: 'MD', maryland: 'MD',
  ma: 'MA', massachusetts: 'MA',
  mi: 'MI', michigan: 'MI',
  mn: 'MN', minnesota: 'MN',
  ms: 'MS', mississippi: 'MS',
  mo: 'MO', missouri: 'MO',
  mt: 'MT', montana: 'MT',
  ne: 'NE', nebraska: 'NE',
  nv: 'NV', nevada: 'NV',
  nh: 'NH', 'new hampshire': 'NH',
  nj: 'NJ', 'new jersey': 'NJ',
  nm: 'NM', 'new mexico': 'NM',
  ny: 'NY', 'new york': 'NY',
  nc: 'NC', 'north carolina': 'NC',
  nd: 'ND', 'north dakota': 'ND',
  oh: 'OH', ohio: 'OH',
  ok: 'OK', oklahoma: 'OK',
  or: 'OR', oregon: 'OR',
  pa: 'PA', pennsylvania: 'PA',
  ri: 'RI', 'rhode island': 'RI',
  sc: 'SC', 'south carolina': 'SC',
  sd: 'SD', 'south dakota': 'SD',
  tn: 'TN', tennessee: 'TN',
  tx: 'TX', texas: 'TX',
  ut: 'UT', utah: 'UT',
  vt: 'VT', vermont: 'VT',
  va: 'VA', virginia: 'VA',
  wa: 'WA', washington: 'WA',
  wv: 'WV', 'west virginia': 'WV',
  wi: 'WI', wisconsin: 'WI',
  wy: 'WY', wyoming: 'WY',
  pr: 'PR', 'puerto rico': 'PR',
  gu: 'GU', guam: 'GU',
  vi: 'VI', 'virgin islands': 'VI',
};

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeState(stateValue) {
  const normalized = normalizeText(stateValue);
  return (US_STATE_CODE_MAP[normalized] || normalized).toLowerCase();
}

function normalizeZipcode(zipValue) {
  const digits = String(zipValue || '').replace(/\D/g, '');
  return digits.length >= 5 ? digits.slice(0, 5) : normalizeText(zipValue);
}

function computeAddressKey(address = {}) {
  const street = [address.addressLine1, address.addressLine2, address.addressLine3]
    .filter(Boolean)
    .map(normalizeText)
    .join(' ');
  const city = normalizeText(address.city);
  const state = normalizeState(address.stateOrProvinceCode || address.stateOrProvince);
  const zipcode = normalizeZipcode(address.postalCode);
  const countryCode = String(address.countryCode || 'US').trim().toUpperCase();

  return crypto
    .createHash('sha256')
    .update(`${countryCode}|${street}|${city}|${state}|${zipcode}`)
    .digest('hex');
}

async function findByKey(addressKey) {
  if (!addressKey) return null;
  return AddressValidationCache.findOne({ addressKey }).lean();
}

async function upsertCache(addressKey, data = {}) {
  if (!addressKey) return null;
  const update = {
    $set: {
      addressKey,
      rawAddress: data.rawAddress || {},
      provider: data.provider || 'smarty',
      status: data.status,
      reason: data.reason || null,
      normalizedAddress: data.normalizedAddress || null,
      analysis: data.analysis || null,
      candidates: data.candidates || null,
    },
    $setOnInsert: {
      hitCount: 0,
      lastHitAt: null,
    },
  };
  return AddressValidationCache.findOneAndUpdate({ addressKey }, update, {
    returnDocument: 'after',
    upsert: true,
    setDefaultsOnInsert: true,
  }).lean();
}

async function recordHit(addressKey) {
  if (!addressKey) return null;
  return AddressValidationCache.updateOne(
    { addressKey },
    {
      $inc: { hitCount: 1 },
      $set: { lastHitAt: new Date() },
    },
  );
}

module.exports = {
  computeAddressKey,
  findByKey,
  upsertCache,
  recordHit,
};
