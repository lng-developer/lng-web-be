const leaderHrPermissions = Object.freeze([
  'HR_EMPLOYEES:READ',
  'HR_SCHEDULE:READ',
  'HR_ATTENDANCE:READ',
  'HR_LEAVE:READ',
  'HR_LEAVE:APPROVE',
  'HR_OVERTIME:READ',
  'HR_OVERTIME:APPROVE',
  'HR_CALENDAR:READ',
  'HR_SATURDAY_ROTATION:WRITE',
]);

const leaderRoleName = 'Team Leader (HR)';

module.exports = { leaderHrPermissions, leaderRoleName };
