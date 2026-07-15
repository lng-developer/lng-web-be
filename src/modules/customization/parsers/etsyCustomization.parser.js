const { customizationStatuses } = require('../constants/customizationStatuses');
const { customizationErrorCodes } = require('../constants/customizationErrorCodes');
const { customizationAssetTypes } = require('../constants/customizationAssetTypes');

const textLabels = new Set([
  'custom',
  'personalization',
  'custom name',
  'names',
  'event date',
  'initials',
]);

const optionLabels = new Set([
  'quantity',
  'sizes',
  'select size',
  'ink color',
  'choose your design',
  'type printing option',
]);

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function cleanValue(value) {
  return String(value || '').trim().replace(/^:+/, '').trim();
}

function parseVariationPairs(variations) {
  return String(variations || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf(':');
      if (index < 0) return null;
      const label = part.slice(0, index).trim();
      const value = cleanValue(part.slice(index + 1));
      if (!label || !value) return null;
      return { label, name: label, value };
    })
    .filter(Boolean);
}

function bucketInputs(pairs, customizedUrl) {
  const customerInputs = { texts: [], options: [], images: [] };

  pairs.forEach((pair) => {
    const label = pair.label.toLowerCase();
    if (label === 'photo') {
      customerInputs.images.push(pair);
    } else if (textLabels.has(label)) {
      customerInputs.texts.push(pair);
    } else if (optionLabels.has(label)) {
      customerInputs.options.push(pair);
    }
  });

  if (customizedUrl && !customerInputs.images.some((image) => image.value === customizedUrl)) {
    customerInputs.images.push({ label: 'customization_url', name: 'customization_url', value: customizedUrl });
  }

  return customerInputs;
}

function isAllowedUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function normalizeEtsyCustomization(rawCustomization = {}) {
  const variations = normalizeString(rawCustomization.variations);
  const personalization = normalizeString(rawCustomization.personalization);
  const customizedUrl = normalizeString(rawCustomization.customizedUrl);
  const pairs = parseVariationPairs(variations);

  if (personalization) {
    pairs.push({ label: 'Personalization', name: 'Personalization', value: personalization });
  }

  const customerInputs = bucketInputs(pairs, customizedUrl);
  const parsedData = {
    amazonCustomization: {
      hasCustomization: true,
      variations,
      personalization,
      customizedUrl,
      customerInputs,
    },
  };

  if (customizedUrl && !isAllowedUrl(customizedUrl)) {
    return {
      outcome: customizationStatuses.NEEDS_REVIEW,
      assets: [],
      parsedData,
      errorCode: customizationErrorCodes.INVALID_RAW_CUSTOMIZATION,
      errorMessage: `Unsupported or invalid customization URL: ${customizedUrl}`,
    };
  }

  const assets = customizedUrl ? [{
    type: customizationAssetTypes.CUSTOMIZED_URL,
    sourceUrl: customizedUrl,
    status: customizationStatuses.PENDING,
    metadata: {},
  }] : [];

  const hasPhotoWithoutUrl = customerInputs.images.some((image) => (
    image.label.toLowerCase() === 'photo' && !isAllowedUrl(image.value)
  ));

  return {
    outcome: hasPhotoWithoutUrl ? customizationStatuses.NEEDS_REVIEW : customizationStatuses.PARSED,
    assets,
    parsedData,
    errorCode: hasPhotoWithoutUrl ? customizationErrorCodes.MANUAL_REVIEW_REQUIRED : null,
    errorMessage: hasPhotoWithoutUrl ? 'Photo customization requires manual review' : null,
  };
}

module.exports = {
  normalizeEtsyCustomization,
};
