const service = require('./services/systemHealth.service');

module.exports = {
  getHealth: service.getHealth,
};
