const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/financeImport.service');
const { toAdsUnassignedRowDto } = require('../dtos/adsUnassignedRow.dto');
const { listAdsUnassignedRowsQuerySchema } = require('../validators/financeSnapshot.validator');
const { assertValid } = require('./requestValidation');

async function list(req, res) {
  const query = assertValid(listAdsUnassignedRowsQuerySchema, req.query);
  const result = await service.listAdsUnassignedRows(query, req.auth);
  res.status(httpStatus.OK).json({
    success: true,
    data: { ...result, items: result.items.map(toAdsUnassignedRowDto) },
  });
}

module.exports = { list };
