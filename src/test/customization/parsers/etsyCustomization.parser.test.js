const {
  normalizeEtsyCustomization,
} = require('../../../modules/customization/parsers/etsyCustomization.parser');
const { customizationStatuses } = require('../../../modules/customization/constants/customizationStatuses');
const { customizationErrorCodes } = require('../../../modules/customization/constants/customizationErrorCodes');

describe('etsyCustomization.parser', () => {
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
