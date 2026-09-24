# Agent Org 历史兼容验收及手测指南

## 当前结论

实现和自动检查已落地；历史浏览、只读、分页和真实退出/重启已用隔离包验证，最终 BuildFast 还已使用正式 `~/.orgii` 完成首次升级与浏览检查。用户于 2026-09-25 报告修复版真实模型和官方 v2.0.8 往返验收成功，并授权提交、推送和创建 Draft PR。两项实机操作由用户完成；代理没有代为发送模型请求，以下记录将用户签收与代理可复核证据分开陈述。

分支 `codex/agent-org-history-compatibility`，基线 `22767a2a4f3185b127bf6d5669302cffcbe6dce4`，未来 PR 目标 `codex/agent-org-background-history`。基线相对用户方案中的 `384a7a71d` 仅增加子进程测试，生产代码相同。

## 可复现构建

```sh
WEBDRIVER=1 NODE_OPTIONS=--max-old-space-size=16384 CARGO_BUILD_JOBS=4 \
  pnpm run tauri:build:fast -- --instance 31 "$ARTIFACT_DIR"
```

独立应用名 `ORG2 Instance 31`，应用身份 `org2ai.org2.instance31`，API 端口 13877，代理端口 17918。启动器显式设置 `ORGII_HOME`，清除 E2E 模拟环境变量；隔离模式把外部来源发现目录放在夹具内，正式模式则把 `ORGII_EXTERNAL_HISTORY_HOME` 设为真实用户主目录，使 Codex 继续读取 `~/.codex/sessions`。正式模式要求 `--allow-primary-profile` 并在存在任何 ORG2 进程时拒绝启动，保证版本不会并行写库。

最终应用：`/private/tmp/org-history-verification/build-final/ORG2 Instance 31.app`。二进制 SHA-256：`845b3235a510a860aef13efb603a2f048a71bb6e6963da0c1501dbb8ffdcb58b`。构建日志：`/private/tmp/org-history-build-formal-fix.log`，退出码 0，用时 460.6 秒。最终包包含共享运行视图停止历史重试、缺失模板快照仍按已保存成员关系归档，以及旧版群聊定向回复在新版执行区建表前仍可生成历史副本三处实机修正。

源码清单及逐文件哈希：`/private/tmp/org-history-verification/final-source-manifest.json`；已跟踪文件补丁 SHA-256 为 `bcccb7fa32819eef92e5b0f90d33010ec059bd42f7c0adc2b5d4ef3f8dc219e5`。未跟踪新增文件另在清单中逐个记录，不能仅凭 HEAD 代表本次实现。最终复核 GitHub #2130 仍为上述基线。

首次安装包及其证据保留在 `build/`；其二进制 SHA-256 为 `fe976fa549f8bd3225251179a6d4ff6809a3f5add9da69c14a3f6e787bae4874`。该包不能替代本次交付版本。

## 自动验证

原始日志及其 SHA-256 清单：`/private/tmp/org-history-verification/automated-evidence-manifest.json`。

| 实际执行命令/范围                                                                                                                                                                                                                  | 结果                                                                                            | 证明边界                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo test --manifest-path src-tauri/Cargo.toml -p agent_core -p session_persistence --lib --no-fail-fast`                                                                                                                        | 最终核心 3,755 通过、3 项原有忽略；会话持久化 67 通过                                           | 固定 v2.0.8、2105/2130 相同旧 DDL、中间附加 BLOB、缺表、事务回滚/并发、当前区损坏、幂等、增量副本、旧群聊事件初始化顺序、发送与工具准入、原有新团队生命周期 |
| `cargo test --manifest-path src-tauri/Cargo.toml -p agent_core --lib retired_archived_roots_remain_discoverable`                                                                                                                   | 后补 1 项通过                                                                                   | 归档历史根仍可发现；副本不能挤占分页名额                                                                                                                    |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::session_directory`                                                                                                                                          | 93 项通过                                                                                       | 置顶、自定义分组与侧栏历史身份一致                                                                                                                          |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`                                                                                                                                                   | 最终 Rust 源码通过                                                                              | 所有目标编译和严格检查；不代表实机运行通过                                                                                                                  |
| `NODE_OPTIONS=--max-old-space-size=16384 pnpm exec vitest run --config config/vitest.config.ts`                                                                                                                                    | 2,262 文件通过、1 文件因依赖软链接越界导入而未运行；17,076 测试通过、2 expected fail、3 skipped | 完整前端套件实际结果；不是一次全绿运行                                                                                                                      |
| 本工作区 `pnpm install --frozen-lockfile --offline` 后，重跑 `ReactArtifactRunner.runtime.test.ts`                                                                                                                                 | 7 项通过                                                                                        | 修复测试环境；未修改业务代码规避失败                                                                                                                        |
| `pnpm exec vitest run --config config/vitest.config.ts src/engines/ChatPanel/InputArea/components/agentOrgRunViewStore.test.ts src/engines/ChatPanel/AgentOrgHistoryBoundary.test.ts src/api/tauri/agent/orgTasks/history.test.ts` | 最后前端修正后 27 项通过                                                                        | 历史错误停止所有共享消费者的轮询/重连发现；当前团队继续刷新；身份在途合并、分页和只读界面                                                                   |
| `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck`                                                                                                                                                                           | 通过                                                                                            | 前后端新增字段的 TS 使用契约                                                                                                                                |
| `pnpm run lint`，最后改动再检查对应 3 文件的 oxlint/eslint                                                                                                                                                                         | 通过                                                                                            | 无抑制规则、无跳过 hook                                                                                                                                     |
| `pnpm run check:circular`                                                                                                                                                                                                          | 通过                                                                                            | 无循环依赖                                                                                                                                                  |
| `node scripts/quality/check-test-placement.mjs`                                                                                                                                                                                    | 635 目录通过                                                                                    | 测试位置                                                                                                                                                    |
| `pnpm run check:i18n:contracts`                                                                                                                                                                                                    | 15 语言、128,918 值，零新增问题                                                                 | 新只读/分页/失败文案                                                                                                                                        |
| `git diff --check`                                                                                                                                                                                                                 | 通过                                                                                            | 无空白错误                                                                                                                                                  |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`                                                                                                                                                                  | 未全仓通过                                                                                      | 最终重跑仍有 70 个未改动基线文件的格式差异，逐文件与 HEAD 字节一致；与本次 227 文件交集为 0。受影响文件没有剩余格式差异，未扩展到全仓格式清理               |

## 首次安装包实机记录（保留原证据）

测试数据库来自前置 PR 的**既有隔离真实模型夹具**，不是用户主数据库。升级前有 5 个团队、25 个根/成员会话、947 条事件、13 份已保存报告。

| 操作                                    | 结果与数据库证据                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 首次启动                                | 5 个历史根、25 个历史身份、25 个独立普通副本、1 批原始归档；新执行区和固定旧区均为空                       |
| 打开根和成员                            | 根报告与 Implementer 正文可读；显示 `Older-version conversation, view only`，无发送输入框                  |
| 打开保存内容、下一页                    | 中文/英文群聊、任务输出和报告可读；首个 50 条窗口可翻到后续内容；不是全量累计渲染                          |
| 原本 archived 的团队                    | 在侧栏可发现、可打开；可置顶，仍呈现同一历史身份                                                           |
| Command+Q、确认退出、进程消失、重新启动 | 归档批次、历史身份/副本、947 原事件、13 报告不重复；打开后报告仍可读                                       |
| 原始内容对照                            | 947 条事件的正文、结果 JSON、时间均保持；13 份报告与普通副本的正文逐一匹配；副本无父会话或团队成员执行字段 |
| 原事件缓存元数据                        | 既有正文加载过程修改 32 条事件 args 中的 `historySequence` / `turnPreviewOnly`；没有声称共享缓存逐字节不变 |
| 旧任务状态                              | 原始归档仍是 running 2、idle 2、archived 1；没有改成完成或取消                                             |
| 多次打开、成员切换、翻页、隐藏、关闭    | Command+5 `No API calls yet`；历史事件数 947，模型用量记录 720，均未增长                                   |
| 新建团队                                | UI 正常建立 1 个新版团队和增量副本；真实调用被过期测试登录阻断，不能作为模型执行/交付通过证据              |

旧版副本的原始事件与可见快照有独立稳定 ID；新版本列表排除副本。自动测试覆盖写入失败时源事件和副本一起回滚、重复写入不增加版本，以及再升级不重新扫描已归档正文。

## 前一候选包的隔离历史复测

以下隔离复测使用候选 SHA-256 `fb4b52ad4bd774b6d663dc06008f76a91ab384320ae49cb3c3149b632693f959` 和新的 `profile-final`。该证据仍证明共享 UI 与生命周期边界，但候选包已被正式库发现的初始化顺序修正取代，不能作为最终二进制身份。

| 检查               | 实际结果                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 第一次升级         | 5 个历史根、25 个历史身份、25 个普通副本、333 条可见历史项、1 批原始归档；旧运行区 0、新执行区 0                            |
| 根、成员、保存内容 | 根报告可读；Implementer 原文可读；长群聊翻到下一页，保留首页入口和只读提示                                                  |
| 归档根及置顶       | 原 archived 团队可发现、打开并置顶，保持历史身份                                                                            |
| 真实退出/重启      | PID 57632 经 Command+Q 确认退出，进程消失；同包新 PID 59826；重启后报告可读、置顶保留                                       |
| 数量与正文         | 前后 50 个共享会话（25 源 + 25 副本）、1,839 事件（947 源 + 892 副本）；947 条源正文哈希逐条一致；13 份报告副本正文全部匹配 |
| 原状态             | running 2、idle 2、archived 1，未改成完成/取消                                                                              |
| 幂等与授权         | 归档、映射、报告与源会话事件集合重启前后完全一致；重复来源映射和重复副本 ID 均为 0；副本执行关联为空                        |
| 模型与后台         | 模型用量记录 720→720；无历史模型请求；Command+5 仅见普通本地 IPC。共享工作站跨 60 秒周期无历史运行视图 fallback             |
| 生命周期采样       | 可见、隐藏、离开历史但保留标签、明确关闭历史标签各 16 样本/约 75 秒；详见性能审查，未把主进程样本称作整机或长期指标         |

可复核 JSON 位于 `/private/tmp/org-history-verification/`：`final-before-upgrade.json`、`final-after-upgrade.json`、`final-after-browse.json`、`final-before-restart.json`、`final-after-restart.json`、`final-runtime-evidence.json`。同次启动记录和进程日志在 `manual-evidence/final-history-*` 与 `manual-evidence/final-restart-*`。初版证据继续保留，没有覆盖为最终通过。

## 最终包正式库首次升级检查

正式 v2.0.8 数据库升级前为 3.3 GB，638 个 session、3,311 条事件、6,626 条模型用量记录、25 条旧运行记录和 18 份报告；`PRAGMA quick_check` 为 `ok`。一致性备份保存于 `~/.orgii-agent-org-history-before-fixed-20260924-225841/sessions.db`，SHA-256 为 `a598dcc3fba0979edee3bebb48fb95a2fdeb7dc919c94501ce6253d063493161`。

第一次正式库启动暴露旧群聊定向回复会在执行区建表前查询新表，界面报缺表。迁移事务完整回滚；启动前后数量、正文和结构指纹一致。修正并完成上表核心检查后，用最终 SHA 重新启动成功：638 个源 session、3,311 条源事件和 18 份报告逐项保持；421 个历史身份及普通副本、88 个历史根、1 个原始归档批次；旧运行区与新执行区均为 0；重复来源映射/副本 ID 为 0；18 份报告副本全部匹配；旧区指纹仍为 v2.0.8 固定值，`quick_check` 为 `ok`。

Computer Use 已看到原正式侧栏，打开“规划德州扑克游戏开发”根报告与 Implementer 正文，显示“旧版本会话，仅供查看”且无发送输入区。没有新建执行团队、发送模型任务或启动官方 v2.0.8；最终包保持打开供用户继续两项手测。证据：`manual-evidence/formal-before-fixed.json`、`formal-after-failed-fixed.json`、`formal-after-fixed-ready.json`、`formal-fixed-ready-*-launch.json/.log`。

后续版本切换发现正式启动器曾把 `ORGII_EXTERNAL_HISTORY_HOME` 错设为 `~/.orgii/external-history-home`。该变量是 Codex、Claude 等来源的发现主目录；错误值使扫描看不到真实 `~/.codex/sessions`，并将可重建的 `imported_history_session_cache` 中 Codex 行暂时裁掉。源文件未删除，升级前备份和当前正式库均为 590 条 Codex 缓存、585 条可列出。直接启动官方应用后缓存恢复；启动器现已在正式模式使用 `$HOME`。这是手测启动环境修正，不改变产品实现或 Agent Org 历史迁移结果。

## 用户最终手测签收

1. **真实模型**：用户于 2026-09-25 报告修复版新团队与真实模型验收成功。代理未代为发送请求；用户没有回传团队 ID、Command+5 截图或结果文件，因此本记录把它列为用户签收，不伪造逐项机器证据。
2. **官方 v2.0.8 往返**：用户使用正式 `~/.orgii` 完成版本切换并报告成功。官方 v2.0.8 二进制 SHA-256 为 `c11a1e709ee6b27014a7fbb413fa97b158ddf4448dc8a678e3d473796b83d267`；发布压缩包 SHA-256 为 `7479d1cdc36e94d028ed8e806adffd12d0507790be3e873ba19bdb3a1005d3dc`。收尾只读快照仍有 638 个源 session、18 份报告、421 个历史身份和副本、88 个历史根、1 个归档批次；新旧执行区均为 0，重复来源映射和副本 ID 均为 0，旧区指纹保持 v2.0.8 固定值。该快照保存在本机验收证据目录，不提交数据库或用户内容。

官方包来源：[v2.0.8 macOS Apple Silicon 发布包](https://github.com/org2AI/ORG2/releases/download/v2.0.8/ORG2-updater-mac-apple-silicon.app.tar.gz)。

## 用户手测指南

- [手测 1：修复版新团队和真实模型执行](AgentOrgHistoryCompatibilityManualNewTeam.md)
- [手测 2：本机正式 `~/.orgii` 往返](AgentOrgHistoryCompatibilityManualFormalRoundTrip.md)
- [备用：独立测试用户/机器四阶段往返](AgentOrgHistoryCompatibilityManualRoundTrip.md)

指南包含固定应用/二进制 SHA-256、正式或隔离目录与启动器、逐步操作、每步预期与失败判定，以及 UI、数据库、日志、文件、Command+5 的证据清单。往返指南提供团队、会话、正文、报告、副本和归档的逐阶段计数表。用户已签收两项；没有回传的分项证据继续明确标为“用户报告”，不转换成代理实测结论。

Command+5 包含普通本地 IPC 请求；“历史零模型请求”不等于面板所有请求为零。侧栏既有的 `session_aggregate_list` 周期刷新与用户触发的正文读取仍存在，不能将它们误判为历史模型执行，也不能声称应用完全没有轮询。

## 风险和恢复

首次升级需要一次原始行归档和可见内容副本写入，会增加磁盘占用；中断/写入失败整体事务回滚。成功后原始归档保留用于提取数据，不能直接接回旧执行授权。旧版可将共享排队状态改为 stale，本次不承诺 unfinished 任务续跑。普通会话、项目、设置、模板原文和其他数据库对象保留。用户已签收实机验收，但未回传的逐步请求、文件和数量证据不能由自动测试代替。

## 改动分类

按显式 SQL 对象映射先剥离机械改名，再按行为差异计数；schema 中原有 594 行测试提取到 607 行独立测试文件，不算删除业务逻辑。完整逐文件清单保存在本地验收证据目录。

最终实际差异：207 个已跟踪文件新增 2,908／删除 3,176 行；20 个新增文件共 5,972 行，合计 **227 文件，新增 8,880／删除 3,176 行**。审计文档单列，不在此数中。

显式对象映射剥离后的分类使用逐行序列比较，和 Git 分块计数略有差异；不同类别可涉及同一物理文件，文件数不能相加：

| 类别                               | 文件数         | 新增 / 删除   | 说明                                                                                                |
| ---------------------------------- | -------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| 表、索引与查询机械改名             | 161            | 2,392 / 2,392 | 共 4,784 行，位于预算 4,000–5,500 内                                                                |
| 改名后换行/逗号格式适配            | 4              | 26 / 11       | 无行为变化，单列                                                                                    |
| 实质生产逻辑                       | 45             | 1,815 / 254   | 合计 2,069 行，位于 1,400–2,200 预算内；18 文件至少 10 行非机械变动，其余多数为 DTO、导出或入口接入 |
| 行为测试及测试支持（不含整段移动） | 22             | 1,172 / 11    | 低于预估行数；并未据此缩减验收矩阵                                                                  |
| 原 schema 测试移动                 | 1 个新测试文件 | 607 / 594     | 从生产 schema 文件提取，不计为删除生产逻辑                                                          |
| 两份固定版本 SQL                   | 2              | 2,804 / 0     | v2.0.8 固定结构及前置 PR 升级输入                                                                   |
| 国际化                             | 15             | 150 / 0       | 历史提示和分页文案                                                                                  |

物理生产文件 45 个高于初估 22–32，原因是既有跨层 DTO、目录和入口的分散接入；未扩展功能、执行授权迁移或常驻同步。逐文件分类在 `/private/tmp/org-history-verification/diff-classification.json`。

最终复核：没有新增凭据、个人绝对目录、构建产物、依赖锁文件修改或检查抑制规则；新增 UI 控件均使用共享 Button，无原生按钮或可点击替代元素。主工作区和 2130 工作区的原有改动未被本工作区纳入。用户已授权从本分支提交、推送并创建 Draft PR。

本地审计文档受仓库共享 `.git/info/exclude` 的 `/docs/` 规则忽略，按用户要求保存在工作区，没有改忽略规则或强制暂存。未来得到提交授权时需要显式处理这些交付文档。

## 交付索引

- [设计到代码、验收到测试及十层架构复核](AgentOrgHistoryCompatibilityImplementation.md)
- [UI 审查](../frontend-ui-audit-2026-09-24/AgentOrgHistoryBoundary.md)：0 fix / 5 keep with reason / 0 abstract
- [性能审查](../org2-performance-guard-2026-09-24/AgentOrgHistoryCompatibility.md)：历史路径已验证，完整矩阵两格由用户实机签收
- [新团队真实模型手测](AgentOrgHistoryCompatibilityManualNewTeam.md)
- [官方 v2.0.8 往返手测](AgentOrgHistoryCompatibilityManualRoundTrip.md)
- [本机正式 `~/.orgii` 往返手测](AgentOrgHistoryCompatibilityManualFormalRoundTrip.md)
