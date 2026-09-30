---
name: visomp
description: Nyalakan/matikan/lirik "VisOMP" — kantor 3D (three.js) tanpa konfigurasi di http://127.0.0.1:8788/kerja yang menampilkan sesi OMP di folder project ini secara langsung. Ketua (sesi utama) bekerja di mejanya; 4 anggota tim santai di lounge lalu duduk bekerja setiap kali sesi memanggil subagent; bila tim penuh, freelancer masuk lewat pintu. Semua dari transkrip OMP nyata (~/.omp/agent/sessions), read-only. Pakai saat user ingin melihat/menyalakan/mematikan visualisasi kerja agent, dashboard subagent, atau URL-nya.
argument-hint: "[start|stop|status|sync] [--port N] [--project DIR]"
---

VisOMP membaca **sesi OMP** (`~/.omp/agent/sessions/**`), menerjemahkannya ke format transkrip
Claude Code di cache (`~/.cache/visomp/<slug>/claude/projects/<slug>/`), lalu menyajikannya lewat
server kantor 3D (three.js, zero-dependency). Tidak ada berkas yang ditulis ke folder project.
Butuh **Node ≥ 18**. Runtime + jembatan ada di direktori skill ini:

- CLI: `node "<skill-dir>/bin/visomp.mjs" <perintah> [--project DIR]` (cara aman: `realpath skill://visomp`)

Argumen user: $ARGUMENTS

## Langkah
1. **Pilih perintah** (tanpa argumen = `start`), jalankan di root project yang dipantau
   (folder tempat sesi OMP dibuka — default: folder kerja saat ini):
   - `start` / kosong → jalankan sebagai **named service** agar server hidup terus:
     `bash` dengan `name: "visomp"` dan `ready: { log: "VISOMP SIAP" }`, perintah:
     `node "<skill-dir>/bin/visomp.mjs" start` (teruskan `--port N`, `--project DIR`, `--bind A` bila ada).
     Setelah siap, panggil `write proc://visomp/mode` dengan isi `persist` supaya tetap hidup antar sesi.
   - `stop` → `node "<skill-dir>/bin/visomp.mjs" stop`; bila dijalankan sebagai service, matikan juga
     service-nya (`write proc://visomp/kill` jika perlu).
   - `status` → `node "<skill-dir>/bin/visomp.mjs" status` → cetak URL + jumlah sesi/subagent.
   - `sync` → terjemah sekali lalu keluar (berguna untuk memeriksa).
2. **Laporkan singkat** (Bahasa Indonesia): URL lokal `http://127.0.0.1:<port>/kerja`, cara menghentikan
   (`stop`), dan catatan bila belum ada transkrip (kantor terisi setelah sesi OMP dipakai di folder itu).
3. Bila port 8788 sibuk, CLI otomatis mencoba port berikutnya dan URL yang benar tetap dicetak pada baris
   `VISOMP SIAP`.

## Cara membaca kantornya (untuk menjawab pertanyaan user)
- **Ketua** = sesi OMP utama terbaru yang aktif; beberapa sesi aktif → catatan "+N sesi lain".
- **Tim** (4 anggota) = subagent OMP. Subagent baru → anggota bebas pertama berjalan ke mejanya;
  selesai/dihentikan → kembali santai. Penugasan dihitung ulang dari data yang sama (stabil).
- **Freelancer** = subagent saat keempat anggota tim sibuk: masuk lewat pintu, duduk di meja cadangan,
  lalu pulang setelah selesai.
- Papan todo mengikuti tool `todo` OMP (init/start/done/append) dari sesi utama.
- Nama/judul/port bisa ditimpa lewat `<project>/.claude/kantor-agent.json` (opsional):
  `{"title": "…", "port": 8788, "names": {"ketua": "…", "team": ["…","…","…","…"], "freelancers": ["…"]}}`.
  Default nama: Joko (ketua), Budi/Sari/Agus/Rina (tim).

## Aturan
- Read-only terhadap project dan sesi OMP. **Isi `tool_result` tidak pernah dibaca/ditulis** — jembatan hanya
  menulis metadata tool_use, teks assistant, timestamp, dan status todo; konten hasil alat diterjemahkan menjadi
  kuitansi kosong.
- Jangan menyalin isi sesi/transkrip ke balasan chat.
- Cache/PID/log/transkrip terjemahan: `~/.cache/visomp/<slug>/` (slug = path project dengan karakter
  non-alfanumerik menjadi `-`).
- Verifikasi cepat setelah start: `node "<skill-dir>/runtime/bin/check.mjs" http://127.0.0.1:<port>` →
  harus "OK (… pemeriksaan)".
