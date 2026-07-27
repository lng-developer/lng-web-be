# Login bằng email hoặc employeeCode

## Mục tiêu

Cho phép `POST /api/auth/login` xác thực bằng email của Account hoặc `employeeCode` của `HrEmployeeProfile`, không thay đổi mật khẩu, token hay response hiện tại.

## Contract

- Payload mới: `{ "identifier": "email-or-employee-code", "password": "..." }`.
- Payload cũ `{ "email": "...", "password": "..." }` tiếp tục được chấp nhận để tương thích ngược.
- Chỉ được gửi một trong hai field `identifier` hoặc `email`.
- Email được trim và lowercase; `employeeCode` được HR chuẩn hóa uppercase.
- Sai email, sai `employeeCode`, profile không tồn tại, account không tồn tại/inactive hoặc sai mật khẩu đều trả cùng lỗi xác thực hiện tại.

## Thiết kế

Auth giữ toàn bộ logic mật khẩu, session và token. Khi identifier có dạng email, Auth dùng Account repository như hiện tại. Nếu không phải email, Auth gọi `hr.public.getEmployeeProfileByEmployeeCode()`, lấy `accountId`, rồi nạp auth model bằng Account repository.

Lệnh gọi HR được resolve ở thời điểm login qua public port để tránh lỗi khởi tạo CommonJS do HR hiện cũng dùng `auth.public`. Không thêm `employeeCode` vào Account và không tạo bảng alias, vì HR là nguồn profile duy nhất.

Frontend đổi input login sang text với `autocomplete="username"`, nhãn “Email hoặc mã nhân viên”, gửi `identifier`; các client cũ vẫn dùng được field `email`.

## Phương án đã loại

1. Copy `employeeCode` vào Account: truy vấn đơn giản nhưng tạo hai nguồn dữ liệu và cần đồng bộ.
2. Tạo module identity/composition riêng: tránh phụ thuộc hai chiều nhưng quá lớn cho một phép phân giải login đơn giản.

## Kiểm thử

- Validator nhận `identifier`, vẫn nhận `email`, từ chối thiếu/cùng lúc hai field.
- Service login bằng email giữ nguyên hành vi.
- Service login bằng `employeeCode` lấy đúng `accountId` qua HR public port.
- `employeeCode` không tồn tại và account inactive trả lỗi xác thực chung.
- Controller truyền đúng identifier; FE gửi payload mới và không ép định dạng email.
- Chạy auth test, architecture test, FE targeted test/lint/build.
