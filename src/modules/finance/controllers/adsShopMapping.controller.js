const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/adsShopMapping.service');
const { toAdsShopMappingDto } = require('../dtos/adsShopMapping.dto');
const { adsShopMappingSchema, listAdsShopMappingsQuerySchema } = require('../validators/financeSnapshot.validator');
const { assertValid } = require('./requestValidation');

async function list(req, res) {
  const query = assertValid(listAdsShopMappingsQuerySchema, req.query);
  const mappings = await service.listAdsShopMappings(query, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: mappings.map(toAdsShopMappingDto) });
}

async function upsert(req, res) {
  const input = assertValid(adsShopMappingSchema, req.body);
  const mapping = await service.upsertAdsShopMapping(input, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: toAdsShopMappingDto(mapping) });
}

module.exports = { list, upsert };
