const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/listingVariant.service');
const { createListingVariantSchema, updateListingVariantSchema } = require('../validators/listingVariant.validator');
const { assertValid } = require('./requestValidation');

const listListingVariants = async (req, res) => res.status(httpStatus.OK).json({ success: true, data: await service.listListingVariants(req.params.id, req.auth) });
const createListingVariant = async (req, res) => res.status(httpStatus.CREATED).json({ success: true, data: await service.createListingVariant(req.params.id, assertValid(createListingVariantSchema, req.body), req.auth) });
const updateListingVariant = async (req, res) => res.status(httpStatus.OK).json({ success: true, data: await service.updateListingVariant(req.params.id, req.params.variantId, assertValid(updateListingVariantSchema, req.body), req.auth) });
const setDefaultListingVariant = async (req, res) => res.status(httpStatus.OK).json({ success: true, data: await service.setDefaultListingVariant(req.params.id, req.params.variantId, req.auth) });
const requestListingVariantPsd = async (req, res) => res.status(httpStatus.CREATED).json({ success: true, data: await service.requestListingVariantPsd(req.params.id, req.params.variantId, req.auth) });

module.exports = { listListingVariants, createListingVariant, updateListingVariant, setDefaultListingVariant, requestListingVariantPsd };
