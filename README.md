# VisOMP — Kantor 3D untuk sesi OMP

Tonton sesi [OMP](https://github.com/) bekerja di kantor 3D kecil (three.js, zero-dependency):
sesi utama menjadi **Ketua** yang bekerja di mejanya, setiap subagent dikerjakan anggota **tim** yang
sedang santai, dan bila tim penuh datanglah **freelancer** lewat pintu. Semua gerakan berasal dari
transkrip OMP yang nyata — tanpa data karangan, tanpa login, tanpa konfigurasi.

> Berasal dari [kantor-agent](https://github.com/humaedihume/kantor-agent) (plugin Claude Code, MIT)
> dengan jembatan transkrip OMP → Claude Code + supervisor Node. Runtime visual (server, UI 3D,
> simulasi penugasan) dipakai apa adanya dari upstream.

![Kantor 3D dengan tim yang sedang bekerja](docs/kantor-bekerja.png)

## Fitur

- **Nol konfigurasi, satu perintah.** Jalankan dari folder project yang ingin dipantau → buka URL-nya.
  Tidak ada file yang ditulis ke folder project (cache & log di `~/.cache/visomp/`).
- **Ketua** = sesi utama OMP terbaru yang aktif, bekerja di mejanya sesuai aksi terakhir
  (mengetik, membaca, terminal, berpikir), santai saat sesi diam. Beberapa sesi aktif → yang terbaru
  ditampilkan + catatan "+N sesi lain".
- **Tim 4 orang** santai di lounge (TV, kopi, gitar, ngobrol) dan berjalan ke meja saat sesi memanggil
  subagent jenis apa pun; selesai → kembali santai.
- **Freelancer** masuk lewat pintu bila keempat anggota sibuk, duduk di meja cadangan, pulang saat selesai.
- **Panel sederhana:** aktivitas langsung, riwayat subagent, daftar todo sesi utama (juga di papan tulis),
  statistik subagent hari ini & aktif sekarang.
- **Privasi:** read-only terhadap `~/.omp/agent/sessions`; **isi `tool_result` tidak pernah dibaca/ditulis**
  (diterjemahkan menjadi kuitansi kosong). Server hanya mendengar di `127.0.0.1`.

## Kebutuhan

| Komponen | Keterangan |
|---|---|
| **OMP** (Oh My Pi / fork-nya) | Sesi disimpan di `~/.omp/agent/sessions` (format SessionEntry JSONL). Diuji di omp v18. |
| **Node ≥ 18** | Satu-satunya runtime (tanpa dependensi npm). Cek: `node -v`. |
| Browser dengan WebGL | Chrome, Edge, Firefox, Safari modern (desktop & ponsel). |

macOS & Linux: sama, melalui bash/terminal biasa. Windows: Git Bash atau PowerShell (`node …` langsung).

## Pasang

Pilih salah satu:

### A. Sebagai skill OMP (disarankan — satu perintah di sesi mana pun)

```bash
git clone https://github.com/<kamu>/VisOMP.git
mkdir -p ~/.agents/skills
ln -s "$PWD/VisOMP/skills/visomp" ~/.agents/skills/visomp   # Windows: copy foldernya
# atau: cp -R VisOMP/skills/visomp ~/.agents/skills/
```

Buka sesi OMP **baru** di folder project, lalu:

```text
/skill:visomp
```

atau cukup bilang *"nyalakan visomp"* — model membaca skill ini dan menjalankan perintahnya.

### B. Manual (tanpa skill)

```bash
git clone https://github.com/<kamu>/VisOMP.git
cd <folder-project-yang-ingin-dipantau>
node /path/ke/VisOMP/skills/visomp/bin/visomp.mjs start
```

## Pakai

Jalankan perintah ini **di folder project yang ingin dipantau** (jalur folder menentukan sesi mana yang tampil):

```bash
node <skill-dir>/bin/visomp.mjs start [--port N] [--project DIR] [--bind ADDR]
```

Keluaran kira-kira:

```text
Terjemah: 6 sesi utama, 1 subagent.
VISOMP SIAP http://127.0.0.1:8788/kerja
```

Buka URL itu di browser. Perintah lain:

| Perintah | Arti |
|---|---|
| `… status` | status + URL + hitungan sesi/subagent |
| `… stop` | hentikan server + penerjemah project ini |
| `… url` | cetak URL saja |
| `… sync` | terjemah sekali lalu keluar (untuk memeriksa) |
| `… --port 9000` | pakai port awal lain (otomatis naik bila sibuk) |
| `… --project DIR` | pantau folder lain tanpa `cd` ke sana |

Agar server hidup terus (recommended): jalankan sebagai **named service** di tool `bash`
(`name: "visomp"`, `ready: { log: "VISOMP SIAP" }`), lalu set `write proc://visomp/mode` = `persist`
supaya tetap hidup antar sesi. Matikan: `node …/visomp.mjs stop`.

### Dari ponsel / jaringan lokal (LAN)

```bash
node <skill-dir>/bin/visomp.mjs start --bind 0.0.0.0   # → http://<ip-komputer>:8788/kerja
```

> ⚠️ Halaman ini tidak punya login. Isinya read-only dan diredaksi, tetapi tetap memperlihatkan
> deskripsi tugas subagent, nama file, dan ringkasan aktivitas project. **Hanya buka ke jaringan
> yang kamu percaya.** Server bawaan hanya mendengarkan di `127.0.0.1`.

## Cara kerja

```text
~/.omp/agent/sessions/<bucket>/<sesi>.jsonl                ← sesi utama → Ketua
                              /<sesi>/<label>.jsonl        ← subagent   → Tim / Freelancer
        │  dibaca read-only; hanya tool_use, teks assistant & todo — isi tool_result TIDAK dibaca
        ▼
bin/translate.mjs   (jembatan: OMP SessionEntry → transkrip Claude Code, inkremental, Node murni)
        │  cache, PID, log → ~/.cache/visomp/<slug-project>/
        ├── <slug>/claude/projects/<slug>/…jsonl           ← dibaca server (via CLAUDE_CONFIG_DIR)
        ▼
runtime/bin/serve-node.mjs + lib/node/*.mjs   (server kantor-agent upstream, tanpa perubahan)
        ├── GET /kerja            halaman 3D
        ├── GET /kerja/api/state  JSON status (dipolling tiap 3 detik)
        └── GET /kerja/assets/*   three.js (vendored) + kantor.js
        ▼
Browser: kantor 3D — meja Ketua, 4 meja tim, 4 meja cadangan, lounge, pintu, papan tulis, panel
```

- Subagent OMP (tool `task`, `vibe_spawn`, dsb.) dipetakan ke penugasan tim; `yield` (selesai),
  `vibe_kill`/`TaskStop` (dihentikan), dan 15 menit tanpa aktivitas menutup tugasnya.
- Todo OMP (`todo`: init/start/done/append) diterjemahkan ke papan todo sesi utama.
- Setiap project mendapat servernya sendiri (port otomatis naik bila 8788 sibuk).

## Verifikasi instalasi

```bash
node skills/visomp/runtime/bin/check.mjs http://127.0.0.1:8788   # harus "OK (… pemeriksaan)"
node skills/visomp/bin/visomp.mjs status                          # URL + hitungan sesi
```

## Masalah umum

**Semua karakter santai terus.** Kantor hanya bergerak bila ada aktivitas nyata. Pastikan server
dijalankan dari **folder yang sama** dengan tempat sesi OMP dibuka, dan periksa
`visomp.mjs status` → jumlah sesi utama > 0.

**Tim tidak bergerak saat subagent jalan.** Subagent OMP menulis sesi anak ke folder artefak sesi
induk — jembatan memantaunya tiap ~1,5 detik. Tunggu ±5 detik lalu muat ulang halaman.

**Port berubah.** Normal bila 8788 dipakai project lain — URL yang benar selalu tercetak di baris
`VISOMP SIAP` dan di `status`.

## Struktur repo

```text
VisOMP/
  README.md                     ← kamu di sini
  LICENSE  THIRD_PARTY_NOTICES.md
  skills/visomp/
    SKILL.md                    ← instruksi skill OMP (start/stop/status)
    bin/visomp.mjs              ← supervisor CLI (terjemah + server)
    bin/translate.mjs           ← jembatan transkrip OMP → Claude Code
    runtime/                    ← server & UI kantor-agent upstream (Node saja)
      bin/serve-node.mjs check.mjs
      lib/node/*.mjs  defaults.json
      public/assets/* (three.js vendored)  views/page.html
  docs/                         ← tangkapan layar (tambahkan sendiri)
```

## Kredit & lisensi

- Visualisasi, server, dan simulasi penugasan: **[kantor-agent](https://github.com/humaedihume/kantor-agent)**
  oleh humaedihume, lisensi **MIT** — dipakai tanpa perubahan di `skills/visomp/runtime/`
  (kecuali launcher bash/PHP yang tidak relevan untuk instalasi ini).
- Jembatan OMP (`bin/translate.mjs`, `bin/visomp.mjs`, `SKILL.md`, README ini): MIT, lihat `LICENSE`.
- three.js (vendored di `runtime/public/assets/vendor/`): lisensi masing-masing, lihat
  `runtime/public/assets/vendor/three/LICENSE`.
