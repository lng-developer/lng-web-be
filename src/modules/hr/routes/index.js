const express = require('express');
const multer = require('multer');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const { hrPermissions, hrTimePermissions } = require('../constants/hr.constants');
const employeeProfileController = require('../controllers/employeeProfile.controller');
const staffProvisioningController = require('../controllers/staffProvisioning.controller');
const scheduleController = require('../controllers/schedule.controller');
const attendanceController = require('../controllers/attendance.controller');
const leaveController = require('../controllers/leave.controller');
const overtimeController = require('../controllers/overtime.controller');
const calendarPolicyController = require('../controllers/calendarPolicy.controller');
const payrollController = require('../controllers/payroll.controller');
const payrollAdjustmentController = require('../controllers/payrollAdjustment.controller');
const announcementController = require('../controllers/announcement.controller');
const hrDashboardController = require('../controllers/hrDashboard.controller');
const workspaceController = require('../controllers/workspace.controller');

const router = express.Router();
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

router.get(
  '/health',
  (_req, res) => res.json({ module: 'hr', status: 'ok' }),
);

const requireEmployeeRead = authPublic.authorizeAnyGlobalPermission(
  hrPermissions.EMPLOYEE_READ,
  hrPermissions.EMPLOYEE_WRITE,
);
const requireEmployeeDirectoryRead = authPublic.authorizeAnyGlobalPermission(
  hrPermissions.EMPLOYEE_READ,
  hrPermissions.EMPLOYEE_WRITE,
  hrPermissions.CALENDAR_READ,
  hrPermissions.CALENDAR_WRITE,
  hrTimePermissions.SCHEDULE_READ,
  hrTimePermissions.SCHEDULE_WRITE,
  hrTimePermissions.ATTENDANCE_READ,
  hrTimePermissions.ATTENDANCE_MANAGE,
);
const requireEmployeeWrite = authPublic.authorizeAnyGlobalPermission(hrPermissions.EMPLOYEE_WRITE);
const requireScheduleRead = authPublic.authorizeAnyGlobalPermission(
  hrTimePermissions.SCHEDULE_READ,
  hrTimePermissions.SCHEDULE_WRITE,
);
const requireScheduleWrite = authPublic.authorizeAnyGlobalPermission(hrTimePermissions.SCHEDULE_WRITE);
const requireCalendarRead = authPublic.authorizeAnyGlobalPermission(
  hrPermissions.CALENDAR_READ,
  hrPermissions.CALENDAR_WRITE,
);
const requireCalendarWrite = authPublic.authorizeAnyGlobalPermission(hrPermissions.CALENDAR_WRITE);
const requireRotationRead = authPublic.authorizeAnyPermission(
  hrPermissions.CALENDAR_READ,
  hrPermissions.CALENDAR_WRITE,
);
const requireRotationWrite = authPublic.authorizeAnyPermission(hrPermissions.CALENDAR_WRITE);
const requireGlobalScheduleWrite = authPublic.authorizeScopedPermission(
  hrTimePermissions.SCHEDULE_WRITE,
  { scopeType: 'global', scopeId: null },
);
const requireAttendanceRead = authPublic.authorizeAnyPermission(
  hrTimePermissions.ATTENDANCE_READ,
  hrTimePermissions.ATTENDANCE_MANAGE,
);
const requireAttendanceWrite = authPublic.authorizeAnyGlobalPermission(hrTimePermissions.ATTENDANCE_WRITE);
const requireAttendanceManage = authPublic.authorizeAnyGlobalPermission(hrTimePermissions.ATTENDANCE_MANAGE);
const requireLeaveRead = authPublic.authorizeAnyPermission(
  hrTimePermissions.LEAVE_READ,
  hrTimePermissions.LEAVE_APPROVE,
);
const requireLeaveWrite = authPublic.authorizeAnyGlobalPermission(hrTimePermissions.LEAVE_WRITE);
const requireLeaveApprove = authPublic.authorizeAnyGlobalPermission(hrTimePermissions.LEAVE_APPROVE);
const requireLeaveDecision = authPublic.authorizeAnyPermission(hrTimePermissions.LEAVE_APPROVE);
const requireLeaveWriteOrApprove = authPublic.authorizeAnyGlobalPermission(
  hrTimePermissions.LEAVE_WRITE,
  hrTimePermissions.LEAVE_APPROVE,
);
const requireOvertimeRead = authPublic.authorizeAnyPermission(
  hrTimePermissions.OVERTIME_READ,
  hrTimePermissions.OVERTIME_APPROVE,
);
const requireOvertimeWrite = authPublic.authorizeAnyGlobalPermission(hrTimePermissions.OVERTIME_WRITE);
const requireOvertimeApprove = authPublic.authorizeAnyPermission(hrTimePermissions.OVERTIME_APPROVE);
const requirePayrollRead = authPublic.authorizeAnyGlobalPermission(hrPermissions.PAYROLL_READ);
const requirePayrollWrite = authPublic.authorizeAnyGlobalPermission(hrPermissions.PAYROLL_WRITE);
const requirePayrollFinalize = authPublic.authorizeAnyGlobalPermission(hrPermissions.PAYROLL_FINALIZE);
const requirePayrollPay = authPublic.authorizeAnyGlobalPermission(hrPermissions.PAYROLL_PAY);
const requireAnnouncementRead = authPublic.authorizeAnyGlobalPermission(
  hrPermissions.ANNOUNCEMENTS_READ,
  hrPermissions.ANNOUNCEMENTS_WRITE,
);
const requireAnnouncementWrite = authPublic.authorizeAnyGlobalPermission(hrPermissions.ANNOUNCEMENTS_WRITE);
const requireTeamWorkspace = authPublic.authorizeAnyPermission(
  hrTimePermissions.SCHEDULE_READ,
  hrTimePermissions.SCHEDULE_WRITE,
  hrTimePermissions.ATTENDANCE_READ,
  hrTimePermissions.ATTENDANCE_MANAGE,
  hrTimePermissions.LEAVE_READ,
  hrTimePermissions.LEAVE_APPROVE,
  hrTimePermissions.OVERTIME_READ,
  hrTimePermissions.OVERTIME_APPROVE,
);

router.get('/workspace/me', authPublic.authenticate, asyncHandler(workspaceController.getMyWorkspace));
router.get('/workspace/team', authPublic.authenticate, requireTeamWorkspace, asyncHandler(workspaceController.getTeamWorkspace));

router.get(
  '/employee-profiles',
  authPublic.authenticate,
  requireEmployeeDirectoryRead,
  asyncHandler(employeeProfileController.listProfiles),
);
router.post(
  '/staff-provisioning',
  authPublic.authenticate,
  requireEmployeeWrite,
  asyncHandler(staffProvisioningController.provisionStaff),
);
router.get(
  '/staff-provisioning/roles',
  authPublic.authenticate,
  requireEmployeeWrite,
  asyncHandler(staffProvisioningController.listAssignableRoles),
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
  '/employee-profiles/me/personal',
  authPublic.authenticate,
  asyncHandler(employeeProfileController.updateMyPersonalProfile),
);
router.patch(
  '/employee-profiles/:profileId/restore',
  authPublic.authenticate,
  requireEmployeeWrite,
  asyncHandler(employeeProfileController.restoreProfile),
);
router.get(
  '/employee-profiles/me/avatar',
  authPublic.authenticate,
  asyncHandler(employeeProfileController.getMyProfileAvatar),
);
router.get(
  '/employee-profiles/:profileId/avatar',
  authPublic.authenticate,
  requireEmployeeRead,
  asyncHandler(employeeProfileController.getProfileAvatar),
);
router.post(
  '/employee-profiles/me/avatar',
  authPublic.authenticate,
  avatarUpload.single('file'),
  asyncHandler(employeeProfileController.uploadMyProfileAvatar),
);
router.post(
  '/employee-profiles/:profileId/avatar',
  authPublic.authenticate,
  requireEmployeeWrite,
  avatarUpload.single('file'),
  asyncHandler(employeeProfileController.uploadProfileAvatar),
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

router.get('/holidays/templates', authPublic.authenticate, requireCalendarRead, asyncHandler(calendarPolicyController.listHolidayTemplates));
router.get('/holidays/range', authPublic.authenticate, requireCalendarRead, asyncHandler(calendarPolicyController.listHolidayRange));
router.get('/holidays/check', authPublic.authenticate, requireCalendarRead, asyncHandler(calendarPolicyController.checkHoliday));
router.get('/holidays/summary/:year', authPublic.authenticate, requireCalendarRead, asyncHandler(calendarPolicyController.summarizeHolidays));
router.get('/holidays', authPublic.authenticate, requireCalendarRead, asyncHandler(calendarPolicyController.listHolidays));
router.get('/holidays/:id', authPublic.authenticate, requireCalendarRead, asyncHandler(calendarPolicyController.getHoliday));
router.post('/holidays/bulk-import', authPublic.authenticate, requireCalendarWrite, asyncHandler(calendarPolicyController.bulkImportHolidays));
router.post('/holidays', authPublic.authenticate, requireCalendarWrite, asyncHandler(calendarPolicyController.createHoliday));
router.patch('/holidays/:id', authPublic.authenticate, requireCalendarWrite, asyncHandler(calendarPolicyController.updateHoliday));
router.delete('/holidays/:id', authPublic.authenticate, requireCalendarWrite, asyncHandler(calendarPolicyController.deleteHoliday));

router.get('/saturday-rotations', authPublic.authenticate, requireRotationRead, asyncHandler(calendarPolicyController.listRotations));
router.get('/saturday-rotations/matrix', authPublic.authenticate, requireRotationRead, asyncHandler(calendarPolicyController.listRotationMatrix));
router.post('/saturday-rotations', authPublic.authenticate, requireRotationWrite, asyncHandler(calendarPolicyController.createRotation));
router.post('/saturday-rotations/generate', authPublic.authenticate, requireRotationWrite, asyncHandler(calendarPolicyController.generateRotations));
router.patch('/saturday-rotations/:id', authPublic.authenticate, requireRotationWrite, asyncHandler(calendarPolicyController.updateRotation));
router.delete('/saturday-rotations/team/:teamId', authPublic.authenticate, requireRotationWrite, asyncHandler(calendarPolicyController.deleteTeamRotations));
router.delete('/saturday-rotations/:id', authPublic.authenticate, requireRotationWrite, asyncHandler(calendarPolicyController.deleteRotation));

router.get('/attendance', authPublic.authenticate, requireAttendanceRead, asyncHandler(attendanceController.listAttendance));
router.get('/attendance/month-matrix', authPublic.authenticate, requireAttendanceRead, asyncHandler(attendanceController.listMonthMatrix));
router.get('/attendance/me', authPublic.authenticate, asyncHandler(attendanceController.listMyAttendance));
router.post('/attendance/check-in', authPublic.authenticate, requireAttendanceWrite, asyncHandler(attendanceController.checkIn));
router.post('/attendance/check-out', authPublic.authenticate, requireAttendanceWrite, asyncHandler(attendanceController.checkOut));
router.patch('/attendance/:attendanceId', authPublic.authenticate, requireAttendanceManage, asyncHandler(attendanceController.adjustAttendance));

router.get('/leave-balances/me', authPublic.authenticate, asyncHandler(leaveController.getMyBalances));
router.get('/leave-balances/:profileId/:year/:leaveType', authPublic.authenticate, requireLeaveRead, asyncHandler(leaveController.getBalance));
router.put('/leave-balances/:profileId/:year/:leaveType', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.upsertBalance));
router.patch('/leave-balances/:profileId/:year/:leaveType/adjust', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.adjustBalance));
router.post('/leave-balances/accrue', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.accrueBalances));
router.post('/leave-balances/reset', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.resetBalances));
router.post('/leave-balances/carry-over', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.carryOverBalances));

router.get('/leave-requests', authPublic.authenticate, requireLeaveRead, asyncHandler(leaveController.listRequests));
router.post('/leave-requests', authPublic.authenticate, requireLeaveWrite, asyncHandler(leaveController.createRequest));
router.patch('/leave-requests/:requestId', authPublic.authenticate, requireLeaveWrite, asyncHandler(leaveController.updateRequest));
router.post('/leave-requests/preview', authPublic.authenticate, requireLeaveWrite, asyncHandler(leaveController.previewRequest));
router.get('/leave-requests/me', authPublic.authenticate, asyncHandler(leaveController.listMyRequests));
router.post('/leave-requests/:requestId/approve', authPublic.authenticate, requireLeaveDecision, asyncHandler(leaveController.approveRequest));
router.post('/leave-requests/:requestId/reject', authPublic.authenticate, requireLeaveDecision, asyncHandler(leaveController.rejectRequest));
router.post('/leave-requests/:requestId/refund', authPublic.authenticate, requireLeaveApprove, asyncHandler(leaveController.refundRequest));
router.post('/leave-requests/:requestId/cancel', authPublic.authenticate, requireLeaveWriteOrApprove, asyncHandler(leaveController.cancelRequest));
router.post('/leave-requests/:requestId/attachments', authPublic.authenticate, requireLeaveWrite, asyncHandler(leaveController.attachReferences));

router.get('/overtime-requests', authPublic.authenticate, requireOvertimeRead, asyncHandler(overtimeController.listRequests));
router.post('/overtime-requests', authPublic.authenticate, requireOvertimeWrite, asyncHandler(overtimeController.createRequest));
router.patch('/overtime-requests/:requestId', authPublic.authenticate, requireOvertimeWrite, asyncHandler(overtimeController.updateRequest));
router.get('/overtime-requests/me', authPublic.authenticate, asyncHandler(overtimeController.listMyRequests));
router.post('/overtime-requests/:requestId/approve', authPublic.authenticate, requireOvertimeApprove, asyncHandler(overtimeController.approveRequest));
router.post('/overtime-requests/:requestId/reject', authPublic.authenticate, requireOvertimeApprove, asyncHandler(overtimeController.rejectRequest));
router.post('/overtime-requests/:requestId/cancel', authPublic.authenticate, requireOvertimeWrite, asyncHandler(overtimeController.cancelRequest));

router.get('/payrolls', authPublic.authenticate, requirePayrollRead, asyncHandler(payrollController.listPayrolls));
router.post('/payrolls/run', authPublic.authenticate, requirePayrollWrite, asyncHandler(payrollController.runPayroll));
router.get('/payrolls/me', authPublic.authenticate, asyncHandler(payrollController.listMyPayrolls));
router.get('/payrolls/results', authPublic.authenticate, requirePayrollRead, asyncHandler(payrollController.listPayrollResults));
router.get('/payrolls/results/export', authPublic.authenticate, requirePayrollRead, asyncHandler(payrollController.exportPayrollResults));
router.get('/payrolls/results/:resultId', authPublic.authenticate, requirePayrollRead, asyncHandler(payrollController.getPayrollResult));
router.get('/payrolls/:id', authPublic.authenticate, requirePayrollRead, asyncHandler(payrollController.getPayroll));
router.post('/payrolls/:id/finalize', authPublic.authenticate, requirePayrollFinalize, asyncHandler(payrollController.finalizePayroll));
router.post('/payrolls/:id/mark-paid', authPublic.authenticate, requirePayrollPay, asyncHandler(payrollController.markPayrollPaid));
router.post('/payrolls/:id/email', authPublic.authenticate, requirePayrollWrite, asyncHandler(payrollController.emailPayroll));
router.get('/payroll-settings', authPublic.authenticate, requirePayrollRead, asyncHandler(payrollController.getPayrollSettings));
router.put('/payroll-settings', authPublic.authenticate, requirePayrollWrite, asyncHandler(payrollController.updatePayrollSettings));

router.get('/payroll-adjustments', authPublic.authenticate, requirePayrollRead, asyncHandler(payrollAdjustmentController.listAdjustments));
router.post('/payroll-adjustments/bulk', authPublic.authenticate, requirePayrollWrite, asyncHandler(payrollAdjustmentController.createBulkAdjustment));
router.post('/payroll-adjustments', authPublic.authenticate, requirePayrollWrite, asyncHandler(payrollAdjustmentController.createAdjustment));
router.patch('/payroll-adjustments/:id', authPublic.authenticate, requirePayrollWrite, asyncHandler(payrollAdjustmentController.updateAdjustment));
router.delete('/payroll-adjustments/:id', authPublic.authenticate, requirePayrollWrite, asyncHandler(payrollAdjustmentController.cancelAdjustment));

router.get('/announcements', authPublic.authenticate, requireAnnouncementRead, asyncHandler(announcementController.listAnnouncements));
router.post('/announcements', authPublic.authenticate, requireAnnouncementWrite, asyncHandler(announcementController.createAnnouncement));
router.get('/announcements/:id', authPublic.authenticate, requireAnnouncementRead, asyncHandler(announcementController.getAnnouncement));
router.patch('/announcements/:id', authPublic.authenticate, requireAnnouncementWrite, asyncHandler(announcementController.updateAnnouncement));
router.delete('/announcements/:id', authPublic.authenticate, requireAnnouncementWrite, asyncHandler(announcementController.deleteAnnouncement));

router.get('/dashboard', authPublic.authenticate, requireEmployeeRead, asyncHandler(hrDashboardController.getDashboard));

module.exports = router;
