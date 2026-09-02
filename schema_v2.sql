-- ============================================================
-- SCHEMA V2 — Nâng cấp thêm Admin, xác thực NV, ngân hàng câu hỏi động
-- Chạy file này SAU khi đã chạy schema.sql gốc (không xóa bảng cũ).
-- An toàn để chạy nhiều lần nhờ "IF NOT EXISTS".
-- ============================================================

-- Tài khoản Admin. Mật khẩu & câu trả lời bảo mật KHÔNG lưu dạng thô — Worker sẽ
-- băm (hash) bằng SHA-256 + salt riêng trước khi lưu, và tự tạo tài khoản
-- ADMIN/67890 mặc định (câu hỏi bảo mật "Vợ bạn tên gì?" / đáp án "Hà") ở lần
-- chạy đầu tiên nếu bảng này đang trống — không cần chèn tay ở đây.
CREATE TABLE IF NOT EXISTS admin_users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  username              TEXT    NOT NULL UNIQUE,
  password_hash         TEXT    NOT NULL,
  password_salt         TEXT    NOT NULL,
  security_question     TEXT    NOT NULL,
  security_answer_hash  TEXT    NOT NULL,
  security_answer_salt  TEXT    NOT NULL,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Phiên đăng nhập Admin (session token ngẫu nhiên, tự hết hạn sau X giờ).
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- Danh sách nhân viên được phép vào web (cổng nhập tên+ID ban đầu).
-- can_download_reports: 1 = được thấy nút "Extract Data" ở trang thống kê, 0 = không.
CREATE TABLE IF NOT EXISTS employees (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT    NOT NULL,
  employee_id           TEXT    NOT NULL UNIQUE,
  warehouse_code        TEXT,
  can_download_reports  INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);

-- Ngân hàng câu hỏi — thay cho mảng QUESTION_BANK cứng trong code.
-- correct_index: số 1-6, chỉ tới option nào (option1..option6) là đáp án đúng.
-- Các cột *_en / *_zh để trống nếu admin chưa dịch — khi đó web tự dùng bản
-- tiếng Việt để hiển thị cho người chọn ngôn ngữ Anh/Trung (tránh câu hỏi bị trống).
CREATE TABLE IF NOT EXISTS question_bank (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id     TEXT    NOT NULL DEFAULT '',
  module         INTEGER NOT NULL DEFAULT 1,
  correct_index  INTEGER NOT NULL,              -- 1..6
  question_vi    TEXT    NOT NULL,
  question_en    TEXT,
  question_zh    TEXT,
  option1_vi TEXT, option2_vi TEXT, option3_vi TEXT, option4_vi TEXT, option5_vi TEXT, option6_vi TEXT,
  option1_en TEXT, option2_en TEXT, option3_en TEXT, option4_en TEXT, option5_en TEXT, option6_en TEXT,
  option1_zh TEXT, option2_zh TEXT, option3_zh TEXT, option4_zh TEXT, option5_zh TEXT, option6_zh TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_question_bank_program ON question_bank(program_id, module);

-- Cấu hình mỗi chương trình đào tạo: số câu rút ngẫu nhiên, ngưỡng đậu, thời
-- gian làm bài (phút) — thay cho các hằng số cứng (20 câu, score>=16, 20 phút).
CREATE TABLE IF NOT EXISTS program_config (
  program_id        TEXT PRIMARY KEY,        -- '' = Kỹ Năng Mềm, '_giao-nhan', ...
  program_name      TEXT NOT NULL,
  questions_per_quiz INTEGER NOT NULL DEFAULT 20,
  pass_score        INTEGER NOT NULL DEFAULT 16,
  time_limit_minutes INTEGER NOT NULL DEFAULT 20,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO program_config (program_id, program_name, questions_per_quiz, pass_score, time_limit_minutes)
VALUES ('', 'Kỹ Năng Mềm', 20, 16, 20);
