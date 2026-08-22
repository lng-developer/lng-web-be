const externalOrderImport = require('./externalOrderImport/public');
const extensionCommand = require('./extensionCommand/public');
const sqlAttendance = require('./sqlAttendance/public');

const publicPort = {
  externalOrderImport,
  extensionCommand,
  sqlAttendance,
};

module.exports = publicPort;
