const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const { hrPermissions, hrTimePermissions } = require('../constants/hr.constants');
const employeeProfileController = require('../controllers/employeeProfile.controller');
const scheduleController = require('../controllers/schedule.controller');
const attendanceController = require('../controllers/attendance.controller');
const leaveController = require('../controllers/leave.controller');
const overtimeController = require('../controllers/overtime.controller');

const router = express.Router();

router.get(
  '/health',
  (_req, res) => res.json({ module: 'hr', status: 'ok' }),
);

const requireEmployeeRead = authPublic.authorizeAnyPermission(
  hrPermissions.EMPLOYEE_READ,
  hrPermissions.EMPLOYEE_WRITE,
);
const requireEmployeeWrite = authPublic.authorizeAnyPermission(hrPermissions.EMPLOYEE_WRITE);
const requireScheduleRead = authPublic.authorizeAnyPermission(
  hrTimePermissions.SCHEDULE_READ,
  hrTimePermissions.SCHEDULE_WRITE,
);
const requireScheduleWrite = authPublic.authorizeAnyPermission(hrTimePermissions.SCHEDULE_WRITE);
const requireGlobalScheduleWrite = authPublic.authorizeScopedPermission(
  hrTimePermissions.SCHEDULE_WRITE,
  { scopeType: 'global', scopeId: null },
);
const requireAttendanceRead = authPublic.authorizeAnyPermission(
  hrTimePermissions.ATTENDANCE_READ,
  hrTimePermissions.ATTENDANCE_MANAGE,
);
const requireAttendanceWrite = authPublic.authorizeAnyPermission(hrTimePermissions.ATTENDANCE_WRITE);
const requireAttendanceManage = authPublic.authorizeAnyPermission(hrTimePermissions.ATTENDANCE_MANAGE);
const requireLeaveRead = authPublic.authorizeAnyPermission(
  hrTimePermissions.LEAVE_READ,
  hrTimePermissions.LEAVE_APPROVE,
);
const requireLeaveWrite = authPublic.authorizeAnyPermission(hrTimePermissions.LEAVE_WRITE);
const requireLeaveApprove = authPublic.authorizeAnyPermission(hrTimePermissions.LEAVE_APPROVE);
const requireLeaveWriteOrApprove = authPublic.authorizeAnyPermission(
  hrTimePermissions.LEAVE_WRITE,
  hrTimePermissions.LEAVE_APPROVE,
);
const requireOvertimeRead = authPublic.authorizeAnyPermission(
  hrTimePermissions.OVERTIME_READ,
  hrTimePermissions.OVERTIME_APPROVE,
);
const requireOvertimeWrite = authPublic.authorizeAnyPermission(hrTimePermissions.OVERTIME_WRITE);
const requireOvertimeApprove = authPublic.authorizeAnyPermission(hrTimePermissions.OVERTIME_APPROVE);

router.get(
  '/employee-profiles',
  authPublic.authenticate,
  requireEmployeeRead,
  asyncHandler(employeeProfileController.listProfiles),
);
router.post(
  '/employee-profiles',
  authPublic.authenticate,
  requireEmployeeWrite,
  asyncHandler(employeeProfileController.createProfile),
);
router.get(
  '/employee-profiles/me',
  authPublic.authenticate,
  asyncHandler(employeeProfileController.getMyProfile),
);
router.patch(
  '/employee-profiles/:profileId/restore',
  authPublic.authenticate,
  requireEmployeeWrite,
  asyncHandler(employeeProfileController.restoreProfile),
);
router.get(
  '/employee-profiles/:profileId',
  authPublic.authenticate,
  requireEmployeeRead,
  asyncHandler(employeeProfileController.getProfile),
);
router.patch(
  '/employee-profiles/:profileId',
  authPublic.authenticate,
  requireEmployeeWrite,
  asyncHandler(employeeProfileController.updateProfile),
);
router.delete(
  '/employee-profiles/:profileId',
  authPublic.authenticate,
  requireEmployeeWrite,
  asyncHandler(employeeProfileController.deleteProfile),
);

router.get('/work-locations', authPublic.authenticate, requireScheduleRead, asyncHandler(scheduleController.listWorkLocations));
router.post('/work-locations', authPublic.authenticate, requireGlobalScheduleWrite, asyncHandler(scheduleController.createWorkLocation));
router.patch('/work-locations/:id', authPublic.authenticate, requireGlobalScheduleWrite, asyncHandler(scheduleController.updateWorkLocation));

router.get('/shifts', authPublic.authenticate, requireScheduleRead, asyncHandler(scheduleController.listShifts));
router.post('/shifts', authPublic.authenticate, requireGlobalScheduleWrite, asyncHandler(scheduleController.createShift));
router.patch('/shifts/:id', authPublic.authenticate, requireGlobalScheduleWrite, asyncHandler(scheduleController.updateShift));

router.get('/shift-assignments', authPublic.authenticate, requireScheduleRead, asyncHandler(scheduleController.listAssignments));
router.post('/shift-assignments', authPublic.authenticate, requireScheduleWrite, asyncHandler(scheduleController.createAssignment));
router.patch('/shift-assignments/:id', authPublic.authenticate, requireScheduleWrite, asyncHandler(scheduleController.updateAssignment));

router.get('/calendar-overrides', authPublic.authenticate, requireScheduleRead, asyncHandler(scheduleController.listCalendarOverrides));
router.post('/calendar-overrides', authPublic.authenticate, requireScheduleWrite, asyncHandler(scheduleController.createCalendarOverride));
router.patch('/calendar-overrides/:id', authPublic.authenticate, requireScheduleWrite, asyncHandler(scheduleController.updateCalendarOverride));

router.get('/attendance', authPublic.authenticate, requireAttendanceRead, asyncHandler(attendanceController.listAttendance));
router.get('/attendance/me', authPublic.authenticate, requireAttendanceWrite, asyncHandler(attendanceController.listMyAttendance));
router.post('/attendance/check-in', authPublic.authenticate, requireAttendanceWrite, asyncHandler(attendanceController.checkIn));
router.post('/attendance/check-out', authPublic.authenticate, requireAttendanceWrite, asyncHandler(attendanceController.checkOut));
router.patch('/attendance/:attendanceId', authPublic.authenticate, requireAttendanceManage, asyncHandler(attendanceController.adjustAttendance));

router.get('/leave-balances/me', authPublic.authenticate, requireLeaveWrite, asyncHandler(leaveController.getMyBalances));
router.get('/leave-balances/:profileId/:year/:leaveType', authPublic.authenticate, requireLeaveRead, asyncHandler(leaveController.getBalance));
router.put('/leave-balances/:profileId/:year/:leaveType', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.upsertBalance));

router.get('/leave-requests', authPublic.authenticate, requireLeaveRead, asyncHandler(leaveController.listRequests));
router.post('/leave-requests', authPublic.authenticate, requireLeaveWrite, asyncHandler(leaveController.createRequest));
router.get('/leave-requests/me', authPublic.authenticate, requireLeaveWrite, asyncHandler(leaveController.listMyRequests));
router.post('/leave-requests/:requestId/approve', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.approveRequest));
router.post('/leave-requests/:requestId/reject', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.rejectRequest));
router.post('/leave-requests/:requestId/cancel', authPublic.authenticate, requireLeaveWriteOrApprove, asyncHandler(leaveController.cancelRequest));

router.get('/overtime-requests', authPublic.authenticate, requireOvertimeRead, asyncHandler(overtimeController.listRequests));
router.post('/overtime-requests', authPublic.authenticate, requireOvertimeWrite, asyncHandler(overtimeController.createRequest));
router.get('/overtime-requests/me', authPublic.authenticate, requireOvertimeWrite, asyncHandler(overtimeController.listMyRequests));
router.post('/overtime-requests/:requestId/approve', authPublic.authenticate, requireOvertimeApprove, asyncHandler(overtimeController.approveRequest));
router.post('/overtime-requests/:requestId/reject', authPublic.authenticate, requireOvertimeApprove, asyncHandler(overtimeController.rejectRequest));
router.post('/overtime-requests/:requestId/cancel', authPublic.authenticate, requireOvertimeWrite, asyncHandler(overtimeController.cancelRequest));

module.exports = router;
