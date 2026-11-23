const mongoose = require('mongoose');

const schema = new mongoose.Schema({ _id: String, revision: Number, cursor: String });
module.exports = mongoose.model('FinanceRecalculationGuard', schema);
