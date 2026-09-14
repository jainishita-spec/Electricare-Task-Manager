// ══════════════════════════════════════════════════════
// DEMO DRIVER  (in-memory SQLite — koi asli database nahi)
// ══════════════════════════════════════════════════════
// Sirf app ghoom kar dekhne ke liye. `.env` me DB_KIND=demo likho aur app
// bina MySQL/Postgres ke chal jaati hai.
//
//   Data process ki memory me rehta hai. Server band = sab data khatam.
//   PRODUCTION ME KABHI NAHI — yahan koi asli persistence nahi hai.
//
// Interface bilkul db-mysql.js jaisa hai (`[rows] = await db.query(...)`,
// `insertId`, `getConnection`), isliye server.js ko farak nahi padta.
//
// Do kaam karta hai:
//   1. data/migrations/mysql/*.sql ka schema SQLite ki boli me chadhata hai
//   2. server.js ki Postgres-boli queries ko har call par SQLite me badalta hai
//
// Schema poora chadhta hai (saari tables banti hain) — isliye jis page ka
// demo data nahi hai wo khaali dikhta hai, error nahi deta.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = path.join(__dirname, 'migrations', 'mysql');

// ── SQL comments hatao aur ';' par todo ───────────────
function statements(sql) {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

// ── DDL: MySQL -> SQLite ──────────────────────────────
function translateDDL(sql) {
  let s = sql;

  // ENGINE/CHARSET/COLLATE ka SQLite me koi wajood nahi
  s = s.replace(/\s*ENGINE\s*=\s*\w+/gi, '')
       .replace(/\s*DEFAULT\s+CHARSET\s*=\s*\w+/gi, '')
       .replace(/\s*COLLATE\s*=?\s*\w+/gi, '');

  // AUTO_INCREMENT column + alag likha "PRIMARY KEY (id)" -> ek hi inline PK.
  // SQLite me AUTOINCREMENT sirf INTEGER PRIMARY KEY par lagta hai.
  s = s.replace(/^(\s*)(\w+)\s+int\s+NOT NULL\s+AUTO_INCREMENT\s*,/gim,
                '$1$2 INTEGER PRIMARY KEY AUTOINCREMENT,');
  s = s.replace(/,\s*PRIMARY KEY\s*\(\s*\w+\s*\)(?=\s*[,)])/gi, '');

  // Types
  s = s.replace(/\b(longtext|mediumtext|tinytext|varchar\s*\(\s*\d+\s*\))/gi, 'TEXT')
       .replace(/\b(datetime|timestamp|date)\b(?!\s*\()/gi, 'TEXT')
       .replace(/\b(smallint|tinyint|bigint|int)\b/gi, 'INTEGER')
       .replace(/\bdecimal\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'REAL');

  // MySQL-only column clauses
  s = s.replace(/\s+ON UPDATE CURRENT_TIMESTAMP/gi, '')
       .replace(/\s+CHARACTER SET \w+/gi, '');

  // CHECK constraints chhod dete hain — demo data pehle se valid hai, aur
  // inke bina translation me ek kam cheez toot sakti hai.
  s = s.replace(/,?\s*CONSTRAINT\s+\w+\s+CHECK\s*\((?:[^()]|\([^()]*\))*\)/gi, '');

  // CONSTRAINT x UNIQUE (...) -> seedha UNIQUE (...)
  s = s.replace(/CONSTRAINT\s+\w+\s+UNIQUE/gi, 'UNIQUE');

  // Bachi hui khaali comma safai
  s = s.replace(/,(\s*\))/g, '$1');

  return s;
}

// Ek statement chalao; DDL me kuch na chade to demo rukta nahi — aage badhta hai
function execDDL(db, raw) {
  const s = raw.trim();
  if (!s) return;

  // MySQL-only, SQLite me matlab hi nahi
  if (/^ALTER TABLE\s+\w+\s+AUTO_INCREMENT/i.test(s)) return;

  // ALTER TABLE x ADD CONSTRAINT y UNIQUE (a,b) -> CREATE UNIQUE INDEX
  const uq = s.match(/^ALTER TABLE\s+(\w+)\s+ADD CONSTRAINT\s+(\w+)\s+UNIQUE\s*\(([^)]+)\)/i);
  if (uq) {
    try { db.exec('CREATE UNIQUE INDEX ' + uq[2] + ' ON ' + uq[1] + ' (' + uq[3] + ')'); } catch (e) {}
    return;
  }

  // DROP INDEX name ON table -> DROP INDEX name
  const di = s.match(/^DROP INDEX\s+(\w+)\s+ON\s+\w+/i);
  if (di) {
    try { db.exec('DROP INDEX IF EXISTS ' + di[1]); } catch (e) {}
    return;
  }

  // functional index: ON users ((LOWER(email))) -> ON users (LOWER(email))
  const out = translateDDL(s).replace(/\(\s*\((LOWER\([^)]*\))\)\s*\)/gi, '($1)');

  try {
    db.exec(out);
  } catch (e) {
    // Demo ke liye ye theek hai — jo table/index nahi bana, uska page khaali rahega
    console.warn('  [demo] skip: ' + e.message.slice(0, 90));
  }
}

function loadSchema(db) {
  const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    // 004 sirf purani cheezein girata hai — demo me kuch nahi bigadta, chhod do
    if (/^004_/.test(f)) continue;
    for (const st of statements(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))) {
      execDDL(db, st);
    }
  }
}

// ── Query: Postgres -> SQLite ─────────────────────────
// server.js ki saari SQL Postgres ki boli me likhi hai (db-mysql.js use MySQL
// me badalta hai) — yahan wahi kaam SQLite ke liye.
const FMT = [
  ['YYYY', '%Y'], ['HH24', '%H'], ['HH12', '%H'],
  ['MM', '%m'], ['DD', '%d'], ['MI', '%M'], ['SS', '%S'],
  ['AM', ''], ['PM', ''], ['HH', '%H'], ['YY', '%Y'],
];

function convFmt(fmt) {
  let out = '', i = 0;
  outer: while (i < fmt.length) {
    for (const pair of FMT) {
      if (fmt.startsWith(pair[0], i)) { out += pair[1]; i += pair[0].length; continue outer; }
    }
    out += fmt[i++];
  }
  return out;
}

function translateQuery(sql) {
  let s = sql;

  // TO_CHAR(x,'YYYY-MM-DD') -> strftime('%Y-%m-%d', x)
  if (/TO_CHAR\s*\(/i.test(s)) {
    s = s.replace(/TO_CHAR\s*\(\s*([^,]+?)\s*,\s*'([^']*)'\s*\)/gi,
      function (m, expr, fmt) { return "strftime('" + convFmt(fmt) + "'," + expr + ")"; });
  }

  // Mahine ka aakhri din (dashboard ka "upcoming")
  s = s.replace(
    /\(\s*date_trunc\s*\(\s*'month'\s*,\s*CURRENT_DATE\s*\)\s*\+\s*interval\s*'1 month - 1 day'\s*\)\s*::\s*date/gi,
    "date(CURRENT_DATE,'start of month','+1 month','-1 day')");

  // due_date + make_interval(days => ?::int) -> date(due_date, ? || ' days')
  s = s.replace(/(\w+(?:\.\w+)?)\s*\+\s*make_interval\s*\(\s*days\s*=>\s*\?\s*(?:::int)?\s*\)/gi,
    "date($1, ? || ' days')");

  // EXTRACT(YEAR FROM col)
  s = s.replace(/EXTRACT\s*\(\s*YEAR\s+FROM\s+([^)]+?)\s*\)/gi,
    "CAST(strftime('%Y',$1) AS INTEGER)");

  // Bache hue Postgres casts
  s = s.replace(/::\s*(int|integer|text|date|numeric|bigint)\b/gi, '');

  // NOW() -> IST (poora code IST maan kar chalta hai)
  s = s.replace(/\bNOW\s*\(\s*\)/gi, "datetime('now','+5 hours','+30 minutes')");

  // ON CONFLICT / EXCLUDED / RETURNING SQLite khud samajhta hai — chhoda hua.
  // Sirf Postgres ka xmax wala jugaad yahan nahi chalta:
  s = s.replace(/\bRETURNING\s*\(\s*xmax\s*=\s*0\s*\)\s*AS\s+"?inserted"?/gi, '');

  return s;
}

// SQLite sirf null/number/string/bigint/buffer leta hai
function normParam(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
}

// server.js boot par kuch "ensure schema" DDL bhi chalata hai (Postgres boli me:
// `serial`, `ADD COLUMN IF NOT EXISTS`, `DEFAULT NOW()`). Ye sab cheezein
// migrations pehle hi bana chuki hain, isliye yahan chalti hain to theek,
// "pehle se hai" wali error aaye to chup-chaap nigal lete hain.
function runDDL(db, sql) {
  const s = translateDDL(sql)
    .replace(/\bserial\b/gi, 'INTEGER')
    .replace(/\bDEFAULT\s+NOW\s*\(\s*\)/gi, 'DEFAULT CURRENT_TIMESTAMP')
    .replace(/\bADD COLUMN IF NOT EXISTS\b/gi, 'ADD COLUMN');

  try {
    db.exec(s);
  } catch (e) {
    const m = e.message || '';
    // "already exists" / "duplicate column" = kaam pehle se ho chuka hai
    if (!/already exists|duplicate column/i.test(m)) {
      console.warn('  [demo] DDL skip: ' + m.slice(0, 90));
    }
  }
  return [{ affectedRows: 0, insertId: 0 }, []];
}

function runQuery(db, sql, params) {
  if (/^\s*(CREATE|ALTER|DROP)\b/i.test(sql)) return runDDL(db, sql);

  const text = translateQuery(sql);
  const p = (params || []).map(normParam);
  const stmt = db.prepare(text);
  const returnsRows = /^\s*(SELECT|WITH|PRAGMA)/i.test(text) || /\bRETURNING\b/i.test(text);

  if (returnsRows) return [stmt.all.apply(stmt, p), []];
  const r = stmt.run.apply(stmt, p);
  return [{ affectedRows: Number(r.changes), insertId: Number(r.lastInsertRowid) }, []];
}

// ── Demo data ─────────────────────────────────────────
// Char role, taaki alag-alag login se UI ka farak dikhe.
const DEMO_PASSWORD = 'demo1234';
const DEMO_USERS = [
  { name: 'Demo Admin',    email: 'admin@demo.local', role: 'admin', department: 'Management', staff_type: 'office' },
  { name: 'Demo HOD',      email: 'hod@demo.local',   role: 'hod',   department: 'Production', staff_type: 'office' },
  { name: 'Demo PC',       email: 'pc@demo.local',    role: 'pc',    department: 'Management', staff_type: 'office' },
  { name: 'Demo Employee', email: 'user@demo.local',  role: 'user',  department: 'Production', staff_type: 'office' },
];

function ymd(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function seed(db) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const insUser = db.prepare(
    'INSERT INTO users (name,email,password,role,department,staff_type,week_off,created_at,session_version,view_only)' +
    " VALUES (?,?,?,?,?,?,'Sunday',?,1,0)");
  DEMO_USERS.forEach(function (u) {
    insUser.run(u.name, u.email, hash, u.role, u.department, u.staff_type, now);
  });

  const ADMIN = 1, HOD = 2, EMP = 4;

  // Delegation — ek-ek karke assign hone wale kaam
  const delegations = [
    ['Machine #3 ka monthly maintenance karwao',      EMP, ADMIN, ymd(-3), 'completed', 'high'],
    ['Naye dyes ka sample approve karao',             EMP, ADMIN, ymd(-1), 'pending',   'high'],
    ['Vendor quotations compare karke sheet bhejo',   EMP, HOD,   ymd(0),  'pending',   'medium'],
    ['Packing material ka stock count karo',          EMP, HOD,   ymd(2),  'pending',   'low'],
    ['Purani order files archive karo',               HOD, ADMIN, ymd(-5), 'completed', 'low'],
    ['Client ko revised delivery schedule mail karo', HOD, ADMIN, ymd(4),  'pending',   'medium'],
  ];
  const insDel = db.prepare(
    'INSERT INTO delegation_tasks (description,assigned_to,assigned_by,due_date,status,priority,created_at,completed_at)' +
    ' VALUES (?,?,?,?,?,?,?,?)');
  delegations.forEach(function (d) {
    insDel.run(d[0], d[1], d[2], d[3], d[4], d[5], now, d[4] === 'completed' ? now : null);
  });

  // Checklist — rozana/hafte ke tay kaam
  const checklists = [
    ['Daily production report bharo',   EMP, ADMIN, ymd(0),  'pending',   'high',   'daily'],
    ['Machine cleaning log sign karo',  EMP, ADMIN, ymd(0),  'pending',   'medium', 'daily'],
    ['Weekly stock reconciliation',     EMP, HOD,   ymd(-1), 'completed', 'high',   'weekly'],
    ['Attendance register update karo', HOD, ADMIN, ymd(0),  'pending',   'low',    'daily'],
    ['Fire safety equipment check',     HOD, ADMIN, ymd(-2), 'completed', 'high',   'monthly'],
  ];
  const insChk = db.prepare(
    'INSERT INTO checklist_tasks (description,assigned_to,assigned_by,due_date,status,priority,frequency,created_at,completed_at)' +
    ' VALUES (?,?,?,?,?,?,?,?,?)');
  checklists.forEach(function (c) {
    insChk.run(c[0], c[1], c[2], c[3], c[4], c[5], c[6], now, c[4] === 'completed' ? now : null);
  });
}

// ── Public interface (db-mysql.js ke barabar) ─────────
module.exports = function createDemo() {
  const g = globalThis;
  if (g.__smDemoApi) return g.__smDemoApi;

  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  loadSchema(db);
  seed(db);

  console.log('\n  ⚠️  DEMO MODE — in-memory SQLite, koi asli database nahi.');
  console.log('     Login: ' + DEMO_USERS.map(function (u) { return u.email; }).join(' / '));
  console.log('     Password (sabka): ' + DEMO_PASSWORD);
  console.log('     Server band hote hi saara data mit jayega.\n');

  const q = function (sql, params) { return Promise.resolve(runQuery(db, sql, params)); };

  // SQLite ek hi process me hai — transaction ka dikhawa kaafi hai
  const conn = {
    query: q,
    execute: q,
    beginTransaction: async function () {},
    commit: async function () {},
    rollback: async function () {},
    release: function () {},
  };

  const api = {
    kind: 'demo',
    query: q,
    execute: q,
    getConnection: async function () { return conn; },
    end: async function () { db.close(); },
    _translate: translateQuery,
    _demoUsers: DEMO_USERS,
    _demoPassword: DEMO_PASSWORD,
  };

  g.__smDemoApi = api;
  return api;
};
