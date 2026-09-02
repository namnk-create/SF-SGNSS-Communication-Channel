-- ============================================================
-- SCHEMA V9 — Thêm tùy chỉnh màu nền/màu chữ/in đậm cho flashcard, để mỗi flashcard có thể
-- nổi bật khác nhau (giống nhu cầu nhấn mạnh nội dung quan trọng).
-- Chạy SAU schema_v8.sql.
-- ============================================================

ALTER TABLE module_flashcards ADD COLUMN bg_color TEXT;
ALTER TABLE module_flashcards ADD COLUMN text_color TEXT;
ALTER TABLE module_flashcards ADD COLUMN is_bold INTEGER NOT NULL DEFAULT 0;
