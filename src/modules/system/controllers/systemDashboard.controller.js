const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/systemDashboard.service');
const { toSystemDashboardDto } = require('../dtos/systemDashboard.dto');

async function getDashboard(req, res) {
  const readModel = await service.getDashboard(req.auth);
  res.status(httpStatus.OK).json({ success: true, data: toSystemDashboardDto(readModel) });
}

module.exports = { getDashboard };
