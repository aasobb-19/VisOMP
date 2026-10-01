// VisOMP autostart hook — nyalakan server kantor 3D otomatis setiap sesi OMP dibuka.
// Letaknya: ~/.omp/agent/hooks/pre/visomp-autostart.js
// Discovery: otomatis oleh OMP saat startup (tidak perlu konfigurasi tambahan).
//
// Server dijalankan sebagai proses anak yang terlepas (detached) — hidup terus walau
// sesi OMP ditutup. Bila server sudah berjalan untuk project ini, tidak dijalankan lagi.
// Cache/PID: ~/.cache/visomp/<slug>/  (tidak menulis apa pun ke folder project).

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);

// Cari visomp.mjs: cek ~/.agents/skills/visomp dulu, lalu VisOMP di Documents.
function findVisomp() {
  const candidates = [
    path.join(os.homedir(), '.agents', 'skills', 'visomp', 'bin', 'visomp.mjs'),
    path.join(os.homedir(), 'Documents', 'VisOMP', 'skills', 'visomp', 'bin', 'visomp.mjs'),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

// Cek apakah server sudah berjalan untuk project ini.
async function isRunning(visomp, project) {
  try {
    const { stdout } = await exec(process.execPath, [visomp, 'status', '--project', project], { timeout: 4000 });
    return stdout.includes('Berjalan');
  } catch { return false; }
}

export default function (pi) {
  pi.on('session_start', async (_event, ctx) => {
    const visomp = findVisomp();
    if (!visomp) return; // skill belum dipasang, lewati tanpa error

    const project = ctx.cwd;

    // Jangan spawn ulang kalau sudah berjalan
    if (await isRunning(visomp, project)) {
      ctx.ui.setStatus('visomp', '🏢 Kantor: Live');
      return;
    }

    // Spawn detached — proses anak hidup mandiri
    const child = spawn(process.execPath, [visomp, 'start', '--project', project], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Tunggu server siap (max 15 detik)
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      await new Promise(r => setTimeout(r, 800));
      if (await isRunning(visomp, project)) break;
    }

    // Ambil URL dari status
    try {
      const { stdout } = await exec(process.execPath, [visomp, 'url', '--project', project], { timeout: 3000 });
      const url = stdout.trim();
      if (url) {
        ctx.ui.setStatus('visomp', `🏢 ${url}`);
        pi.logger.info(`VisOMP siap: ${url}`);
      }
    } catch {
      ctx.ui.setStatus('visomp', '🏢 Kantor: gagal start');
    }
  });

  // Bersihkan status saat sesi tutup
  pi.on('session_shutdown', async (_event, ctx) => {
    ctx.ui.setStatus('visomp', '');
  });
}
