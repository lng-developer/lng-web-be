# Git Rules — Ecommerce Project

Đây là quy ước git của team mình. Đọc kỹ một lần, làm theo là xong. Có gì không rõ hỏi trực tiếp, đừng tự suy đoán rồi làm.

---

## Branch

```
main       → production, không động vào trực tiếp
develop    → nơi tích hợp feature trước khi release

feature/EC-xxx-ten-tinh-nang
fixbug/EC-xxx-mo-ta-loi
hotfix/EC-xxx-loi-khan-cap      ← checkout từ main, không phải develop
refactor/EC-xxx-mo-ta           ← refactor code, không đổi behavior
perf/EC-xxx-mo-ta               ← tối ưu hiệu năng
chore/EC-xxx-mo-ta              ← deps, config, CI/CD
test/EC-xxx-mo-ta               ← thêm hoặc sửa test
release/x.x.x
```

Ví dụ thực tế:

```
feature/EC-101-product-listing
fixbug/EC-312-fix-payment-null
hotfix/EC-400-order-status-stuck
refactor/EC-215-extract-order-status-logic
perf/EC-318-optimize-product-listing-query
chore/EC-205-upgrade-dependencies
test/EC-310-add-cart-unit-tests
```

---

## Commit message

Format: `<type>(<scope>): <mô tả>`

| type       | dùng khi nào                              |
| ---------- | ----------------------------------------- |
| `feat`     | thêm tính năng mới                        |
| `fix`      | sửa bug                                   |
| `refactor` | refactor, không đổi behavior              |
| `style`    | format code, whitespace — không đổi logic |
| `perf`     | tối ưu hiệu năng                          |
| `test`     | thêm hoặc sửa test                        |
| `chore`    | config, deps, tooling                     |
| `ci`       | sửa CI/CD                                 |
| `build`    | build system                              |
| `docs`     | tài liệu                                  |
| `revert`   | revert commit cũ                          |

Scope thường dùng: `product` `cart` `checkout` `payment` `order` `auth` `user`

> **Không có type `update`.** Khi sửa tính năng hiện có, chọn theo tiêu chí:
>
> - Behavior thay đổi → `feat`
> - Logic thay đổi nhưng output như cũ → `refactor`
> - Chỉ đổi text/label/copy UI → `style`
> - Đổi config, env, hằng số → `chore`

Ví dụ đúng:

```
feat(cart): add quantity update with optimistic UI
fix(payment): handle VNPay callback when signature is null
refactor(order): extract order status logic into helper
perf(product): cache category list to avoid repeated DB query
chore(deps): upgrade stripe-js to v3.2.1
test(order): add unit test for status transition
```

Không viết kiểu này:

```
fix
update code
sửa lỗi abc
```

---

## Flow hàng ngày

```bash
# Bắt đầu task mới
git checkout develop && git pull origin develop
git checkout -b feature/EC-101-ten-task

# Mỗi sáng sync code (rebase, không merge)
git fetch origin
git rebase origin/develop

# Xong thì push lên, tạo PR vào develop
git push origin feature/EC-101-ten-task
```

---

## Hotfix

Hotfix thì checkout từ `main`, không phải `develop`:

```bash
git checkout main && git pull origin main
git checkout -b hotfix/EC-400-order-status-stuck

# Fix xong → PR vào main
# Sau khi merge vào main → nhớ merge ngược về develop
git checkout develop
git merge hotfix/EC-400-order-status-stuck
git push origin develop
```

---

## Pull Request

Trước khi tạo PR tự check lại:

- [ ] đã tự đọc lại diff chưa
- [ ] còn `console.log` hay debug code không
- [ ] có hardcode secret, API key không
- [ ] test local chạy được không

Quy tắc merge:

- cần ít nhất **1 người approve** mới merge
- không tự merge PR của mình
- merge xong xóa branch đi

---

## Ai merge thì chú ý

Trước khi bấm merge:

- đủ approval chưa
- CI pass chưa
- branch target đúng chưa — feature đi vào develop, hotfix đi vào main
- còn conflict không

Merge strategy:

- **Squash and merge** — cho feature/fixbug (history develop gọn hơn)
- **Merge commit** — cho release/hotfix vào main
- **Không dùng Rebase and merge** cho branch người khác

Merge xong nhớ xóa branch và báo lại cho người làm.

---

## Tuyệt đối không

```bash
git push --force origin main      # không force push main/develop
git checkout main && git commit   # không commit thẳng lên main/develop
git add .env                      # không commit file .env hay secret
```

Branch mở quá 1 tuần mà chưa merge thì nên hỏi lại xem còn làm không.

---

Có gì không rõ hỏi team lead trước khi tự làm theo cách khác.

---

## Tích hợp IDE với Jira

### VS Code

Cài extension **"Jira and Bitbucket (Atlassian Labs)"** từ Marketplace.

1. Đăng nhập: `Ctrl+Shift+P` → `Atlassian: Sign In`
2. Sidebar sẽ hiện danh sách Jira issues
3. Tạo branch từ issue: click vào issue → **"Create branch"**, hoặc `Ctrl+Shift+P` → `Jira: Start Work on Issue`
4. Branch tự đặt tên theo convention: `feature/EC-123-ten-task`

### WebStorm

WebStorm có tích hợp task management **native**, không cần cài thêm plugin.

1. Vào **Settings** → `Tools` → `Tasks & Contexts` → **Add server** → chọn **Jira**
2. Điền thông tin:
   - Server URL: `https://your-company.atlassian.net`
   - Username + API Token (tạo tại Atlassian Account → Security → API tokens)
3. Mở task: `Alt+Shift+N` hoặc `Tools → Tasks → Open Task`
4. Chọn issue → WebStorm hỏi **"Create branch?"** → tự tạo branch với tên từ issue

> **Lưu ý**: Jira Cloud bắt buộc dùng **API Token** thay vì password. Tạo tại: [id.atlassian.com](https://id.atlassian.com) → Security → Create and manage API tokens.

### Quy trình khi dùng IDE tích hợp Jira

```
Jira Issue (EC-123)
    ↓ Mở task trong IDE
    ↓ IDE tự tạo branch: feature/EC-123-ten-task
    ↓ Code → commit với prefix "EC-123: ..."
    ↓ Push → Jira tự link commit/PR vào issue
```
