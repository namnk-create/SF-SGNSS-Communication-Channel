-- ============================================================
-- SCHEMA V10 — Thêm mã PIN riêng cho từng nhân viên. Admin cấp PIN khi thêm/sửa NV, chỉ NV
-- đó biết. Bước xác thực vào hệ thống (cổng vào) giờ yêu cầu ĐÚNG Tên + Mã NV + PIN, thay vì
-- chỉ Tên + Mã NV (vốn không phải bí mật, ai cũng có thể biết được của đồng nghiệp).
-- Chạy SAU schema_v9.sql.
-- ============================================================

ALTER TABLE employees ADD COLUMN pin_hash TEXT;
ALTER TABLE employees ADD COLUMN pin_salt TEXT;
