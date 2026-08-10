const {
  normalizeAmazonCustomization,
} = require('../../../src/modules/customization/parsers/amazonCustomization.parser');
const { customizationStatuses } = require('../../../src/modules/customization/constants/customizationStatuses');
const { customizationErrorCodes } = require('../../../src/modules/customization/constants/customizationErrorCodes');
const { customizationAssetTypes } = require('../../../src/modules/customization/constants/customizationAssetTypes');

describe('amazonCustomization.parser', () => {
  test('parses valid customizedUrl into a pending asset', () => {
    const result = normalizeAmazonCustomization({
      hasCustomization: true,
      customizedUrl: 'https://example.test/custom.zip',
    });

    expect(result).toMatchObject({
      outcome: customizationStatuses.PARSED,
      assets: [{
        type: customizationAssetTypes.CUSTOMIZED_URL,
        sourceUrl: 'https://example.test/custom.zip',
        status: customizationStatuses.PENDING,
        metadata: {},
      }],
      parsedData: {
        amazonCustomization: {
          hasCustomization: true,
          customizedUrl: 'https://example.test/custom.zip',
        },
      },
      errorCode: null,
      errorMessage: null,
    });
  });

  test('parses valid customizedPage into a pending asset', () => {
    const result = normalizeAmazonCustomization({
      hasCustomization: true,
      customizedPage: 'https://a.co/example',
    });

    expect(result.assets).toEqual([{
      type: customizationAssetTypes.CUSTOMIZED_PAGE,
      sourceUrl: 'https://a.co/example',
      status: customizationStatuses.PENDING,
      metadata: {},
    }]);
  });

  test('preserves itemExtensionsData in parsedData', () => {
    const result = normalizeAmazonCustomization({
      itemExtensionsData: '{"name":"Jane"}',
    });

    expect(result.outcome).toBe(customizationStatuses.PARSED);
    expect(result.parsedData.amazonCustomization).toMatchObject({
      hasCustomization: true,
      itemExtensionsData: '{"name":"Jane"}',
    });
  });

  test('returns needs review when there is no customization evidence', () => {
    const result = normalizeAmazonCustomization({ hasCustomization: false });

    expect(result).toMatchObject({
      outcome: customizationStatuses.NEEDS_REVIEW,
      assets: [],
      errorCode: customizationErrorCodes.MANUAL_REVIEW_REQUIRED,
    });
  });

  test('trims evidence fields before checking for customization evidence', () => {
    const result = normalizeAmazonCustomization({
      hasCustomization: true,
      customizedUrl: '   ',
      customizedPage: '\t',
      itemExtensionsData: '  ',
    });

    expect(result).toMatchObject({
      outcome: customizationStatuses.NEEDS_REVIEW,
      assets: [],
      parsedData: {
        amazonCustomization: {
          customizedUrl: null,
          customizedPage: null,
          itemExtensionsData: null,
        },
      },
    });
  });

  test('returns needs review when hasCustomization false conflicts with url evidence', () => {
    const result = normalizeAmazonCustomization({
      hasCustomization: false,
      customizedUrl: 'https://example.test/custom.zip',
    });

    expect(result).toMatchObject({
      outcome: customizationStatuses.NEEDS_REVIEW,
      assets: [],
      errorCode: customizationErrorCodes.MANUAL_REVIEW_REQUIRED,
    });
    expect(result.errorMessage).toContain('conflicts');
  });

  test.each([
    ['not-a-url'],
    ['javascript:alert(1)'],
    ['file:///tmp/custom.zip'],
    ['data:text/plain,custom'],
    ['ftp://example.test/custom.zip'],
  ])('returns needs review for invalid or unsupported URL %p', (url) => {
    const result = normalizeAmazonCustomization({
      hasCustomization: true,
      customizedUrl: url,
    });

    expect(result).toMatchObject({
      outcome: customizationStatuses.NEEDS_REVIEW,
      assets: [],
      errorCode: customizationErrorCodes.INVALID_RAW_CUSTOMIZATION,
    });
  });

  test('re-running parser is deterministic and duplicate url assets are not duplicated', () => {
    const rawCustomization = {
      hasCustomization: true,
      customizedUrl: ' https://example.test/custom.zip ',
      customizedPage: 'https://example.test/custom.zip',
      itemExtensionsData: 'page-data',
    };

    const first = normalizeAmazonCustomization(rawCustomization);
    const second = normalizeAmazonCustomization(rawCustomization);

    expect(second).toEqual(first);
    expect(first.assets).toHaveLength(2);
    expect(new Set(first.assets.map((asset) => `${asset.type}:${asset.sourceUrl}`)).size).toBe(2);
  });
});
