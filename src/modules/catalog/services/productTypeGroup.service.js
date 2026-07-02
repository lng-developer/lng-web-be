const { assertValidObjectId } = require('../../../shared/utils/objectId');
const productTypeGroupRepository = require('../repositories/productTypeGroup.repository');
const { recordStatuses } = require('../constants/catalog.constants');
const { toProductTypeGroupDto, toPaginatedResponse } = require('../dtos/catalog.dto');
const { conflict, mapDuplicate, notFound } = require('./catalogError.helpers');

async function assertProductTypeGroupActive(productTypeGroupId) {
  assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
  const group = await productTypeGroupRepository.findById(productTypeGroupId);
  if (!group) throw notFound('Product type group not found');
  if (group.status !== recordStatuses.ACTIVE) throw conflict('Product type group is not active');
  return group;
}

async function listProductTypeGroups(query = {}) {
  const result = await productTypeGroupRepository.list(query);
  return toPaginatedResponse(result, toProductTypeGroupDto);
}

async function createProductTypeGroup(payload) {
  try {
    return toProductTypeGroupDto(await productTypeGroupRepository.create(payload));
  } catch (error) {
    await mapDuplicate(error, 'Product type group code already exists');
  }
}

async function updateProductTypeGroup(groupId, patch) {
  assertValidObjectId(groupId, 'productTypeGroupId');
  try {
    const group = await productTypeGroupRepository.update(groupId, patch);
    if (!group) throw notFound('Product type group not found');
    return toProductTypeGroupDto(group);
  } catch (error) {
    await mapDuplicate(error, 'Product type group code already exists');
  }
}

async function getProductTypeGroupById(groupId) {
  assertValidObjectId(groupId, 'productTypeGroupId');
  const group = await productTypeGroupRepository.findById(groupId);
  if (!group) throw notFound('Product type group not found');
  return group;
}

module.exports = {
  assertProductTypeGroupActive,
  listProductTypeGroups,
  createProductTypeGroup,
  updateProductTypeGroup,
  getProductTypeGroupById,
};
