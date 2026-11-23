// Curriculum Tree service. Plain Node, no dependencies.
// Serves the page and the course files, keeps the roster, and stores each student's attempt log on disk.
//
//   DATA_DIR      where data lives. On Render, the mount path of the disk (for example /var/data).
//   TEACHER_KEY   the teacher's key. If unset, one is made on first start and written to DATA_DIR/teacher-key.txt.
//   PORT          set by Render.

const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public'), COURSES = path.join(__dirname, 'courses');
const PORT = process.env.PORT || 3000;
fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'state'), { recursive: true });

const keyFile = path.join(DATA, 'teacher-key.txt');
let KEY = process.env.TEACHER_KEY;
if (!KEY) { if (fs.existsSync(keyFile)) KEY = fs.readFileSync(keyFile, 'utf8').trim(); else { KEY = crypto.randomBytes(12).toString('base64url'); fs.writeFileSync(keyFile, KEY + '\n'); console.log('Teacher key written to', keyFile); } }

// ---------- roster ----------
const rosterFile = path.join(DATA, 'roster.json');
const makeRoster = () => {
  let data = { classes: [] };
  try { data = JSON.parse(fs.readFileSync(rosterFile, 'utf8')); } catch (e) { /* first run */ }
  const byToken = new Map();
  const index = () => { byToken.clear(); data.classes.forEach(c => c.students.forEach(s => byToken.set(s.token, { student: s, cls: c }))); };
  const save = () => { const tmp = rosterFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1)); fs.renameSync(tmp, rosterFile); index(); };
  const id = n => crypto.randomBytes(n).toString('base64url');
  index();
  return {
    all: () => data.classes,
    find: token => byToken.get(String(token || '')) || null,
    cls: cid => data.classes.find(c => c.id === cid) || null,
    addNames: (cid, name, names) => {
      let c = data.classes.find(x => x.id === cid);
      if (!c) { c = { id: id(5), name: String(name || 'Class').slice(0, 80), students: [] }; data.classes.push(c); }
      names.map(n => String(n).trim().slice(0, 80)).filter(Boolean).forEach(n => { if (!c.students.some(s => s.name === n)) c.students.push({ id: id(6), name: n, token: id(16) }); });
      save(); return c;
    },
    rename: (cid, name) => { const c = data.classes.find(x => x.id === cid); if (c) { c.name = String(name).slice(0, 80); save(); } return c; },
    removeClass: cid => { data.classes = data.classes.filter(c => c.id !== cid); save(); },
    removeStudent: sid => { data.classes.forEach(c => { c.students = c.students.filter(s => s.id !== sid); }); save(); },
    relink: sid => { let out = null; data.classes.forEach(c => c.students.forEach(s => { if (s.id === sid) { s.token = id(16); out = s; } })); save(); return out; },
  };
};
const roster = makeRoster();

// ---------- attempt logs: one append-only file per student ----------
const logFile = sid => path.join(DATA, 'logs', sid + '.jsonl'), stateFile = sid => path.join(DATA, 'state', sid + '.json');
const entryKey = e => [e.t, e.i || '', e.k || '', e.n || ''].join('|');
const readLog = sid => { try { return fs.readFileSync(logFile(sid), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; } };
const readState = sid => { try { return JSON.parse(fs.readFileSync(stateFile(sid), 'utf8')); } catch (e) { return { flags: {}, seen: {} }; } };
const clean = e => { const o = { t: +e.t || Date.now(), n: String(e.n || '').slice(0, 120) }; if (e.k) { o.k = e.k === 'reset' ? 'reset' : 'rust'; if (o.k === 'rust') o.a = e.a === 2 ? 2 : 1; } else { o.i = String(e.i || '').slice(0, 140); o.ok = e.ok ? 1 : 0; o.a = String(e.a == null ? '' : e.a).slice(0, 80); } return o; };
const appendLog = (sid, entries) => {
  const have = new Set(readLog(sid).map(entryKey)); const fresh = [];
  entries.slice(0, 5000).map(clean).forEach(e => { const k = entryKey(e); if (!have.has(k)) { have.add(k); fresh.push(e); } });
  if (fresh.length) fs.appendFileSync(logFile(sid), fresh.map(e => JSON.stringify(e)).join('\n') + '\n');
  return have.size;
};
const mergeState = (sid, st) => {
  const cur = readState(sid), pick = o => { const out = {}; Object.keys(o || {}).slice(0, 5000).forEach(k => { if (o[k]) out[String(k).slice(0, 120)] = 1; }); return out; };
  const next = { flags: pick(st.flags), seen: Object.assign(cur.seen || {}, pick(st.seen)) };   // flags are replaced, seen only grows
  fs.writeFileSync(stateFile(sid), JSON.stringify(next)); return next;
};

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, code, body, type) => { const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); res.writeHead(code, { 'content-type': type || 'application/json', 'content-length': buf.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(buf); };
const readBody = req => new Promise((ok, no) => { let n = 0; const parts = []; req.on('data', c => { n += c.length; if (n > 2e6) { no(new Error('too large')); req.destroy(); } else parts.push(c); }); req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { no(e); } }); req.on('error', no); });
const isTeacher = req => { const k = String(req.headers['x-teacher-key'] || ''); const a = Buffer.from(k), b = Buffer.from(KEY); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const staticFile = (res, root, rel) => { const file = path.join(root, rel); if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' }); send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream'); };

const routes = {
  'GET /api/courses': () => ({ files: fs.existsSync(COURSES) ? fs.readdirSync(COURSES).filter(f => f.endsWith('.course.txt')).sort() : [] }),
  // student
  'GET /api/me': (req, q) => { const f = roster.find(q.get('t')); if (!f) return [401, { error: 'This link is not on the roster any more. Ask your teacher for a new one.' }]; return { name: f.student.name, cls: f.cls.name }; },
  'GET /api/pull': (req, q) => { const f = roster.find(q.get('t')); if (!f) return [401, { error: 'unknown link' }]; return { log: readLog(f.student.id), state: readState(f.student.id) }; },
  'POST /api/push': (req, q, body) => { const f = roster.find(body.t); if (!f) return [401, { error: 'unknown link' }]; const count = appendLog(f.student.id, Array.isArray(body.entries) ? body.entries : []); if (body.state) mergeState(f.student.id, body.state); return { count }; },
  // teacher
  'GET /api/classes': req => (isTeacher(req) ? { classes: roster.all() } : [403, { error: 'That key was not accepted.' }]),
  'POST /api/class': (req, q, b) => (isTeacher(req) ? { cls: roster.addNames(b.id, b.name, Array.isArray(b.names) ? b.names.slice(0, 400) : []) } : [403, { error: 'no' }]),
  'POST /api/class/rename': (req, q, b) => (isTeacher(req) ? { cls: roster.rename(b.id, b.name) } : [403, { error: 'no' }]),
  'POST /api/class/remove': (req, q, b) => { if (!isTeacher(req)) return [403, { error: 'no' }]; roster.removeClass(b.id); return { ok: true }; },
  'POST /api/student/remove': (req, q, b) => { if (!isTeacher(req)) return [403, { error: 'no' }]; roster.removeStudent(b.id); return { ok: true }; },
  'POST /api/student/relink': (req, q, b) => (isTeacher(req) ? { student: roster.relink(b.id) } : [403, { error: 'no' }]),
  'GET /api/classlog': (req, q) => { if (!isTeacher(req)) return [403, { error: 'no' }]; const c = roster.cls(q.get('id')); if (!c) return [404, { error: 'no such class' }]; return { id: c.id, name: c.name, students: c.students.map(s => ({ id: s.id, name: s.name, log: readLog(s.id), state: readState(s.id) })) }; },
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), route = routes[req.method + ' ' + url.pathname];
    if (route) { const body = req.method === 'POST' ? await readBody(req) : null; const out = route(req, url.searchParams, body || {}); return Array.isArray(out) ? send(res, out[0], out[1]) : send(res, 200, out); }
    if (req.method !== 'GET') return send(res, 405, { error: 'method' });
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith('/courses/')) return staticFile(res, COURSES, decodeURIComponent(url.pathname.slice(9)));
    return staticFile(res, PUBLIC, url.pathname === '/' || url.pathname === '/teach' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
  } catch (e) { send(res, 400, { error: 'bad request' }); }
}).listen(PORT, () => console.log('Curriculum Tree on port ' + PORT + ', data in ' + DATA));
