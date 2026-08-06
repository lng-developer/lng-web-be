const router = require('./routes');
const publicPort = require('./public');
const express = require('express');
const sqlAttendanceRouter = require('./sqlAttendance/routes');

const hrRouter = express.Router();
sqlAttendanceRouter.apiContractMountPath = '/sql-attendance';
hrRouter.use('/sql-attendance', sqlAttendanceRouter);

module.exports = {
  router,
  publicPort,
  hrRouter,
};
