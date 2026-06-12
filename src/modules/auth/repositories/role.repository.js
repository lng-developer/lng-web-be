const Role = require('../models/role.model');

async function findByCode(code) {
  return Role.findOne({ code: code.toUpperCase() }).lean();
}

module.exports = {
  findByCode,
};
