const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const shopService = require('../services/shop.service');
const {
  listShopsQuerySchema,
  createShopSchema,
  updateShopStatusSchema,
  validate,
} = require('../validators/shop.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
}

async function listShops(req, res) {
  const query = assertValid(listShopsQuerySchema, req.query);
  const result = await shopService.listShops(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createShop(req, res) {
  const payload = assertValid(createShopSchema, req.body);
  const result = await shopService.createShop(payload);

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getShop(req, res) {
  const result = await shopService.getShop(req.params.shopId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateShopStatus(req, res) {
  const payload = assertValid(updateShopStatusSchema, req.body);
  const result = await shopService.updateShopStatus(req.params.shopId, payload.status);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

module.exports = {
  listShops,
  createShop,
  getShop,
  updateShopStatus,
};
