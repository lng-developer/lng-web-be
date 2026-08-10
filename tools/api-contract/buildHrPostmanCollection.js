const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { buildRouteInventory } = require('./routeInventory');

const outputPath = path.resolve(__dirname, '../../docs/api/postman/hr.postman_collection.json');
const oid = (name) => `{{${name}}}`;

const variables = [
  ['baseUrl', 'http://localhost:3000'], ['accessToken', ''],
  ['profileId', '64b000000000000000000001'], ['accountId', '64b000000000000000000002'],
  ['departmentId', '64b000000000000000000003'], ['teamId', '64b000000000000000000004'],
  ['workLocationId', '64b000000000000000000005'], ['shiftId', '64b000000000000000000006'],
  ['assignmentId', '64b000000000000000000007'], ['calendarOverrideId', '64b000000000000000000008'],
  ['holidayId', '64b000000000000000000009'], ['rotationId', '64b00000000000000000000a'],
  ['attendanceId', '64b00000000000000000000b'], ['leaveRequestId', '64b00000000000000000000c'],
  ['overtimeRequestId', '64b00000000000000000000d'], ['payrollId', '64b00000000000000000000e'],
  ['payrollResultId', '64b00000000000000000000f'], ['adjustmentId', '64b000000000000000000010'],
  ['announcementId', '64b000000000000000000011'], ['roleId', '64b000000000000000000012'],
  ['id', '64b000000000000000000013'], ['requestId', '64b000000000000000000014'],
  ['resultId', '64b000000000000000000015'], ['year', '2026'], ['leaveType', 'ANNUAL'],
];

const pathVariables = {
  profileId: oid('profileId'), id: null, teamId: oid('teamId'), attendanceId: oid('attendanceId'),
  requestId: null, resultId: oid('payrollResultId'), year: '2026', leaveType: 'ANNUAL',
};

const bodyByRoute = {
  'POST /api/hr/staff-provisioning': { employeeCode: 'LNG001', workEmail: 'staff@example.com', fullName: 'Nguyen Van A', departmentId: oid('departmentId'), teamId: oid('teamId'), employmentType: 'FULL_TIME', workMode: 'ONSITE', assignments: [{ roleId: oid('roleId'), scopeType: 'department', scopeId: oid('departmentId'), customPermissionIds: [], overridePermissionIds: null }] },
  'POST /api/hr/employee-profiles': { accountId: oid('accountId'), employeeCode: 'LNG001', fullName: 'Nguyen Van A', employmentType: 'FULL_TIME', workMode: 'ONSITE' },
  'PATCH /api/hr/employee-profiles/me/personal': { phoneNumber: '0901234567', address: 'Ho Chi Minh City', personalEmail: 'staff.personal@example.com', emergencyContact: { name: 'Nguyen Van B', phone: '0907654321', relation: 'Family' } },
  'PATCH /api/hr/employee-profiles/:profileId': { jobTitle: 'Designer', departmentId: oid('departmentId'), teamId: oid('teamId') },
  'POST /api/hr/work-locations': { code: 'HCM', name: 'Ho Chi Minh Office', timezone: 'Asia/Ho_Chi_Minh' },
  'PATCH /api/hr/work-locations/:id': { name: 'Ho Chi Minh Office', status: 'ACTIVE' },
  'POST /api/hr/shifts': { code: 'DAY', name: 'Day shift', startTime: '08:00', endTime: '17:00', breakMinutes: 60, workdays: [1, 2, 3, 4, 5] },
  'PATCH /api/hr/shifts/:id': { name: 'Day shift', graceMinutes: 10 },
  'POST /api/hr/shift-assignments': { profileId: oid('profileId'), shiftId: oid('shiftId'), workLocationId: oid('workLocationId'), effectiveFrom: '2026-08-01' },
  'PATCH /api/hr/shift-assignments/:id': { effectiveTo: '2026-12-31' },
  'POST /api/hr/calendar-overrides': { dateKey: '2026-09-02', kind: 'DAY_OFF', scopeType: 'GLOBAL', scopeId: null, name: 'National Day' },
  'PATCH /api/hr/calendar-overrides/:id': { name: 'Updated calendar override' },
  'POST /api/hr/holidays': { dateKey: '2026-09-02', name: 'National Day', holidayType: 'PUBLIC_HOLIDAY', isWorkDay: false },
  'PATCH /api/hr/holidays/:id': { name: 'Updated holiday' },
  'POST /api/hr/holidays/bulk-import': { items: [{ dateKey: '2026-09-02', name: 'National Day', holidayType: 'PUBLIC_HOLIDAY', isWorkDay: false }] },
  'POST /api/hr/saturday-rotations': { teamId: oid('teamId'), dateKey: '2026-08-08', employeeProfileIds: [oid('profileId')] },
  'POST /api/hr/saturday-rotations/generate': { teamId: oid('teamId'), year: 2026, month: 8 },
  'PATCH /api/hr/saturday-rotations/:id': { employeeProfileIds: [oid('profileId')] },
  'POST /api/hr/attendance/check-in': { occurredAt: '2026-08-06T01:00:00.000Z' },
  'POST /api/hr/attendance/check-out': { occurredAt: '2026-08-06T10:00:00.000Z' },
  'PATCH /api/hr/attendance/:attendanceId': { checkInAt: '2026-08-06T01:00:00.000Z', reason: 'Correct imported time' },
  'PUT /api/hr/leave-balances/:profileId/:year/:leaveType': { entitledUnits: 24, adjustmentUnits: 0, reason: 'Annual entitlement' },
  'PATCH /api/hr/leave-balances/:profileId/:year/:leaveType/adjust': { units: 2, reason: 'Manual correction' },
  'POST /api/hr/leave-balances/accrue': { profileIds: [oid('profileId')], year: 2026, month: 8, units: 2, reason: 'Monthly accrual' },
  'POST /api/hr/leave-balances/reset': { profileIds: [oid('profileId')], year: 2026, leaveType: 'ANNUAL', entitledUnits: 24, reason: 'Year opening' },
  'POST /api/hr/leave-balances/carry-over': { profileIds: [oid('profileId')], fromYear: 2025, toYear: 2026, leaveType: 'ANNUAL', maxUnits: 10, reason: 'Annual carry over' },
  'POST /api/hr/leave-requests': { leaveType: 'ANNUAL', portion: 'FULL_DAY', startDateKey: '2026-08-10', endDateKey: '2026-08-10', reason: 'Personal leave' },
  'PATCH /api/hr/leave-requests/:requestId': { leaveType: 'ANNUAL', portion: 'FULL_DAY', startDateKey: '2026-08-11', endDateKey: '2026-08-11', reason: 'Updated personal leave' },
  'POST /api/hr/leave-requests/preview': { leaveType: 'ANNUAL', portion: 'FULL_DAY', startDateKey: '2026-08-10', endDateKey: '2026-08-10', reason: 'Preview leave units' },
  'POST /api/hr/leave-requests/:requestId/approve': {},
  'POST /api/hr/leave-requests/:requestId/reject': { reason: 'Insufficient staffing' },
  'POST /api/hr/leave-requests/:requestId/refund': { dateKeys: ['2026-08-10'], reason: 'Leave day restored' },
  'POST /api/hr/leave-requests/:requestId/cancel': { reason: 'Plans changed' },
  'POST /api/hr/leave-requests/:requestId/attachments': { attachments: [{ mediaId: 'leave-proof-001', filename: 'proof.pdf', mimeType: 'application/pdf' }] },
  'POST /api/hr/overtime-requests': { workDateKey: '2026-08-08', plannedStartTime: '18:00', plannedEndTime: '20:00', reason: 'Urgent production batch' },
  'PATCH /api/hr/overtime-requests/:requestId': { workDateKey: '2026-08-08', plannedStartTime: '18:30', plannedEndTime: '20:30', reason: 'Updated overtime window' },
  'POST /api/hr/overtime-requests/:requestId/approve': { approvedMinutes: 120, reason: 'Approved' },
  'POST /api/hr/overtime-requests/:requestId/reject': { reason: 'Not required' },
  'POST /api/hr/overtime-requests/:requestId/cancel': { reason: 'Work completed' },
  'POST /api/hr/payrolls/run': { month: 7, year: 2026, profileIds: [oid('profileId')], shadow: false },
  'POST /api/hr/payrolls/:id/finalize': { expectedVersion: 0 },
  'POST /api/hr/payrolls/:id/mark-paid': { payrollResultIds: [oid('payrollResultId')], expectedVersion: 0 },
  'POST /api/hr/payrolls/:id/email': {},
  'POST /api/hr/payroll-adjustments': { profileId: oid('profileId'), month: 7, year: 2026, type: 'EARNING', code: 'BONUS', name: 'Performance bonus', amount: 1000000, note: 'Approved bonus' },
  'POST /api/hr/payroll-adjustments/bulk': { profileIds: [oid('profileId')], month: 7, year: 2026, type: 'EARNING', code: 'BONUS', name: 'Performance bonus', amount: 1000000, note: 'Approved bonus' },
  'PUT /api/hr/payroll-settings': { expectedVersion: 0, workHoursPerDay: 8, insuranceRates: { social: 800, health: 150, unemployment: 100 }, company: { name: 'LNG Group', currency: 'VND' } },
  'PATCH /api/hr/payroll-adjustments/:id': { amount: 1200000, expectedVersion: 0 },
  'DELETE /api/hr/payroll-adjustments/:id': { expectedVersion: 0 },
  'POST /api/hr/announcements': { title: 'Company update', content: 'Office announcement', category: 'NEWS', priority: 'NORMAL', sendToAll: true, status: 'PUBLISHED' },
  'PATCH /api/hr/announcements/:id': { title: 'Updated company announcement' },
};

const queryByPrefix = {
  '/api/hr/workspace/': { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  '/api/hr/employee-profiles': { page: '1', limit: '20', status: 'ACTIVE' },
  '/api/hr/work-locations': { page: '1', limit: '20', status: 'ACTIVE' },
  '/api/hr/shifts': { page: '1', limit: '20', status: 'ACTIVE' },
  '/api/hr/shift-assignments': { page: '1', limit: '20', profileId: oid('profileId') },
  '/api/hr/calendar-overrides': { page: '1', limit: '20', dateKey: '2026-09-02' },
  '/api/hr/attendance/month-matrix': { year: '2026', month: '8', teamId: oid('teamId') },
  '/api/hr/attendance': { dateFrom: '2026-08-01', dateTo: '2026-08-31', page: '1', limit: '20' },
  '/api/hr/leave-requests': { year: '2026', page: '1', limit: '20' },
  '/api/hr/overtime-requests': { dateFrom: '2026-08-01', dateTo: '2026-08-31', page: '1', limit: '20' },
  '/api/hr/payroll-adjustments': { month: '7', year: '2026', page: '1', limit: '20' },
  '/api/hr/payrolls/results/export': { month: '7', year: '2026' },
  '/api/hr/payrolls/results': { month: '7', year: '2026', page: '1', limit: '20' },
  '/api/hr/payrolls': { month: '7', year: '2026', page: '1', limit: '20' },
  '/api/hr/announcements': { page: '1', limit: '20' },
};

const queryByRoute = {
  'GET /api/hr/employee-profiles/:profileId': { includeSensitive: 'false' },
  'GET /api/hr/holidays': { dateFrom: '2026-01-01', dateTo: '2026-12-31', page: '1', limit: '20' },
  'GET /api/hr/holidays/range': { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  'GET /api/hr/holidays/check': { dateKey: '2026-09-02' },
  'GET /api/hr/saturday-rotations': { teamId: oid('teamId'), month: '8', year: '2026', page: '1', limit: '20' },
  'GET /api/hr/saturday-rotations/matrix': { teamId: oid('teamId'), month: '8', year: '2026' },
  'DELETE /api/hr/saturday-rotations/team/:teamId': { month: '8', year: '2026' },
  'GET /api/hr/leave-balances/me': { year: '2026' },
};

function routeId(route) { return `${route.method} ${route.path}`; }
function variableFor(name, routePath) {
  if (name === 'id') {
    if (routePath.includes('work-locations')) return oid('workLocationId');
    if (routePath.includes('/shifts/')) return oid('shiftId');
    if (routePath.includes('shift-assignments')) return oid('assignmentId');
    if (routePath.includes('calendar-overrides')) return oid('calendarOverrideId');
    if (routePath.includes('holidays')) return oid('holidayId');
    if (routePath.includes('saturday-rotations')) return oid('rotationId');
    if (routePath.includes('payroll-adjustments')) return oid('adjustmentId');
    if (routePath.includes('announcements')) return oid('announcementId');
    return oid('payrollId');
  }
  if (name === 'requestId') return routePath.includes('overtime') ? oid('overtimeRequestId') : oid('leaveRequestId');
  return pathVariables[name] || oid(name);
}

function queryFor(route) {
  if (queryByRoute[routeId(route)]) return Object.entries(queryByRoute[routeId(route)]).map(([key, value]) => ({ key, value }));
  if (route.method !== 'GET') return [];
  const prefix = Object.keys(queryByPrefix).sort((a, b) => b.length - a.length).find((item) => route.path.startsWith(item));
  return Object.entries(prefix ? queryByPrefix[prefix] : {}).map(([key, value]) => ({ key, value }));
}

function requestFor(route) {
  const names = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  let renderedPath = route.path;
  const variable = names.map((key) => {
    const value = variableFor(key, route.path);
    renderedPath = renderedPath.replace(`:${key}`, `{{${key}}}`);
    return { key, value };
  });
  const query = queryFor(route);
  const raw = `${oid('baseUrl')}${renderedPath}${query.length ? `?${query.map(({ key, value }) => `${key}=${value}`).join('&')}` : ''}`;
  const request = {
    description: route.authenticated
      ? `Bearer token required.${route.permissions.length ? ` Permissions (${route.authorizationMode}): ${route.permissions.join(', ')}.` : ''}`
      : 'Public endpoint.',
    method: route.method,
    header: [],
    url: { raw, host: [oid('baseUrl')], path: renderedPath.split('/').filter(Boolean), ...(query.length && { query }), ...(variable.length && { variable }) },
  };
  if (route.authenticated) request.auth = { type: 'bearer', bearer: [{ key: 'token', value: oid('accessToken'), type: 'string' }] };
  if (route.path.endsWith('/avatar') && route.method === 'POST') {
    request.body = { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: [] }] };
  } else if (Object.hasOwn(bodyByRoute, routeId(route))) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(bodyByRoute[routeId(route)], null, 2), options: { raw: { language: 'json' } } };
  }
  return request;
}

function folderName(routePath) {
  const resource = routePath.split('/')[3] || 'health';
  return resource.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function buildCollection() {
  const folders = new Map();
  for (const route of buildRouteInventory().filter(({ module }) => module === 'hr')) {
    const folder = folderName(route.path);
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push({ name: routeId(route), request: requestFor(route) });
  }
  return {
    info: { _postman_id: randomUUID(), name: 'LNG Web BE - HR', description: 'Complete HR API requests generated from the registered Express routes. Example values follow the Joi request contracts.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: variables.map(([key, value]) => ({ key, value })),
    item: [...folders].map(([name, item]) => ({ name, item })),
  };
}

function main() {
  fs.writeFileSync(outputPath, `${JSON.stringify(buildCollection(), null, 2)}\n`);
  process.stdout.write(`Wrote ${outputPath}\n`);
}

if (require.main === module) main();
module.exports = { buildCollection };
