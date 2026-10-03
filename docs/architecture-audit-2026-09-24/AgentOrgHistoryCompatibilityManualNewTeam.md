# 手测 1：修复版新团队和真实模型执行

**状态：用户于 2026-09-25 报告验收成功。** 新团队和真实模型步骤由用户执行；代理未代为发送请求。用户未回传团队 ID、Command+5 截图或结果文件，因此本文件记录用户签收，不将缺失的分项证据写成代理实测。

若从[正式数据往返指南](AgentOrgHistoryCompatibilityManualFormalRoundTrip.md)进入本项，只复用本文件的任务原文、操作和判定；应用启动、数据目录、前后取证路径以正式数据往返指南为准。下面的 `profile-final` 启动说明仅适用于隔离夹具模式。

> 这是隔离验收环境，不是你的正式 `~/.orgii` 数据库。正式 session 不会出现在这里；当前夹具只有 25 个历史源会话及其 25 个普通兼容副本。下面的 `.app` 路径只用于固定测试版本，**不要直接双击启动**，因为双击不会设置本指南要求的数据目录。始终使用下方 `launch-app.py` 命令启动。

正式数据模式已经由用户明确选择，并完成一致性备份和首次升级检查。若从正式数据往返指南进入，忽略本节的隔离 profile 提示，保持使用 `~/.orgii`；仍需保证任一时刻只有一个 ORG2 进程。若单独执行本指南，继续使用下面的隔离夹具。

## 固定版本与启动

- BuildFast：`/private/tmp/org-history-verification/build-final/ORG2 Instance 31.app`
- 可执行文件：上述 `.app/Contents/MacOS/org2`
- 二进制 SHA-256：`845b3235a510a860aef13efb603a2f048a71bb6e6963da0c1501dbb8ffdcb58b`
- 分支：`codex/agent-org-history-compatibility`；基线：`22767a2a4f3185b127bf6d5669302cffcbe6dce4`
- 隔离数据：`/private/tmp/org-history-verification/profile-final`
- 隔离外部历史：`/private/tmp/org-history-verification/profile-final/external-history`
- 测试输出目录：`/private/tmp/org-history-verification/new-team-workspace`
- 身份：`org2ai.org2.instance31`；API 13877；代理 17918

若测试实例已经由下方脚本启动，可直接使用。否则只对 **ORG2 Instance 31** 使用 Command+Q 并确认退出，再运行：

```sh
python3 /private/tmp/org-history-verification/launch-app.py \
  --version fixed \
  --profile /private/tmp/org-history-verification/profile-final \
  --label new-team
```

启动器会校验 SHA-256、拒绝重复启动相同实例、设置两处隔离目录并去掉 E2E 模拟变量。不要用其他安装包代替，也不要退出主 ORG2。每次启动的 PID、时间、版本和日志路径写入 `manual-evidence/*-launch.json`；同目录 `.log` 是对应进程日志。

启动后侧栏应看到隔离夹具中的 5 个历史团队，而不是你正式环境中的 session。若侧栏完全没有这 5 个团队，先退出测试实例并重新执行上述脚本；不要通过“改成正式数据库”来修正启动方式。

先自行完成测试模型账户登录；此前隔离账户的过期错误只作为环境证据保留。本指南不要求复用该账户。

## 记录起点

```sh
mkdir -p /private/tmp/org-history-verification/manual-evidence
python3 /private/tmp/org-history-verification/inspect-history.py \
  --profile /private/tmp/org-history-verification/profile-final \
  --out /private/tmp/org-history-verification/manual-evidence/new-team-before.json
mkdir -p /private/tmp/org-history-verification/new-team-workspace
```

脚本只读数据库，不打印凭据。初始夹具应有 5 个历史团队、25 个历史会话、25 个普通副本、947 条原始事件、13 份已保存报告；旧运行区为 0，新执行区为 0。若你此前已做过测试，以保存的 `before.json` 实际值为准，不删除历史来凑数量。

Command+5 同时记录本地 IPC；判断时按根/成员会话 ID 区分真实模型请求与列表/正文读取，不能用面板总请求数代替模型请求数。

## 操作与判定

| 步骤 | 操作                                                               | 预期结果 / 失败判定                                                                                                                |
| ---- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 新会话选择 Default Agent Org、可用真实模型，并选择上述独立输出目录 | 显示新版团队操作界面，不能出现历史只读提示；工作目录不得指向代码仓库或旧夹具项目                                                   |
| 2    | 发送下方最小任务                                                   | Command+5 出现此**新团队根/成员**的真实请求；若只有登录错误、排队或模型口头答复而没有真实请求，不算通过                            |
| 3    | 等待 Implementer 与 Reviewer/Tester 完成                           | 正式任务有输出、独立验证完成、保存最终报告；不能只有聊天文本“已完成”                                                               |
| 4    | 读文件、抓取数据库、日志和请求记录                                 | `hello.txt` 恰为 18 字节 `HISTORY_COMPAT_OK\n`；新执行区增加 1 个团队；对应会话存在副本；原 5 个历史团队不产生请求、不变成 current |
| 5    | Command+Q 真退出，再用同一命令启动                                 | 原新团队 ID 保持在新执行区，任务/报告仍可读；不得清空或退休成历史；不得重复产生执行团队或副本                                      |
| 6    | 回到旧团队，切成员、翻页，再看 Command+5                           | 历史仍无输入执行控件；不能出现属于旧根/成员的新模型请求；旧正文/报告哈希不变                                                       |

建议任务原文：

```text
只在 /private/tmp/org-history-verification/new-team-workspace 工作。
使用最小正式团队流程：Implementer 创建 hello.txt，内容恰好是 HISTORY_COMPAT_OK 加一个换行；Reviewer 或 Tester 独立读取并核对完整字节。记录正式 TaskOutput，完成交付认证并保存简短最终报告。不要启动服务、安装依赖、提交 Git，也不要修改目录外的文件。
```

文件独立检查：

```sh
python3 - <<'PY'
from pathlib import Path
p = Path('/private/tmp/org-history-verification/new-team-workspace/hello.txt')
data = p.read_bytes()
print('bytes:', len(data), 'repr:', repr(data))
assert data == b'HISTORY_COMPAT_OK\n'
PY
```

## 同一团队继续回归

以下是用户计划要求的真实模型回归项。用户已给出整体验收成功结论，但没有回传每项前后快照和 Command+5 记录；因此这些步骤继续作为可复现清单，不单独宣称每一格都有机器证据。

| 场景            | 可直接执行的操作                                                                                                                                                                         | 预期 / 失败判定                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 暂停后交付      | 追加给 Implementer 的任务：若 `pause.marker` 不存在，创建它并同步等待 90 秒；若已存在则跳过等待，写 `pause-result.txt` 为 `RESUMED\n`。在等待时通过团队按钮暂停，确认进入 Paused，再恢复 | 同一正式 Task ID 继续；结果文件和最终报告保存；不得重复创建替代任务来冒充恢复                                      |
| 报告 Stop/Retry | 在任务结束、最终报告仍在生成时点击 Stop；确认报告停止，再 Retry                                                                                                                          | 新请求属于报告重试；正式任务不重新执行；只保留有效报告结果，不重复交付。如果模型太快而未捕获生成中窗口，记为未覆盖 |
| 结算禁发        | 在最终报告生成的结算阶段尝试发普通团队消息                                                                                                                                               | 明确禁止/拒绝，不接收为新任务，不产生额外执行授权；请求不能偷偷排队到下一轮                                        |
| 拒绝请求恢复    | 在团队空闲时自行使测试模型凭据不可用，发送一条小任务，确认拒绝；恢复可用账户并使用产品重试入口                                                                                           | 错误清晰；重试不丢正文、不重复正式任务；只有有效请求产生真实用量。只改测试实例配置                                 |

## 每阶段证据

将快照命令中的文件名改为 `new-team-after-delivery.json`、`new-team-after-restart.json`、`new-team-after-pause.json` 等：

```sh
python3 /private/tmp/org-history-verification/inspect-history.py \
  --profile /private/tmp/org-history-verification/profile-final \
  --out /private/tmp/org-history-verification/manual-evidence/new-team-after-delivery.json
```

检查并回传：

- UI：团队根标题、成员、任务状态、报告正文、旧历史只读提示截图
- 数据库：`runs.agent_org_execution_runs` 中新团队 ID；`history_roots` 仍为原历史；每个源会话事件数量与正文哈希；报告数；副本映射
- 重复检查：`duplicate_source_mappings=0`、`duplicate_copy_ids=0`、`copy_authority_violations=[]`；当前新增报告的 `copy_body_matches=true`
- 日志：对应启动记录中的 `.log`，保留发送、暂停、恢复、报告保存时段，不把凭据贴入记录
- 文件：`hello.txt` 和后续暂停测试文件实际字节
- Command+5：模型名、根/成员会话 ID、请求时间与结果；历史会话请求数应为 0

回传格式：每项 `PASS / FAIL / 未覆盖`，新团队根 ID、模型、前后 JSON 文件、相关请求截图、文件验证输出、错误或日志时间段。用户已报告整体 `PASS`；若后续补交分项材料，可追加到验收记录，无需修改产品实现。

只读取证脚本同时输出 `source_session_count`（扣除兼容副本的会话数）、`source_event_count`（原会话事件数）、`compatibility_copy_event_count`（副本事件数）；历史群聊/可见输出按种类统计在 JSON 的 `visible_items_by_kind`。总事件数增加可以来自合法副本，必须结合这些分类和逐会话 ID/哈希判定，不要直接比较全库总数推断丢失或重复。
