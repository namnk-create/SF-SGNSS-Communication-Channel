-- ============================================================
-- SCHEMA V7 — Chức danh nhân viên quản lý động (thêm được qua Admin), theo dõi NV đã đọc
-- thông báo, liên kết Bài test định kỳ với 1 chương trình đào tạo cụ thể để bấm vào là
-- làm bài luôn (thay vì chỉ đọc nội dung tĩnh).
-- Chạy SAU schema_v6.sql. An toàn để chạy nhiều lần (trừ dòng ALTER TABLE).
-- ============================================================

-- Danh mục chức danh nhân viên — Admin tự thêm/xóa qua giao diện, không còn cứng cố định
-- BA/VAN/WA/SSM trong code nữa.
CREATE TABLE IF NOT EXISTS employee_titles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO employee_titles (name) VALUES ('BA'), ('VAN'), ('WA'), ('SSM'), ('SGNSS');

-- Ghi nhận nhân viên nào đã xác nhận "Đã đọc và nắm thông tin" cho từng thông báo —
-- dùng để tính % nhân viên đã nắm thông tin, và để không hiện lại nút xác nhận nếu đã bấm rồi.
CREATE TABLE IF NOT EXISTS announcement_reads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL,
  employee_id     TEXT    NOT NULL,
  read_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(announcement_id, employee_id)
);

-- Liên kết Bài test định kỳ với 1 chương trình đào tạo cụ thể (program_id) — để khi nhân
-- viên bấm vào mục này trên hamburger menu, hệ thống đưa thẳng vào làm bài thi của đúng
-- chương trình đó (dùng lại Ngân hàng câu hỏi + Cấu hình bài thi đã thiết lập sẵn), thay vì
-- chỉ hiển thị nội dung tĩnh.
ALTER TABLE periodic_tests ADD COLUMN linked_program_id TEXT;
