/**
 * Cloudflare Worker — backend cho SF Express Soft Skills Quiz (v2).
 *
 * Cần 1 D1 database gắn vào Worker qua binding tên "DB" (xem wrangler.toml).
 * Chạy LẦN LƯỢT: schema.sql → schema_v2.sql → seed_questions.sql (1 lần duy nhất)
 * trên D1 đó trước khi dùng.
 *
 * ================= ENDPOINT CÔNG KHAI (không cần đăng nhập) =================
 *   POST /api/submit                 — nộp bài quiz
 *   GET  /api/stats                  — đọc thống kê công khai
 *   GET  /api/questions              — lấy bộ câu hỏi ngẫu nhiên để làm bài
 *   POST /api/employee/verify        — kiểm tra tên+ID nhân viên hợp lệ (cổng vào)
 *   GET  /api/program-config         — lấy cấu hình chương trình (số câu, ngưỡng đậu...)
 *
 * ================= ENDPOINT ADMIN (bắt buộc header Authorization: Bearer <token>) ====
 *   POST /api/admin/login
 *   POST /api/admin/forgot-password  — kiểm tra câu hỏi bảo mật, trả về reset token ngắn hạn
 *   POST /api/admin/reset-password   — đặt mật khẩu mới bằng reset token
 *   POST /api/admin/change-password  — đổi mật khẩu (khi đã đăng nhập)
 *   POST /api/admin/logout
 *   GET|POST|PUT|DELETE /api/admin/employees
 *   GET|POST|PUT|DELETE /api/admin/questions
 *   GET|PUT             /api/admin/program-config
 *   GET  /api/admin/export           — xuất toàn bộ quiz_submissions dạng JSON (FE dựng file Excel)
 *   DELETE /api/admin/submissions    — xóa data (theo id hoặc xóa hết theo programId)
 *
 * KHÔNG có endpoint đọc quiz_submissions công khai — chỉ admin đã đăng nhập mới gọi được
 * /api/admin/export.
 */

const ALLOWED_ORIGIN = "*"; // đổi thành domain thật nếu muốn giới hạn CORS
const SESSION_HOURS = 12;    // phiên đăng nhập admin hết hạn sau 12 giờ
const RESET_TOKEN_MINUTES = 10;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/* ---------------- Mật khẩu: hash bằng SHA-256 + salt ngẫu nhiên ---------------- */
function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashWithSalt(plain, salt) {
  return sha256Hex(salt + ":" + plain);
}

async function verifyHash(plain, salt, hash) {
  const computed = await hashWithSalt(plain, salt);
  return computed === hash;
}

/* ---------------- Bootstrap: tạo tài khoản admin mặc định lần đầu ---------------- */
async function ensureDefaultAdmin(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM admin_users").first();
  if (row && row.c > 0) return;
  const pwdSalt = randomHex();
  const pwdHash = await hashWithSalt("67890", pwdSalt);
  const ansSalt = randomHex();
  const ansHash = await hashWithSalt("Hà", ansSalt);
  await env.DB.prepare(
    `INSERT INTO admin_users (username, password_hash, password_salt, security_question, security_answer_hash, security_answer_salt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind("ADMIN", pwdHash, pwdSalt, "Vợ bạn tên gì?", ansHash, ansSalt).run();
}

// Tự động tạo sẵn 3 chương trình còn lại (nếu chưa có) để admin thấy ngay trong danh sách
// pill mà không cần bấm "+" thêm từng cái — INSERT OR IGNORE nên gọi lại nhiều lần vẫn an toàn.
async function ensureDefaultPrograms(env) {
  const defaults = [
    { id: "_giao-nhan", name: "Nghiệp vụ giao nhận hàng" },
    { id: "_an-toan-giao-thong", name: "An toàn giao thông" },
    { id: "_van-hanh-noi-bo", name: "Quy trình vận hành nội bộ" },
  ];
  const stmts = defaults.map((p) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO program_config (program_id, program_name, questions_per_quiz, pass_score, time_limit_minutes)
       VALUES (?, ?, 20, 16, 20)`
    ).bind(p.id, p.name)
  );
  await env.DB.batch(stmts);
}

/* ---------------- Kiểm tra session admin từ header Authorization ---------------- */
async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT username, expires_at FROM admin_sessions WHERE token = ?"
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return row.username;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      await ensureDefaultAdmin(env);
      await ensureDefaultPrograms(env);

      // ---------- Công khai ----------
      if (url.pathname === "/api/submit" && request.method === "POST") return handleSubmit(request, env);
      if (url.pathname === "/api/stats" && request.method === "GET") return handleStats(url, env);
      if (url.pathname === "/api/questions" && request.method === "GET") return handleGetQuestions(url, env);
      if (url.pathname === "/api/program-config" && request.method === "GET") return handleGetProgramConfig(url, env);
      if (url.pathname === "/api/employee/verify" && request.method === "POST") return handleEmployeeVerify(request, env);
      if (url.pathname === "/api/reports/export" && request.method === "GET") return handleEmployeeReportExport(url, env);
      if (url.pathname === "/api/programs" && request.method === "GET") return handleListProgramsPublic(env);
      if (url.pathname === "/api/course-content" && request.method === "GET") return handleGetCourseContent(url, env);
      if (url.pathname === "/api/announcements" && request.method === "GET") return handleListAnnouncements(env);
      if (url.pathname === "/api/periodic-tests" && request.method === "GET") return handleListPeriodicTests(env);
      if (url.pathname === "/api/periodic-tests/check-attempt" && request.method === "GET") return handleCheckPeriodicTestAttempt(url, env);
      if (url.pathname === "/api/announcement-reads") {
        if (request.method === "GET") return handleCheckAnnouncementRead(url, env);
        if (request.method === "POST") return handleConfirmAnnouncementRead(request, env);
      }
      if (url.pathname === "/api/employee-titles" && request.method === "GET") return handleListEmployeeTitlesPublic(env);

      // ---------- Quản lý thời gian làm việc SSM/SGNSS (timesheet.html) ----------
      // Xác thực nhẹ theo mã NV (giống cơ chế cổng vào NV) — không cần đăng nhập Admin,
      // vì đây là công cụ nội bộ cho dưới 10 SSM + 1 SGNSS, không phải dữ liệu công khai.
      if (url.pathname === "/api/timesheet/entries") {
        if (request.method === "POST") return handleCreateTimeEntry(request, env);
        if (request.method === "GET") return handleListTimeEntries(url, env);
        if (request.method === "DELETE") return handleDeleteTimeEntry(url, env);
      }
      if (url.pathname === "/api/timesheet/entries/all" && request.method === "GET")
        return handleListAllTimeEntries(url, env);

      if (url.pathname === "/api/timesheet/leave-requests") {
        if (request.method === "POST") return handleCreateLeaveRequest(request, env);
        if (request.method === "GET") return handleListLeaveRequests(url, env);
      }
      if (url.pathname === "/api/timesheet/leave-requests/all" && request.method === "GET")
        return handleListAllLeaveRequests(url, env);
      if (url.pathname === "/api/timesheet/leave-requests/review" && request.method === "POST")
        return handleReviewLeaveRequest(request, env);

      if (url.pathname === "/api/timesheet/tasks") {
        if (request.method === "POST") return handleCreateTask(request, env);
        if (request.method === "GET") return handleListMyTasks(url, env);
      }
      if (url.pathname === "/api/timesheet/tasks/all" && request.method === "GET")
        return handleListAllTasks(url, env);
      if (url.pathname === "/api/timesheet/tasks/confirm" && request.method === "POST")
        return handleConfirmTask(request, env);
      if (url.pathname === "/api/timesheet/tasks/complete" && request.method === "POST")
        return handleCompleteTask(request, env);

      if (url.pathname === "/api/timesheet/kpi-definitions") {
        if (request.method === "GET") return handleListKpiDefinitions(env);
        if (request.method === "POST") return handleCreateKpiDefinition(request, env);
        if (request.method === "DELETE") return handleDeleteKpiDefinition(url, env);
      }
      if (url.pathname === "/api/timesheet/kpi-entries") {
        if (request.method === "POST") return handleUpsertKpiEntry(request, env);
        if (request.method === "GET") return handleListKpiEntries(url, env);
      }
      if (url.pathname === "/api/timesheet/kpi-entries/all" && request.method === "GET")
        return handleListAllKpiEntries(url, env);

      // ---------- Admin: auth ----------
      if (url.pathname === "/api/admin/login" && request.method === "POST") return handleAdminLogin(request, env);
      if (url.pathname === "/api/admin/forgot-password" && request.method === "POST") return handleForgotPassword(request, env);
      if (url.pathname === "/api/admin/reset-password" && request.method === "POST") return handleResetPassword(request, env);
      if (url.pathname === "/api/admin/logout" && request.method === "POST") return handleAdminLogout(request, env);

      // ---------- Admin: các API còn lại cần đăng nhập ----------
      if (url.pathname.startsWith("/api/admin/")) {
        const username = await requireAdmin(request, env);
        if (!username) return jsonResponse({ error: "Unauthorized" }, 401);

        if (url.pathname === "/api/admin/change-password" && request.method === "POST")
          return handleChangePassword(request, env, username);

        if (url.pathname === "/api/admin/employees") {
          if (request.method === "GET") return handleListEmployees(env);
          if (request.method === "POST") return handleCreateEmployee(request, env);
          if (request.method === "PUT") return handleUpdateEmployee(request, env);
          if (request.method === "DELETE") return handleDeleteEmployee(url, env);
        }

        if (url.pathname === "/api/admin/questions") {
          if (request.method === "GET") return handleListQuestions(url, env);
          if (request.method === "POST") return handleCreateQuestions(request, env);
          if (request.method === "PUT") return handleUpdateQuestion(request, env);
          if (request.method === "DELETE") return handleDeleteQuestion(url, env);
        }

        if (url.pathname === "/api/admin/program-config") {
          if (request.method === "GET") return handleGetProgramConfig(url, env);
          if (request.method === "PUT") return handleUpdateProgramConfig(request, env);
        }

        if (url.pathname === "/api/admin/programs") {
          if (request.method === "GET") return handleListPrograms(env);
          if (request.method === "POST") return handleCreateProgram(request, env);
          if (request.method === "PUT") return handleUpdateProgramMeta(request, env);
          if (request.method === "DELETE") return handleDeleteProgram(url, env);
        }

        if (url.pathname === "/api/admin/modules") {
          if (request.method === "GET") return handleListModules(url, env);
          if (request.method === "POST") return handleCreateModule(request, env);
          if (request.method === "PUT") return handleUpdateModule(request, env);
          if (request.method === "DELETE") return handleDeleteModule(url, env);
        }

        if (url.pathname === "/api/admin/flashcards") {
          if (request.method === "GET") return handleListFlashcards(url, env);
          if (request.method === "POST") return handleCreateFlashcard(request, env);
          if (request.method === "PUT") return handleUpdateFlashcard(request, env);
          if (request.method === "DELETE") return handleDeleteFlashcard(url, env);
        }

        if (url.pathname === "/api/admin/announcements") {
          if (request.method === "GET") return handleListAnnouncements(env);
          if (request.method === "POST") return handleCreateAnnouncement(request, env);
          if (request.method === "PUT") return handleUpdateAnnouncement(request, env);
          if (request.method === "DELETE") return handleDeleteAnnouncement(url, env);
        }

        if (url.pathname === "/api/admin/periodic-tests") {
          if (request.method === "GET") return handleListPeriodicTests(env);
          if (request.method === "POST") return handleCreatePeriodicTest(request, env);
          if (request.method === "PUT") return handleUpdatePeriodicTest(request, env);
          if (request.method === "DELETE") return handleDeletePeriodicTest(url, env);
        }
        if (url.pathname === "/api/admin/periodic-tests/ensure-program" && request.method === "POST")
          return handleEnsurePeriodicTestProgram(request, env);

        if (url.pathname === "/api/admin/employee-titles") {
          if (request.method === "GET") return handleListEmployeeTitles(env);
          if (request.method === "POST") return handleCreateEmployeeTitle(request, env);
          if (request.method === "DELETE") return handleDeleteEmployeeTitle(url, env);
        }

        if (url.pathname === "/api/admin/export" && request.method === "GET")
          return handleExport(url, env);

        if (url.pathname === "/api/admin/submissions" && request.method === "DELETE")
          return handleDeleteSubmissions(request, env);

        if (url.pathname === "/api/admin/storage-info" && request.method === "GET")
          return handleStorageInfo(env);

        if (url.pathname === "/api/admin/dashboard-stats" && request.method === "GET")
          return handleDashboardStats(url, env);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: "Internal error", detail: String(err) }, 500);
    }
  },
};

/* ================= NỘP BÀI / THỐNG KÊ (giữ nguyên logic cũ) ================= */

async function handleSubmit(request, env) {
  const body = await request.json();
  const programId = typeof body.programId === "string" ? body.programId : "";
  const payload = body.payload || {};
  const publicStats = body.publicStats || {};
  const periodicTestId = body.periodicTestId ?? null;

  if (!payload.name || !payload.employeeId) {
    return jsonResponse({ error: "Missing name/employeeId" }, 400);
  }

  // Bài test định kỳ: mỗi NV CHỈ ĐƯỢC LÀM 1 LẦN DUY NHẤT — chặn ở server (không chỉ ẩn nút
  // trên giao diện) để tránh trường hợp NV mở lại link cũ / gọi thẳng API mà bỏ qua kiểm tra
  // phía client. Chương trình học thường (periodicTestId = null) KHÔNG bị giới hạn này.
  if (periodicTestId !== null) {
    const existing = await env.DB.prepare(
      "SELECT id FROM quiz_submissions WHERE periodic_test_id = ? AND employee_id = ?"
    ).bind(periodicTestId, payload.employeeId).first();
    if (existing) {
      return jsonResponse({ error: "Bạn đã hoàn thành bài test định kỳ này rồi, không thể làm lại." }, 409);
    }
  }

  const submittedAt = new Date().toISOString();

  const insertSubmission = env.DB.prepare(
    `INSERT INTO quiz_submissions
      (program_id, name, employee_id, language, score, total, percentage, passed,
       rating, module_scores, questions, client_submitted_at, submitted_at, periodic_test_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    programId, payload.name, payload.employeeId, payload.language ?? null,
    payload.score ?? null, payload.total ?? null, payload.percentage ?? null,
    payload.passed ? 1 : 0, payload.rating ?? null,
    JSON.stringify(payload.moduleScores ?? {}), JSON.stringify(payload.questions ?? []),
    payload.clientSubmittedAt ?? null, submittedAt, periodicTestId
  );

  const insertPublicStats = env.DB.prepare(
    `INSERT INTO quiz_stats_public
      (program_id, score, total, percentage, passed, rating, module_scores, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    programId, publicStats.score ?? null, publicStats.total ?? null,
    publicStats.percentage ?? null, publicStats.passed ? 1 : 0,
    publicStats.rating ?? null, JSON.stringify(publicStats.moduleScores ?? {}), submittedAt
  );

  await env.DB.batch([insertSubmission, insertPublicStats]);
  return jsonResponse({ ok: true, submittedAt });
}

async function handleStats(url, env) {
  const programId = url.searchParams.get("programId") ?? "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = `SELECT score, total, percentage, passed, rating, module_scores, submitted_at
               FROM quiz_stats_public WHERE program_id = ?`;
  const binds = [programId];
  if (from) { query += " AND submitted_at >= ?"; binds.push(from); }
  if (to) { query += " AND submitted_at <= ?"; binds.push(to); }
  query += " ORDER BY submitted_at ASC";

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  const rows = results.map((r) => ({
    score: r.score, total: r.total, percentage: r.percentage, passed: !!r.passed,
    rating: r.rating, moduleScores: safeParse(r.module_scores), submittedAt: r.submitted_at,
  }));
  return jsonResponse(rows);
}

/* ================= NGÂN HÀNG CÂU HỎI ================= */

async function handleGetQuestions(url, env) {
  const programId = url.searchParams.get("programId") ?? "";
  const config = await env.DB.prepare(
    "SELECT questions_per_quiz FROM program_config WHERE program_id = ?"
  ).bind(programId).first();
  const limit = config ? config.questions_per_quiz : 20;

  const { results } = await env.DB.prepare(
    "SELECT * FROM question_bank WHERE program_id = ?"
  ).bind(programId).all();

  const shuffled = [...results];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked = shuffled.slice(0, limit).map(rowToQuestion);
  return jsonResponse(picked);
}

function rowToQuestion(r) {
  const langOptions = (lang) => {
    const opts = [];
    for (let i = 1; i <= 6; i++) {
      const v = r[`option${i}_${lang}`];
      if (v !== null && v !== undefined && v !== "") opts.push(v);
    }
    return opts;
  };
  const viOpts = langOptions("vi");
  const enOpts = langOptions("en");
  const zhOpts = langOptions("zh");
  return {
    id: r.id,
    m: r.module,
    correct: r.correct_index - 1,
    vi: { q: r.question_vi, a: viOpts },
    en: { q: r.question_en || r.question_vi, a: enOpts.length ? enOpts : viOpts },
    zh: { q: r.question_zh || r.question_vi, a: zhOpts.length ? zhOpts : viOpts },
  };
}

async function handleListQuestions(url, env) {
  const programId = url.searchParams.get("programId") ?? "";
  const { results } = await env.DB.prepare(
    "SELECT * FROM question_bank WHERE program_id = ? ORDER BY module, id"
  ).bind(programId).all();
  return jsonResponse(results);
}

async function handleCreateQuestions(request, env) {
  const body = await request.json();
  const items = Array.isArray(body) ? body : [body];
  const stmts = items.map((q) => buildInsertQuestionStmt(env, q));
  await env.DB.batch(stmts);
  return jsonResponse({ ok: true, inserted: items.length });
}

function buildInsertQuestionStmt(env, q) {
  const cols = [
    "program_id", "module", "correct_index", "question_vi", "question_en", "question_zh",
    "option1_vi", "option2_vi", "option3_vi", "option4_vi", "option5_vi", "option6_vi",
    "option1_en", "option2_en", "option3_en", "option4_en", "option5_en", "option6_en",
    "option1_zh", "option2_zh", "option3_zh", "option4_zh", "option5_zh", "option6_zh",
  ];
  const opts = q.options || {};
  const vals = [
    q.programId ?? "", q.module ?? 1, q.correctIndex ?? 1, q.questionVi ?? "", q.questionEn ?? null, q.questionZh ?? null,
    opts.vi?.[0] ?? null, opts.vi?.[1] ?? null, opts.vi?.[2] ?? null, opts.vi?.[3] ?? null, opts.vi?.[4] ?? null, opts.vi?.[5] ?? null,
    opts.en?.[0] ?? null, opts.en?.[1] ?? null, opts.en?.[2] ?? null, opts.en?.[3] ?? null, opts.en?.[4] ?? null, opts.en?.[5] ?? null,
    opts.zh?.[0] ?? null, opts.zh?.[1] ?? null, opts.zh?.[2] ?? null, opts.zh?.[3] ?? null, opts.zh?.[4] ?? null, opts.zh?.[5] ?? null,
  ];
  return env.DB.prepare(
    `INSERT INTO question_bank (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
  ).bind(...vals);
}

async function handleUpdateQuestion(request, env) {
  const q = await request.json();
  if (!q.id) return jsonResponse({ error: "Missing id" }, 400);
  const opts = q.options || {};
  await env.DB.prepare(
    `UPDATE question_bank SET
       module = ?, correct_index = ?, question_vi = ?, question_en = ?, question_zh = ?,
       option1_vi=?, option2_vi=?, option3_vi=?, option4_vi=?, option5_vi=?, option6_vi=?,
       option1_en=?, option2_en=?, option3_en=?, option4_en=?, option5_en=?, option6_en=?,
       option1_zh=?, option2_zh=?, option3_zh=?, option4_zh=?, option5_zh=?, option6_zh=?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    q.module ?? 1, q.correctIndex ?? 1, q.questionVi ?? "", q.questionEn ?? null, q.questionZh ?? null,
    opts.vi?.[0] ?? null, opts.vi?.[1] ?? null, opts.vi?.[2] ?? null, opts.vi?.[3] ?? null, opts.vi?.[4] ?? null, opts.vi?.[5] ?? null,
    opts.en?.[0] ?? null, opts.en?.[1] ?? null, opts.en?.[2] ?? null, opts.en?.[3] ?? null, opts.en?.[4] ?? null, opts.en?.[5] ?? null,
    opts.zh?.[0] ?? null, opts.zh?.[1] ?? null, opts.zh?.[2] ?? null, opts.zh?.[3] ?? null, opts.zh?.[4] ?? null, opts.zh?.[5] ?? null,
    q.id
  ).run();
  return jsonResponse({ ok: true });
}

async function handleDeleteQuestion(url, env) {
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "Missing id" }, 400);
  await env.DB.prepare("DELETE FROM question_bank WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
}

/* ================= CẤU HÌNH CHƯƠNG TRÌNH ================= */

async function handleGetProgramConfig(url, env) {
  const programId = url.searchParams.get("programId") ?? "";
  let row = await env.DB.prepare(
    "SELECT * FROM program_config WHERE program_id = ?"
  ).bind(programId).first();
  if (!row) {
    row = { program_id: programId, program_name: programId || "Chương trình", questions_per_quiz: 20, pass_score: 16, time_limit_minutes: 20 };
  }
  return jsonResponse(row);
}

async function handleUpdateProgramConfig(request, env) {
  const body = await request.json();
  await env.DB.prepare(
    `INSERT INTO program_config (program_id, program_name, questions_per_quiz, pass_score, time_limit_minutes, required_titles, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(program_id) DO UPDATE SET
       program_name = excluded.program_name,
       questions_per_quiz = excluded.questions_per_quiz,
       pass_score = excluded.pass_score,
       time_limit_minutes = excluded.time_limit_minutes,
       required_titles = excluded.required_titles,
       updated_at = datetime('now')`
  ).bind(
    body.programId ?? "", body.programName ?? "", body.questionsPerQuiz ?? 20,
    body.passScore ?? 16, body.timeLimitMinutes ?? 20, JSON.stringify(body.requiredTitles ?? [])
  ).run();
  return jsonResponse({ ok: true });
}

/* ================= DANH SÁCH CHƯƠNG TRÌNH (dùng để hiện tab pill bên Admin) ================= */

async function handleListPrograms(env) {
  const { results } = await env.DB.prepare(
    "SELECT program_id, program_name, status FROM program_config ORDER BY (program_id = '') DESC, program_name ASC"
  ).all();
  return jsonResponse(results);
}

// Bản công khai (không cần đăng nhập) — dùng để dựng hamburger menu ngoài trang chủ, hiện
// đúng tên + trạng thái (Sắp có/Live) mà Admin đã thiết lập cho từng chương trình.
async function handleListProgramsPublic(env) {
  const { results } = await env.DB.prepare(
    "SELECT program_id, program_name, status FROM program_config ORDER BY (program_id = '') DESC, program_name ASC"
  ).all();
  return jsonResponse(results);
}

// Đổi tên và/hoặc trạng thái (Sắp có/Live) của 1 chương trình đã có.
async function handleUpdateProgramMeta(request, env) {
  const { programId, programName, status } = await request.json();
  if (programId === undefined || programId === null) {
    return jsonResponse({ error: "Thiếu programId" }, 400);
  }
  if (status && !["live", "coming_soon"].includes(status)) {
    return jsonResponse({ error: "status không hợp lệ" }, 400);
  }
  const existing = await env.DB.prepare(
    "SELECT * FROM program_config WHERE program_id = ?"
  ).bind(programId).first();
  if (!existing) return jsonResponse({ error: "Không tìm thấy chương trình" }, 404);
  await env.DB.prepare(
    `UPDATE program_config SET program_name = ?, status = ?, updated_at = datetime('now') WHERE program_id = ?`
  ).bind(programName ?? existing.program_name, status ?? existing.status ?? "coming_soon", programId).run();
  return jsonResponse({ ok: true });
}

// Thêm 1 chương trình đào tạo mới — programId phải là chuỗi duy nhất, không trùng chương
// trình đã có. Tự tạo 1 dòng program_config mặc định (20 câu / đậu 16 / 20 phút) để chương
// trình mới có thể dùng ngay được ở tab Ngân hàng câu hỏi / Cấu hình bài thi.
async function handleCreateProgram(request, env) {
  const { programId, programName } = await request.json();
  if (!programId || typeof programId !== "string" || !programId.trim()) {
    return jsonResponse({ error: "Thiếu mã chương trình" }, 400);
  }
  if (!programName || !programName.trim()) {
    return jsonResponse({ error: "Thiếu tên chương trình" }, 400);
  }
  const existing = await env.DB.prepare(
    "SELECT program_id FROM program_config WHERE program_id = ?"
  ).bind(programId.trim()).first();
  if (existing) {
    return jsonResponse({ error: "Mã chương trình này đã tồn tại" }, 409);
  }
  await env.DB.prepare(
    `INSERT INTO program_config (program_id, program_name, questions_per_quiz, pass_score, time_limit_minutes, status)
     VALUES (?, ?, 20, 16, 20, 'coming_soon')`
  ).bind(programId.trim(), programName.trim()).run();
  return jsonResponse({ ok: true });
}

// Xóa 1 chương trình khỏi danh sách quản lý (KHÔNG xóa dữ liệu bài nộp/ngân hàng câu hỏi đã
// có của chương trình đó — chỉ ẩn khỏi danh sách tab để tránh mất dữ liệu ngoài ý muốn; muốn
// xóa hẳn dữ liệu, dùng tab "Dữ liệu"). Không cho xóa chương trình gốc Kỹ Năng Mềm (id rỗng).
async function handleDeleteProgram(url, env) {
  const programId = url.searchParams.get("programId");
  if (programId === null) return jsonResponse({ error: "Thiếu programId" }, 400);
  if (programId === "") return jsonResponse({ error: "Không thể xóa chương trình Kỹ Năng Mềm gốc" }, 403);
  await env.DB.prepare("DELETE FROM program_config WHERE program_id = ?").bind(programId).run();
  return jsonResponse({ ok: true });
}

/* ================= NỘI DUNG KHÓA HỌC: MODULE + FLASHCARD ================= */
// Kiến trúc: mỗi module có content_html (admin tự viết, hỗ trợ thẻ HTML cơ bản như
// <strong>/<i>/<br>/<ul><li>) + màu nhấn riêng + danh sách flashcard ôn tập kèm theo.
// Đây là nội dung ĐƠN NGÔN NGỮ (khác với mảng MODULES cứng cũ có 3 ngôn ngữ) — khi hiển thị,
// front-end sẽ dùng chung 1 nội dung này cho cả 3 lựa chọn ngôn ngữ (giống cách ngân hàng
// câu hỏi admin nhập cũng chỉ có bản tiếng Việt).

// CÔNG KHAI — lấy toàn bộ module + flashcard của 1 chương trình để hiển thị trang học.
async function handleGetCourseContent(url, env) {
  const programId = url.searchParams.get("programId") ?? "";
  const { results: modules } = await env.DB.prepare(
    "SELECT * FROM course_modules WHERE program_id = ? ORDER BY module_order ASC, id ASC"
  ).bind(programId).all();
  if (!modules.length) return jsonResponse([]);

  const moduleIds = modules.map((m) => m.id);
  const placeholders = moduleIds.map(() => "?").join(",");
  const { results: flashcards } = await env.DB.prepare(
    `SELECT * FROM module_flashcards WHERE module_id IN (${placeholders}) ORDER BY card_order ASC, id ASC`
  ).bind(...moduleIds).all();

  const cardsByModule = {};
  flashcards.forEach((c) => {
    if (!cardsByModule[c.module_id]) cardsByModule[c.module_id] = [];
    cardsByModule[c.module_id].push({
      question: { vi: c.question, en: c.question_en || c.question, zh: c.question_zh || c.question },
      answer: { vi: c.answer, en: c.answer_en || c.answer, zh: c.answer_zh || c.answer },
      bgColor: c.bg_color || null,
      textColor: c.text_color || null,
      isBold: !!c.is_bold,
    });
  });

  // Chưa dịch Anh/Trung -> tự dùng bản tiếng Việt để không hiện trống khi đổi ngôn ngữ.
  const out = modules.map((m) => ({
    id: m.id,
    title: { vi: m.title, en: m.title_en || m.title, zh: m.title_zh || m.title },
    color: m.color,
    contentHtml: { vi: m.content_html, en: m.content_html_en || m.content_html, zh: m.content_html_zh || m.content_html },
    flashcards: cardsByModule[m.id] || [],
  }));
  return jsonResponse(out);
}

async function handleListModules(url, env) {
  const programId = url.searchParams.get("programId") ?? "";
  const { results } = await env.DB.prepare(
    "SELECT * FROM course_modules WHERE program_id = ? ORDER BY module_order ASC, id ASC"
  ).bind(programId).all();
  return jsonResponse(results);
}

async function handleCreateModule(request, env) {
  const { programId, titleVi, titleEn, titleZh, color, contentHtmlVi, contentHtmlEn, contentHtmlZh, moduleOrder } = await request.json();
  if (!titleVi || !titleVi.trim()) return jsonResponse({ error: "Thiếu tên module (tiếng Việt)" }, 400);
  let order = moduleOrder;
  if (!order) {
    const row = await env.DB.prepare(
      "SELECT COALESCE(MAX(module_order),0) AS maxOrder FROM course_modules WHERE program_id = ?"
    ).bind(programId ?? "").first();
    order = (row?.maxOrder || 0) + 1;
  }
  const result = await env.DB.prepare(
    `INSERT INTO course_modules (program_id, module_order, title, title_en, title_zh, color, content_html, content_html_en, content_html_zh)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    programId ?? "", order, titleVi.trim(), titleEn || null, titleZh || null,
    color || "#E11B22", contentHtmlVi || "", contentHtmlEn || null, contentHtmlZh || null
  ).run();
  return jsonResponse({ ok: true, id: result.meta.last_row_id });
}

async function handleUpdateModule(request, env) {
  const { id, titleVi, titleEn, titleZh, color, contentHtmlVi, contentHtmlEn, contentHtmlZh, moduleOrder } = await request.json();
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  await env.DB.prepare(
    `UPDATE course_modules SET title = ?, title_en = ?, title_zh = ?, color = ?,
       content_html = ?, content_html_en = ?, content_html_zh = ?, module_order = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(titleVi, titleEn || null, titleZh || null, color, contentHtmlVi, contentHtmlEn || null, contentHtmlZh || null, moduleOrder, id).run();
  return jsonResponse({ ok: true });
}

async function handleDeleteModule(url, env) {
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM module_flashcards WHERE module_id = ?").bind(id),
    env.DB.prepare("DELETE FROM course_modules WHERE id = ?").bind(id),
  ]);
  return jsonResponse({ ok: true });
}

async function handleListFlashcards(url, env) {
  const moduleId = url.searchParams.get("moduleId");
  if (!moduleId) return jsonResponse({ error: "Thiếu moduleId" }, 400);
  const { results } = await env.DB.prepare(
    "SELECT * FROM module_flashcards WHERE module_id = ? ORDER BY card_order ASC, id ASC"
  ).bind(moduleId).all();
  return jsonResponse(results);
}

async function handleCreateFlashcard(request, env) {
  const { moduleId, questionVi, questionEn, questionZh, answerVi, answerEn, answerZh, cardOrder, bgColor, textColor, isBold } = await request.json();
  if (!moduleId || !questionVi || !answerVi) return jsonResponse({ error: "Thiếu câu hỏi/đáp án (tiếng Việt)" }, 400);
  let order = cardOrder;
  if (!order) {
    const row = await env.DB.prepare(
      "SELECT COALESCE(MAX(card_order),0) AS maxOrder FROM module_flashcards WHERE module_id = ?"
    ).bind(moduleId).first();
    order = (row?.maxOrder || 0) + 1;
  }
  const result = await env.DB.prepare(
    `INSERT INTO module_flashcards (module_id, card_order, question, question_en, question_zh, answer, answer_en, answer_zh, bg_color, text_color, is_bold)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    moduleId, order, questionVi, questionEn || null, questionZh || null, answerVi, answerEn || null, answerZh || null,
    bgColor || null, textColor || null, isBold ? 1 : 0
  ).run();
  return jsonResponse({ ok: true, id: result.meta.last_row_id });
}

async function handleUpdateFlashcard(request, env) {
  const { id, questionVi, questionEn, questionZh, answerVi, answerEn, answerZh, cardOrder, bgColor, textColor, isBold } = await request.json();
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  await env.DB.prepare(
    `UPDATE module_flashcards SET question = ?, question_en = ?, question_zh = ?,
       answer = ?, answer_en = ?, answer_zh = ?, card_order = ?, bg_color = ?, text_color = ?, is_bold = ? WHERE id = ?`
  ).bind(
    questionVi, questionEn || null, questionZh || null, answerVi, answerEn || null, answerZh || null, cardOrder,
    bgColor || null, textColor || null, isBold ? 1 : 0, id
  ).run();
  return jsonResponse({ ok: true });
}

async function handleDeleteFlashcard(url, env) {
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  await env.DB.prepare("DELETE FROM module_flashcards WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
}

/* ================= THÔNG BÁO & BÀI TEST ĐỊNH KỲ (hiện ngay trong hamburger menu) ================= */

async function handleListAnnouncements(env) {
  const { results } = await env.DB.prepare("SELECT * FROM announcements ORDER BY created_at DESC").all();
  return jsonResponse(results);
}
async function handleCreateAnnouncement(request, env) {
  const { title, content, requiredTitles } = await request.json();
  if (!title || !title.trim()) return jsonResponse({ error: "Thiếu tiêu đề" }, 400);
  const result = await env.DB.prepare(
    "INSERT INTO announcements (title, content, required_titles) VALUES (?, ?, ?)"
  ).bind(title.trim(), content || "", JSON.stringify(requiredTitles ?? [])).run();
  return jsonResponse({ ok: true, id: result.meta.last_row_id });
}
async function handleUpdateAnnouncement(request, env) {
  const { id, title, content, requiredTitles } = await request.json();
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  if (!title || !title.trim()) return jsonResponse({ error: "Thiếu tiêu đề" }, 400);
  await env.DB.prepare(
    "UPDATE announcements SET title = ?, content = ?, required_titles = ? WHERE id = ?"
  ).bind(title.trim(), content || "", JSON.stringify(requiredTitles ?? []), id).run();
  return jsonResponse({ ok: true });
}
async function handleDeleteAnnouncement(url, env) {
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  await env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
}

async function handleListPeriodicTests(env) {
  const { results } = await env.DB.prepare("SELECT * FROM periodic_tests ORDER BY created_at DESC").all();
  return jsonResponse(results);
}
// Kiểm tra 1 NV đã làm bài test định kỳ này (theo id) chưa — dùng để chặn hiện nút "Bắt đầu
// làm bài" nếu đã làm rồi (mỗi bài test định kỳ chỉ được làm 1 lần duy nhất, khác với chương
// trình học thường vẫn cho làm lại thoải mái).
async function handleCheckPeriodicTestAttempt(url, env) {
  const periodicTestId = url.searchParams.get("periodicTestId");
  const employeeId = url.searchParams.get("employeeId");
  if (!periodicTestId || !employeeId) return jsonResponse({ error: "Thiếu dữ liệu" }, 400);
  const row = await env.DB.prepare(
    "SELECT passed, percentage, submitted_at FROM quiz_submissions WHERE periodic_test_id = ? AND employee_id = ?"
  ).bind(periodicTestId, employeeId).first();
  if (!row) return jsonResponse({ attempted: false });
  return jsonResponse({ attempted: true, passed: !!row.passed, percentage: row.percentage, submittedAt: row.submitted_at });
}
async function handleCreatePeriodicTest(request, env) {
  const { title, content, requiredTitles, linkedProgramId } = await request.json();
  if (!title || !title.trim()) return jsonResponse({ error: "Thiếu tiêu đề" }, 400);
  const result = await env.DB.prepare(
    "INSERT INTO periodic_tests (title, content, required_titles, linked_program_id) VALUES (?, ?, ?, ?)"
  ).bind(title.trim(), content || "", JSON.stringify(requiredTitles ?? []), linkedProgramId ?? null).run();
  return jsonResponse({ ok: true, id: result.meta.last_row_id });
}
async function handleUpdatePeriodicTest(request, env) {
  const { id, title, content, requiredTitles } = await request.json();
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  if (!title || !title.trim()) return jsonResponse({ error: "Thiếu tiêu đề" }, 400);
  await env.DB.prepare(
    "UPDATE periodic_tests SET title = ?, content = ?, required_titles = ? WHERE id = ?"
  ).bind(title.trim(), content || "", JSON.stringify(requiredTitles ?? []), id).run();
  return jsonResponse({ ok: true });
}
// Bài test định kỳ cần 1 "chương trình ẩn" riêng để chứa ngân hàng câu hỏi CHỈ DÀNH cho nó
// (không dùng chung/trộn với ngân hàng câu hỏi của các chương trình đào tạo khác). Hàm này
// tự động tạo chương trình đó (nếu bài test chưa có), rồi trả về programId để Admin bấm
// "Thiết lập câu hỏi" là được đưa thẳng vào đúng tab Ngân hàng câu hỏi của chương trình ẩn này.
// Gọi lại nhiều lần vẫn an toàn (idempotent) — nếu đã có linked_program_id thì trả về luôn.
async function handleEnsurePeriodicTestProgram(request, env) {
  const { periodicTestId } = await request.json();
  if (!periodicTestId) return jsonResponse({ error: "Thiếu periodicTestId" }, 400);
  const pt = await env.DB.prepare("SELECT * FROM periodic_tests WHERE id = ?").bind(periodicTestId).first();
  if (!pt) return jsonResponse({ error: "Không tìm thấy bài test định kỳ" }, 404);
  if (pt.linked_program_id) return jsonResponse({ ok: true, programId: pt.linked_program_id });
  const generatedId = `_pt${periodicTestId}`;
  await env.DB.prepare(
    `INSERT INTO program_config (program_id, program_name, questions_per_quiz, pass_score, time_limit_minutes, status)
     VALUES (?, ?, 20, 16, 20, 'live')
     ON CONFLICT(program_id) DO NOTHING`
  ).bind(generatedId, pt.title).run();
  await env.DB.prepare("UPDATE periodic_tests SET linked_program_id = ? WHERE id = ?").bind(generatedId, periodicTestId).run();
  return jsonResponse({ ok: true, programId: generatedId });
}
async function handleDeletePeriodicTest(url, env) {
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  await env.DB.prepare("DELETE FROM periodic_tests WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
}

/* ================= XÁC NHẬN ĐÃ ĐỌC THÔNG BÁO ================= */
async function handleCheckAnnouncementRead(url, env) {
  const announcementId = url.searchParams.get("announcementId");
  const employeeId = url.searchParams.get("employeeId");
  if (!announcementId || !employeeId) return jsonResponse({ error: "Thiếu dữ liệu" }, 400);
  const row = await env.DB.prepare(
    "SELECT read_at FROM announcement_reads WHERE announcement_id = ? AND employee_id = ?"
  ).bind(announcementId, employeeId).first();
  return jsonResponse({ read: !!row, readAt: row?.read_at || null });
}
async function handleConfirmAnnouncementRead(request, env) {
  const { announcementId, employeeId } = await request.json();
  if (!announcementId || !employeeId) return jsonResponse({ error: "Thiếu dữ liệu" }, 400);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO announcement_reads (announcement_id, employee_id) VALUES (?, ?)"
  ).bind(announcementId, employeeId).run();
  return jsonResponse({ ok: true });
}

/* ================= CHỨC DANH NHÂN VIÊN (quản lý động, không cứng BA/VAN/WA/SSM) ================= */
async function handleListEmployeeTitlesPublic(env) {
  const { results } = await env.DB.prepare("SELECT name FROM employee_titles ORDER BY name ASC").all();
  return jsonResponse(results.map((r) => r.name));
}
async function handleListEmployeeTitles(env) {
  const { results } = await env.DB.prepare("SELECT * FROM employee_titles ORDER BY name ASC").all();
  return jsonResponse(results);
}
async function handleCreateEmployeeTitle(request, env) {
  const { name } = await request.json();
  if (!name || !name.trim()) return jsonResponse({ error: "Thiếu tên chức danh" }, 400);
  try {
    const result = await env.DB.prepare("INSERT INTO employee_titles (name) VALUES (?)").bind(name.trim()).run();
    return jsonResponse({ ok: true, id: result.meta.last_row_id });
  } catch (err) {
    return jsonResponse({ error: "Chức danh này đã tồn tại" }, 409);
  }
}
async function handleDeleteEmployeeTitle(url, env) {
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "Thiếu id" }, 400);
  await env.DB.prepare("DELETE FROM employee_titles WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
}

async function handleEmployeeVerify(request, env) {
  const { name, employeeId } = await request.json();
  if (!name || !employeeId) return jsonResponse({ ok: false, error: "Thiếu tên hoặc mã NV" }, 400);
  const row = await env.DB.prepare(
    "SELECT name, employee_id, warehouse_code, title, can_download_reports FROM employees WHERE employee_id = ?"
  ).bind(employeeId.trim()).first();
  if (!row) return jsonResponse({ ok: false, error: "Mã nhân viên không tồn tại trong hệ thống" }, 404);
  const norm = (s) => s.trim().toLowerCase();
  if (norm(row.name) !== norm(name)) {
    return jsonResponse({ ok: false, error: "Tên không khớp với mã nhân viên" }, 403);
  }
  return jsonResponse({
    ok: true,
    name: row.name,
    employeeId: row.employee_id,
    warehouseCode: row.warehouse_code,
    title: row.title,
    canDownloadReports: !!row.can_download_reports,
  });
}

/* ================= ADMIN: AUTH ================= */

async function handleAdminLogin(request, env) {
  const { username, password } = await request.json();
  const row = await env.DB.prepare(
    "SELECT username, password_hash, password_salt FROM admin_users WHERE username = ? COLLATE NOCASE"
  ).bind((username || "").trim()).first();
  if (!row) return jsonResponse({ ok: false, error: "Sai tài khoản hoặc mật khẩu" }, 401);
  const valid = await verifyHash(password || "", row.password_salt, row.password_hash);
  if (!valid) return jsonResponse({ ok: false, error: "Sai tài khoản hoặc mật khẩu" }, 401);

  const token = randomHex(24);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, username, expires_at) VALUES (?, ?, ?)"
  ).bind(token, row.username, expiresAt).run();

  return jsonResponse({ ok: true, token, expiresAt, username: row.username });
}

async function handleAdminLogout(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
  return jsonResponse({ ok: true });
}

async function handleForgotPassword(request, env) {
  const { username, securityAnswer } = await request.json();
  const row = await env.DB.prepare(
    "SELECT username, security_answer_hash, security_answer_salt FROM admin_users WHERE username = ? COLLATE NOCASE"
  ).bind((username || "").trim()).first();
  if (!row) return jsonResponse({ ok: false, error: "Không tìm thấy tài khoản" }, 404);
  const valid = await verifyHash(securityAnswer || "", row.security_answer_salt, row.security_answer_hash);
  if (!valid) return jsonResponse({ ok: false, error: "Câu trả lời không đúng" }, 403);

  const resetToken = "RESET_" + randomHex(24);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, username, expires_at) VALUES (?, ?, ?)"
  ).bind(resetToken, row.username, expiresAt).run();

  return jsonResponse({ ok: true, resetToken, expiresInMinutes: RESET_TOKEN_MINUTES });
}

async function handleResetPassword(request, env) {
  const { resetToken, newPassword } = await request.json();
  if (!resetToken || !resetToken.startsWith("RESET_")) {
    return jsonResponse({ ok: false, error: "Token không hợp lệ" }, 400);
  }
  const row = await env.DB.prepare(
    "SELECT username, expires_at FROM admin_sessions WHERE token = ?"
  ).bind(resetToken).first();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return jsonResponse({ ok: false, error: "Token đã hết hạn, vui lòng thử lại bước quên mật khẩu" }, 401);
  }
  if (!newPassword || newPassword.length < 4) {
    return jsonResponse({ ok: false, error: "Mật khẩu mới phải có ít nhất 4 ký tự" }, 400);
  }
  const salt = randomHex();
  const hash = await hashWithSalt(newPassword, salt);
  await env.DB.prepare(
    "UPDATE admin_users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE username = ?"
  ).bind(hash, salt, row.username).run();
  await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(resetToken).run();
  return jsonResponse({ ok: true });
}

async function handleChangePassword(request, env, username) {
  const { currentPassword, newPassword } = await request.json();
  const row = await env.DB.prepare(
    "SELECT password_hash, password_salt FROM admin_users WHERE username = ?"
  ).bind(username).first();
  const valid = await verifyHash(currentPassword || "", row.password_salt, row.password_hash);
  if (!valid) return jsonResponse({ ok: false, error: "Mật khẩu hiện tại không đúng" }, 403);
  if (!newPassword || newPassword.length < 4) {
    return jsonResponse({ ok: false, error: "Mật khẩu mới phải có ít nhất 4 ký tự" }, 400);
  }
  const salt = randomHex();
  const hash = await hashWithSalt(newPassword, salt);
  await env.DB.prepare(
    "UPDATE admin_users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE username = ?"
  ).bind(hash, salt, username).run();
  return jsonResponse({ ok: true });
}

/* ================= ADMIN: QUẢN LÝ NHÂN VIÊN ================= */

async function handleListEmployees(env) {
  const { results } = await env.DB.prepare("SELECT * FROM employees ORDER BY name").all();
  return jsonResponse(results);
}

async function handleCreateEmployee(request, env) {
  const body = await request.json();
  const items = Array.isArray(body) ? body : [body];
  let inserted = 0;
  const errors = [];
  for (const e of items) {
    if (!e.name || !e.employeeId) { errors.push(`Thiếu tên/mã NV (dòng "${e.name || e.employeeId || "?"}")`); continue; }
    try {
      await env.DB.prepare(
        "INSERT INTO employees (name, employee_id, warehouse_code, title, can_download_reports) VALUES (?, ?, ?, ?, ?)"
      ).bind(e.name, e.employeeId, e.warehouseCode ?? null, e.title ?? null, e.canDownloadReports ? 1 : 0).run();
      await rememberEmployeeTitle(env, e.title);
      inserted++;
    } catch (err) {
      errors.push(`Mã NV "${e.employeeId}" đã tồn tại`);
    }
  }
  if (!Array.isArray(body) && inserted === 0) {
    return jsonResponse({ error: errors[0] || "Không thêm được nhân viên" }, 409);
  }
  return jsonResponse({ ok: true, inserted, errors });
}

async function handleUpdateEmployee(request, env) {
  const e = await request.json();
  if (!e.id) return jsonResponse({ error: "Missing id" }, 400);
  await env.DB.prepare(
    `UPDATE employees SET name = ?, employee_id = ?, warehouse_code = ?, title = ?, can_download_reports = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(e.name, e.employeeId, e.warehouseCode ?? null, e.title ?? null, e.canDownloadReports ? 1 : 0, e.id).run();
  await rememberEmployeeTitle(env, e.title);
  return jsonResponse({ ok: true });
}

// Chức danh giờ là ô nhập tự do (không bắt buộc chọn từ danh sách cố định) — mỗi khi admin
// gõ 1 chức danh mới, tự động ghi thêm vào bảng employee_titles (INSERT OR IGNORE, không lỗi
// nếu đã tồn tại) để chức danh đó xuất hiện ngay trong gợi ý và trong checkbox "Đối tượng bắt
// buộc hoàn thành" ở Cấu hình bài thi — không cần Admin phải quản lý danh sách riêng.
async function rememberEmployeeTitle(env, title) {
  if (!title || !title.trim()) return;
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO employee_titles (name) VALUES (?)").bind(title.trim()).run();
  } catch (e) { /* bỏ qua lỗi phụ, không ảnh hưởng thao tác chính */ }
}

async function handleDeleteEmployee(url, env) {
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "Missing id" }, 400);
  await env.DB.prepare("DELETE FROM employees WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
}

/* ================= ADMIN: XUẤT / XÓA DATA ================= */

/* ================= XUẤT BÁO CÁO CHO NHÂN VIÊN (không cần token admin) ================= */
// Chỉ trả dữ liệu nếu employeeId truyền vào thực sự có can_download_reports = 1 trong D1 —
// KHÔNG tin cờ canDownloadReports mà trình duyệt tự gửi lên (có thể bị sửa tay).
async function handleEmployeeReportExport(url, env) {
  const programId = url.searchParams.get("programId") ?? "";
  const employeeId = url.searchParams.get("employeeId") ?? "";
  if (!employeeId) return jsonResponse({ error: "Missing employeeId" }, 400);

  const emp = await env.DB.prepare(
    "SELECT can_download_reports FROM employees WHERE employee_id = ?"
  ).bind(employeeId).first();

  if (!emp || !emp.can_download_reports) {
    return jsonResponse({ error: "Không có quyền tải báo cáo" }, 403);
  }

  return handleExport(url, env);
}

// programId=&allPrograms=1 -> lấy TẤT CẢ chương trình (dùng cho tab Dữ liệu, xuất báo cáo tổng).
// from/to (ISO datetime) -> lọc theo khoảng thời gian nộp bài.
async function handleExport(url, env) {
  const programId = url.searchParams.get("programId");
  const allPrograms = url.searchParams.get("allPrograms") === "1";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = "SELECT * FROM quiz_submissions WHERE 1=1";
  const binds = [];
  if (!allPrograms) {
    query += " AND program_id = ?";
    binds.push(programId ?? "");
  }
  if (from) { query += " AND submitted_at >= ?"; binds.push(from); }
  if (to) { query += " AND submitted_at <= ?"; binds.push(to); }
  query += " ORDER BY submitted_at DESC";

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  const rows = results.map((r) => ({
    ...r,
    module_scores: safeParse(r.module_scores),
    questions: safeParse(r.questions),
  }));
  return jsonResponse(rows);
}

// Xóa theo id cụ thể, HOẶC theo (chương trình [hoặc tất cả] + khoảng thời gian [hoặc toàn bộ]).
// Luôn xóa đồng thời ở CẢ quiz_submissions và quiz_stats_public theo cùng điều kiện, để bảng
// thống kê công khai không còn hiện lại dữ liệu đã xóa.
async function handleDeleteSubmissions(request, env) {
  const { ids, programId, allPrograms, from, to, deleteAll } = await request.json();

  if (Array.isArray(ids) && ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    await env.DB.prepare(`DELETE FROM quiz_submissions WHERE id IN (${placeholders})`).bind(...ids).run();
    return jsonResponse({ ok: true, deleted: ids.length });
  }

  if (!deleteAll && !from && !to) {
    return jsonResponse({ error: "Cần truyền ids, hoặc from/to, hoặc deleteAll" }, 400);
  }

  let subWhere = "WHERE 1=1";
  let statsWhere = "WHERE 1=1";
  const subBinds = [];
  const statsBinds = [];
  if (!allPrograms) {
    subWhere += " AND program_id = ?"; subBinds.push(programId ?? "");
    statsWhere += " AND program_id = ?"; statsBinds.push(programId ?? "");
  }
  if (from) {
    subWhere += " AND submitted_at >= ?"; subBinds.push(from);
    statsWhere += " AND submitted_at >= ?"; statsBinds.push(from);
  }
  if (to) {
    subWhere += " AND submitted_at <= ?"; subBinds.push(to);
    statsWhere += " AND submitted_at <= ?"; statsBinds.push(to);
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM quiz_submissions ${subWhere}`).bind(...subBinds),
    env.DB.prepare(`DELETE FROM quiz_stats_public ${statsWhere}`).bind(...statsBinds),
  ]);
  return jsonResponse({ ok: true });
}

// Ước lượng dung lượng D1 đang dùng (page_count * page_size, theo cơ chế SQLite nội bộ)
// so với hạn mức Free Tier của Cloudflare D1 (5 GB tổng cho toàn bộ database trong account,
// tính tới thời điểm hiện tại — có thể thay đổi, xem developers.cloudflare.com/d1/platform/pricing).
// D1 CHẶN mọi câu PRAGMA đo dung lượng (page_count/page_size) — trả lỗi "not authorized:
// SQLITE_AUTH", đây là giới hạn cố định của nền tảng, không phải lỗi code. Cloudflare cũng
// không cung cấp API nào khác qua Worker binding để lấy dung lượng thật của database.
// Giải pháp: ƯỚC LƯỢNG dung lượng dữ liệu bằng cách cộng LENGTH() của các cột văn bản trong
// mọi bảng — đây là SQL thường, D1 cho phép bình thường. Con số này CHƯA gồm overhead lưu trữ
// nội bộ của SQLite (B-tree, index...) nên sẽ thấp hơn dung lượng thật hiển thị trên
// Cloudflare Dashboard/wrangler d1 info một chút, nhưng phản ánh đúng xu hướng tăng/giảm.
// Tổng hợp toàn bộ số liệu cho tab "📊 Tổng quan" — nhân viên theo kho/chức danh, mỗi
// chương trình có bao nhiêu module/câu hỏi và % nhân viên thuộc diện bắt buộc đã hoàn thành
// (đạt bài thi) trong khoảng thời gian đã chọn, cùng số thông báo/bài test định kỳ trong kỳ.
async function handleDashboardStats(url, env) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const employeesRes = await env.DB.prepare("SELECT id, employee_id, warehouse_code, title FROM employees").all();
  const programsRes = await env.DB.prepare("SELECT * FROM program_config").all();
  const modulesAggRes = await env.DB.prepare("SELECT program_id, COUNT(*) AS cnt FROM course_modules GROUP BY program_id").all();
  const questionsAggRes = await env.DB.prepare("SELECT program_id, COUNT(*) AS cnt FROM question_bank GROUP BY program_id").all();

  let subQuery = "SELECT program_id, employee_id, passed, periodic_test_id FROM quiz_submissions WHERE 1=1";
  const subBinds = [];
  if (from) { subQuery += " AND submitted_at >= ?"; subBinds.push(from); }
  if (to) { subQuery += " AND submitted_at <= ?"; subBinds.push(to); }
  const submissionsRes = await env.DB.prepare(subQuery).bind(...subBinds).all();

  let annQuery = "SELECT * FROM announcements WHERE 1=1";
  const annBinds = [];
  if (from) { annQuery += " AND created_at >= ?"; annBinds.push(from); }
  if (to) { annQuery += " AND created_at <= ?"; annBinds.push(to); }
  const annListRes = await env.DB.prepare(annQuery).bind(...annBinds).all();

  let ptQuery = "SELECT * FROM periodic_tests WHERE 1=1";
  const ptBinds = [];
  if (from) { ptQuery += " AND created_at >= ?"; ptBinds.push(from); }
  if (to) { ptQuery += " AND created_at <= ?"; ptBinds.push(to); }
  const ptListRes = await env.DB.prepare(ptQuery).bind(...ptBinds).all();

  // Đếm số NV đã xác nhận đọc cho MỌI thông báo trong 1 lượt (tránh N+1 query).
  const { results: readsAgg } = await env.DB.prepare(
    "SELECT announcement_id, COUNT(*) AS cnt FROM announcement_reads GROUP BY announcement_id"
  ).all();
  const readCountByAnnouncement = {};
  readsAgg.forEach((r) => { readCountByAnnouncement[r.announcement_id] = r.cnt; });

  const employees = employeesRes.results;
  const byWarehouse = {};
  const byTitle = {};
  // Bảng chéo Kho x Chức danh: pivot[maKho][tenChucDanh] = số lượng — để Admin xem 1 bảng
  // duy nhất thay vì 2 bảng tách rời, dễ đối chiếu cơ cấu nhân sự theo từng kho.
  const pivot = {};
  const titlesSet = new Set();
  employees.forEach((e) => {
    const wh = e.warehouse_code || "(chưa gán)";
    const t = e.title || "(chưa gán)";
    byWarehouse[wh] = (byWarehouse[wh] || 0) + 1;
    byTitle[t] = (byTitle[t] || 0) + 1;
    titlesSet.add(t);
    if (!pivot[wh]) pivot[wh] = {};
    pivot[wh][t] = (pivot[wh][t] || 0) + 1;
  });
  const titles = [...titlesSet].sort();

  // Hàm dùng chung: tính số NV đủ điều kiện theo danh sách chức danh bắt buộc (JSON string).
  function eligibleCodesFor(requiredTitlesJson) {
    let requiredTitles = [];
    try { requiredTitles = JSON.parse(requiredTitlesJson || "[]"); } catch (e) { requiredTitles = []; }
    const eligibleEmployees = requiredTitles.length
      ? employees.filter((e) => requiredTitles.includes(e.title))
      : employees;
    return { requiredTitles, eligibleCodes: new Set(eligibleEmployees.map((e) => e.employee_id)) };
  }

  const moduleCountByProgram = {};
  modulesAggRes.results.forEach((r) => { moduleCountByProgram[r.program_id] = r.cnt; });
  const questionCountByProgram = {};
  questionsAggRes.results.forEach((r) => { questionCountByProgram[r.program_id] = r.cnt; });

  // Gộp theo chương trình: tập hợp mã NV đã nộp bài + tập hợp mã NV đã ĐẠT (dùng Set để
  // tự loại trùng nếu 1 người nộp nhiều lần trong kỳ).
  const submittedByProgram = {};
  const passedByProgram = {};
  // Gộp RIÊNG theo từng bài test định kỳ (periodic_test_id) — KHÔNG dùng chung số liệu với
  // chương trình gốc, vì bài test định kỳ giới hạn 1 lần/NV và cần đo đúng lượt làm CHÍNH bài
  // test đó, không tính luôn cả những lần NV làm chương trình học thông thường (không giới hạn).
  const submittedByPeriodicTest = {};
  const passedByPeriodicTest = {};
  submissionsRes.results.forEach((s) => {
    if (!submittedByProgram[s.program_id]) submittedByProgram[s.program_id] = new Set();
    if (!passedByProgram[s.program_id]) passedByProgram[s.program_id] = new Set();
    submittedByProgram[s.program_id].add(s.employee_id);
    if (s.passed) passedByProgram[s.program_id].add(s.employee_id);
    if (s.periodic_test_id !== null && s.periodic_test_id !== undefined) {
      if (!submittedByPeriodicTest[s.periodic_test_id]) submittedByPeriodicTest[s.periodic_test_id] = new Set();
      if (!passedByPeriodicTest[s.periodic_test_id]) passedByPeriodicTest[s.periodic_test_id] = new Set();
      submittedByPeriodicTest[s.periodic_test_id].add(s.employee_id);
      if (s.passed) passedByPeriodicTest[s.periodic_test_id].add(s.employee_id);
    }
  });

  // Tính đầy đủ chỉ số hoàn thành từ 2 tập hợp (submitted/passed) + đối tượng bắt buộc —
  // dùng chung cho cả bảng "Chương trình đào tạo" (theo program_id) và bảng "Bài test định
  // kỳ" (theo periodic_test_id) bằng cách truyền vào đúng cặp Set tương ứng.
  function computeStatsFromSets(submittedSet, passedSet, requiredTitlesJson) {
    const { requiredTitles, eligibleCodes } = eligibleCodesFor(requiredTitlesJson);
    const passed = passedSet || new Set();
    const submitted = submittedSet || new Set();
    const passedInEligible = [...passed].filter((code) => eligibleCodes.has(code)).length;
    const submittedInEligible = [...submitted].filter((code) => eligibleCodes.has(code)).length;
    const failedInEligible = submittedInEligible - passedInEligible;
    const eligibleCount = eligibleCodes.size;
    return {
      requiredTitles,
      eligibleCount,
      submittedCount: submittedInEligible,
      passedCount: passedInEligible,
      failedCount: failedInEligible,
      passRatePct: submittedInEligible ? Math.round((passedInEligible / submittedInEligible) * 100) : null,
      failRatePct: submittedInEligible ? Math.round((failedInEligible / submittedInEligible) * 100) : null,
      completionPct: eligibleCount ? Math.round((passedInEligible / eligibleCount) * 100) : null,
    };
  }
  function computeProgramStats(programId, requiredTitlesJson) {
    return computeStatsFromSets(submittedByProgram[programId], passedByProgram[programId], requiredTitlesJson);
  }

  const programs = programsRes.results.map((p) => {
    const stats = computeProgramStats(p.program_id, p.required_titles);
    // Kỹ Năng Mềm (program_id rỗng) dùng 6 module CỨNG trong chính file index.html, không lưu
    // ở bảng course_modules nên COUNT() từ DB luôn ra 0 — cộng thêm số module cố định này để
    // hiển thị đúng thực tế trên Dashboard.
    const moduleCount = (moduleCountByProgram[p.program_id] || 0) + (p.program_id === "" ? 6 : 0);
    return {
      programId: p.program_id,
      programName: p.program_name,
      status: p.status,
      moduleCount,
      questionCount: questionCountByProgram[p.program_id] || 0,
      ...stats,
    };
  });

  // Mỗi thông báo: số NV đủ điều kiện (theo required_titles riêng của thông báo đó) và số
  // NV đã bấm "Xác nhận đã đọc" — để biết còn bao nhiêu người CHƯA nắm thông tin.
  const announcements = annListRes.results.map((a) => {
    const { requiredTitles, eligibleCodes } = eligibleCodesFor(a.required_titles);
    return {
      id: a.id,
      title: a.title,
      createdAt: a.created_at,
      requiredTitles,
      eligibleCount: eligibleCodes.size,
      confirmedCount: readCountByAnnouncement[a.id] || 0,
    };
  });

  // Mỗi bài test định kỳ: tính theo ĐÚNG lượt làm của chính bài test đó (periodic_test_id),
  // không lẫn với các lượt làm chương trình học thông thường (không giới hạn) của cùng
  // chương trình gốc — vì bài test định kỳ chỉ cho phép làm 1 lần duy nhất.
  const periodicTests = ptListRes.results.map((t) => {
    const stats = computeStatsFromSets(submittedByPeriodicTest[t.id], passedByPeriodicTest[t.id], t.required_titles);
    return {
      id: t.id,
      title: t.title,
      createdAt: t.created_at,
      linkedProgramId: t.linked_program_id,
      ...stats,
    };
  });

  return jsonResponse({
    employees: { total: employees.length, byWarehouse, byTitle, pivot, titles },
    programs,
    announcements,
    periodicTests,
    announcementsCount: announcements.length,
    periodicTestsCount: periodicTests.length,
  });
}

async function handleStorageInfo(env) {
  const tables = [
    { name: "quiz_submissions", cols: ["name", "employee_id", "language", "module_scores", "questions", "client_submitted_at", "submitted_at"] },
    { name: "quiz_stats_public", cols: ["module_scores", "submitted_at"] },
    { name: "employees", cols: ["name", "employee_id", "warehouse_code", "title", "created_at"] },
    { name: "question_bank", cols: ["question_vi", "question_en", "question_zh",
        "option1_vi", "option2_vi", "option3_vi", "option4_vi", "option5_vi", "option6_vi",
        "option1_en", "option2_en", "option3_en", "option4_en", "option5_en", "option6_en",
        "option1_zh", "option2_zh", "option3_zh", "option4_zh", "option5_zh", "option6_zh"] },
    { name: "admin_users", cols: ["username", "password_hash", "password_salt", "security_question", "security_answer_hash", "security_answer_salt"] },
    { name: "program_config", cols: ["program_id", "program_name", "status"] },
    { name: "course_modules", cols: ["program_id", "title", "title_en", "title_zh", "color", "content_html", "content_html_en", "content_html_zh"] },
    { name: "module_flashcards", cols: ["question", "question_en", "question_zh", "answer", "answer_en", "answer_zh", "bg_color", "text_color"] },
    { name: "announcements", cols: ["title", "content"] },
    { name: "periodic_tests", cols: ["title", "content", "linked_program_id"] },
    { name: "employee_titles", cols: ["name"] },
    { name: "announcement_reads", cols: ["announcement_id", "employee_id"] },
    { name: "time_entries", cols: ["employee_id", "entry_date", "from_time", "to_time", "work_category", "error_notes"] },
    { name: "leave_requests", cols: ["employee_id", "leave_date", "duration", "reason"] },
    { name: "task_assignments", cols: ["assigned_to", "assigned_by", "title", "description", "deadline"] },
    { name: "kpi_definitions", cols: ["name", "unit", "target_value"] },
    { name: "kpi_entries", cols: ["employee_id", "period", "value"] },
  ];
  let totalBytes = 0;
  let totalRows = 0;
  for (const t of tables) {
    const sumExpr = t.cols.map((c) => `COALESCE(LENGTH(${c}),0)`).join(" + ");
    try {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(${sumExpr}),0) AS bytes FROM ${t.name}`
      ).first();
      totalBytes += Number(row?.bytes || 0);
      totalRows += Number(row?.cnt || 0);
    } catch (e) {
      // Bảng có thể chưa tồn tại nếu admin chưa chạy schema mới nhất — bỏ qua, không chặn cả API.
    }
  }
  return jsonResponse({
    ok: true,
    sizeBytes: totalBytes,
    totalRows,
    limitBytes: 5 * 1024 * 1024 * 1024,
    approximate: true,
  });
}

/* ================================================================
   ===== QUẢN LÝ THỜI GIAN LÀM VIỆC SSM/SGNSS (timesheet.html) =====
   ================================================================ */

// Kiểm tra 1 mã NV có đúng là SGNSS không — dùng để chặn các thao tác chỉ SGNSS được làm
// (duyệt nghỉ phép, giao việc, tạo KPI...). Trả về true/false, không throw lỗi.
async function isSgnss(env, employeeId) {
  if (!employeeId) return false;
  const row = await env.DB.prepare("SELECT title FROM employees WHERE employee_id = ?").bind(employeeId).first();
  return !!row && row.title === "SGNSS";
}

/* ---- Báo cáo thời gian làm việc (time_entries) ---- */
async function handleCreateTimeEntry(request, env) {
  const b = await request.json();
  if (!b.employeeId || !b.entryDate || !b.fromTime || !b.toTime || !b.workCategory) {
    return jsonResponse({ error: "Thiếu dữ liệu bắt buộc" }, 400);
  }
  const result = await env.DB.prepare(
    `INSERT INTO time_entries (employee_id, entry_date, from_time, to_time, work_category, efficiency_pct, error_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(b.employeeId, b.entryDate, b.fromTime, b.toTime, b.workCategory, b.efficiencyPct ?? null, b.errorNotes || null).run();
  return jsonResponse({ ok: true, id: result.meta.last_row_id });
}
async function handleListTimeEntries(url, env) {
  const employeeId = url.searchParams.get("employeeId");
  if (!employeeId) return jsonResponse({ error: "Thiếu employeeId" }, 400);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let q = "SELECT * FROM time_entries WHERE employee_id = ?";
  const binds = [employeeId];
  if (from) { q += " AND entry_date >= ?"; binds.push(from); }
  if (to) { q += " AND entry_date <= ?"; binds.push(to); }
  q += " ORDER BY entry_date DESC, from_time DESC";
  const { results } = await env.DB.prepare(q).bind(...binds).all();
  return jsonResponse(results);
}
async function handleListAllTimeEntries(url, env) {
  const requesterId = url.searchParams.get("employeeId");
  if (!(await isSgnss(env, requesterId))) return jsonResponse({ error: "Chỉ SGNSS được xem toàn bộ báo cáo" }, 403);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let q = `SELECT t.*, e.name AS employee_name FROM time_entries t
           LEFT JOIN employees e ON e.employee_id = t.employee_id WHERE 1=1`;
  const binds = [];
  if (from) { q += " AND t.entry_date >= ?"; binds.push(from); }
  if (to) { q += " AND t.entry_date <= ?"; binds.push(to); }
  q += " ORDER BY t.entry_date DESC, t.from_time DESC";
  const { results } = await env.DB.prepare(q).bind(...binds).all();
  return jsonResponse(results);
}
async function handleDeleteTimeEntry(url, env) {
  const id = url.searchParams.get("id");
  const employeeId = url.searchParams.get("employeeId");
  if (!id || !employeeId) return jsonResponse({ error: "Thiếu id hoặc employeeId" }, 400);
  // Chỉ cho xóa đúng báo cáo của chính mình (khớp employee_id) để tránh sửa/xóa hộ người khác.
  await env.DB.prepare("DELETE FROM time_entries WHERE id = ? AND employee_id = ?").bind(id, employeeId).run();
  return jsonResponse({ ok: true });
}

/* ---- Xin nghỉ phép (leave_requests) ---- */
async function handleCreateLeaveRequest(request, env) {
  const b = await request.json();
  if (!b.employeeId || !b.leaveDate) return jsonResponse({ error: "Thiếu dữ liệu bắt buộc" }, 400);
  const result = await env.DB.prepare(
    "INSERT INTO leave_requests (employee_id, leave_date, duration, reason) VALUES (?, ?, ?, ?)"
  ).bind(b.employeeId, b.leaveDate, b.duration || "full", b.reason || null).run();
  return jsonResponse({ ok: true, id: result.meta.last_row_id });
}
async function handleListLeaveRequests(url, env) {
  const employeeId = url.searchParams.get("employeeId");
  if (!employeeId) return jsonResponse({ error: "Thiếu employeeId" }, 400);
  const { results } = await env.DB.prepare(
    "SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY leave_date DESC"
  ).bind(employeeId).all();
  return jsonResponse(results);
}
async function handleListAllLeaveRequests(url, env) {
  const requesterId = url.searchParams.get("employeeId");
  if (!(await isSgnss(env, requesterId))) return jsonResponse({ error: "Chỉ SGNSS được xem toàn bộ đơn nghỉ phép" }, 403);
  const { results } = await env.DB.prepare(
    `SELECT l.*, e.name AS employee_name FROM leave_requests l
     LEFT JOIN employees e ON e.employee_id = l.employee_id ORDER BY l.created_at DESC`
  ).all();
  return jsonResponse(results);
}
async function handleReviewLeaveRequest(request, env) {
  const { requestId, decision, reviewerEmployeeId } = await request.json();
  if (!requestId || !["approved", "rejected"].includes(decision)) {
    return jsonResponse({ error: "Dữ liệu không hợp lệ" }, 400);
  }
  if (!(await isSgnss(env, reviewerEmployeeId))) return jsonResponse({ error: "Chỉ SGNSS được duyệt nghỉ phép" }, 403);
  await env.DB.prepare(
    "UPDATE leave_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?"
  ).bind(decision, reviewerEmployeeId, requestId).run();
  return jsonResponse({ ok: true });
}

/* ---- Giao việc (task_assignments) ---- */
async function handleCreateTask(request, env) {
  const b = await request.json();
  if (!b.assignedTo || !b.assignedBy || !b.title) return jsonResponse({ error: "Thiếu dữ liệu bắt buộc" }, 400);
  if (!(await isSgnss(env, b.assignedBy))) return jsonResponse({ error: "Chỉ SGNSS được giao việc" }, 403);
  const result = await env.DB.prepare(
    "INSERT INTO task_assignments (assigned_to, assigned_by, title, description, deadline) VALUES (?, ?, ?, ?, ?)"
  ).bind(b.assignedTo, b.assignedBy, b.title, b.description || null, b.deadline || null).run();
  return jsonResponse({ ok: true, id: result.meta.last_row_id });
}
async function handleListMyTasks(url, env) {
  const employeeId = url.searchParams.get("employeeId");
  if (!employeeId) return jsonResponse({ error: "Thiếu employeeId" }, 400);
  const { results } = await env.DB.prepare(
    "SELECT * FROM task_assignments WHERE assigned_to = ? ORDER BY created_at DESC"
  ).bind(employeeId).all();
  return jsonResponse(results);
}
async function handleListAllTasks(url, env) {
  const requesterId = url.searchParams.get("employeeId");
  if (!(await isSgnss(env, requesterId))) return jsonResponse({ error: "Chỉ SGNSS được xem toàn bộ công việc" }, 403);
  const { results } = await env.DB.prepare(
    `SELECT t.*, e.name AS assigned_to_name FROM task_assignments t
     LEFT JOIN employees e ON e.employee_id = t.assigned_to ORDER BY t.created_at DESC`
  ).all();
  return jsonResponse(results);
}
async function handleConfirmTask(request, env) {
  const { taskId, employeeId } = await request.json();
  if (!taskId || !employeeId) return jsonResponse({ error: "Thiếu dữ liệu" }, 400);
  await env.DB.prepare(
    "UPDATE task_assignments SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ? AND assigned_to = ?"
  ).bind(taskId, employeeId).run();
  return jsonResponse({ ok: true });
}
async function handleCompleteTask(request, env) {
  const { taskId, employeeId } = await request.json();
  if (!taskId || !employeeId) return jsonResponse({ error: "Thiếu dữ liệu" }, 400);
  await env.DB.prepare(
    "UPDATE task_assignments SET status = 'completed', completed_at = datetime('now') WHERE id = ? AND assigned_to = ?"
  ).bind(taskId, employeeId).run();
  return jsonResponse({ ok: true });
}

/* ---- KPI ---- */
async function handleListKpiDefinitions(env) {
  const { results } = await env.DB.prepare("SELECT * FROM kpi_definitions ORDER BY id ASC").all();
  return jsonResponse(results);
}
async function handleCreateKpiDefinition(request, env) {
  const { name, unit, targetValue, creatorEmployeeId } = await request.json();
  if (!name) return jsonResponse({ error: "Thiếu tên chỉ số KPI" }, 400);
  if (!(await isSgnss(env, creatorEmployeeId))) return jsonResponse({ error: "Chỉ SGNSS được tạo chỉ số KPI" }, 403);
  const result = await env.DB.prepare(
    "INSERT INTO kpi_definitions (name, unit, target_value) VALUES (?, ?, ?)"
  ).bind(name, unit || null, targetValue || null).run();
  return jsonResponse({ ok: true, id: result.meta.last_row_id });
}
async function handleDeleteKpiDefinition(url, env) {
  const id = url.searchParams.get("id");
  const requesterId = url.searchParams.get("employeeId");
  if (!(await isSgnss(env, requesterId))) return jsonResponse({ error: "Chỉ SGNSS được xóa chỉ số KPI" }, 403);
  await env.DB.prepare("DELETE FROM kpi_definitions WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
}
async function handleUpsertKpiEntry(request, env) {
  const { kpiId, employeeId, period, value } = await request.json();
  if (!kpiId || !employeeId || !period) return jsonResponse({ error: "Thiếu dữ liệu bắt buộc" }, 400);
  const existing = await env.DB.prepare(
    "SELECT id FROM kpi_entries WHERE kpi_id = ? AND employee_id = ? AND period = ?"
  ).bind(kpiId, employeeId, period).first();
  if (existing) {
    await env.DB.prepare("UPDATE kpi_entries SET value = ?, updated_at = datetime('now') WHERE id = ?").bind(value, existing.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO kpi_entries (kpi_id, employee_id, period, value) VALUES (?, ?, ?, ?)"
    ).bind(kpiId, employeeId, period, value).run();
  }
  return jsonResponse({ ok: true });
}
async function handleListKpiEntries(url, env) {
  const employeeId = url.searchParams.get("employeeId");
  if (!employeeId) return jsonResponse({ error: "Thiếu employeeId" }, 400);
  const { results } = await env.DB.prepare(
    "SELECT * FROM kpi_entries WHERE employee_id = ? ORDER BY period DESC"
  ).bind(employeeId).all();
  return jsonResponse(results);
}
async function handleListAllKpiEntries(url, env) {
  const requesterId = url.searchParams.get("employeeId");
  if (!(await isSgnss(env, requesterId))) return jsonResponse({ error: "Chỉ SGNSS được xem toàn bộ KPI" }, 403);
  const period = url.searchParams.get("period");
  let q = `SELECT k.*, e.name AS employee_name, d.name AS kpi_name, d.unit AS kpi_unit
           FROM kpi_entries k
           LEFT JOIN employees e ON e.employee_id = k.employee_id
           LEFT JOIN kpi_definitions d ON d.id = k.kpi_id WHERE 1=1`;
  const binds = [];
  if (period) { q += " AND k.period = ?"; binds.push(period); }
  q += " ORDER BY k.employee_id, d.name";
  const { results } = await env.DB.prepare(q).bind(...binds).all();
  return jsonResponse(results);
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return {}; }
}
