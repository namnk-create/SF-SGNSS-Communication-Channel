-- ============================================================
-- SCHEMA V6 — Quản lý thời gian làm việc SSM/SGNSS (trang timesheet.html riêng, dùng
-- CHUNG Worker + D1 với hệ thống đào tạo). Chạy SAU schema_v5.sql.
-- ============================================================

-- Báo cáo từng khoảng thời gian làm việc trong ngày của SSM (1 ngày có thể có nhiều dòng).
CREATE TABLE IF NOT EXISTS time_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id     TEXT    NOT NULL,               -- mã NV (SSM), khớp employees.employee_id
  entry_date      TEXT    NOT NULL,               -- ngày báo cáo, định dạng YYYY-MM-DD
  from_time       TEXT    NOT NULL,               -- giờ bắt đầu, định dạng HH:MM
  to_time         TEXT    NOT NULL,               -- giờ kết thúc, định dạng HH:MM
  work_category   TEXT    NOT NULL,               -- Vận Hành / Hỗ trợ khách hàng / Họp / Đào tạo / Nghỉ giải lao
  efficiency_pct  INTEGER,                        -- % hiệu quả công việc (0-100)
  error_notes     TEXT,                           -- lỗi phát hiện & cách xử lý (nếu có)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_time_entries_emp_date ON time_entries(employee_id, entry_date);

-- Đơn xin nghỉ phép (cả ngày/nửa ngày) — cần SGNSS duyệt trước khi có hiệu lực.
CREATE TABLE IF NOT EXISTS leave_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT    NOT NULL,
  leave_date    TEXT    NOT NULL,                 -- ngày xin nghỉ, YYYY-MM-DD
  duration      TEXT    NOT NULL DEFAULT 'full',  -- 'full' (cả ngày) hoặc 'half' (nửa ngày)
  reason        TEXT,
  status        TEXT    NOT NULL DEFAULT 'pending', -- pending / approved / rejected
  reviewed_by   TEXT,                             -- mã NV SGNSS đã duyệt/từ chối
  reviewed_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON leave_requests(employee_id);

-- Công việc SGNSS giao cho SSM — SSM phải xác nhận nhận việc rồi cập nhật khi hoàn thành.
CREATE TABLE IF NOT EXISTS task_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assigned_to   TEXT    NOT NULL,                 -- mã NV SSM được giao việc
  assigned_by   TEXT    NOT NULL,                 -- mã NV SGNSS giao việc
  title         TEXT    NOT NULL,
  description   TEXT,
  deadline      TEXT,                             -- YYYY-MM-DD HH:MM (tùy chọn)
  status        TEXT    NOT NULL DEFAULT 'assigned', -- assigned / confirmed / completed
  confirmed_at  TEXT,
  completed_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_assignments_to ON task_assignments(assigned_to);

-- Danh mục chỉ số KPI công ty đặt ra (SGNSS/Admin định nghĩa 1 lần, mỗi SSM tự nhập giá trị
-- theo kỳ vào bảng kpi_entries bên dưới).
CREATE TABLE IF NOT EXISTS kpi_definitions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  unit          TEXT,                             -- đơn vị tính, VD: "%", "số lượng"...
  target_value  TEXT,                             -- chỉ tiêu mong muốn (tham khảo)
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Giá trị KPI thực tế mỗi SSM tự cập nhật theo từng kỳ (VD: "2026-09" theo tháng).
CREATE TABLE IF NOT EXISTS kpi_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_id        INTEGER NOT NULL,
  employee_id   TEXT    NOT NULL,
  period        TEXT    NOT NULL,                 -- VD: "2026-09"
  value         TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kpi_entries_emp_period ON kpi_entries(employee_id, period);
