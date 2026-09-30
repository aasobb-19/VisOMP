#!/usr/bin/env node
// VisOMP — supervisor: terjemah sesi OMP → transkrip Claude Code, lalu jalankan
// visualisasi kantor 3D (runtime kantor-agent asli, tanpa perubahan) membaca hasil terjemahan.
//
//   node visomp.mjs start  [--project DIR] [--port N] [--bind A] [--interval MS]   (foreground)
//   node visomp.mjs sync   [--project DIR]                                         (sekali lalu keluar)
//   node visomp.mjs stop|status|url [--project DIR]
//
// Tidak menulis apa pun ke folder project. State: ~/.cache/visomp/<slug>/ (pid, log, cache, transkrip).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeProject, slugOf, syncOnce } from './translate.mjs';

const SERVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'bin', 'serve-node.mjs');

function parseArgs(argv) {
  const a = { cmd: 'start', project: null, port: null, bind: '127.0.0.1', interval: 1500 };
  const cmds = ['start', 'sync', 'stop', 'status', 'url', 'help'];
  if (argv[0] && cmds.includes(argv[0])) a.cmd = argv.shift();
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--project' || k === '-p') a.project = argv[++i];
    else if (k.startsWith('--project=')) a.project = k.slice(10);
    else if (k === '--port') a.port = Number(argv[++i]);
    else if (k.startsWith('--port=')) a.port = Number(k.slice(7));
    else if (k === '--bind') a.bind = argv[++i];
    else if (k.startsWith('--bind=')) a.bind = k.slice(7);
    else if (k === '--interval') a.interval = Number(argv[++i]);
    else if (k.startsWith('--interval=')) a.interval = Number(k.slice(11));
    else if (k === '-h' || k === '--help') a.cmd = 'help';
    else { console.error(`Opsi tidak dikenal: ${k}`); process.exit(2); }
  }
  return a;
}

const HELP = `VisOMP — kantor 3D untuk sesi OMP
  start   [--project DIR] [--port N] [--bind A] [--interval MS]   terjemah + jalankan server (foreground)
  sync    [--project DIR]                                         terjemah sekali lalu keluar
  stop    [--project DIR]                                         hentikan server project ini
  status  [--project DIR]                                         status + URL
  url     [--project DIR]                                         cetak URL saja
State: ~/.cache/visomp/<slug>/ · Privasi: isi tool_result tidak pernah dibaca/ditulis.`;

function stateOf(projectReal) {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const root = path.join(base, 'visomp', slugOf(projectReal));
  return {
    root,
    pidFile: path.join(root, 'pid.json'),
    serverLog: path.join(root, 'server.log'),
    claudeCfg: path.join(root, 'claude'),
  };
}

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

function readPid(st) {
  try { return JSON.parse(fs.readFileSync(st.pidFile, 'utf8')); } catch { return null; }
}

async function ping(port, project) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/kerja/api/ping`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j && j.app === 'kantor-agent' && (!project || j.project === project);
  } catch { return false; }
}

const projectId = (p) => createHash('md5').update(p).digest('hex').slice(0, 12);

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.cmd === 'help') { console.log(HELP); return; }

  const projectReal = normalizeProject(a.project);
  const st = stateOf(projectReal);
  const rec = readPid(st);

  if (a.cmd === 'sync') {
    const s = syncOnce(projectReal);
    console.log(`Terjemah: ${s.mains} sesi utama, ${s.children} subagent, ${s.changed} berubah, ${s.pruned} dibersihkan.`);
    return;
  }

  if (a.cmd === 'url') {
    if (rec && alive(rec.serverPid) && (await ping(rec.port, projectId(projectReal)))) {
      console.log(`http://${rec.bind || '127.0.0.1'}:${rec.port}/kerja`);
      return;
    }
    console.error('Tidak berjalan.'); process.exit(1);
  }

  if (a.cmd === 'status') {
    const up = rec && alive(rec.serverPid) && (await ping(rec.port, projectId(projectReal)));
    const s = syncOnce(projectReal); // refresh agar statistik mencerminkan data terkini
    if (up) {
      console.log(`Berjalan — http://${rec.bind || '127.0.0.1'}:${rec.port}/kerja`);
      console.log(`PID ${rec.serverPid} · project ${rec.projectPath}`);
      console.log(`Transkrip: ${s.mains} sesi utama, ${s.children} subagent, ${s.changed} berubah.`);
    } else {
      console.log(`Tidak berjalan. Transkrip siap: ${s.mains} sesi utama, ${s.children} subagent.`);
      console.log(`Mulai: node "${path.resolve(fileURLToPath(import.meta.url))}" start --project "${projectReal}"`);
    }
    return;
  }

  if (a.cmd === 'stop') {
    if (rec) {
      for (const pid of [rec.serverPid, rec.pid]) {
        if (alive(pid)) { try { process.kill(pid); } catch { /* abai */ } }
      }
      try { fs.unlinkSync(st.pidFile); } catch { /* abai */ }
      console.log('Kantor Agent dihentikan.');
    } else console.log('Tidak berjalan untuk project ini.');
    return;
  }

  // ---- start
  if (rec) {
    // instance lama: hentikan dulu agar server baru memakai kode terjemahan terbaru
    const up = alive(rec.serverPid) && (await ping(rec.port, projectId(projectReal)));
    if (up || alive(rec.serverPid) || (rec.pid !== process.pid && alive(rec.pid))) {
      for (const pid of [rec.serverPid, rec.pid]) {
        if (pid !== process.pid && alive(pid)) { try { process.kill(pid); } catch { /* abai */ } }
      }
      const t0 = Date.now();
      while (alive(rec.serverPid) && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 100));
      try { fs.unlinkSync(st.pidFile); } catch { /* abai */ }
      console.log('Instance lama dihentikan — memulai ulang dengan versi terbaru.');
    }
  }

  fs.mkdirSync(st.root, { recursive: true });
  let stats = syncOnce(projectReal);
  console.log(`Terjemah: ${stats.mains} sesi utama, ${stats.children} subagent.`);
  // Buang seluruh cache ringkasan lama: ringkasan inkremental kantor berasumsi file
  // hanya ditambah, sedangkan jembatan menulis ulang — ringkasan basi wajib dihitung ulang.
  try { fs.rmSync(path.join(st.root, 'cache'), { recursive: true, force: true }); } catch { /* abai */ }

  const base = a.port || Number(process.env.KANTOR_PORT || 0) || 8788;
  let server = null;
  let port = 0;

  const startChild = (p) => new Promise((resolve) => {
    const fs2 = fs.openSync(st.serverLog, 'a');
    const child = spawn(process.execPath, [SERVE], {
      env: {
        ...process.env,
        KANTOR_PROJECT: projectReal,
        KANTOR_STORAGE: st.root,
        KANTOR_PORT: String(p),
        KANTOR_BIND: a.bind,
        CLAUDE_CONFIG_DIR: st.claudeCfg,
      },
      stdio: ['ignore', fs2, fs2],
      windowsHide: true,
    });
    fs.closeSync(fs2);
    server = child;
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    child.on('exit', (code) => {
      if (server === child) server = null;
      done({ ok: false, code });
    });
    const t0 = Date.now();
    (async () => {
      while (Date.now() - t0 < 4000) {
        if (server !== child) return; // sudah keluar → exit handler yang me-resolve
        if (await ping(p, projectId(projectReal))) { done({ ok: true }); return; }
        await new Promise((r) => setTimeout(r, 150));
      }
      // port tidak menjawab: bunuh percobaan agar port berikutnya bisa dicoba
      if (server === child) { try { child.kill(); } catch { /* abai */ } }
      done({ ok: false, code: 'timeout' });
    })();
  });

  for (let p = base; p <= base + 20; p++) {
    const r = await startChild(p);
    if (r.ok) { port = p; break; }
    if (r.code === 3 || r.code === 'timeout') { if (r.code === 3) console.log(`Port ${p} sibuk — mencoba ${p + 1}…`); continue; }
    console.error(`Server gagal dijalankan (keluar ${r.code}). Log: ${st.serverLog}`);
    process.exit(1);
  }
  if (!port) { console.error(`Tidak ada port bebas di ${base}–${base + 20}.`); process.exit(1); }

  fs.writeFileSync(st.pidFile, JSON.stringify({
    pid: process.pid, serverPid: server.pid, port, bind: a.bind,
    projectPath: projectReal, started: new Date().toISOString(),
  }, null, 2));

  const url = `http://${a.bind === '0.0.0.0' ? '127.0.0.1' : a.bind}:${port}/kerja`;
  console.log(`VISOMP SIAP ${url}`);

  // siklus terjemahan inkremental + jaga server hidup
  const tick = () => {
    try { stats = syncOnce(projectReal); } catch (e) { console.error(`Terjemahan gagal: ${e.message}`); }
  };
  const timer = setInterval(tick, Math.max(500, a.interval));
  const shutdown = () => {
    clearInterval(timer);
    if (server) { try { server.kill(); } catch { /* abai */ } }
    try { fs.unlinkSync(st.pidFile); } catch { /* abai */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  setInterval(async () => {
    if (!server) {
      console.error('Server mati — memulai ulang…');
      const r = await startChild(port);
      if (r.ok) fs.writeFileSync(st.pidFile, JSON.stringify({
        pid: process.pid, serverPid: server.pid, port, bind: a.bind,
        projectPath: projectReal, started: new Date().toISOString(),
      }, null, 2));
      else console.error(`Gagal memulai ulang: ${r.code}`);
    }
  }, 5000).unref();
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
