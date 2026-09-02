-- ============================================================
-- SCHEMA V11 — Thay cơ chế PIN (schema_v10) bằng cơ chế MẬT KHẨU:
--   - Đăng nhập bằng Mã NV (username) + Mật khẩu.
--   - Mật khẩu BAN ĐẦU = chính Mã NV. Bắt buộc đổi mật khẩu ngay lần đăng nhập đầu tiên.
--   - Mật khẩu lưu DẠNG THÔ (không mã hóa) để Admin xem lại được trong bảng quản lý NV —
--     đây là lựa chọn có chủ đích cho hệ thống nội bộ, đánh đổi lấy khả năng Admin hỗ trợ NV.
-- Chạy SAU schema_v10.sql. Các cột pin_hash/pin_salt từ v10 không dùng nữa nhưng để nguyên,
-- không xóa (an toàn, không ảnh hưởng gì).
-- ============================================================

ALTER TABLE employees ADD COLUMN password_plain TEXT;
ALTER TABLE employees ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1;

-- Khởi tạo mật khẩu mặc định = chính Mã NV cho TOÀN BỘ nhân viên hiện có trong hệ thống.
UPDATE employees SET password_plain = employee_id WHERE password_plain IS NULL;
