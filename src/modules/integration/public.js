const externalOrderImport = require('./externalOrderImport/public');
const sqlAttendance = require('./sqlAttendance/public');

const publicPort = {
  externalOrderImport,
  sqlAttendance,
};

module.exports = publicPort;
