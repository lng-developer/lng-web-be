const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { isDuplicateKeyError } = require('../../../shared/utils/mongo');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');
const employeeProfileService = require('./employeeProfile.service');
const employeeProfileRepository = require('../repositories/employeeProfile.repository');
const leaveRepository = require('../repositories/leave.repository');
const { hrPermissions } = require('../constants/hr.constants');
const { toStaffProvisioningDto, toAssignableRoleCatalogDto } = require('../dtos/staffProvisioning.dto');

function conflict(message) {
  return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

async function provisionStaff(payload, authContext = {}, httpContext) {
  const organization = await employeeProfileService.resolveOrganization(payload);
  employeeProfileService.assertCanAccessProfile(
    authContext,
    { ...payload, ...organization },
    [hrPermissions.EMPLOYEE_WRITE],
  );

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const account = await authPublic.createProvisionedAccount({
        email: payload.workEmail,
        assignments: payload.assignments,
        session,
        authContext,
        httpContext,
      });
      const [existingAccount, existingEmployeeCode] = await Promise.all([
        employeeProfileRepository.findByAccountId(account._id, { includeDeleted: true, session }),
        employeeProfileRepository.findByEmployeeCode(payload.employeeCode, { includeDeleted: true, session }),
      ]);
      if (existingAccount) throw conflict('Account already has an HR profile');
      if (existingEmployeeCode) throw conflict('Employee code already exists');

      const profile = await employeeProfileRepository.create({
        employeeCode: payload.employeeCode,
        workEmail: payload.workEmail,
        fullName: payload.fullName,
        departmentId: organization.departmentId,
        teamId: organization.teamId,
        jobTitle: payload.jobTitle,
        jobLevel: payload.jobLevel,
        employmentType: payload.employmentType,
        workMode: payload.workMode,
        startDate: payload.startDate,
        probationEndDate: payload.probationEndDate,
        status: payload.status,
        baseCurrency: payload.baseCurrency,
        baseSalary: payload.baseSalary,
        accountId: account._id,
        isProfileUpdated: false,
      }, { session });
      if (organization.teamId) {
        await organizationPublic.syncTeamMembership({
          accountId: account._id,
          teamId: organization.teamId,
        }, { session });
      }
      const year = new Date().getUTCFullYear();
      await leaveRepository.ensureBalance(profile._id, year, 'ANNUAL', { session });
      await employeeProfileService.recordProfileAudit('HR_STAFF_PROVISIONED', profile, authContext, {}, {
        required: true, session,
      });
      result = toStaffProvisioningDto({ account, profile, year });
    });
    return result;
  } catch (error) {
    if (isDuplicateKeyError(error)) throw conflict('Employee profile has duplicate fields');
    throw error;
  } finally {
    await session.endSession();
  }
}

async function listAssignableRoles(authContext = {}) {
  return toAssignableRoleCatalogDto(await authPublic.listAssignableRoles(authContext));
}

module.exports = { provisionStaff, listAssignableRoles };
