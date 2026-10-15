const { customizationStatuses } = require('../constants/customizationStatuses');
const { customizationErrorCodes } = require('../constants/customizationErrorCodes');
const { customizationAssetTypes } = require('../constants/customizationAssetTypes');

const textLabels = new Set([
  'custom',
  'personalization',
  'enter your custom',
  'custom name',
  'names',
  'event date',
  'initials',
]);

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function cleanValue(value) {
  return String(value || '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
    .replace(/^:+/, '')
    .trim();
}

function splitVariationParts(variations) {
  const source = String(variations || '');
  const matches = [...source.matchAll(/(?:^|,)\s*([^:,]+):/g)];
  if (!matches.length) return [];
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const valueStart = match.index + match[0].length;
    const valueEnd = next ? next.index : source.length;
    return `${match[1].trim()}:${source.slice(valueStart, valueEnd).replace(/^,/, '').trim()}`;
  });
}

function parseVariationPairs(variations) {
  return splitVariationParts(variations)
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
    } else {
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

  const normalizeWhitespace = (text) => cleanValue(text).replace(/\s+/g, ' ');
  const combined = pairs.map(pair => `${pair.label}: ${pair.value}`).join('\n');
  const isCombinedCopy = pairs.length > 0 && normalizeWhitespace(personalization) === normalizeWhitespace(combined);
  const isTextCopy = pairs.some(pair => textLabels.has(pair.label.toLowerCase()) && normalizeWhitespace(pair.value) === normalizeWhitespace(personalization));
  if (personalization && !isCombinedCopy && !isTextCopy) {
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

  const mediaAssets = rawCustomization.mediaAssets || [];
  for (const media of mediaAssets) {
    assets.push({ assetId: media.mediaAssetId, type: 'CUSTOMER_IMAGE', status: customizationStatuses.DOWNLOADED, metadata: { filename: media.filename, mimeType: media.contentType, sha256: media.sha256 } });
    customerInputs.images.push({ assetId: media.mediaAssetId, label: 'Customer image', name: media.filename });
  }
  const incomplete = rawCustomization.needsReview || mediaAssets.length < (rawCustomization.expectedFileCount || 0);

  const hasPhotoWithoutUrl = !mediaAssets.length && customerInputs.images.some((image) => (
    image.label.toLowerCase() === 'photo' && !isAllowedUrl(image.value)
  ));
  if (mediaAssets.length) customerInputs.images = customerInputs.images.filter((image) => image.assetId || image.label?.toLowerCase() !== 'photo');

  return {
    outcome: hasPhotoWithoutUrl || incomplete ? customizationStatuses.NEEDS_REVIEW : customizationStatuses.PARSED,
    assets,
    parsedData,
    errorCode: hasPhotoWithoutUrl || incomplete ? customizationErrorCodes.MANUAL_REVIEW_REQUIRED : null,
    errorMessage: hasPhotoWithoutUrl || incomplete ? 'Photo customization requires manual review' : null,
  };
}

module.exports = {
  normalizeEtsyCustomization,
};
