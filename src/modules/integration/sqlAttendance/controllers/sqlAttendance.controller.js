const sqlAttendance = require('../public');

async function sync(req, res) {
  const result = await sqlAttendance.enqueueSync({ limit: req.body?.limit });
  res.status(202).json({ success: true, data: result });
}

async function status(_req, res) {
  res.json({ success: true, data: await sqlAttendance.getStatus() });
}

module.exports = { status, sync };
