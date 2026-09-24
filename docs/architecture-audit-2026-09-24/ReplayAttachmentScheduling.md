# 会话回放附件调度隔离：实现与验证

本次实现对应中文设计 [#2114](https://github.com/org2AI/ORG2/pull/2114) 的第一步：正文同步不再等待附件能力探测、补传读取或网络上传。本次不实施完整持久附件 outbox、对象存储、逐附件界面或配额管理；线上容量不变。

## 根因与写入边界

正文以本机规范化事件为源，经 `Org2CloudSessionSync` 提交远端正文，并写入 `org2CloudPushCursorsAtom`。#2111 已将正文提交提前，但 `pushSession` 仍等待附件，且附件补传状态会迫使正文轮次探测能力并全量读取历史。一个慢附件可以占住 sender pass，影响之后的会话或追加正文。

现在正文只调度附件任务，不等待任务完成。正文已经干净时，待补传标记只触发独立附件工作，不影响正文的增量读取策略。共享文件版本标记仍是原有持久游标字段，没有改变存储格式。只有任务捕获的游标仍是当前游标，任务才能将附件标记为完成；否则保持待补传，下一轮重新评估。

任务由现有同步实例拥有，同时最多两个；没有新增轮询、定时器或内存等待队列。槽位用尽时保留持久待补传标记；槽位释放且此前有工作被推迟时，通知现有串行引擎补一轮同步。没有被推迟的任务不触发新轮次，隐藏/停止后不主动唤醒。取消中的任务在实际结束前仍占槽，避免连续 reset 导致真实并发失控。配额冷却仍按组织执行。

查找与上传 RPC 接受可选 AbortSignal。reset、会话撤回、降为仅元数据、组织/会话移出本机范围时取消任务；异步边界再次校验身份、端点、运行代次和可见性。隐藏窗口不启动新的附件工作，在途请求结束后不再读取或上传下一个文件。能力探测仍使用现有共享探测和 15 秒超时，不能因单个任务取消而中止其他消费者的探测；附件 RPC 保留 30 秒超时。本机历史/文件读取沿用现有 IPC，不能被 AbortSignal 中断；取消后仍占槽直至读取实际结束，之后不得发起网络上传。

历史缺失正文/附件没有被删除或修改；原发布端升级后仍需补传验证。撤销请求无法撤回服务端已经完成的写入，最终权限仍由服务端 ACL 决定。

## 补测发现：并发槽位释放后没有唤醒

引擎没有周期轮询；之前假设“后续同步轮次自然会来”，导致第三个会话的待补传游标可能一直等到用户再次操作。新增真实引擎回归先在无唤醒版本复现失败（预期 3 次附件调用，实际 2 次），然后验证释放槽位自动排空 3/7 个会话。测试冻结 bootstrap/focus 定时器，等待真实异步摘要计算，既不推进时钟也不手动再调一次 pass，避免定时器造成假通过。

修复在附件任务的 `finally` 释放槽位后通知现有引擎；引擎复用原有单飞/合并机制。持久游标仍是任务发现与完成的依据，一个布尔位只合并唤醒需求。新增停止/隐藏后的负向断言；没有数据清理或历史状态迁移。

## 十层架构检查

| 层                | 覆盖范围                                       | 结果                                                                                       |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1 编译            | TypeScript、相关测试、lint                     | 见下方命令；未修改 Rust；为桌面 E2E 编译当前 Rust 与 sidecar                               |
| 2 结构/重复       | 回放、评论、续聊用户输入、续聊输出的附件调用点 | 本次改回放调度；显式评论必须先有可用附件引用，续聊执行链保持原有行为，未宣称已统一所有入口 |
| 3 命名            | scheduleReplaySharedFiles / sharedFileJobs     | 调度方法返回 void，正文不等待附件任务                                                      |
| 4 语义            | 正文成功与附件完成                             | 两种状态独立；旧任务不能认证更新后的游标                                                   |
| 5 默认分支        | 配额、网络、未知能力、隐藏、满槽、取消         | 待补传保持；失败仅影响附件冷却；暂停原因有按 owner 每分钟限频的诊断                        |
| 6 领域边界        | 回放上传与执行输入                             | 不改变续聊输入附件或评论提交语义                                                           |
| 7 可理解性        | 已提交正文但文件暂停                           | 代码注释和本文明确过渡范围；逐附件可见状态尚未实施                                         |
| 8 线协议          | 共享文件查找、上传                             | 仅传递客户端取消信号，RPC 名称/参数/返回数据不变；线边界测试覆盖取消、权限、配额与完整性   |
| 9 初始化/生命周期 | 原有 sender owner、reset、prune、重启、隐藏    | 有界任务集合；取消后实际结束才释放；持久游标用于恢复                                       |
| 10 解析一致性     | full / incremental / clean 三种正文路径        | 附件缺失不再强制正文全读；不完整增量对应的附件由后台完整补传，不误标完成                   |

## 性能与生命周期

| Area               | Verdict | Evidence                                   | Change or reason kept                                   | Verification                                       |
| ------------------ | ------- | ------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------- |
| Background work    | fix     | 原 sender await 附件；新增最多两个活动任务 | 正文不等待；既有轮次触发，无新增轮询；隐藏不启动        | 悬挂上传/探测时正文继续追加；隐藏后可见轮次恢复    |
| Memory             | fix     | 没有等待队列；活动任务最多两个             | 取消未结束仍占槽；结束释放引用；重试表沿用 256 上限     | 并发、重复轮次、reset 后槽位与迟到完成测试         |
| Scope/isolation    | fix     | 端点、身份、代次、组织/会话和 AbortSignal  | reset/retract/metadata/prune 取消；旧游标不能写完成状态 | 账号切换、reset、撤回、降级、prune、旧上传完成测试 |
| Rendering/hot path | keep    | 未修改 React 订阅或组件                    | 无界面渲染变更；保留逐附件 UI 为设计后续项              | 不宣称渲染性能改善                                 |

| Provider          | Raw transition                           | App/UI state                     | Topology/boundary                        | Expected invariant                         | Observed evidence                              |
| ----------------- | ---------------------------------------- | -------------------------------- | ---------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| 原生会话共享入口  | 规范化事件追加；无真实原始 provider 文件 | 单元环境，非渲染 UI              | 本机事件源 stub → 真实 sender → RPC mock | 附件悬挂不妨碍正文追加；旧完成不覆盖新游标 | 通过；不代表原始 provider 摄取验证             |
| Cursor 导入入口   | 代表性原始 chunk fixture 追加            | 引擎轮次，非真实桌面             | 导入源 fixture → sender → RPC mock       | 冷却期正文仍增量，恢复后完整补传附件       | 通过；Rust 规范化为 mock，不宣称端到端摄取覆盖 |
| 所有真实 provider | create/append/compact/rotate/delete      | 冷启动、活动窗口、隐藏、二次启动 | 隔离 A 上传 / B 接收与云端账本           | 正文及精确版本可读，无额外重写，资源释放   | not run                                        |

### 隔离桌面补测

Core UI E2E 最终结果：**7 passing / 1 skipped**。两个独立桌面身份、数据目录、WebView 存储和端口，运行当前 Rust/sidecar 构建；测试云端为独立本机 PostgreSQL 数据库，应用 cloud-infra 0001–0033 迁移，经 PostgREST 与故障代理调用真实 SQL。认证使用测试 JWT，未运行 GoTrue/Realtime 服务；未写入生产。

- A→B、B→A：规范化用户/agent 事件经生产分享、上传、侧栏打开和文件预览路径；接收端没有源文件，实际预览字节匹配。
- 附件上传挂起：正文 sender pass 126 ms 返回，接收端正文及后续第三条事件均可见，附件请求仍在挂起。
- 实际 SQL 的 1,000 文件条目配额：正文 pass 123 ms 返回，接收端正文及追加均可见；旧附件仍可预览。填充记录仅在专用测试组织中创建，并在 finally 清理。
- 撤回共享后真实 RPC 拒绝文件读取，预览显示错误；恢复测试共享后继续。
- 两个账户各两次冷启动：身份不串号，文件 ID 不变，接收端预览仍可读。每个场景前后检查整个测试数据库账本；旧行无删除/权限变化、事件数量不倒退、epoch 不增长，未发生重写风暴。
- 可见与隐藏各 20 秒：两个原生进程 CPU 时间分别增加 0.01/0.03 秒、0.02/0.01 秒，RSS 约 167–206 MiB 且下降。仅测原生进程，**不包含 WebKit renderer**，不能代表整应用性能。

补测也修正了两处测试观察问题：用户附件实际是 role=link 的 span；刷新列表是异步操作，必须等已提交的列表游标达到 3 再重新点击，不能用旧行触发回放。只读 E2E 检查增加 eventsCount，未注入导入状态或替换生产下载链路。

运行环境的 webpack-dev-server 5 拒绝仓库当前 object 形式 proxy；本次用本地临时适配为数组启动，finally 恢复，未混入 PR。日志中保留无 Realtime 服务的 CHANNEL_ERROR、测试仓库远端不可用、故意缺失附件，以及快速场景切换产生的 orgtrack 高频读取警告；不声称无 WARN/ERROR。

**Performance verdict: blocked**：调度边界、双端正文/文件及原生短时 idle 检查通过；完整 WebKit 资源、旧版本升级、原始 provider create/compact/rotate/delete、真实 Realtime 重连及原发布端历史恢复未覆盖。真实模型回答测试未启用，明确 skipped；不能把规范化事件 fixture 当作 provider 摄取或完整生命周期验证。

全量历史补传仍可能读入大型会话；最多两个任务不等于字节级内存预算。持久分页 outbox、不可变文件快照、按字节预算管理及统一续聊附件 owner 仍属于设计后续实现。

## 验证命令

- `pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/org2CloudSessionSync src/features/Org2Cloud/org2CloudSyncEngine src/features/Org2Cloud/sessionSharedFile src/features/Org2Cloud/syncSessionSharedFiles.test.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter`：22 个文件、253 条测试通过。
- `pnpm typecheck:fast`：通过。
- `CARGO_BUILD_JOBS=2 node scripts/tauri/prepare-sidecars.cjs --profile debug`：通过；WDIO 构建两个隔离身份的 `cargo build -p org2 --features webdriver`。
- `cd tests/e2e && pnpm test -- --spec ./specs/core/cloud-dual-instance-ui.spec.mjs --mochaOpts.grep "Shared session files across two desktop accounts"`：本地隔离 fixture/端口/故障代理环境下 7 passing / 1 skipped；环境变量使用 `E2E_SHARED_FILES_FIXTURE`、`E2E_SHARED_FILES_ARTIFACTS`、`E2E_ISOLATED_RUN=1`、`E2E_PROVIDER_MODE=mock`。
- 对本次八个 TypeScript 文件运行 `pnpm exec eslint <changed-ts-files> --max-warnings 0`，对四个生产文件运行 `pnpm exec oxlint -c src/.oxlintrc.json --max-warnings 0 <changed-production-files>`。
- `pnpm check:circular`、`pnpm check:test-placement`、`git diff --check`，结果记录在 PR 中。

没有数据库、配置、配额或持久格式迁移。回滚仅需回退客户端代码；未完成标记仍能被 #2111 的补传路径识别。下载接口未改变，新增上传配额依然不参与已有文件读取。
