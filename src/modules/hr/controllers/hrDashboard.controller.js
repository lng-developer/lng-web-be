const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/hrDashboard.service');

async function getDashboard(req, res) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  const dateKey = req.query.dateKey || `${parts.year}-${parts.month}-${parts.day}`;
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) {
    throw new AppError('dateKey must use YYYY-MM-DD', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  res.status(httpStatus.OK).json({ success: true, data: await service.getDashboard({ dateKey }) });
}

module.exports = { getDashboard };
