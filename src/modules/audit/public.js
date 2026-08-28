const service = require('./services/auditEvent.service');

const publicPort = { record: service.record, listEvents: service.listEvents };

module.exports = publicPort;
