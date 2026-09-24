# 手测 2：官方 v2.0.8 → 修复版 → v2.0.8 → 修复版

**状态：备用指南，未单独执行。** 用户后来选择正式 `~/.orgii` 路径完成往返并于 2026-09-25 报告成功；本文件保留独立 macOS 用户或另一台 Apple Silicon 测试机的可复现方案，不宣称这条备用路径也已执行。

## 需要带到测试环境的文件

将 `/private/tmp/org-history-verification` 中以下内容复制到测试环境的同一目录（例如 `$HOME/OrgHistoryManual`），保持相对结构：

- `build-final/ORG2 Instance 31.app`：修复版 BuildFast
- `official-v2.0.8/ORG2.app`：未经修改的正式 v2.0.8
- `official-v2.0.8/ORG2-updater-mac-apple-silicon.app.tar.gz`：原始发布包
- `launch-app.py`、`inspect-history.py`、`manual-artifacts.json`：启动、只读取证和版本清单

**不要复制 `profile`、`profile-final` 或凭据文件作为本项起点**；它们来自前置 PR 隔离夹具。本项必须让官方 v2.0.8 在全新测试目录中建立自己的数据库。

| 版本        | 原机应用路径                                                             | 二进制 SHA-256                                                     |
| ----------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 修复版      | `/private/tmp/org-history-verification/build-final/ORG2 Instance 31.app` | `845b3235a510a860aef13efb603a2f048a71bb6e6963da0c1501dbb8ffdcb58b` |
| 官方 v2.0.8 | `/private/tmp/org-history-verification/official-v2.0.8/ORG2.app`         | `c11a1e709ee6b27014a7fbb413fa97b158ddf4448dc8a678e3d473796b83d267` |

正式发布压缩包 SHA-256：`7479d1cdc36e94d028ed8e806adffd12d0507790be3e873ba19bdb3a1005d3dc`。来源：[官方 v2.0.8 发布包](https://github.com/org2AI/ORG2/releases/download/v2.0.8/ORG2-updater-mac-apple-silicon.app.tar.gz)。表中的二进制哈希与压缩包哈希是不同对象，不能混用。

## 一次设置

以下命令在**独立测试用户/机器**的 Terminal 执行；若文件复制位置不同，仅修改第一行：

```sh
VERIFY_ROOT="$HOME/OrgHistoryManual"
VERIFY_PROFILE="$VERIFY_ROOT/roundtrip-profile"
mkdir -p "$VERIFY_PROFILE" "$VERIFY_ROOT/manual-evidence" "$VERIFY_ROOT/roundtrip-workspace"
```

每次启动都用脚本设置相同 `ORGII_HOME=$VERIFY_PROFILE` 和 `ORGII_EXTERNAL_HISTORY_HOME=$VERIFY_PROFILE/external-history`。官方包的 WebView 身份仍是系统中的主应用身份，因此独立系统用户/测试机是必要条件；数据目录变量不能代替它。

启动器校验二进制哈希、拒绝已有 ORG2 进程时启动官方包，不会关闭任何应用。切换前必须 Command+Q 确认退出。不要修改 app 标识或注入替代 SQL 来让旧版“通过”。如系统要求正式应用的正常首启操作，请由你完成；不要关闭系统安全保护。

## 逐阶段操作

### A：官方旧版建立基线

```sh
python3 "$VERIFY_ROOT/launch-app.py" --version official \
  --profile "$VERIFY_PROFILE" --label A-old-first
```

1. 自行配置可用测试模型，在 `roundtrip-workspace` 创建旧团队 **A**。让至少一个成员写文件 `old-a.txt` 为 `OLD_A\n`，另一成员读取验证，保存可见最终报告。
2. 加一条可辨认的群聊消息，例如 `ROUNDTRIP_OLD_A_GROUP`，保留成员回复；记录根与成员会话 ID。
3. 再建立一个普通会话 **S**，保存文字 `ROUNDTRIP_ORDINARY_S`。记录一个普通项目/设置值，后面检查它们没有被迁移重置。
4. Command+5 保存 A 的真实请求记录；不要把仍运行中的任务当成已保存报告。
5. 真退出旧版，取证并备份整份隔离数据：

```sh
python3 "$VERIFY_ROOT/inspect-history.py" --profile "$VERIFY_PROFILE" \
  --out "$VERIFY_ROOT/manual-evidence/A-old-before-upgrade.json"
ditto "$VERIFY_PROFILE" "$VERIFY_ROOT/backup-A-old"
```

**预期：** 旧版正常初始化；A 的根/成员/群聊/报告和 S 可读。若出现结构校验错误、未落盘或模型失败，先记录，A 不算完成，不能直接跳到后续阶段宣称往返通过。

### B：首次升级到修复版

```sh
python3 "$VERIFY_ROOT/launch-app.py" --version fixed \
  --profile "$VERIFY_PROFILE" --label B-fixed-first
```

1. 在侧栏及置顶列表打开 A；切换成员、查看群聊和保存内容、翻页、查看最终报告。
2. A 显示“旧版本会话，仅供查看”，不能发送/恢复/重试旧团队；Command+5 不得出现 A 根/成员的新模型请求。
3. S、普通项目和设置保持；不要把 S 变成只读团队历史。
4. 让修复版新建团队 **B**，使用真实模型写 `new-b.txt` 为 `NEW_B\n` 并保存报告。B 应拥有新版团队操作；它必须与 A 的只读身份区别明确。
5. 退出后取证，再启动/退出一次取第二份快照，检查正常重启幂等：

```sh
python3 "$VERIFY_ROOT/inspect-history.py" --profile "$VERIFY_PROFILE" \
  --out "$VERIFY_ROOT/manual-evidence/B-fixed-before-restart.json"
python3 "$VERIFY_ROOT/launch-app.py" --version fixed \
  --profile "$VERIFY_PROFILE" --label B-fixed-restart
# 在 UI 打开 A 和 B 后，Command+Q 退出，再执行：
python3 "$VERIFY_ROOT/inspect-history.py" --profile "$VERIFY_PROFILE" \
  --out "$VERIFY_ROOT/manual-evidence/B-fixed-after-restart.json"
ditto "$VERIFY_PROFILE" "$VERIFY_ROOT/backup-B-fixed"
```

**预期：** A 成为历史；B 在新执行区；固定旧运行区为空；普通副本无执行关联。两次 B 快照的历史身份、归档批次、副本映射数量不增加，B 团队 ID 不变。源正文/报告哈希不丢失。出现空库、A 可执行、B 被退休或重启重复导入均判失败。

### C：降级回官方 v2.0.8

```sh
python3 "$VERIFY_ROOT/launch-app.py" --version official \
  --profile "$VERIFY_PROFILE" --label C-old-downgrade
```

1. 必须看到应用正常打开，无数据库结构校验错误。
2. 找到 A 和 B 的普通历史副本，打开根/成员正文、群聊和报告；名字保留团队/成员含义。用前一步 JSON 的 `copy_mapping` 对照会话身份；如果列表看不到或打不开，即使数据库有行也判失败。
3. 旧版可能仍显示输入控件，本项不要求它强制只读；**不要通过副本发送消息**作为兼容性验收。副本不得关联新版执行区。
4. 旧版另建团队 **C**，保存文字、成员输出、群聊标记 `ROUNDTRIP_OLD_C_GROUP` 和报告；写 `old-c.txt` 为 `OLD_C\n`。
5. 退出后取证和备份：

```sh
python3 "$VERIFY_ROOT/inspect-history.py" --profile "$VERIFY_PROFILE" \
  --out "$VERIFY_ROOT/manual-evidence/C-old-before-reupgrade.json"
ditto "$VERIFY_PROFILE" "$VERIFY_ROOT/backup-C-old"
```

**预期：** A/B 已保存历史可发现且可读，原报告正文匹配；新执行区 B 的结构与记录仍存在。旧版可以将共享排队项改为 stale，不要求未完成任务继续执行。C 留在旧运行区，等待再升级归档。若旧版删除/重置新执行区、正文或报告丢失，则失败。

### D：再次升级修复版

```sh
python3 "$VERIFY_ROOT/launch-app.py" --version fixed \
  --profile "$VERIFY_PROFILE" --label D-fixed-reupgrade
```

1. A 与 C 都可发现、可读、只读；B 仍在当前执行区，原 ID、报告和正文保留；S 保持普通会话。
2. 新版列表只展示源团队身份，不展示普通兼容副本造成的重复团队。
3. 打开 A/C、成员切换、翻页后，Command+5 不得有这些历史会话的新请求；不能自动重放 A/C 退休任务。
4. 退出取证，再正常启动/退出一次，检查没有再次导入 C：

```sh
python3 "$VERIFY_ROOT/inspect-history.py" --profile "$VERIFY_PROFILE" \
  --out "$VERIFY_ROOT/manual-evidence/D-fixed-first.json"
python3 "$VERIFY_ROOT/launch-app.py" --version fixed \
  --profile "$VERIFY_PROFILE" --label D-fixed-repeat
# UI 检查后 Command+Q，再执行：
python3 "$VERIFY_ROOT/inspect-history.py" --profile "$VERIFY_PROFILE" \
  --out "$VERIFY_ROOT/manual-evidence/D-fixed-repeat.json"
```

**预期：** C 只归档一次；D 两份快照的归档批次、历史身份、兼容副本数量及映射相同。B 不清空，A/C 不恢复执行，旧运行区再次为空。副本不能带 org/member/parent/work-item 执行关联。

Command+5 同时记录本地 IPC；对照具体根/成员会话 ID 和模型请求目标，列表刷新、正文读取并不代表执行旧团队。

## 每个阶段必须记录的数量

不要只记全库 `events` 总数：兼容副本的新增本来就会使总数增加。以下表每列填实际数，并同时保留脚本输出 JSON。

| 指标                              | A 旧版基线 | B 首次升级        | B 重启 | C 降级后             | D 再升级          | D 重启 |
| --------------------------------- | ---------- | ----------------- | ------ | -------------------- | ----------------- | ------ |
| 旧运行区团队数及根 ID             |            | 0                 | 0      | 新 C                 | 0                 | 0      |
| 新执行区团队数及根 ID             | 无         | B                 | 同 B   | 同 B                 | 同 B              | 同 B   |
| 历史根团队数及 ID                 | 无         | A                 | 同左   | 同左                 | A+C               | 同左   |
| 历史根/成员会话数                 | 无         |                   | 不增加 |                      | 仅增加 C 关联会话 | 不增加 |
| 普通兼容副本数与来源映射          | 无         | A+B 的已保存会话  | 不增加 | 不应删除             | 增加 C 副本       | 不增加 |
| 全部 agent_sessions / events 行数 |            |                   |        |                      |                   |        |
| 各**源**会话事件数 / 正文哈希     |            | 原 A/S 保持       | 保持   | A/B/S 保持           | A/B/C/S 保持      | 保持   |
| 已保存报告数 / 正文哈希           |            | 原 A 保留、另有 B | 保持   | A/B 保留、另有 C     | 全保留            | 保持   |
| 原始归档批次数                    | 无         | 首次一批          | 不增加 | 不增加               | 因 C 新增一批     | 不增加 |
| 重复来源映射 / 重复副本 ID        | 无         | 0 / 0             | 0 / 0  | 0 / 0                | 0 / 0             | 0 / 0  |
| 历史身份对应新增模型请求          | —          | 0                 | 0      | 不作为未完成续跑验收 | 0                 | 0      |

脚本 `sessions` 包含逐会话事件 ID/正文哈希；`reports` 包含逐报告正文与副本匹配结果；`counts`、`history_roots`、`runs`、`copy_mapping` 是数量与身份依据。完整历史保留可能包含合法重复文本，不能按正文相同就当作重复导入；应比较稳定来源/事件 ID 和映射。

最终固定旧区指纹应为 `ca0b99fc4d60fe4a4d691c405114d7e48009b8b86fdeec78cf1a0f82998cd352`。指纹只能证明结构，不替代官方应用真正打开和浏览。

## 需要回传的证据及失败处理

每阶段保存 UI 截图（侧栏、成员、报告、只读提示）、Command+5 请求会话 ID/时间/结果、取证 JSON、启动 JSON、同次 `.log`、三个结果文件的字节校验。普通 S 的正文及项目/设置也需前后对照。日志不可包含你复制粘贴的凭据。

任一步失败，记录 `FAIL`、阶段、操作和日志时间；保留失败数据库、WAL/SHM 和当时应用版本，退出应用后复制整个 profile 作为故障证据。不要删除表、清空数据或修复后跳过失败阶段。可从对应完整备份复制到另一个测试目录重测。不要把原始归档重新接回执行区，也不要自动复活旧任务。

正式数据路径的用户验收结论见 `AgentOrgHistoryCompatibilityAcceptance.md`。本备用路径没有单独证据，不能引用正式库签收来声称独立测试用户/机器也已运行。

只读取证脚本同时输出 `source_session_count`（扣除兼容副本的会话数）、`source_event_count`（原会话事件数）、`compatibility_copy_event_count`（副本事件数）；历史群聊/可见输出按种类统计在 JSON 的 `visible_items_by_kind`。总事件数增加可以来自合法副本，必须结合这些分类和逐会话 ID/哈希判定，不要直接比较全库总数推断丢失或重复。
