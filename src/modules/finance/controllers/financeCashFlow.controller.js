const httpStatus = require('../../../shared/constants/httpStatus');
const cashFlowService = require('../services/financeCashFlow.service');
const { listCashFlowQuerySchema } = require('../validators/financeCashFlow.validator');
const { assertValid } = require('./requestValidation');

async function list(req, res) {
  const query = assertValid(listCashFlowQuerySchema, req.query);
  const data = await cashFlowService.getCashFlow(query, {
    ...req.auth,
    source: 'HTTP',
    auditContext: { requestId: req.id || null, ipAddress: req.ip || null, userAgent: req.get('user-agent') || null },
  });
  res.status(httpStatus.OK).json({ success: true, data });
}

module.exports = { list };
