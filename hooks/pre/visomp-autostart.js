// VisOMP autostart hook — nyalakan server kantor 3D otomatis setiap sesi OMP dibuka.
// Letaknya: ~/.omp/agent/hooks/pre/visomp-autostart.js
// Discovery: otomatis oleh OMP saat startup (tidak perlu konfigurasi tambahan).
//
// Strategi Windows-safe: spawn visomp.mjs start dengan stdio pipe, pantau stdout
// sampai baris "VISOMP SIAP" atau timeout 20 detik — lalu lepas (unref) prosesnya.
// Bila server sudah berjalan, langsung tampilkan URL tanpa spawn ulang.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const exec = promisify(execFile);

// Cari visomp.mjs: cek ~/.agents/skills/visomp dulu, lalu VisOMP di Documents.
function findVisomp() {
  const candidates = [
    path.join(os.homedir(), '.agents', 'skills', 'visomp', 'bin', 'visomp.mjs'),
    path.join(os.homedir(), 'Documents', 'VisOMP', 'skills', 'visomp', 'bin', 'visomp.mjs'),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

// Cek apakah server sudah berjalan untuk project ini via status.
async function isRunning(visomp, project) {
  try {
    const { stdout } = await exec(process.execPath, [visomp, 'status', '--project', project], { timeout: 4000 });
    return stdout.includes('Berjalan');
  } catch { return false; }
}

// Ambil URL dari status output.
async function getUrl(visomp, project) {
  try {
    const { stdout } = await exec(process.execPath, [visomp, 'url', '--project', project], { timeout: 3000 });
    return stdout.trim();
  } catch { return null; }
}

// Spawn visomp start, tunggu baris "VISOMP SIAP <url>" di stdout, lalu unref.
function spawnAndWaitReady(visomp, project, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [visomp, 'start', '--project', project], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let url = null;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      // Lepaskan proses anak — tetap hidup mandiri
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const match = text.match(/VISOMP SIAP (http\S+)/);
      if (match) {
        url = match[1];
        clearTimeout(timer);
        finish({ ok: true, url });
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      finish({ ok: false, reason: `exit ${code}` });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, reason: err.message });
    });
  });
}

export default function (pi) {
  pi.on('session_start', async (_event, ctx) => {
    const visomp = findVisomp();
    if (!visomp) return; // skill belum dipasang, lewati tanpa error

    const project = ctx.cwd;

    // Sudah berjalan? Ambil URL dan tampilkan saja.
    if (await isRunning(visomp, project)) {
      const url = await getUrl(visomp, project);
      if (url) ctx.ui.setStatus('visomp', `🏢 ${url}`);
      return;
    }

    // Belum berjalan → spawn dan tunggu siap.
    ctx.ui.setStatus('visomp', '🏢 Kantor: memulai…');
    const result = await spawnAndWaitReady(visomp, project);

    if (result.ok) {
      ctx.ui.setStatus('visomp', `🏢 ${result.url}`);
      pi.logger.info(`VisOMP siap: ${result.url}`);
    } else {
      ctx.ui.setStatus('visomp', `🏢 Kantor: gagal (${result.reason})`);
      pi.logger.warn(`VisOMP gagal start: ${result.reason}`);
    }
  });

  // Bersihkan status saat sesi tutup
  pi.on('session_shutdown', async (_event, ctx) => {
    ctx.ui.setStatus('visomp', '');
  });
}
