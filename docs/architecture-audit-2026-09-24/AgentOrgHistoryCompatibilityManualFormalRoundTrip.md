# 正式数据往返手测：官方 v2.0.8 ↔ 修复版 BuildFast

**状态：用户于 2026-09-25 报告往返验收成功。** 本指南使用本机正式 `~/.orgii` 数据环境。代理准备版本、备份和启动入口；版本切换和团队操作由用户执行。

## 已固定的起点

- 正式数据目录：`~/.orgii`
- 正式外部历史发现主目录：`$HOME`，因此 Codex 来源为 `~/.codex/sessions`
- 官方应用：`/Applications/ORG2.app`
- 官方版本：v2.0.8；二进制 SHA-256：`c11a1e709ee6b27014a7fbb413fa97b158ddf4448dc8a678e3d473796b83d267`
- 修复版：`/private/tmp/org-history-verification/build-final/ORG2 Instance 31.app`
- 修复版二进制 SHA-256：`845b3235a510a860aef13efb603a2f048a71bb6e6963da0c1501dbb8ffdcb58b`
- 升级前备份：`~/.orgii-agent-org-history-before-fixed-20260924-225841/sessions.db`
- 备份 SHA-256：`a598dcc3fba0979edee3bebb48fb95a2fdeb7dc919c94501ce6253d063493161`
- 双击启动器：`/private/tmp/org-history-verification/ORG2 BuildFast 正式数据.app`
- 命令行启动器：`/private/tmp/org-history-verification/launch-app.py`
- 只读取证：`/private/tmp/org-history-verification/inspect-history.py`

升级前数据库已经过 `PRAGMA quick_check`，结果为 `ok`：638 个 session、3,311 条事件、6,626 条模型用量记录、25 个旧运行区团队、18 份已保存报告；旧结构指纹为 v2.0.8 的 `ca0b99fc4d60fe4a4d691c405114d7e48009b8b86fdeec78cf1a0f82998cd352`。

## 切换版本的硬规则

1. 任一时刻只能运行一个 ORG2 进程。切换前使用 Command+Q 真退出，等待窗口和进程消失。
2. BuildFast 必须使用“ORG2 BuildFast 正式数据.app”或下面的命令行启动器；不能直接双击 `build-final/ORG2 Instance 31.app`，后者会按 Instance 31 规则进入隔离数据目录。
3. 官方 v2.0.8 可从 `/Applications/ORG2.app` 正常启动，也可用启动器的 `--version official`；二者二进制哈希相同。
4. 不删除历史表、兼容副本或原始归档，不手动修数据库来让步骤通过。
5. Command+5 会包含正常的本地 IPC。按根/成员 session ID 判断模型请求；列表和正文读取不算团队执行。

启动器在使用正式 profile 时要求 `--allow-primary-profile`，并且检测到任何 ORG2 进程都会拒绝启动，防止两个版本同时写正式数据库。正式模式把 `ORGII_EXTERNAL_HISTORY_HOME` 设为用户主目录 `$HOME`；不能改成 `~/.orgii/external-history-home`，否则应用会把真实 `~/.codex/sessions` 判为不存在，并在重扫期间暂时清空 Codex 侧栏缓存。

## A：修复版首次升级

代理已完成本阶段的非模型启动检查：正式 session 可见，旧团队根报告和 Implementer 正文可读，界面显示“旧版本会话，仅供查看”。数据库结果为 638 个源 session、3,311 条源事件、18 份报告全部保持；421 个历史身份及普通兼容副本、88 个可发现历史根、1 个归档批次；旧运行区和新执行区均为 0，重复来源映射/副本 ID 均为 0，`PRAGMA quick_check` 为 `ok`。证据是 `manual-evidence/formal-before-fixed.json` 与 `manual-evidence/formal-after-fixed-ready.json`。用户随后报告 B/C/D 往返成功。

双击 `/private/tmp/org-history-verification/ORG2 BuildFast 正式数据.app`，或执行等价命令：

```sh
python3 /private/tmp/org-history-verification/launch-app.py \
  --version fixed \
  --profile "$HOME/.orgii" \
  --allow-primary-profile \
  --label formal-fixed-ready
```

预期：应用正常进入工作台，能看到原正式 session；此前 25 个团队作为“旧版本会话，仅供查看”出现，普通 session、项目和设置仍可用。不得出现应用错误、空白侧栏、结构校验错误或自动重放旧团队。

先打开你熟悉的普通 session 和至少两个旧团队，分别检查根正文、成员、群聊和报告。再执行：

```sh
python3 /private/tmp/org-history-verification/inspect-history.py \
  --profile "$HOME/.orgii" \
  --out /private/tmp/org-history-verification/manual-evidence/formal-A-fixed.json
```

记录 UI 截图、Command+5、启动 JSON 和对应 `.log`。失败判定包括：原 session 消失、旧团队可执行、正文/报告打不开、归档或副本重复、历史 session 发出模型请求。

## B：在修复版创建真实模型团队

按[新团队真实模型手测指南](AgentOrgHistoryCompatibilityManualNewTeam.md)执行最小任务，但数据目录保持本指南的正式 `~/.orgii`，不要改回 `profile-final`。记录新团队根/成员 ID、真实模型请求、任务输出、报告和结果文件。

退出并重新启动一次修复版，确认新团队仍在新版执行区、旧团队仍只读且没有重复导入。再次保存取证 JSON，例如 `formal-B-fixed-restart.json`。

## C：降级到官方 v2.0.8

先 Command+Q 退出 BuildFast，再确认没有 ORG2 进程。推荐用同一启动器保留日志：

```sh
python3 /private/tmp/org-history-verification/launch-app.py \
  --version official \
  --profile "$HOME/.orgii" \
  --allow-primary-profile \
  --label formal-official-downgrade
```

预期：官方 v2.0.8 正常打开；原正式普通 session 仍可读；旧团队和修复版新团队的普通兼容副本可发现并打开正文/报告。旧版可能显示输入控件，不要求其强制只读；不要通过兼容副本发送消息。新版执行表必须保留，旧版不得清空它。

可在官方版另建一个小团队并保存可见正文、群聊和报告，用于验证再次升级的新增旧团队归档。退出后保存 `formal-C-official.json`。

## D：再次升级修复版

确认官方版已退出后，重新执行 A 的 BuildFast 启动命令，将 `--label` 改为 `formal-fixed-reupgrade`。

预期：最初 25 个旧团队和 C 阶段新增团队均为历史只读；B 阶段新团队仍在新版执行区，ID、正文和报告保留；普通兼容副本不会在新版侧栏造成重复；历史团队不产生模型请求或自动重放。退出、再启动一次，归档批次、历史身份和副本映射不再增加。

## 每阶段记录

| 指标                   | 升级前 v2.0.8 | A 修复版     | B 修复版重启 | C v2.0.8     | D 再升级    | D 重启 |
| ---------------------- | ------------- | ------------ | ------------ | ------------ | ----------- | ------ |
| 全部 session / event   | 638 / 3,311   |              |              |              |             |        |
| 旧运行区团队数         | 25            | 0            | 0            | C 新团队数   | 0           | 0      |
| 新执行区团队 ID        | 无            | 0            | B            | B            | B           | B      |
| 历史根 / 历史会话数    | 无            |              | 不增加       | 保留         | 增加 C      | 不增加 |
| 普通兼容副本数         | 无            |              | 不增加       | 保留         | 增加 C      | 不增加 |
| 源会话正文哈希         | 基线          | 保持         | 保持         | 保持         | 保持        | 保持   |
| 已保存报告数 / 哈希    | 18 / 基线     | 保持并增加 B | 保持         | 保持并增加 C | 全保留      | 保持   |
| 原始归档批次数         | 无            | 1            | 1            | 1            | 因 C 增加 1 | 不增加 |
| 重复来源映射 / 副本 ID | 无            | 0 / 0        | 0 / 0        | 0 / 0        | 0 / 0       | 0 / 0  |
| 历史模型请求           | —             | 0            | 0            | 不验收续跑   | 0           | 0      |

每阶段同时保留：侧栏、成员与报告 UI；取证 JSON；启动 JSON 和 `.log`；Command+5 中请求对应的 session ID；B/C 测试文件实际字节。若数量发生合法变化，必须能由新团队和稳定来源映射解释，不能只比较全库总数。

## 失败与恢复

任一步失败，先退出应用并保存当时 `sessions.db`、`-wal`、`-shm` 和日志，不要继续下一个版本。升级前备份已经独立保留，且不含运行中的 WAL 依赖。恢复会覆盖正式数据库，必须在所有 ORG2 进程退出、失败现场另存后再做；不要边运行边复制，也不要只删兼容表。

用户已报告完整往返通过。收尾只读快照保留 638 个源 session、18 份报告、421 个历史身份和副本、88 个历史根、1 个归档批次；新旧执行区均为 0，重复来源映射和副本 ID 均为 0，旧区指纹仍为固定 v2.0.8 值。用户未回传每阶段表格、截图和 Command+5 记录，因此这些数量是代理可复核的最终快照，完整操作结论仍标记为用户签收。
