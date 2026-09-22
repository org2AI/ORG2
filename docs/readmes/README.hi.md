<div align="center">
  <h1>ORG-2</h1>
  <p><strong>Agents सॉफ़्टवेयर कैसे बनाते हैं, उसका System of Record।<br />अपने कोडिंग Agents चलाएँ — किसी भी सेशन को replay करें, टीम के साथ रिव्यू करें, और हर लाइन को उसके पीछे के निर्णय तक ट्रेस करें।</strong></p>
  <p>Rust और Tauri से बना, local-first एक्ज़ीक्यूशन के लिए, डिस्क पर 100MB से कम। Agent trajectory के livestream और replay का समर्थन करता है। फ़ॉलो और रिव्यू करना आसान।</p>
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

यह जवाब देना कि कोई कोड क्यों मौजूद है — और क्या वह काम कर रहा था — इसके लिए हमेशा कई सिस्टम को हाथ से जोड़ना पड़ा है। Jira को सिर्फ़ ticket दिखते हैं। Codex को सिर्फ़ अपने सेशन दिखते हैं। GitHub को सिर्फ़ commit हुई लाइनें दिखती हैं। Amplitude को सिर्फ़ metrics दिखते हैं। जब कोड इंसान लिखते थे, तब यह झेला जा सकता था। Agent की रफ़्तार पर नहीं: सोमवार को लिखा कोड शुक्रवार तक legacy बन जाता है।

ORG-2 वह जगह है जहाँ आपकी टीम अपने कोडिंग Agents चलाती है — एक native Rust harness और 20+ Agent CLI के लिए launcher — और यह वह रिकॉर्ड अपने आप बनाता है। हर सेशन एक trajectory बन जाता है जिसे साथी वीडियो की तरह replay करते हैं, सिर्फ़ diff देखने के बजाय यह रिव्यू करते हैं कि काम असल में कैसे बना, और संदर्भ में कमेंट करते हैं। दूसरे टूल में चले सेशन उनकी हिस्ट्री से ingest और backfill हो जाते हैं, इसलिए रिकॉर्ड उस काम को भी कवर करता है जो कभी ऐप से नहीं गुज़रा। रिकॉर्ड जोड़ता है कि इंसान ने क्या माँगा, Agent ने क्या समझा, और उसने असल में क्या किया — ताकि ship हुई कोई भी लाइन उस सेशन तक ट्रेस हो सके जिसने उसे लिखा।

यह सिर्फ़ एक और AI कोडिंग टूल नहीं है; यह मानव/Agent संगठनों और org-level alignment का एक प्रयोग है। ORG2 Agents को एक संरचित संगठन के भीतर स्थायी, observable सहकर्मियों की तरह देखता है — replay करने योग्य एक्ज़ीक्यूशन, cross-session मेमोरी, AI blame, और local-first Rust runtime, ताकि इंसान, Agents और टीमें साझा संदर्भ और aligned लक्ष्यों के इर्द-गिर्द मिलकर काम कर सकें।

## विशेषताएँ

<table>
<tr><td width="50%" valign="middle"><h3>अंतर्निहित Rust harness</h3><p>अपनी मौजूदा API key और Agent सब्सक्रिप्शन के साथ तेज़, token बचाने वाले और कस्टमाइज़ करने योग्य native Agents चलाएँ।</p></td><td width="50%"><img src="../assets/feature-wall/rust-harness.gif" alt="ORG2 Rust harness के साथ Agents चलाएँ" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>10+ ऐप और CLI के सेशन मैनेज करें</h3><p>अपने सभी टूल के Agent सेशन एक ही जगह लोड और मैनेज करें। ऐप बदले बिना हिस्ट्री स्कैन करें, subagents जाँचें और हर source को कंट्रोल करें।</p></td><td width="50%"><img src="../assets/feature-wall/session-sources.png" alt="ORG2 में ऐप और CLI के Agent सेशन source मैनेज करें" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>टीम बनाएँ और सिर्फ़ PR नहीं, trajectory रिव्यू करें</h3><p>अपनी टीम बनाएँ और डिवाइस व साथियों के बीच सेशन शेयर करें। सिर्फ़ अंतिम diff नहीं, पूरी Agent trajectory रिव्यू करें और संदर्भ में कमेंट छोड़ें।</p></td><td width="50%"><img src="../assets/feature-wall/team-trajectory-review.png" alt="ORG2 में साथी और trajectory replay अनुमतियाँ मैनेज करें" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>Tool call, अब वीडियो की तरह</h3><p>native Rust harness और 15+ CLI Agents के काम को replay करें। संदेश, tool call, फ़ाइल एडिट और कमांड आउटपुट एक ही रिव्यू करने योग्य timeline में सिंक रहते हैं।</p></td><td width="50%"><img src="../assets/feature-wall/replay.gif" alt="ORG2 में Agent सेशन replay करें" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>AI blame, सिर्फ़ Git blame नहीं</h3><p>इस पर न रुकें कि किसी लाइन को किसने बदला। उसे उन Agent सेशन, tool call और निर्णयों तक ट्रेस करें जिन्होंने वह बदलाव कराया।</p></td><td width="50%"><img src="../assets/feature-wall/ai-blame.gif" alt="ORG2 में कोड बदलावों को Agent सेशन और निर्णयों तक ट्रेस करें" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>दिशा में बने रहें</h3><p>देखें कि आपका समय कार्यों और Agent सेशन में कैसे बँटा। रोज़ की गतिविधि timeline अवधि, कोड बदलाव और प्राथमिकताएँ दिखाती रहती है।</p></td><td width="50%"><img src="../assets/feature-wall/work-diary.png" alt="ORG2 में कार्यों और Agent सेशन पर लगे समय की समीक्षा करें" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>पूरा dev workspace</h3><p>अपना Agent workspace छोड़े बिना terminal इस्तेमाल करें, source control मैनेज करें, Git हिस्ट्री ट्रेस करें और pull request रिव्यू करें।</p></td><td width="50%"><img src="../assets/feature-wall/development-workspace.gif" alt="ORG2 में source control, Git हिस्ट्री और code review टूल" width="100%" /></td></tr>
<tr><td width="50%" valign="middle"><h3>Design Mode</h3><p>native WebKit ब्राउज़र में लाइव पेज इंस्पेक्ट करें। कोई एलिमेंट चुनें और उसका सटीक पेज संदर्भ सीधे Agent को भेजें, ताकि फ़िक्स आसान हो।</p></td><td width="50%"><img src="../assets/feature-wall/design-mode.gif" alt="ORG2 Design Mode से वेबपेज एलिमेंट इंस्पेक्ट करें" width="100%" /></td></tr>
</table>

## अन्य क्षमताएँ

- GUI, CLI, terminal, Git, ब्राउज़र, LSP, timeline और डेटाबेस टूलिंग।
- Cross-session मेमोरी, Agents के बीच ज्ञान साझा करना, और साझा workspace स्टेट।
- Resource-aware एक्ज़ीक्यूशन, जो CPU, RAM और मानवीय ध्यान की उपलब्धता पर प्रतिक्रिया कर सकता है।
- निगरानी में self-evolution के लिए Agent-संचालित GUI end-to-end टेस्टिंग।
- Scheduling और auto-started सेशन, ताकि Agents रात भर चल सकें या आपकी अनुपस्थिति में काम जारी रख सकें।
- इंसानों, Agents, लक्ष्यों और जवाबदेही के समन्वय के लिए org-level alignment सरफ़ेस (issues/projects प्रबंधन) (WIP)।
- स्वयं-होस्ट किए Supabase के ज़रिए session collaboration और group issue workflow (WIP)।

## समर्थित Agents

ORG2 का अंतर्निहित Rust harness इस्तेमाल करें, या डेस्कटॉप ऐप से ये समर्थित coding-agent CLI लॉन्च करें।

### GUI + TUI

<p>
  <a href="#विशेषताएँ"><kbd><img src="../assets/org2-icon.svg" alt="ORG-2 लोगो" width="22" valign="middle" /> ORG-2</kbd></a> &nbsp;
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

## डाउनलोड

नवीनतम ORG2 डेस्कटॉप ऐप एक क्लिक में डाउनलोड करें:

- [macOS Apple Silicon](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-mac-apple-silicon.dmg)
- [Windows x64 इंस्टॉलर](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-windows-x64-setup.exe)
- [Windows x64 MSI](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-windows-x64.msi)
- [Linux x64 AppImage](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-linux-x64.AppImage)
- [Linux x64 DEB](https://github.com/org2AI/ORG2/releases/latest/download/ORG2-latest-linux-x64.deb)
- [नवीनतम रिलीज़ की सभी assets](https://github.com/org2AI/ORG2/releases/latest)

सीधे डाउनलोड लिंक हमेशा GitHub के latest release पॉइंटर से हल होते हैं।

## सोर्स से डेवलप करें

सोर्स से build करने या योगदान देने के लिए:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

योगदान से जुड़ी और जानकारी के लिए [CONTRIBUTING.md](../../.github/CONTRIBUTING.md) देखें। हम सभी से सम्मानजनक और सहानुभूतिपूर्ण रहने की अपेक्षा करते हैं; [CODE_OF_CONDUCT.md](../../.github/CODE_OF_CONDUCT.md) देखें।

## वैकल्पिक native sidecars

Browser Use और Computer Use फ़ीचर ब्राउज़र ऑटोमेशन और macOS स्क्रीन ऑटोमेशन के लिए वैकल्पिक native helper पर निर्भर करते हैं:

- `agent-browser` मौजूदा OS/CPU के लिए `vercel-labs/agent-browser` releases से डाउनलोड होता है।
- `peekaboo` macOS पर `steipete/peekaboo` releases से डाउनलोड होता है।

Computer Use अभी सिर्फ़ macOS पर उपलब्ध है। Browser Use समर्थित प्लेटफ़ॉर्म पर `agent-browser` इस्तेमाल कर सकता है।

अगर कोई sidecar मौजूद नहीं है, तो Rust build एक छोटा placeholder resource बना देता है जिससे development build चलते रहें। संबंधित क्षमता `PATH` पर fallback कर सकती है या तब तक अनुपलब्ध रह सकती है जब तक आप `pnpm run download:sidecars` न चलाएँ।

## कम्युनिटी

सवाल हैं, फ़ीडबैक देना है, या ORG-2 के विकास के साथ जुड़े रहना है? Discord पर हमसे जुड़ें:

👉 **Discord: [discord.gg/tvWgAqhCzs](https://discord.gg/tvWgAqhCzs)**
👉 **WeChat: [https://github.com/org2AI/ORG2/issues/128]**

- **#how-to-use-org2** और **#faq** — शुरुआत करें
- **#announcement** — रिलीज़ की खबरें और अपडेट
- **#lets-chat** — आप जो बना रहे हैं उसे साझा करें और कम्युनिटी से मिलें
- **#feedback** — विचार, फ़ीचर अनुरोध और बग रिपोर्ट

## लाइसेंस

ORG2 GNU Affero General Public License v3.0 या बाद के संस्करण (`AGPL-3.0-or-later`) के तहत लाइसेंस प्राप्त है। पूर्ण लाइसेंस टेक्स्ट के लिए [`LICENSE`](../../LICENSE) देखें।
