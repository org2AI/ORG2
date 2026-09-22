<div align="center">
  <h1>ORG-2</h1>
  <p><strong>System of record untuk bagaimana Agents membangun perangkat lunak.<br />Jalankan coding Agents Anda — replay sesi apa pun, review bersama tim, dan lacak setiap baris kembali ke keputusan di belakangnya.</strong></p>
  <p>Dibangun dengan Rust dan Tauri untuk eksekusi local-first dengan ukuran di bawah 100MB pada disk. Mendukung livestream dan replay trajectory Agents. Mudah diikuti dan direview.</p>
</div>

---

<p align="center">
  <a href="https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-mac-apple-silicon.dmg"><strong>macOS Apple Silicon</strong></a>
  ·
  <a href="https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-windows-x64-setup.exe"><strong>Windows installer</strong></a>
  ·
  <a href="https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-windows-x64.msi"><strong>Windows MSI</strong></a>
  ·
  <a href="https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-linux-x64.AppImage"><strong>Linux AppImage</strong></a>
  ·
  <a href="https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-linux-x64.deb"><strong>Linux DEB</strong></a>
  ·
  <a href="https://github.com/org2AI/ORG2/releases/latest"><strong>All latest release assets</strong></a>
</p>

---

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.zh.md">简体中文</a> · <a href="README.zh-Hant.md">繁體中文</a> · <a href="README.es.md">Español</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ru.md">Русский</a> · <a href="README.pt.md">Português</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.pl.md">Polski</a>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a" controls width="720"></video>
</p>

Menjawab mengapa sebuah potongan kode ada — dan apakah kode itu berhasil — selalu berarti menyambung berbagai sistem secara manual. Jira hanya melihat ticket. Codex hanya melihat sesinya sendiri. GitHub hanya melihat baris yang sudah di-commit. Amplitude hanya melihat metrik. Itu masih bisa ditahan ketika manusia yang menulis kode. Pada kecepatan Agent, tidak lagi: kode yang ditulis Senin sudah menjadi legacy pada Jumat.

ORG-2 adalah tempat tim Anda menjalankan coding Agents — sebuah Rust harness native ditambah launcher untuk 20+ CLI Agent — dan ia membangun catatan itu secara otomatis. Setiap sesi menjadi trajectory yang direplay rekan tim seperti video, mereview bagaimana pekerjaan benar-benar dibangun alih-alih hanya diff-nya, dan berkomentar dalam konteks. Sesi yang dijalankan di tool lain ikut di-ingest dan di-backfill dari riwayatnya, sehingga catatan tersebut mencakup pekerjaan yang tidak pernah melewati aplikasi ini. Catatan itu menghubungkan apa yang diminta manusia, apa yang dipahami Agent, dan apa yang benar-benar dilakukannya, sehingga setiap baris yang dirilis dapat dilacak kembali ke sesi yang menulisnya.

Ini bukan sekadar satu lagi tool coding AI; ini sebuah eksperimen tentang organisasi manusia/Agent dan alignment di tingkat organisasi. ORG2 memperlakukan Agents sebagai kolega yang persisten dan dapat diamati di dalam organisasi yang terstruktur — eksekusi yang dapat direplay, memori lintas sesi, AI blame, dan runtime Rust local-first agar manusia, Agents, dan tim dapat berkolaborasi di sekitar konteks bersama dan tujuan yang selaras.

## Fitur

<table>
<tr><td width="50%" valign="middle"><h3>Rust harness bawaan</h3><p>Jalankan Agents native yang cepat, hemat token, dan dapat disesuaikan menggunakan API key serta langganan Agent yang sudah Anda miliki.</p></td><td width="50%"><img src="../assets/feature-wall/rust-harness.gif" alt="Menjalankan Agents dengan Rust harness ORG2" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>Kelola sesi dari 10+ aplikasi &amp; CLI</h3><p>Muat dan kelola sesi Agent dari semua tool Anda di satu tempat. Pindai riwayat, periksa subagents, dan kendalikan setiap source tanpa berpindah aplikasi.</p></td><td width="50%"><img src="../assets/feature-wall/session-sources.png" alt="Mengelola source sesi Agent dari aplikasi dan CLI di ORG2" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>Bentuk tim dan review trajectory, bukan hanya PR</h3><p>Bentuk tim Anda dan bagikan sesi antar perangkat dan rekan tim. Review seluruh trajectory Agent, bukan hanya diff akhirnya, dan tinggalkan komentar dalam konteks.</p></td><td width="50%"><img src="../assets/feature-wall/team-trajectory-review.png" alt="Mengelola rekan tim dan izin replay trajectory di ORG2" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>Tool call, kini seperti video</h3><p>Replay pekerjaan dari Rust harness native dan 15+ CLI Agents. Pesan, tool call, penyuntingan file, dan output perintah tetap tersinkron dalam satu timeline yang bisa direview.</p></td><td width="50%"><img src="../assets/feature-wall/replay.gif" alt="Mereplay sesi Agent di ORG2" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>AI blame, bukan hanya Git blame</h3><p>Jangan berhenti pada siapa yang mengubah sebuah baris. Lacak kembali ke sesi Agent, tool call, dan keputusan yang mendorong perubahan itu.</p></td><td width="50%"><img src="../assets/feature-wall/ai-blame.gif" alt="Melacak perubahan kode kembali ke sesi dan keputusan Agent di ORG2" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>Tetap pada jalur</h3><p>Lihat bagaimana waktu Anda terpakai di antara tugas dan sesi Agent. Timeline aktivitas harian menjaga durasi, perubahan kode, dan prioritas tetap terlihat.</p></td><td width="50%"><img src="../assets/feature-wall/work-diary.png" alt="Meninjau waktu yang dipakai untuk tugas dan sesi Agent di ORG2" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>Workspace pengembangan lengkap</h3><p>Gunakan terminal, kelola source control, lacak riwayat Git, dan review pull request tanpa meninggalkan workspace Agent Anda.</p></td><td width="50%"><img src="../assets/feature-wall/development-workspace.gif" alt="Source control, riwayat Git, dan tool code review di ORG2" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>Design Mode</h3><p>Periksa halaman live di browser WebKit native. Pilih sebuah elemen dan kirim konteks halamannya yang tepat langsung ke Agent untuk perbaikan yang lugas.</p></td><td width="50%"><img src="../assets/feature-wall/design-mode.gif" alt="Memeriksa elemen halaman web dengan Design Mode ORG2" width="100%" /></td></tr>
</table>

## Kemampuan lainnya

- Tooling GUI, CLI, terminal, Git, browser, LSP, timeline, dan basis data.
- Memori lintas sesi, berbagi pengetahuan antar Agents, dan state workspace bersama.
- Eksekusi yang sadar sumber daya dan dapat bereaksi terhadap ketersediaan CPU, RAM, serta perhatian manusia.
- Pengujian GUI end-to-end bertenaga Agent untuk self-evolution yang terawasi.
- Scheduling dan sesi yang dimulai otomatis agar Agents dapat berjalan sepanjang malam atau melanjutkan pekerjaan saat Anda tidak ada.
- Permukaan alignment tingkat organisasi (manajemen issues/projects) untuk mengoordinasikan manusia, Agents, tujuan, dan akuntabilitas (WIP).
- Kolaborasi sesi dan alur kerja group issue melalui Supabase yang di-host sendiri (WIP).

## Agents yang didukung

Gunakan Rust harness bawaan ORG2, atau jalankan CLI coding-agent berikut yang didukung dari aplikasi desktop.

### GUI + TUI

<p>
  <a href="#fitur"><kbd><img src="../assets/org2-icon.svg" alt="Logo ORG-2" width="22" valign="middle" /> ORG-2</kbd></a> &nbsp;
  <a href="https://cursor.com/docs/cli/overview"><kbd><img src="../../src/assets/modelIcons/cursor.svg" alt="Cursor CLI logo" width="16" valign="middle" /> Cursor CLI</kbd></a> &nbsp;
  <a href="https://code.claude.com/docs/en/configuration"><kbd><img src="../../src/assets/modelIcons/claude.svg" alt="Claude logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://developers.openai.com/codex/config-basic"><kbd><img src="../../src/assets/modelIcons/openai.svg" alt="Codex logo" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://kiro.dev/docs/cli/installation"><kbd><img src="../../src/assets/modelIcons/kiro.svg" alt="Kiro CLI logo" width="16" valign="middle" /> Kiro CLI</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-in-the-cli"><kbd><img src="../../src/assets/modelIcons/copilot.svg" alt="GitHub Copilot logo" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/config/"><kbd><img src="../../src/assets/modelIcons/opencode.svg" alt="OpenCode logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://github.com/deepseek-ai/deepseek-harness"><kbd><img src="../../src/assets/modelIcons/deepseek.svg" alt="DeepSeek Harness logo" width="16" valign="middle" /> DeepSeek Harness</kbd></a> &nbsp;
  <a href="https://antigravity.google/docs/cli/getting-started"><kbd><img src="../../src/assets/modelIcons/antigravity.svg" alt="Antigravity logo" width="16" valign="middle" /> Antigravity</kbd></a>
</p>

### TUI

<p>
  <a href="https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/configuration-files.html"><kbd><img src="../../src/assets/modelIcons/kimi.svg" alt="Kimi Code CLI logo" width="16" valign="middle" /> Kimi Code CLI</kbd></a> &nbsp;
  <a href="https://aider.chat/docs/config.html"><kbd><img src="../../src/assets/modelIcons/aider.svg" alt="Aider logo" width="16" valign="middle" /> Aider</kbd></a> &nbsp;
  <a href="https://goose-docs.ai/docs/category/getting-started/"><kbd><img src="../../src/assets/modelIcons/goose.svg" alt="Goose logo" width="16" valign="middle" /> Goose</kbd></a> &nbsp;
  <a href="https://ampcode.com/manual"><kbd><img src="../../src/assets/modelIcons/amp.svg" alt="Amp logo" width="16" valign="middle" /> Amp</kbd></a> &nbsp;
  <a href="https://docs.cline.bot/cli/cli-reference"><kbd><img src="../../src/assets/modelIcons/cline.svg" alt="Cline logo" width="16" valign="middle" /> Cline</kbd></a> &nbsp;
  <a href="https://kilo.ai/docs/cli"><kbd><img src="../../src/assets/modelIcons/kilo.svg" alt="Kilo Code logo" width="16" valign="middle" /> Kilo Code</kbd></a> &nbsp;
  <a href="https://docs.x.ai/build/overview"><kbd><img src="../../src/assets/modelIcons/grok.svg" alt="Grok CLI logo" width="16" valign="middle" /> Grok CLI</kbd></a> &nbsp;
  <a href="https://docs.devin.ai/cli"><kbd><img src="../../src/assets/modelIcons/devin.svg" alt="Devin logo" width="16" valign="middle" /> Devin</kbd></a> &nbsp;
  <a href="https://hermes-agent.nousresearch.com/docs/user-guide/configuration"><kbd><img src="../../src/assets/modelIcons/hermes.svg" alt="Hermes logo" width="16" valign="middle" /> Hermes</kbd></a> &nbsp;
  <a href="https://docs.openclaw.ai/cli/config"><kbd><img src="../../src/assets/modelIcons/openclaw.svg" alt="OpenClaw logo" width="16" valign="middle" /> OpenClaw</kbd></a> &nbsp;
  <a href="https://www.codebuff.com/docs"><kbd><img src="../../src/assets/modelIcons/infinity-agent.svg" alt="Codebuff logo" width="16" valign="middle" /> Codebuff</kbd></a> &nbsp;
  <a href="https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/"><kbd><img src="../../src/assets/modelIcons/qwen.svg" alt="Qwen Code logo" width="16" valign="middle" /> Qwen Code</kbd></a> &nbsp;
  <a href="https://mimo.xiaomi.com/mimocode/config-files"><kbd><img src="../../src/assets/modelIcons/xiaomimimo.svg" alt="Mimo Code logo" width="16" valign="middle" /> Mimo Code</kbd></a> &nbsp;
  <a href="https://docs.continue.dev/cli/configuration"><kbd><img src="../../src/assets/modelIcons/continue.svg" alt="Continue logo" width="16" valign="middle" /> Continue</kbd></a> &nbsp;
  <a href="https://docs.factory.ai/cli/byok/overview"><kbd><img src="../../src/assets/modelIcons/droid.svg" alt="Droid logo" width="16" valign="middle" /> Droid</kbd></a> &nbsp;
  <a href="https://docs.mistral.ai/vibe/code/cli/install-setup"><kbd><img src="../../src/assets/modelIcons/mistral.svg" alt="Mistral Vibe logo" width="16" valign="middle" /> Mistral Vibe</kbd></a> &nbsp;
  <a href="https://docs.autohand.ai/integrations/ai-model-providers"><kbd><img src="../../src/assets/modelIcons/autohand.svg" alt="Autohand logo" width="16" valign="middle" /> Autohand</kbd></a> &nbsp;
  <a href="https://github.com/open-horizon-labs/oh-omp"><kbd><img src="../../src/assets/modelIcons/omp.svg" alt="OMP logo" width="16" valign="middle" /> OMP</kbd></a> &nbsp;
  <a href="https://pi.dev/docs/latest/providers"><kbd><img src="../../src/assets/modelIcons/pi.svg" alt="Pi logo" width="16" valign="middle" /> Pi</kbd></a>
</p>

## Unduh

Unduh aplikasi desktop ORG2 terbaru dengan satu klik:

- [macOS Apple Silicon](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-mac-apple-silicon.dmg)
- [Installer Windows x64](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-windows-x64-setup.exe)
- [Windows x64 MSI](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-windows-x64.msi)
- [Linux x64 AppImage](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-linux-x64.AppImage)
- [Linux x64 DEB](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-linux-x64.deb)
- [Semua asset rilis terbaru](https://github.com/org2AI/ORG2/releases/latest)

Tautan unduh langsung selalu diarahkan melalui pointer rilis terbaru GitHub.

## Kembangkan dari source

Untuk build atau berkontribusi dari source:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

Untuk detail kontribusi lebih lanjut, lihat [CONTRIBUTING.md](../../.github/CONTRIBUTING.md). Kami meminta semua orang untuk saling menghormati dan berempati; lihat [CODE_OF_CONDUCT.md](../../.github/CODE_OF_CONDUCT.md).

## Native sidecars opsional

Fitur Browser Use dan Computer Use bergantung pada native helper opsional untuk otomasi browser dan otomasi layar macOS:

- `agent-browser` diunduh dari releases `vercel-labs/agent-browser` untuk OS/CPU saat ini.
- `peekaboo` diunduh dari releases `steipete/peekaboo` di macOS.

Computer Use saat ini hanya tersedia di macOS. Browser Use dapat menggunakan `agent-browser` di platform yang didukung.

Jika sebuah sidecar tidak ada, build Rust membuat resource placeholder kecil agar build pengembangan dapat berlanjut. Kemampuan terkait mungkin jatuh kembali ke `PATH` atau tetap tidak tersedia sampai Anda menjalankan `pnpm run download:sidecars`.

## Komunitas

Punya pertanyaan, masukan, atau ingin mengikuti perkembangan ORG-2? Bergabunglah dengan kami di Discord:

👉 **Discord: [discord.gg/tvWgAqhCzs](https://discord.gg/tvWgAqhCzs)**
👉 **WeChat: [https://github.com/org2AI/ORG2/issues/128]**

- **#how-to-use-org2** dan **#faq** — mulai menggunakan
- **#announcement** — berita rilis dan pembaruan
- **#lets-chat** — bagikan apa yang Anda bangun dan temui komunitas
- **#feedback** — ide, permintaan fitur, dan laporan bug

## Lisensi

ORG2 dilisensikan di bawah GNU Affero General Public License v3.0 atau yang lebih baru (`AGPL-3.0-or-later`). Lihat [`LICENSE`](../../LICENSE) untuk teks lisensi lengkap.
