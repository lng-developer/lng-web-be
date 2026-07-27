const sqlAttendance = require('../public');

async function sync(req, res) {
  const result = await sqlAttendance.enqueueSync({ limit: req.body?.limit });
  res.status(202).json({ data: result });
}

async function status(_req, res) {
  res.json({ data: await sqlAttendance.getStatus() });
}

module.exports = { status, sync };
