// Jembatan VisOMP: terjemah sesi OMP → transkrip format Claude Code (dibaca runtime kantor-agent tanpa perubahan).
//   ~/.omp/agent/sessions/**  →  <CLAUDE_CONFIG_DIR>/projects/<slug>/<stem>.jsonl
//                              →  …/<stem>/subagents/agent-<label>.jsonl + .meta.json
// Privasi: isi tool_result TIDAK PERNAH dibaca/ditulis — baris toolResult diterjemahkan
// menjadi kuitansi kosong `content: []` (kantor hanya memeriksa bahwa kontennya objek).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const OMP_SESSIONS = path.join(os.homedir(), '.omp', 'agent', 'sessions');
const HEAD_BYTES = 16384;

// ---------------------------------------------------------------------------
// helper
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);
const firstLine = (s, n = 200) => {
  const l = String(s || '').split(/\r?\n/).map((x) => x.trim()).find((x) => x !== '') || '';
  return l.replace(/[ \t]+/g, ' ').slice(0, n);
};
const STOP = { stop: 'end_turn', toolUse: 'tool_use', error: 'error', aborted: 'aborted' };

// Path project apa pun (POSIX /c/…, Windows C:/…, relatif) → jalur Windows kanonik.
export function normalizeProject(p) {
  let s = String(p || process.cwd());
  const posix = /^\/([A-Za-z])([\\/]|$)/.exec(s);
  if (posix) s = `${posix[1].toUpperCase()}:${s.slice(2)}`;
  s = s.replace(/\//g, '\\');
  try { s = fs.realpathSync(s); } catch { /* biarkan */ }
  return s;
}

// Slug persis seperti kantor (transcripts.mjs): path realpath → non-alfanumerik jadi '-'.
export const slugOf = (projectReal) => projectReal.replace(/[^a-zA-Z0-9]/g, '-');

function readWindowDays() {
  try {
    const d = JSON.parse(fs.readFileSync(new URL('./runtime/defaults.json', import.meta.url), 'utf8'));
    return Number.isInteger(d.window_days) && d.window_days > 0 ? d.window_days : 7;
  } catch { return 7; }
}

function readHeader(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
      if (!line.includes('"type":"session"')) continue;
      try {
        const o = JSON.parse(line);
        if (o && o.type === 'session') return { cwd: o.cwd || '', parentSession: o.parentSession || null };
      } catch { /* baris title-slot — lanjut */ }
    }
  } catch { /* file hilang/terkunci */ }
  return null;
}

// ---------------------------------------------------------------------------
// Penemuan: sesi utama (cwd == project, tanpa parentSession) + seluruh anak
// (parentSession menyambung ke utama, berlapis — resolusi transitive).
export function discover(projectReal, windowDays) {
  const want = norm(projectReal);
  const cutoff = Date.now() - windowDays * 86400000;
  const files = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); continue; }
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const h = readHeader(p);
      if (!h) continue;
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(p).mtimeMs; } catch { continue; }
      files.push({ path: p, src: p, stem: e.name.slice(0, -6), cwd: h.cwd, parentSession: h.parentSession, mtimeMs });
    }
  };
  if (fs.existsSync(OMP_SESSIONS)) walk(OMP_SESSIONS, 0);

  const byNorm = new Map(files.map((f) => [norm(f.path), f]));
  const mains = files.filter((f) => !f.parentSession && norm(f.cwd) === want && f.mtimeMs >= cutoff);
  const mainsByStem = new Map(mains.map((m) => [m.stem, m]));

  const children = [];
  for (const f of files) {
    if (f.parentSession === null && norm(f.cwd) === want) continue; // utama
    if (f.mtimeMs < cutoff) continue;
    // rantai parentSession → sesi utama
    let cur = f, depth = 0, main = null, seen = new Set();
    while (cur && cur.parentSession) {
      if (seen.has(cur.path)) { main = null; break; }
      seen.add(cur.path);
      depth++;
      const p = byNorm.get(norm(cur.parentSession));
      if (!p) break;
      if (p.parentSession === null && norm(p.cwd) === want) { main = p; break; }
      cur = p;
    }
    // fallback: file fisik di bawah folder <mainStem>/ walau parentSession tak cocok
    if (!main) {
      const rel = f.path.slice(norm(OMP_SESSIONS).length); // path asli → cari segmen folder
      const segs = rel.split(/[\\/]/).filter(Boolean);
      const cand = segs.find((s) => mainsByStem.has(s));
      if (cand) { main = mainsByStem.get(cand); depth = segs.indexOf(cand) === segs.length - 2 ? 1 : segs.length - 1 - segs.indexOf(cand); }
    }
    if (!main) continue;
    let label = f.stem.replace(/^agent-/, '');
    let parentLabel = null;
    const dirOfParent = path.basename(path.dirname(f.path));
    if (depth >= 2) parentLabel = dirOfParent.replace(/^agent-/, '');
    children.push({ src: f.path, mainStem: main.stem, label, depth: Math.max(1, depth), parentLabel });
  }
  mains.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return { mains, children };
}

// ---------------------------------------------------------------------------
// Pemetaan tool OMP → nama tool Claude Code yang dikenal kantor.
function makeCtx(projectReal) {
  const projFwd = projectReal.replace(/\\/g, '/').toLowerCase() + '/';
  return {
    relFile(v) {
      if (typeof v !== 'string' || v === '') return '';
      const low = v.replace(/\\/g, '/').toLowerCase();
      if (low.startsWith(projFwd)) return `${projectReal}/${v.replace(/\\/g, '/').slice(projFwd.length)}`;
      return v;
    },
  };
}

function taskDescription(args) {
  const t = Array.isArray(args.tasks) && args.tasks[0] ? args.tasks[0].task : null;
  return firstLine(t || args.context || args.description || args.prompt || '', 200);
}

function mapTool(name, args, ctx) {
  const fp = () => ctx.relFile(args.path ?? args.file_path ?? args.notebook_path ?? '');
  switch (name) {
    case 'read': return ['Read', { file_path: fp() }];
    case 'write': return ['Write', { file_path: fp() }];
    case 'edit': case 'ast_edit': case 'multi_edit': case 'notebook_edit': return ['Edit', { file_path: fp() }];
    case 'bash': return ['Bash', { command: args.command ?? '', description: args.i ?? args.description ?? '' }];
    case 'grep': return ['Grep', { pattern: args.pattern ?? '' }];
    case 'glob': return ['Glob', { pattern: args.pattern ?? args.path ?? '' }];
    case 'ask': return ['AskUserQuestion', {}];
    case 'web_search': return ['WebSearch', {}];
    case 'web_fetch': return ['WebFetch', {}];
    case 'task': return ['Task', { description: taskDescription(args) }];
    case 'yield': return ['SubagentHandback', {}]; // subagent omp menutup tugasnya dengan yield
    case 'vibe_spawn': return ['Task', { description: args.i || firstLine(args.prompt, 200) || args.name || 'subagent' }];
    case 'vibe_send': return ['SendMessage', {}];
    case 'vibe_kill': return ['TaskStop', { task_id: String(args.session ?? args.name ?? '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) }];
    default: return [name, {}];
  }
}

// Status papan todo dikelola dari op tool `todo` (init/start/done/append/list).
function applyTodoOp(todos, args) {
  const op = args.op;
  if (op === 'init') {
    const list = Array.isArray(args.list) ? args.list : [];
    return list.flatMap((g) => (Array.isArray(g?.items) ? g.items : []).map((i) => ({ content: String(i), status: 'pending' })));
  }
  const out = todos.map((t) => ({ ...t }));
  if (op === 'start') {
    for (const t of out) if (t.status === 'in_progress') t.status = 'pending';
    const hit = out.find((t) => t.content === args.task);
    if (hit) hit.status = 'in_progress'; else out.push({ content: String(args.task ?? ''), status: 'in_progress' });
  } else if (op === 'done') {
    const hit = out.find((t) => t.content === args.task);
    if (hit) hit.status = 'completed'; else out.push({ content: String(args.task ?? ''), status: 'completed' });
  } else if (op === 'append') {
    for (const i of Array.isArray(args.items) ? args.items : []) {
      if (!out.some((t) => t.content === i)) out.push({ content: String(i), status: 'pending' });
    }
  }
  return out;
}

const todoUse = (todos) => ({
  type: 'tool_use', name: 'TodoWrite',
  input: { todos: todos.map((t) => ({ content: t.content, status: t.status })) },
});

// ---------------------------------------------------------------------------
// Terjemah satu file sumber → { text, meta? } (meta hanya untuk subagent).
function translateFile(src, opts) {
  let raw;
  try { raw = fs.readFileSync(src, 'utf8'); } catch { return null; }
  const ctx = opts.ctx;
  const rows = [];
  const state = { todos: [], init: null, firstUser: '' };
  let seq = 0;

  const endsNl = raw.endsWith('\n');
  const lines = raw.split('\n');
  if (!endsNl) lines.pop(); // baris parsial (masih ditulis) — tunggu siklus berikutnya

  for (const line of lines) {
    if (line === '') continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    const t = typeof row.timestamp === 'string' && row.timestamp.includes('T') ? row.timestamp : '';

    if (row.type === 'session_init') {
      state.init = { agent: typeof row.agent === 'string' ? row.agent : '', task: typeof row.task === 'string' ? row.task : '' };
      continue;
    }
    if (row.type !== 'message' || t === '') continue;
    const msg = row.message;
    if (!msg || typeof msg !== 'object') continue;

    if (msg.role === 'assistant') {
      const blocks = [];
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'toolCall') {
          const name = typeof b.name === 'string' ? b.name : '';
          const args = b.arguments && typeof b.arguments === 'object' ? b.arguments : {};
          if (name === 'todo') {
            state.todos = applyTodoOp(state.todos, args);
            if (state.todos.length) blocks.push(todoUse(state.todos));
            continue;
          }
          const [cn, input] = mapTool(name, args, ctx);
          blocks.push({ type: 'tool_use', id: typeof b.id === 'string' ? b.id : undefined, name: cn, input });
        } else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') {
          blocks.push({ type: 'text', text: b.text });
        }
        // thinking/gambar/dll: dilewati — kantor tidak membacanya
      }
      const u = msg.usage && typeof msg.usage === 'object' ? msg.usage : null;
      const out = {
        type: 'assistant',
        timestamp: t,
        message: {
          id: `omp-${row.id ?? ++seq}`,
          content: blocks,
          usage: u ? {
            input_tokens: int(u.input),
            output_tokens: int(u.output),
            cache_read_input_tokens: int(u.cacheRead),
            cache_creation_input_tokens: int(u.cacheWrite),
          } : undefined,
          stop_reason: STOP[msg.stopReason] ?? (typeof msg.stopReason === 'string' ? msg.stopReason : undefined),
        },
      };
      if (!out.message.usage) delete out.message.usage;
      if (out.message.stop_reason === undefined) delete out.message.stop_reason;
      rows.push(JSON.stringify(out));
      continue;
    }

    if (msg.role === 'user') {
      const blocks = Array.isArray(msg.content) ? msg.content : (typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : []);
      const text = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
      if (text.trim() === '') continue; // hanya gambar/file-sebutan — tanpa nilai untuk panel
      if (!state.firstUser) state.firstUser = text;
      const isRealUser = msg.attribution === 'user';
      rows.push(JSON.stringify(isRealUser
        ? { type: 'user', timestamp: t, message: { content: text } }
        : { type: 'user', timestamp: t, isMeta: true, message: { content: text } }));
      continue;
    }

    if (msg.role === 'toolResult') {
      // kuitansi kosong: kantor hanya mengecek bahwa konten berbentuk objek.
      rows.push(JSON.stringify({ type: 'user', timestamp: t, message: { content: [] } }));
      continue;
    }
    // role lain (developer, custom, bashExecution, fileMention, …) → dilewati
  }

  const text = rows.length ? rows.join('\n') + '\n' : '';
  let meta = null;
  if (opts.asSubagent) {
    const agent = state.init?.agent || 'general-purpose';
    const description = firstLine(state.init?.task || state.firstUser, 140);
    meta = { agentType: agent.slice(0, 40), description };
    if (opts.parentAgentId) meta.parentAgentId = opts.parentAgentId;
  }
  return { text, meta };
}

// ---------------------------------------------------------------------------
// Satu siklus sinkronisasi. Mengembalikan statistik; menulis hanya bila berubah.
export function syncOnce(projectReal) {
  const windowDays = readWindowDays();
  const slug = slugOf(projectReal);
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const outRoot = path.join(base, 'visomp', slug, 'claude', 'projects', slug);
  // cache ringkasan inkremental milik serve-node: nama n-<md5(path-output)>.json di <state>/cache
  const cacheDir = path.resolve(outRoot, '..', '..', '..', 'cache');
  const ctx = makeCtx(projectReal);
  const { mains, children } = discover(projectReal, windowDays);
  const stats = { mains: 0, children: 0, skipped: 0, pruned: 0, changed: 0 };

  const writeIf = (file, content, mtimeMs) => {
    let same = false;
    try { same = fs.readFileSync(file, 'utf8') === content; } catch { /* belum ada */ }
    if (!same) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, file);
      // tulis-ulang (bukan tambah) → cache lama bisa menyimpan ringkasan basi
      try { fs.unlinkSync(path.join(cacheDir, `n-${createHash('md5').update(file).digest('hex')}.json`)); } catch { /* tidak ada */ }
      stats.changed++;
    }
    // mtime output = mtime sumber → jendela 7 hari kantor mengikuti aktivitas nyata
    try { const d = new Date(mtimeMs); fs.utimesSync(file, d, d); } catch { /* abai */ }
  };

  const expected = new Set();
  for (const m of mains) {
    const r = translateFile(m.src, { ctx });
    if (!r) { stats.skipped++; continue; }
    const out = path.join(outRoot, `${m.stem}.jsonl`);
    expected.add(out);
    writeIf(out, r.text, m.mtimeMs);
    stats.mains++;
    const stemDir = path.join(outRoot, m.stem);
    expected.add(stemDir);
    for (const c of children.filter((c) => c.mainStem === m.stem)) {
      const cr = translateFile(c.src, { ctx, asSubagent: true, parentAgentId: c.parentLabel || undefined });
      if (!cr) { stats.skipped++; continue; }
      const subDir = c.depth >= 2
        ? path.join(stemDir, 'subagents', 'workflows', c.parentLabel || 'wf')
        : path.join(stemDir, 'subagents');
      const childOut = path.join(subDir, `agent-${c.label}.jsonl`);
      const childMeta = `${childOut.slice(0, -6)}.meta.json`;
      expected.add(childOut); expected.add(childMeta); expected.add(subDir); expected.add(stemDir);
      writeIf(childOut, cr.text, c.mtimeMs);
      writeIf(childMeta, JSON.stringify(cr.meta), c.mtimeMs);
      stats.children++;
    }
  }

  // buang output yatim (sumber hilang / di luar jendela)
  const prune = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { prune(p); if (expected.has(p)) continue; try { fs.rmdirSync(p); } catch { /* tak kosong */ } continue; }
      if (expected.has(p)) continue;
      if (!/\.(jsonl|meta\.json|tmp-\d+)$/.test(e.name)) continue;
      try { fs.unlinkSync(p); stats.pruned++; } catch { /* abai */ }
    }
  };
  if (fs.existsSync(outRoot)) prune(outRoot);

  return stats;
}
