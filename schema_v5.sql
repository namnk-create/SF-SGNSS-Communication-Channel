-- ============================================================
-- SCHEMA V5 — Chức danh nhân viên (BA/VAN/WA/SSM...) + đối tượng bắt buộc hoàn thành cho
-- từng chương trình/thông báo/bài test định kỳ, phục vụ tab "📊 Tổng quan" (Dashboard).
-- Chạy SAU schema_v4.sql. An toàn để chạy nhiều lần (trừ các dòng ALTER TABLE — mỗi dòng
-- chỉ nên chạy 1 lần; nếu D1 báo "duplicate column name" khi lỡ chạy lại thì bỏ qua lỗi đó).
-- ============================================================

-- Chức danh nhân viên — Admin tự đặt (VD: BA, VAN, WA, SSM), dùng để lọc thống kê và gán
-- đối tượng bắt buộc hoàn thành chương trình/thông báo/bài test.
ALTER TABLE employees ADD COLUMN title TEXT;

-- Đối tượng bắt buộc hoàn thành — lưu dạng JSON mảng chức danh, VD: ["BA","VAN"].
-- Để trống hoặc "[]" = áp dụng cho tất cả nhân viên (không giới hạn theo chức danh).
ALTER TABLE program_config ADD COLUMN required_titles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE announcements ADD COLUMN required_titles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE periodic_tests ADD COLUMN required_titles TEXT NOT NULL DEFAULT '[]';
