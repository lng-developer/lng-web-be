# Theo Dõi Trạng Thái Các Nhánh Mã Nguồn (Branch Tracking)

*Tài liệu tổng hợp trạng thái các nhánh, commit và tiến độ tính năng trên hệ thống LNG Web (FE & BE).*  
*Cập nhật lần cuối: 26/10/2026.*

---

## 1. Nhánh tính năng mới: `feat/attendance-timekeeping` (Máy chấm công & Bảng công nhân viên)

*Mục tiêu:* Kết nối cơ sở dữ liệu máy chấm công Wise Eye / Ronald Jack (SQL Server `chamcong` tại `192.168.0.200:1430`) và cho phép nhân viên xem tổng công (`totalWorkdays`), tổng giờ làm (`totalWorkedHours`), chi tiết giờ vào/ra, đi muộn/về sớm, nguồn chấm công trên Web Portal.

| Repository | File thay đổi | Chi tiết triển khai |
| :--- | :--- | :--- |
| **`lng-web-be`** | - `src/modules/integration/sqlAttendance/services/sqlAttendanceClient.service.js`<br>- `src/modules/integration/sqlAttendance/validators/sqlAttendance.validator.js`<br>- `src/modules/integration/sqlAttendance/controllers/sqlAttendance.controller.js`<br>- `src/modules/integration/sqlAttendance/routes/index.js`<br>- `src/modules/integration/sqlAttendance/services/sqlAttendanceScheduler.service.js`<br>- `src/modules/integration/sqlAttendance/public.js`<br>- `src/server.js`<br>- `.env.example`, `.env`<br>- `tests/integration/sqlAttendance/*` | - Hỗ trợ Composite ID `UserEnrollNumber + TimeStr` cho Wise Eye/Ronald Jack.<br>- Tự động format mã máy sang mã nhân viên chuẩn (`101` -> `J101`).<br>- Hỗ trợ tham số `immediate: true` để trigger đồng bộ tức thì qua API.<br>- Bộ lập lịch tự động `sqlAttendanceScheduler` chạy định kỳ ngầm khi cấu hình `DB_SERVER`.<br>- Tích hợp quyền `HR_ATTENDANCE:MANAGE` cho router.<br>- Mọi unit test và architecture tests đều pass 100%. |
| **`lng-web-fe`** | - `src/features/hr/api/hrTimeApi.ts`<br>- `src/features/hr/pages/Attendance/AttendancePage.tsx`<br>- `src/features/hr/pages/Attendance/useAttendance.tsx`<br>- `src/features/hr/pages/Attendance/AttendancePage.module.scss`<br>- `src/shared/i18n/locales/vi/common.json`<br>- `src/shared/i18n/locales/en/common.json` | - Bổ sung 2 MetricCard nổi bật: **Tổng công** (`totalWorkdays`) & **Tổng giờ làm** (`totalWorkedHours`).<br>- Bổ sung nút **"Đồng bộ máy chấm công"** (`syncSqlAttendance`) trên PageHeader cho quản trị/vận hành.<br>- Mở rộng bảng chấm công: Thứ trong tuần, Ca làm việc, Giờ vào/ra, Tag Đi muộn/Về sớm, Giờ làm thực tế, Tag Giá trị công (1.0 / 0.5 công), Tag Nguồn chấm công (`Máy chấm công` / `Web portal`).<br>- Thẻ tóm tắt tháng hiển thị chi tiết số công lũy kế và tổng số giờ làm.<br>- Đầy đủ i18n song ngữ tiếng Việt & tiếng Anh. |

---

## 2. Các nhánh đã commit và đẩy lên Remote trước đó

| Nhánh | Repository | Commit Hash | Trạng thái Remote | Nội dung tính năng chính |
| :--- | :--- | :--- | :--- | :--- |
| **`ndluan_teams_notification`** | `lng-web-fe` | `b724e2d` | Đã push (`origin/ndluan_teams_notification`) | - **Đại tu Notification Center** (Facebook-style tabs, filter chưa đọc, thời gian tương đối).<br>- Bổ sung cập nhật họ tên `fullName` trong MyProfile & ProfileSetup.<br>- Nút copy mã đơn hàng `CopyableOrderId` & tối ưu hiển thị ảnh `OrderItemPanel`. |
| **`teams_chat_integration_phase1`** | `lng-web-fe` | `b953a9b` | Đã push (`origin/teams_chat_integration_phase1`) | - **Đại tu Chat Workspace nội bộ** (tính năng quote reply, danh sách kênh, cuộn tin nhắn).<br>- Giao diện lỗi 403 Forbidden tùy biến kèm hình ảnh chú mèo và nút điều hướng.<br>- Dọn dẹp module CSS và giao diện tab đơn hàng. |
| **`codex/legacy-sidebar`** | `lng-web-fe` | `774b16b` | Đã push (`origin/codex/legacy-sidebar`) | - Cập nhật hình ảnh nhận diện thương hiệu 3D `login-lng-3d.png` trên trang Đăng nhập.<br>- Bổ sung unit test xác thực asset trên `LoginPage.test.tsx`. |
| **`ndluan_teams_notification`** | `lng-web-be` | `23c5ca84` | Đã push (`origin/ndluan_teams_notification`) | - Tích hợp bắn thông báo Activity sang Microsoft Teams khi hệ thống tạo notification.<br>- Mở rộng cập nhật họ tên trong HR Profile. |

---

## 3. Các nhánh Local đã merge hoàn tất vào `develop` (An toàn để dọn dẹp)

Các nhánh dưới đây có `Ahead: 0` so với `develop` (toàn bộ code đã nằm trong `develop`):

* **FE & BE**:
  - `improve_notification_feature` (Tích hợp đăng nhập Microsoft OAuth redirect)
  - `switch_user_account` (Hỗ trợ dark mode và layout popup chat nhanh)
  - `update_user_greeting` (Đồng nhất commit với switch_user_account)
  - `ndluan_gmail` (OAuth redirect flow)
* **FE**:
  - `ndluan_profile_setup` (Setup profile flow ban đầu)
  - `ndluan_fix-bug-login` (Sửa lỗi popup login Microsoft)

---

## 4. Các nhánh Remote còn code tính năng riêng (Chưa merge vào `develop`)

### Backend (`lng-web-be`)
1. **`origin/EC/listing-launch-phase-2`** *(Ahead 20)*: Quy trình Listing Launch Giai đoạn 2 (AI Content Provider sinh bài đăng, approval review workflow, Cloudinary mockup storage).
2. **`origin/codex/etsy-extension-provider`** *(Ahead 11)*: Luồng nhập đơn hàng Etsy từ Extension (gia hạn lease, shop token scoping, fallback ảnh PSD).
3. **`origin/codex/teams-oauth-outbox`** *(Ahead 7)*: Cơ chế Outbox đồng bộ bền vững Teams OAuth ra bên ngoài và guard quyền đọc trạng thái OAuth.
4. **`origin/EC/amazon-extension-v2`** *(Ahead 4)*: Logic submit tracking Amazon từ extension, bắt buộc xác nhận tracking từ vendor.

### Frontend (`lng-web-fe`)
1. **`origin/EC/chat-popup-sync`** *(Ahead 4)*: Đồng bộ attachments và quote replies cho Quick Chat Popup; tối ưu bundle CSS.
2. **`origin/EC/ms-local-onboarding`** *(Ahead 2)*: Flow thiết lập mật khẩu LNG lần đầu cho tài khoản đăng nhập qua Microsoft.
3. **`origin/EC/listing-launch-mockup-assistant`** *(Ahead 1)*: Giao diện Workbench cho seller tạo mockup bài đăng listing.
