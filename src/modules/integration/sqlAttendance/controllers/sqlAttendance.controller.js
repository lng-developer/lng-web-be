const sqlAttendance = require('../public');

async function sync(req, res) {
  if (req.body?.immediate) {
    const result = await sqlAttendance.syncPage({ limit: req.body?.limit });
    return res.status(200).json({ success: true, data: result });
  }
  const result = await sqlAttendance.enqueueSync({ limit: req.body?.limit });
  return res.status(202).json({ success: true, data: result });
}

async function status(_req, res) {
  res.json({ success: true, data: await sqlAttendance.getStatus() });
}

module.exports = { status, sync };
