jest.mock('../../../src/modules/catalog/repositories/productTypeGroup.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/repositories/internalTemplate.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findByCode: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
}));

const errorCodes = require('../../../src/shared/constants/errorCodes');
const groupRepository = require('../../../src/modules/catalog/repositories/productTypeGroup.repository');
const templateRepository = require('../../../src/modules/catalog/repositories/internalTemplate.repository');
const mediaPublic = require('../../../src/modules/media/public');
const service = require('../../../src/modules/catalog/services/catalog.service');

describe('catalog InternalTemplate service', () => {
  const groupId = '660000000000000000000301';
  const templateId = '660000000000000000000701';
  const mediaAssetId = '660000000000000000000901';

  beforeEach(() => {
    jest.clearAllMocks();
    groupRepository.findById.mockResolvedValue({ _id: groupId, code: 'NAPKIN', name: 'Napkin', status: 'ACTIVE' });
    mediaPublic.assertMediaAssetExists.mockResolvedValue({ _id: mediaAssetId });
    templateRepository.create.mockResolvedValue({
      _id: templateId,
      code: 'NAPKIN_MAIN',
      name: 'Napkin Main',
      productTypeGroupId: { _id: groupId, code: 'NAPKIN', name: 'Napkin', status: 'ACTIVE' },
      requiredFields: [{ key: 'customName', type: 'TEXT' }],
      artworkSlots: [{ key: 'front', type: 'TEXT', acceptedFieldKeys: ['customName'] }],
      designAssets: [{ type: 'PSD_TEMPLATE', mediaAssetId, status: 'ACTIVE' }],
      status: 'ACTIVE',
    });
  });

  test('createInternalTemplate validates group, field keys, slot keys, and media assets', async () => {
    const result = await service.createInternalTemplate({
      code: ' napkin_main ',
      name: 'Napkin Main',
      productTypeGroupId: groupId,
      requiredFields: [{ key: 'customName', type: 'TEXT', required: true }],
      artworkSlots: [{ key: 'front', type: 'TEXT', acceptedFieldKeys: ['customName'] }],
      designAssets: [{ type: 'PSD_TEMPLATE', mediaAssetId }],
    });

    expect(groupRepository.findById).toHaveBeenCalledWith(groupId);
    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(mediaAssetId);
    expect(templateRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      code: 'NAPKIN_MAIN',
      requiredFields: [{ key: 'customName', type: 'TEXT', required: true }],
    }));
    expect(result).toMatchObject({ id: templateId, code: 'NAPKIN_MAIN' });
  });

  test('createInternalTemplate rejects duplicate required field keys', async () => {
    await expect(service.createInternalTemplate({
      code: 'NAPKIN_MAIN',
      name: 'Napkin Main',
      productTypeGroupId: groupId,
      requiredFields: [{ key: 'customName' }, { key: 'customName' }],
    })).rejects.toMatchObject({ code: errorCodes.VALIDATION_ERROR, statusCode: 400 });
  });

  test('createInternalTemplate rejects accepted field keys missing from requiredFields', async () => {
    await expect(service.createInternalTemplate({
      code: 'NAPKIN_MAIN',
      name: 'Napkin Main',
      productTypeGroupId: groupId,
      requiredFields: [{ key: 'customName' }],
      artworkSlots: [{ key: 'front', acceptedFieldKeys: ['missingField'] }],
    })).rejects.toMatchObject({ code: errorCodes.VALIDATION_ERROR, statusCode: 400 });
  });

  test('inactive ProductTypeGroup cannot be used for template', async () => {
    groupRepository.findById.mockResolvedValue({ _id: groupId, status: 'INACTIVE' });

    await expect(service.createInternalTemplate({
      code: 'NAPKIN_MAIN',
      name: 'Napkin Main',
      productTypeGroupId: groupId,
    })).rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });
  });

  test('duplicate code maps to conflict', async () => {
    templateRepository.create.mockRejectedValue({ code: 11000 });

    await expect(service.createInternalTemplate({
      code: 'NAPKIN_MAIN',
      name: 'Napkin Main',
      productTypeGroupId: groupId,
    })).rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });
  });

  test('public lookups return active templates only', async () => {
    templateRepository.findByCode.mockResolvedValueOnce({ _id: templateId, status: 'INACTIVE' });
    templateRepository.findById.mockResolvedValueOnce({ _id: templateId, status: 'ACTIVE' });

    await expect(service.findInternalTemplateByCode(' napkin_main ')).resolves.toBeNull();
    await expect(service.getInternalTemplateById(templateId)).resolves.toMatchObject({ _id: templateId });
    expect(templateRepository.findByCode).toHaveBeenCalledWith('NAPKIN_MAIN');
  });

  test('PATCH cannot change code and replaces arrays deterministically', async () => {
    templateRepository.findById.mockResolvedValue({ _id: templateId, productTypeGroupId: groupId, status: 'ACTIVE' });
    templateRepository.update.mockResolvedValue({
      _id: templateId,
      code: 'NAPKIN_MAIN',
      name: 'Updated',
      productTypeGroupId: { _id: groupId, code: 'NAPKIN', name: 'Napkin', status: 'ACTIVE' },
      requiredFields: [{ key: 'customName', type: 'TEXT' }],
      artworkSlots: [],
      designAssets: [],
      status: 'ACTIVE',
    });

    await service.updateInternalTemplate(templateId, {
      code: 'OTHER',
      name: 'Updated',
      requiredFields: [{ key: 'customName', type: 'TEXT' }],
      artworkSlots: [],
      designAssets: [],
    });

    expect(templateRepository.update).toHaveBeenCalledWith(templateId, {
      name: 'Updated',
      requiredFields: [{ key: 'customName', type: 'TEXT' }],
      artworkSlots: [],
      designAssets: [],
    });
  });
});
