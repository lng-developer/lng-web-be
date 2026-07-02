const internalTemplateFieldTypes = Object.freeze({
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  OPTION: 'OPTION',
  FILE: 'FILE',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  UNKNOWN: 'UNKNOWN',
});

const internalTemplateFieldSources = Object.freeze({
  CUSTOMER_INPUT: 'CUSTOMER_INPUT',
  AMAZON_CUSTOMIZATION: 'AMAZON_CUSTOMIZATION',
  MANUAL: 'MANUAL',
  SYSTEM: 'SYSTEM',
});

const artworkSlotTypes = Object.freeze({
  IMAGE: 'IMAGE',
  TEXT: 'TEXT',
  VECTOR: 'VECTOR',
  PDF: 'PDF',
  MIXED: 'MIXED',
});

const artworkOutputRoles = Object.freeze({
  FRONT: 'FRONT',
  BACK: 'BACK',
  LEFT_SLEEVE: 'LEFT_SLEEVE',
  RIGHT_SLEEVE: 'RIGHT_SLEEVE',
  MOCKUP: 'MOCKUP',
  PREVIEW: 'PREVIEW',
  OTHER: 'OTHER',
});

const designAssetTypes = Object.freeze({
  PSD_TEMPLATE: 'PSD_TEMPLATE',
  PREVIEW_IMAGE: 'PREVIEW_IMAGE',
  MASK_FILE: 'MASK_FILE',
  SVG_TEMPLATE: 'SVG_TEMPLATE',
  SAMPLE_OUTPUT: 'SAMPLE_OUTPUT',
  OTHER: 'OTHER',
});

module.exports = {
  internalTemplateFieldTypes,
  internalTemplateFieldSources,
  artworkSlotTypes,
  artworkOutputRoles,
  designAssetTypes,
};
