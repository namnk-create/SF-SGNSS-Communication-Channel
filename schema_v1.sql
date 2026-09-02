-- Schema Cloudflare D1 cho SF Express Soft Skills Quiz
-- Thay thế 2 collection Firestore "quiz_submissions*" và "quiz_stats_public*".
-- Mọi chương trình đào tạo (Kỹ Năng Mềm, Nghiệp vụ giao nhận, ...) dùng CHUNG 2 bảng
-- này, phân biệt nhau bằng cột program_id (tương đương hậu tố PROGRAM_ID trong file
-- index.html của từng chương trình).

-- Bản ghi ĐẦY ĐỦ: tên, mã nhân viên, chi tiết từng câu trả lời.
-- Chỉ đọc được qua `wrangler d1 execute` hoặc tab D1 trên Cloudflare Dashboard —
-- Worker KHÔNG expose endpoint đọc bảng này ra internet.
CREATE TABLE IF NOT EXISTS quiz_submissions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id          TEXT    NOT NULL DEFAULT '',
  name                TEXT,
  employee_id         TEXT,
  language            TEXT,
  score               INTEGER,
  total               INTEGER,
  percentage          INTEGER,
  passed              INTEGER,          -- 0/1
  rating              INTEGER,
  module_scores       TEXT,             -- JSON: { "1": {correct,total}, ... }
  questions           TEXT,             -- JSON: chi tiết từng câu trả lời
  client_submitted_at TEXT,             -- ISO string, đồng hồ trình duyệt người nộp
  submitted_at        TEXT    NOT NULL DEFAULT (datetime('now'))  -- đồng hồ server (UTC)
);

-- Bản ghi CÔNG KHAI cho bảng thống kê đầu trang: điểm số, đạt/không đạt, kết quả theo
-- từng module, đánh giá 1-10 — KHÔNG có tên/ID/nội dung câu hỏi — an toàn để đọc công khai.
CREATE TABLE IF NOT EXISTS quiz_stats_public (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id    TEXT    NOT NULL DEFAULT '',
  score         INTEGER,
  total         INTEGER,
  percentage    INTEGER,
  passed        INTEGER,               -- 0/1
  rating        INTEGER,
  module_scores TEXT,                  -- JSON: { "1": {correct,total}, ... }
  submitted_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_submissions_program_time
  ON quiz_submissions(program_id, submitted_at);

CREATE INDEX IF NOT EXISTS idx_stats_public_program_time
  ON quiz_stats_public(program_id, submitted_at);
