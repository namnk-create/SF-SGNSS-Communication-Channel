# SF Express Soft Skills — Nâng cấp v2: Admin Panel + Xác thực NV

## Bộ file
- `index.html` — trang chính (đã có cổng xác thực NV + toàn bộ Admin Panel).
- `worker.js` — Cloudflare Worker v2 (thêm auth admin, quản lý NV, ngân hàng câu hỏi, xuất/xóa data).
- `schema.sql` — schema D1 gốc (2 bảng `quiz_submissions`, `quiz_stats_public`) — **đã chạy rồi, không cần chạy lại**.
- `schema_v2.sql` — schema D1 **mới**, thêm 5 bảng: `admin_users`, `admin_sessions`, `employees`, `question_bank`, `program_config`.
- `seed_questions.sql` — nạp sẵn **60 câu hỏi thật** (Module 1-6) trích từ chương trình Kỹ Năng Mềm gốc vào `question_bank`.

## Các bước triển khai (chạy 1 lần)

Đứng trong thư mục chứa các file trên (nơi có `wrangler.toml`):

```powershell
# 1. Chạy schema mới (thêm bảng admin/employees/question_bank/program_config)
wrangler d1 execute sfexpress-quiz --remote --file=./schema_v2.sql

# 2. Nạp 60 câu hỏi có sẵn vào ngân hàng câu hỏi
wrangler d1 execute sfexpress-quiz --remote --file=./seed_questions.sql

# 3. Deploy lại Worker (bản v2 có toàn bộ API admin)
wrangler deploy
```

Sau đó thay file `index.html` cũ trên GitHub Pages bằng file `index.html` mới này (đã trỏ sẵn `WORKER_BASE_URL` về đúng Worker của bạn).

## Tài khoản Admin mặc định

- **Tài khoản:** `ADMIN`
- **Mật khẩu:** `67890`
- **Câu hỏi bảo mật:** "Vợ bạn tên gì?" → đáp án: `Hà`

Tài khoản này được Worker **tự động tạo** ở lần gọi API đầu tiên sau khi deploy (không cần chèn tay vào D1). Vào menu ☰ (hamburger) ở góc trên-trái trang web → mục **"Admin"** ở cuối menu để đăng nhập. Nên đổi mật khẩu ngay sau lần đăng nhập đầu tiên (tab "🔑 Đổi mật khẩu" trong Admin).

## Cách hoạt động của cổng xác thực nhân viên

- Khi vào trang, người dùng phải nhập **đúng Họ tên + Mã NV** đã có trong danh sách Admin quản lý (tab "👤 Nhân viên") mới được vào web.
- Danh sách nhân viên **ban đầu trống** — bạn cần vào Admin → tab Nhân viên → thêm chính tài khoản của bạn (và các NV khác) trước khi họ có thể vào web.
- Sau khi qua cổng, tên/ID được tự động điền vào phần làm bài Kỹ Năng Mềm — nhân viên không cần nhập lại.
- Bật "Tải báo cáo" cho nhân viên nào cần thấy nút **Extract Data** ở trang thống kê.

## Ngân hàng câu hỏi — cách Admin tự quản lý

Vào Admin → tab "❓ Ngân hàng câu hỏi":
- **Thêm từng câu:** điền form (Module, Đáp án đúng theo số thứ tự 1-6, câu hỏi, các lựa chọn).
- **Nhập hàng loạt (copy từ Excel):** dán trực tiếp các dòng đã copy từ Excel vào ô textarea, mỗi dòng 1 câu hỏi, các cột cách nhau bằng Tab, đúng thứ tự:
  `Chương trình | Nội dung câu hỏi | Đáp án đúng (số 1-6) | Lựa chọn 1 | ... | Lựa chọn 6`
  (Chương trình để trống = chương trình Kỹ Năng Mềm).

60 câu hỏi hiện có đã được nạp sẵn qua `seed_questions.sql` — không cần nhập lại, chỉ cần bổ sung câu mới nếu muốn.

## Cấu hình bài thi (số câu / ngưỡng đậu / thời gian)

Vào Admin → tab "⚙️ Cấu hình bài thi" — thay cho việc phải sửa code, giờ chỉ cần đổi số trong 3 ô: Số câu/bài thi, Điểm đậu, Thời gian làm bài (phút), bấm Lưu là áp dụng ngay từ lượt làm bài tiếp theo.

## Xuất Excel / Xóa dữ liệu

- **Extract Data** (trang thống kê, cho NV được cấp quyền, hoặc Admin → tab "🗑️ Dữ liệu"): tải file `.xlsx` chứa toàn bộ bài nộp (tên, mã NV, điểm, thời gian nộp...).
- **Xóa dữ liệu**: Admin → tab "🗑️ Dữ liệu" → nút xóa toàn bộ (có xác nhận, không thể hoàn tác).

## Lưu ý về thời gian nộp bài

`submitted_at` (thời gian máy chủ) và `client_submitted_at` (thời gian máy nhân viên) đã được lưu sẵn từ bản chuyển đổi Cloudflare trước đó — không cần bổ sung gì thêm, cả 2 đều xuất hiện trong file Excel khi Extract Data.

## Thêm chương trình đào tạo mới

Cơ chế nền (Admin, ngân hàng câu hỏi, cấu hình bài thi) đã dùng chung cho mọi chương trình qua `PROGRAM_ID`. Phần nội dung module/flashcard cho chương trình mới (Nghiệp vụ giao nhận, An toàn giao thông...) sẽ được làm ở bước tiếp theo.

