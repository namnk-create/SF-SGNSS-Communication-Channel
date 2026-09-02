-- ============================================================
-- SCHEMA V3 — Admin tự thiết kế nội dung chương trình học (module + flashcard),
-- trạng thái Live/Sắp có cho từng chương trình (hiện trên hamburger menu).
-- Chạy file này SAU schema_v2.sql. An toàn để chạy nhiều lần.
-- ============================================================

-- Module nội dung của 1 chương trình đào tạo — thay cho mảng MODULES cứng trong code.
-- content_html: admin gõ nội dung dạng HTML đơn giản (được phép <strong>, <i>, <br>, <ul><li>...),
-- hiển thị y hệt các khung lý thuyết/case-study trước đây nhưng giờ do admin tự viết.
CREATE TABLE IF NOT EXISTS course_modules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id    TEXT    NOT NULL DEFAULT '',
  module_order  INTEGER NOT NULL DEFAULT 1,
  title         TEXT    NOT NULL,
  color         TEXT    NOT NULL DEFAULT '#E11B22',  -- màu viền/nhấn của module (hex)
  content_html  TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_course_modules_program ON course_modules(program_id, module_order);

-- Flashcard ôn tập nhanh, thuộc về 1 module cụ thể (module_id).
CREATE TABLE IF NOT EXISTS module_flashcards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id    INTEGER NOT NULL,
  card_order   INTEGER NOT NULL DEFAULT 1,
  question     TEXT    NOT NULL,
  answer       TEXT    NOT NULL,
  FOREIGN KEY (module_id) REFERENCES course_modules(id)
);
CREATE INDEX IF NOT EXISTS idx_flashcards_module ON module_flashcards(module_id);

-- Thêm cột "status" vào program_config (nếu chưa có) để hiển thị "Sắp có"/"Live" trên
-- hamburger menu. SQLite không có "ADD COLUMN IF NOT EXISTS" nên bọc trong try — nếu cột
-- đã tồn tại (chạy lại file này lần 2), lệnh dưới sẽ báo lỗi nhưng KHÔNG ảnh hưởng dữ liệu,
-- bỏ qua lỗi đó nếu D1 báo "duplicate column name".
ALTER TABLE program_config ADD COLUMN status TEXT NOT NULL DEFAULT 'coming_soon';

-- Chương trình gốc Kỹ Năng Mềm luôn ở trạng thái Live (đã có nội dung thật từ trước).
UPDATE program_config SET status = 'live' WHERE program_id = '';
