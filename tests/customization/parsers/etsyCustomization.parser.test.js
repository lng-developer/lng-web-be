const {
  normalizeEtsyCustomization,
} = require('../../../src/modules/customization/parsers/etsyCustomization.parser');
const { customizationStatuses } = require('../../../src/modules/customization/constants/customizationStatuses');
const { customizationErrorCodes } = require('../../../src/modules/customization/constants/customizationErrorCodes');

describe('etsyCustomization.parser', () => {
  test('deduplicates the legacy all-fields personalization and retains options and multiline text', () => {
    const result = normalizeEtsyCustomization({
      variations: 'SIZES: 3.5in, Choose Background: Design 1, Enter Your Custom: Nora\nPreschool\n2026, Border Color: Red, Print Placement: Square',
      personalization: 'SIZES: 3.5in\nChoose Background: Design 1\nEnter Your Custom: Nora\nPreschool\n2026\nBorder Color: Red\nPrint Placement: Square',
    });
    const inputs = result.parsedData.amazonCustomization.customerInputs;
    expect(inputs.texts).toEqual([{ label: 'Enter Your Custom', name: 'Enter Your Custom', value: 'Nora\nPreschool\n2026' }]);
    expect(inputs.options.map(x => x.value)).toEqual(['3.5in', 'Design 1', 'Red', 'Square']);
  });
  test('preserves independent personalization and deduplicates exact copies', () => {
    const parse = personalization => normalizeEtsyCustomization({ variations: 'Personalization: Aiden/Alabama, Border Color: Red', personalization }).parsedData.amazonCustomization.customerInputs;
    expect(parse('Aiden/Alabama').texts).toHaveLength(1);
    expect(parse('Different message\nSecond line').texts).toHaveLength(2);
  });
  test('image expectations remain blocked until all verified Media assets arrive', () => {
    expect(normalizeEtsyCustomization({ provider: 'ETSY', expectedFileCount: 2 }).outcome).toBe('NEEDS_REVIEW');
    const result = normalizeEtsyCustomization({ provider: 'ETSY', variations: 'Photo: Uploaded', expectedFileCount: 1, mediaAssets: [{ mediaAssetId: 'asset', filename: 'photo.png', contentType: 'image/png' }] });
    expect(result.outcome).toBe('PARSED');
    expect(result.assets[0]).toMatchObject({ assetId: 'asset', status: 'DOWNLOADED', type: 'CUSTOMER_IMAGE' });
    expect(result.parsedData.amazonCustomization.customerInputs.images[0]).toMatchObject({ assetId: 'asset' });
  });
  test('parses Etsy variation text into customer inputs', () => {
    const result = normalizeEtsyCustomization({
      hasCustomization: true,
      variations: 'Quantity:Pack 30pcs,Sizes:4.8x4.8 INCHES,Custom Name::Erica,Event Date:04.07.2025,Ink Color:Gold,Type printing option:Square',
    });

    expect(result).toMatchObject({
      outcome: customizationStatuses.PARSED,
      assets: [],
      errorCode: null,
      errorMessage: null,
      parsedData: {
        amazonCustomization: {
          hasCustomization: true,
          customerInputs: {
            texts: [
              { label: 'Custom Name', name: 'Custom Name', value: 'Erica' },
              { label: 'Event Date', name: 'Event Date', value: '04.07.2025' },
            ],
            options: [
              { label: 'Quantity', name: 'Quantity', value: 'Pack 30pcs' },
              { label: 'Sizes', name: 'Sizes', value: '4.8x4.8 INCHES' },
              { label: 'Ink Color', name: 'Ink Color', value: 'Gold' },
              { label: 'Type printing option', name: 'Type printing option', value: 'Square' },
            ],
            images: [],
          },
        },
      },
    });
  });

  test('keeps Photo without URL in needs review but preserves parsed inputs', () => {
    const result = normalizeEtsyCustomization({
      hasCustomization: true,
      variations: 'Quantity:Pack 50pcs,Sizes:4.8x4.8 INCHES,Names:Darci,Photo:1 file',
    });

    expect(result.outcome).toBe(customizationStatuses.NEEDS_REVIEW);
    expect(result.errorCode).toBe(customizationErrorCodes.MANUAL_REVIEW_REQUIRED);
    expect(result.parsedData.amazonCustomization.customerInputs).toMatchObject({
      texts: [{ label: 'Names', name: 'Names', value: 'Darci' }],
      options: [
        { label: 'Quantity', name: 'Quantity', value: 'Pack 50pcs' },
        { label: 'Sizes', name: 'Sizes', value: '4.8x4.8 INCHES' },
      ],
      images: [{ label: 'Photo', name: 'Photo', value: '1 file' }],
    });
  });
});
