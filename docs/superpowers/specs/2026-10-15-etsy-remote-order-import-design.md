# Etsy: kéo đơn và tự import theo lệnh từ web

## Mục tiêu đã thống nhất

Người dùng chọn extension Etsy trên Integrations, chọn giới hạn số đơn và bấm kéo. BE tạo task; extension nhận task, lấy đơn và tự import cùng ảnh/file qua pipeline hiện tại. Không cần bấm xác nhận lại trong VM. Không bật lịch tự động, Ads hay tracking trong đợt này.

Đây là mở rộng giao thức task hiện có, không phải một hệ thống queue mới. Chưa triển khai product code theo spec này.

## Bằng chứng từ code hiện tại

- `integration/extensionCommand` đã có tạo, claim, start, complete, khóa chống nhiều import đồng thời và lịch sử lệnh.
- Extension `lng-web-be-agent.mjs` có executor Orders/Ads; chế độ thủ công hiện chỉ gửi heartbeat.
- Executor Orders cũ dùng `numDays * 50`, tối đa 200 đơn: không phải lọc đơn theo ngày và không đáp ứng test 1 đơn.
- `etsy-import-runner.mjs/resumeEtsyImport` đã có CSV idempotency, job checkpoint, tải customer files, manifest và kết quả cần kiểm tra. Executor remote cũ chỉ upload CSV rồi chờ job.
- BE cấp lease 5 phút; `updateClaimed` từ chối lease hết hạn. Heartbeat online hiện không gia hạn lease task.
- FE `ExtensionManualRequest.tsx` hiện hiển thị cửa sổ ngày cho Orders theo giao diện Amazon.

## Thiết kế

### 1. Nhận diện và giới hạn lệnh Etsy

- Mở rộng thông tin agent bằng loại provider/capabilities cần thiết để BE và FE phân biệt Etsy với agent Amazon cũ. Agent cũ không có metadata giữ hành vi hiện tại.
- Agent Etsy mới công bố hỗ trợ lệnh kéo đơn theo yêu cầu. Không dựa vào tên label để xác định provider.
- BE lấy shop từ agent đã xác thực; không tin shop/client ID tùy ý để truy cập shop khác. Giữ Auth scoped RBAC cho thao tác từ web.
- Chỉ nhận lệnh Orders do người dùng gửi từ web trong phiên này; không vô tình nhận task Ads/finance hoặc task từ lịch. Bộ lọc claim phải ở BE, trước khi cấp lease.
- Không tự bật hoặc tạo schedule. FE không cung cấp lịch Etsy chưa được hỗ trợ.

### 2. Tham số và giao diện

- Giữ loại task Orders có sẵn; thêm tham số `maxOrders` cho Etsy, số nguyên 1–200, mặc định 1 để test an toàn.
- Amazon giữ `numDays` và luồng hiện có. Etsy không chuyển đổi ngày thành số đơn.
- FE hiển thị chọn số đơn cho Etsy và nói rõ bấm nút sẽ tự import. Chỉ cho gửi khi agent online và người dùng có quyền shop.
- Giữ bảng lịch sử task hiện có, thể hiện giới hạn số đơn, trạng thái và liên kết import job. Không làm lại toàn bộ màn hình hoặc bổ sung lịch sử lượt kéo thủ công độc lập trong đợt này.
- Giới hạn số đơn là giới hạn dữ liệu collector lấy được; không hứa là chỉ đơn New, theo ngày hay theo mã đơn. Không đổi quy tắc lọc collector ngầm.

### 3. Thực thi và dữ liệu

- Dùng token phiên đã xác thực và URL backend hiện tại; không fallback token local cũ khi mất token phiên.
- Dùng collector và `resumeEtsyImport` hiện có cho remote Orders, bao gồm listing image, customer files và manifest. Tách phần tạo capture dùng chung nếu cần, không nhân đôi parser.
- Giữ checkpoint remote riêng với preview thủ công để không ghi đè dữ liệu người dùng đang xem.
- ID task làm khóa idempotency ổn định; khi resume dùng lại CSV/job/checkpoint đã lưu, không kéo lại thành một payload khác với cùng khóa.
- Không claim khi đang có thao tác thủ công/remote khác; thao tác thủ công cũng không được khởi chạy trong khi remote đang chạy. Preview thủ công chưa hoàn tất được giữ nguyên và báo bận rõ ràng.
- Không có đơn là kết quả hợp lệ với 0 đơn, không cố upload CSV rỗng.

### 4. Lease, lỗi và kết quả

- Bổ sung gia hạn lease có xác thực theo agent + command + lease token, chỉ cho task active chưa hết hạn. Không dùng heartbeat online để mặc nhiên gia hạn mọi task.
- Gia hạn định kỳ trong lúc chạy; nếu không còn quyền sở hữu task thì không bắt đầu thêm thao tác ghi. Request đã gửi có thể hoàn tất; checkpoint/idempotency dùng để đối chiếu khi phục hồi.
- Lease hết hạn không được claim lại hoặc ghi đè trạng thái terminal ngầm. Khi mất phiên/đóng Chrome, task phải thể hiện gián đoạn/thất bại và giữ bằng chứng job đã tạo nếu có.
- Chỉ báo thành công sau khi job import hoàn tất và phần ảnh/file/manifest cần thiết đã được xử lý. `NEEDS_REVIEW` không được hiển thị thành công toàn bộ.
- Kết quả lưu job ID, các bộ đếm được hỗ trợ và lỗi ngắn đã loại thông tin nhạy cảm. Không lưu token hoặc raw customer files vào command logs.
- Retry/resume chỉ tiếp tục phần chưa hoàn tất của checkpoint gắn đúng task/backend/shop; không tự tạo task mới hoặc tự gửi lại đơn sang vendor.

## Phạm vi file/module

- BE: `integration/extensionCommand` models, validators, repositories, services, controllers, DTO/routes và tests; public ports khi cần gọi module khác. Không thay `shop.model.js`.
- Extension: command client/runner, worker lifecycle, capture/import checkpoint và tests. Không thay parser Etsy hoặc luồng legacy tracking ngoài yêu cầu.
- FE: API types, hook tạo task, `ExtensionManualRequest`, phần hiển thị agent/task liên quan và bản dịch VI/EN. Tận dụng UI dùng chung.
- Cập nhật hợp đồng API và hướng dẫn test theo endpoint thay đổi.

## Tiêu chí kiểm thử

1. Etsy task với `maxOrders=1` đi từ web qua BE đến collector đúng một đơn tối đa; tự import không cần xác nhận VM.
2. Không claim lệnh không hỗ trợ/lệnh schedule; không chạy trùng khi người dùng đang thao tác thủ công.
3. Amazon cũ vẫn dùng ngày và nhận task theo hợp đồng cũ.
4. Không truy cập/hoàn tất/gia hạn task của agent hoặc shop khác; token hết hạn không fallback token cũ.
5. Lượt kéo lâu hơn 5 phút vẫn giữ lease hợp lệ; mất lease dừng thao tác mới và không báo thành công giả.
6. Resume dùng cùng CSV, idempotency key và job, không tạo import trùng; checkpoint thủ công không bị ghi đè.
7. Job thất bại, ảnh lỗi hoặc manifest cần review xuất hiện đúng trong kết quả task; không có đơn trả 0 hợp lệ.
8. Chạy tests extension, tests BE task/architecture và FE task UI; test VM riêng sau khi đồng bộ ba bản code.

## Rollout và giới hạn

Triển khai BE hỗ trợ contract trước, rồi FE và extension. Không claim Etsy remote nếu backend chưa hỗ trợ giao thức cần thiết. Giữ lịch tắt và bắt đầu kiểm thử thật bằng một task một đơn theo yêu cầu người dùng; không chạy import thật chỉ để kiểm thử tự động.

Không backfill task cho các lượt thủ công cũ, không thay trạng thái nghiệp vụ đơn Amazon/Etsy và không đưa đơn vào sản xuất trong phạm vi này. Bộ lọc/phân trang lịch sử tổng hợp từ yêu cầu trước chưa thuộc đợt remote import này.
