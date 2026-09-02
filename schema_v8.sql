-- ============================================================
-- SCHEMA V8 — Bài test định kỳ: giới hạn MỖI NHÂN VIÊN CHỈ ĐƯỢC LÀM 1 LẦN DUY NHẤT cho mỗi
-- bài test định kỳ cụ thể (khác với chương trình học thường vẫn cho làm lại thoải mái).
-- Cần cột periodic_test_id để phân biệt: 1 lượt nộp bài thuộc "bài test định kỳ nào" hay chỉ
-- là 1 lượt học/ôn tập thông thường của chương trình (periodic_test_id = NULL).
-- Chạy SAU schema_v7.sql.
-- ============================================================

ALTER TABLE quiz_submissions ADD COLUMN periodic_test_id INTEGER;
