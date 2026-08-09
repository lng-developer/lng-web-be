const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/hrDashboard.service');
const { toHrDashboardDto } = require('../dtos/hrDashboard.dto');

async function getDashboard(req, res) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  const dateKey = req.query.dateKey || `${parts.year}-${parts.month}-${parts.day}`;
  const days = req.query.days === undefined ? undefined : Number(req.query.days);
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) {
    throw new AppError('dateKey must use YYYY-MM-DD', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  if (days !== undefined && ![1, 7, 30].includes(days)) {
    throw new AppError('days must be 1, 7, or 30', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  const readModel = await service.getDashboard({ dateKey, ...(days ? { days } : {}) });
  res.status(httpStatus.OK).json({ success: true, data: toHrDashboardDto(readModel) });
}

module.exports = { getDashboard };
