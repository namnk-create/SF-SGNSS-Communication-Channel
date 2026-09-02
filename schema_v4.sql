-- ============================================================
-- SCHEMA V4 — Nội dung module/flashcard hỗ trợ 3 ngôn ngữ (Việt/Anh/Trung) xuyên suốt;
-- thêm 2 mục mới trên hamburger menu: Nội dung thông báo & Bài test định kỳ.
-- Chạy SAU schema_v3.sql. An toàn để chạy nhiều lần (trừ 2 dòng ALTER TABLE — mỗi dòng
-- chỉ nên chạy 1 lần; nếu lỡ chạy lại và D1 báo "duplicate column name" thì bỏ qua lỗi đó).
-- ============================================================

-- Thêm cột tiếng Anh/Trung cho module (cột "title"/"content_html" cũ giữ nguyên = tiếng Việt).
ALTER TABLE course_modules ADD COLUMN title_en TEXT;
ALTER TABLE course_modules ADD COLUMN title_zh TEXT;
ALTER TABLE course_modules ADD COLUMN content_html_en TEXT;
ALTER TABLE course_modules ADD COLUMN content_html_zh TEXT;

-- Thêm cột tiếng Anh/Trung cho flashcard (cột "question"/"answer" cũ giữ nguyên = tiếng Việt).
ALTER TABLE module_flashcards ADD COLUMN question_en TEXT;
ALTER TABLE module_flashcards ADD COLUMN question_zh TEXT;
ALTER TABLE module_flashcards ADD COLUMN answer_en TEXT;
ALTER TABLE module_flashcards ADD COLUMN answer_zh TEXT;

-- Nội dung thông báo — hiện dạng danh sách xổ ngay trong hamburger menu, mới nhất lên đầu.
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Bài test định kỳ — cùng cơ chế hiển thị như thông báo, danh sách riêng.
CREATE TABLE IF NOT EXISTS periodic_tests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
