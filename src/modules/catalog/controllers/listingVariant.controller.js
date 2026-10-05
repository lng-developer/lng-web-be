const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/listingVariant.service');
const {
  applyListingVariantPsdSchema,
  createListingVariantSchema,
  updateListingVariantSchema,
} = require('../validators/listingVariant.validator');
const { assertValid } = require('./requestValidation');

const listListingVariants = async (req, res) => res.status(httpStatus.OK).json({ success: true, data: await service.listListingVariants(req.params.id, req.auth) });
const createListingVariant = async (req, res) => res.status(httpStatus.CREATED).json({ success: true, data: await service.createListingVariant(req.params.id, assertValid(createListingVariantSchema, req.body), req.auth) });
const updateListingVariant = async (req, res) => res.status(httpStatus.OK).json({ success: true, data: await service.updateListingVariant(req.params.id, req.params.variantId, assertValid(updateListingVariantSchema, req.body), req.auth) });
async function requestListingVariantPsd(req, res) {
  const result = await service.requestListingVariantPsd(req.params.id, req.params.variantId, req.auth);
  res.status(result.created ? httpStatus.CREATED : httpStatus.OK).json({
    success: true,
    data: result.task,
  });
}
const applyListingVariantPsdToCompatible = async (req, res) => res.status(httpStatus.OK).json({
  success: true,
  data: await service.applyListingVariantPsdToCompatible(
    req.params.id,
    req.params.variantId,
    assertValid(applyListingVariantPsdSchema, req.body),
    req.auth,
  ),
});

module.exports = {
  applyListingVariantPsdToCompatible,
  listListingVariants,
  createListingVariant,
  updateListingVariant,
  requestListingVariantPsd,
};
