# Login Identifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép đăng nhập bằng email Account hoặc `HrEmployeeProfile.employeeCode` qua cùng endpoint hiện tại.

**Architecture:** Auth tiếp tục sở hữu mật khẩu, session và token. Email được tra trực tiếp trong Account; identifier không phải email được resolve qua `hr.public.getEmployeeProfileByEmployeeCode()` rồi Auth nạp account bằng `accountId`. Public port HR được require tại thời điểm login để tránh lỗi khởi tạo CommonJS khi HR cũng dùng `auth.public`.

**Tech Stack:** Node.js, Express, Joi, Jest; React, React Hook Form, Zod, MUI, Vitest, Vite.

## Global Constraints

- Payload mới là `{ identifier, password }`; payload `{ email, password }` vẫn hợp lệ.
- Chỉ nhận một trong `identifier` hoặc `email`.
- Không thêm `employeeCode` vào Account và không tạo login-alias collection.
- Mọi lỗi lookup/password/status giữ cùng lỗi xác thực chung.
- Không commit implementation riêng vì các file liên quan đang chứa refactor HR/UserProfile chưa commit.

---

### Task 1: Backend login contract

**Files:**
- Modify: `src/test/auth/validators/auth.validator.test.js`
- Modify: `src/test/auth/controllers/auth.controller.test.js`
- Modify: `src/modules/auth/validators/auth.validator.js`
- Modify: `src/modules/auth/controllers/auth.controller.js`

**Interfaces:**
- Consumes: `validate(loginSchema, payload)` và `authManager.login(identifier, password, ip, userAgent)`.
- Produces: payload login đã chuẩn hóa với đúng một field `identifier` hoặc `email`.

- [ ] **Step 1: Viết test validator/controller thất bại**

```js
expect(validate(loginSchema, { identifier: ' j2501 ', password: 'secret' }).value)
  .toMatchObject({ identifier: 'j2501', password: 'secret' });
expect(validate(loginSchema, { email: 'admin@lng.co', password: 'secret' }).details).toBeUndefined();
expect(validate(loginSchema, { identifier: 'J2501', email: 'admin@lng.co', password: 'secret' }).details)
  .toBeDefined();
expect(validate(loginSchema, { password: 'secret' }).details).toBeDefined();
```

Controller test submits `{ identifier: 'J2501', password: 'secret' }` and expects `authManager.login('J2501', 'secret', ip, userAgent)`.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:
`npx jest src/test/auth/validators/auth.validator.test.js src/test/auth/controllers/auth.controller.test.js --runInBand`

Expected: FAIL vì `loginSchema` chỉ nhận email và controller truyền `payload.email`.

- [ ] **Step 3: Implement contract tối thiểu**

```js
const loginSchema = Joi.object({
  identifier: Joi.string().trim().min(1).max(254),
  email: Joi.string().trim().email(),
  password: Joi.string().required(),
}).xor('identifier', 'email');
```

Controller gọi `authManager.login(payload.identifier || payload.email, ...)`.

- [ ] **Step 4: Chạy lại test để xác nhận GREEN**

Run:
`npx jest src/test/auth/validators/auth.validator.test.js src/test/auth/controllers/auth.controller.test.js --runInBand`

Expected: PASS.

### Task 2: Backend employeeCode resolver

**Files:**
- Modify: `src/test/auth/services/authManager.service.test.js`
- Modify: `src/modules/auth/services/authManager.service.js`

**Interfaces:**
- Consumes: `hr.public.getEmployeeProfileByEmployeeCode(employeeCode)` trả `{ accountId } | null`.
- Produces: `login(identifier, password, ipAddress, userAgent)` hoạt động cho cả email và employeeCode.

- [ ] **Step 1: Viết test service thất bại**

```js
hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue({ accountId: accountId });
accountRepository.findAuthAccountById.mockResolvedValue(authModel);

await authManager.login('j2501', 'valid-password');

expect(hrPublic.getEmployeeProfileByEmployeeCode).toHaveBeenCalledWith('j2501');
expect(accountRepository.findAuthAccountById).toHaveBeenCalledWith(accountId);
```

Thêm case HR trả `null`, kỳ vọng `AUTHENTICATION_ERROR` và không gọi `findAuthAccountById`.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:
`npx jest src/test/auth/services/authManager.service.test.js --runInBand`

Expected: FAIL vì login đang luôn gọi `findAuthAccountByEmail`.

- [ ] **Step 3: Implement resolver tối thiểu**

```js
async function findAuthModelByIdentifier(identifier) {
  const normalized = String(identifier).trim();
  if (normalized.includes('@')) {
    return accountRepository.findAuthAccountByEmail(normalized.toLowerCase());
  }

  const hrPublic = require('../../hr/public');
  const profile = await hrPublic.getEmployeeProfileByEmployeeCode(normalized);
  return profile?.accountId
    ? accountRepository.findAuthAccountById(profile.accountId)
    : null;
}
```

`login()` dùng helper này trước `enrichWithScopedAccess()`; các nhánh status/password/token giữ nguyên.

- [ ] **Step 4: Chạy lại auth service và auth suite**

Run:
`npx jest src/test/auth/services/authManager.service.test.js --runInBand`

Run:
`npm run test:auth -- --runInBand`

Expected: PASS.

### Task 3: Frontend identifier field

**Files:**
- Create: `src/validations/loginSchema.test.js`
- Modify: `src/validations/loginSchema.js`
- Modify: `src/features/auth/components/LoginForm.jsx`
- Modify: `src/i18n/locales/vi/common.json`
- Modify: `src/i18n/locales/en/common.json`

**Interfaces:**
- Consumes: backend payload `{ identifier, password }`.
- Produces: form value `{ identifier, password }` không ép định dạng email.

- [ ] **Step 1: Viết test Zod thất bại**

```js
expect(loginSchema.parse({ identifier: 'J2501', password: 'secret' }))
  .toEqual({ identifier: 'J2501', password: 'secret' });
expect(loginSchema.safeParse({ identifier: '', password: 'secret' }).success).toBe(false);
expect(loginDefaultValues).toEqual({ identifier: '', password: '' });
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:
`npx vitest run src/validations/loginSchema.test.js`

Expected: FAIL vì schema/default values hiện dùng `email`.

- [ ] **Step 3: Implement form tối thiểu**

```js
export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'auth.login.errors.identifierRequired'),
  password: z.string().min(1, 'auth.login.errors.passwordRequired'),
});

export const loginDefaultValues = { identifier: '', password: '' };
```

Đổi `LoginForm` sang `name="identifier"`, `autoComplete="username"`, label/placeholder i18n “Email hoặc mã nhân viên” / “Email or employee code”. Mutation giữ nguyên vì đã forward payload nguyên trạng.

- [ ] **Step 4: Chạy targeted test và lint**

Run:
`npx vitest run src/validations/loginSchema.test.js`

Run:
`npx eslint src/validations/loginSchema.js src/validations/loginSchema.test.js src/features/auth/components/LoginForm.jsx`

Expected: PASS.

### Task 4: Cross-repo verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: toàn bộ thay đổi Tasks 1-3.
- Produces: bằng chứng syntax, architecture và FE build không regress.

- [ ] **Step 1: Backend verification**

Run:
`node -c src/modules/auth/services/authManager.service.js`

Run:
`npm run test:auth -- --runInBand`

Run:
`npm run test:architecture -- --runInBand`

- [ ] **Step 2: Frontend verification**

Run:
`npm run build`

Run:
`git diff --check`

- [ ] **Step 3: Review scope**

Run `git diff --name-only` trong cả BE và FE; xác nhận không có dependency mới, không có `employeeCode` trong Account, và không stage/commit các thay đổi implementation.
