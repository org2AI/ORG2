# 续聊产物的持久传输与执行终态隔离

日期：2026-09-24。对应 Share Sessions 审计 F5，以及续聊产物范围内的 F6。本 PR 不部署云端，不修改用户历史，不改 canonical/provider-native 消息。

## 问题、权威来源和目标不变量

旧写入链：`cloudConversationQueueAdapter.plane.ts` 发布正文后 await `syncSessionSharedFiles`，`conversationTurnRunner.ts` 等发布完成，随后 `cloudConversationQueueAdapter.ts` 才调用 `coordination.finish`。附件能力探测、磁盘读取或网络上传因此进入执行完成的关键路径；额度与网络错误可能让已经结束的执行保持恢复中或被记成失败。

新链路：正文 RPC 成功 → 通知正文可读 → 将文件候选持久写入本地 SQLite → 完成本次执行。上传由同步引擎拥有的独立消费者执行，结果只改变附件任务，不进入 turn 的失败处理。Agent 回答中的 Markdown、`[file:…]` 和 shell 生成但仅通过回答交付的文件仍自动入队，不要求额外手动附加。

本地队列提交仍是一次必要的持久化边界：磁盘满/SQLite 写入失败时保留同一 accepted turn 的发布恢复状态，不能谎报附件已交接，也不创建失败正文或重新执行 provider。正文已在云端持久化，可先读取。执行确实需要的输入附件仍沿用原有执行前依赖，不被本次产物解耦修改。

## 存储与恢复

- 新增 `sessions.db` 的 `cloud_file_outbox` 表和到期索引，使用独立 CREATE IF NOT EXISTS 初始化，不重建或修改旧表。正式启动与隔离测试初始化入口一致。
- 每行只保存 endpoint/user identity、组织、根会话、源路径、事件 revision，以及 attempts、next_attempt_at、lease、last_outcome。不保存 access token、refresh token、整段 transcript 或文件 bytes。
- `(identity, org_id, session_id, path, revision)` 唯一；重复发布、部分批次保存后恢复均可幂等入队。读取已有云端 revision 时直接确认，不重复上传。
- SQLite `BEGIN IMMEDIATE` 抢占单条任务；五分钟 lease 超时后可恢复崩溃任务。完成和失败更新必须匹配 identity、row ID 和 lease；旧消费者不能确认新占用者的任务。
- 同步成功删除本地待传输记录，不删除云附件。源文件读取失败记录 `source_unavailable` 并保留任务，不按成功确认。
- 每次 IPC 最多 256 条用于限制序列化瞬时内存；超过时分批写入全部候选。这不是文件数或套餐上限，不截断任务。数据库按到期索引每次领取一条，不把整个历史队列读入内存。
- 每个消费者串行传一个文件，32 项后让出事件循环继续处理已知积压。lease 处理多窗口/进程竞争；Tauri 本机事件通知其他窗口有新任务。不同应用数据目录自然使用不同 SQLite。
- 网络/能力/访问错误从五秒指数退避到最多三十分钟；额度失败让同一组织已有和新入队任务共同等待三十分钟；源文件暂不可读也等待三十分钟。已知持久任务允许低频重试，空队列没有定时轮询。
- 隐藏、离线、注销、账号/端点/组织变化和停止引擎都会中止当前任务；旧任务实际结束后才释放消费者槽位。重新可见、联网、匹配身份恢复、重新启动或新入队事件触发恢复。移除组织时不销毁任务，服务端 ACL 仍是读取/上传权限的权威来源。

## 明确没有解决的部分

本 PR 持久化的是文件候选，**不是不可变文件快照**。仍沿用当前“传输时读源路径”的语义；源文件改写/丢失后无法保证历史字节，F2/F4 的捕获与稳定附件引用必须继续实现。不能把这一步称为快照完成。

replay sender 仍使用 #2119 的独立调度与 cursor；它的本地读取失败 ready 语义没有在此改变。这里复用实际读取/上传函数，但只在新的逐文件续聊队列中消费 `sourceUnavailable` 结果，避免扩大当前 PR 的迁移范围。两个发送路径合计最多是 replay 的两个文件任务加本消费者的一个，不声称全应用总并发为一。

队列尚无逐文件管理 UI，访客读取权限仍依赖 #2123 / infra #147。缺失源、撤销访问或无法恢复的任务会保留本地元数据并按退避尝试，尚无引用 GC/用户清理入口，不静默丢弃它们。独立进程间的新任务发现依赖启动/回到前台等恢复触发；本机 Tauri 通知覆盖同一应用的多个窗口，不能把它当作跨进程消息总线。

## 十层架构检查

| Layer            | 本次覆盖                                                         | 证据/边界                                      |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| 1 编译           | TS 类型与 lint、Rust tests/Clippy                                | 见验证记录，不声称所有全仓测试通过             |
| 2 结构与重复     | 两类 sender 复用候选读取和上传                                   | 新消费者不重写上传协议；replay cursor 尚未迁移 |
| 3 命名           | file outbox、sourceUnavailable、supported                        | supported 不代表文件字节已上传                 |
| 4 语义重载       | 正文持久、队列提交、文件可读、执行完成四个状态                   | 只把本地队列持久交接纳入发布完成               |
| 5 默认分支       | 未支持能力、读失败、超额、身份切换、存储失败                     | 不丢任务、不把附件传输异常改成执行失败         |
| 6 跨域边界       | SQLite 持久队列、同步引擎资源所有权、turn finality               | 上传消费者不调用 finish/failure tail           |
| 7 可理解性       | 本文给出恢复责任和未完成边界                                     | 无新 UI，不声称用户已经能看到逐项队列状态      |
| 8 Wire/IPC       | 新增三个 typed RPC，与 Rust camelCase/enum 对齐                  | 云 RPC 不变；不传 auth token 到新表            |
| 9 初始化一致性   | 启动 schema、测试 schema、command 注册、TS router                | 隔离原生命令往返测试，worker startup 恢复测试  |
| 10 resolver 对称 | enqueue/claim/settle 均绑定 identity；成功/失败/取消均校验 lease | 当前 endpoint/org 白名单；服务端继续最终授权   |

| 入口                | 权威记录                     | 恢复/终态                                        |
| ------------------- | ---------------------------- | ------------------------------------------------ |
| 正常产物发布        | 云正文 + 本地候选 journal    | journal 持久后 finish，不等上传                  |
| publish 重试        | 同一 accepted runner/turn    | 云 push 与 enqueue 均幂等，不运行第二次 provider |
| 本地 journal 写失败 | 原 accepted delivery 未释放  | recovery pending；不伪造附件交接成功             |
| 后台传输失败        | 单文件 durable task          | 单独退避，与原执行状态无写入关系                 |
| 崩溃/新窗口         | SQLite lease 与 pending rows | startup/本机通知恢复，旧 lease 不能 ack          |
| 无候选正文          | 云正文                       | 不调用 outbox IPC                                |

## 性能与生命周期

| Area               | Verdict | Evidence                                           | Change or reason kept                                     | Verification                                                 |
| ------------------ | ------- | -------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Background work    | fix     | 上传离开 publishTail；具体 pending task 才有 timer | 空队列无轮询；可见/在线才消费；stop 清理订阅与 timer      | 空队列一小时虚拟时钟、hidden/offline/stop、peer 监听清理测试 |
| Memory             | keep    | 单条 claim、单个文件、最多一个 timer；32 项让步    | 不保留 transcript 队列；SQLite 保存未完成任务，不静默淘汰 | 40 项积压分轮测试；真实 RSS 未测                             |
| Scope/isolation    | fix     | identity + org + root + path/revision、lease CAS   | 账号/端点/组织变化取消；scope 不因 token refresh 改变     | Rust 身份/组织/lease测试；TS 旧成功及迟到 claim 拒绝         |
| Rendering/hot path | keep    | 无 UI/streaming 改动，仅终态交付与后台上传         | 不修改正文或 native transcript；不全量扫描历史            | producing-boundary 自动链接及原文不变测试                    |

| Provider                       | Raw transition                    | App/UI state                | Topology/boundary                 | Expected invariant                             | Observed evidence                                   |
| ------------------------------ | --------------------------------- | --------------------------- | --------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| 共享 continuation 边界         | 已规范化助手尾部交付              | 完成/恢复、重启消费者       | TS publisher/worker + 本地 SQLite | 上传不改变 turn 终态，文件自动入队且持久可恢复 | 单元/渲染无关状态测试与 SQLite 命令测试             |
| ORG2 / Claude / Codex 原始来源 | create/append/compact/rotate/fork | 真实桌面、旧行打开、restart | provider → app → 云 → 队友        | 完整自动文件交付                               | not run；没有以规范化事件测试冒充 provider/双机验证 |

**Performance verdict: blocked**。新资源的所有权、停止条件、内存界限和退避已有测试，但未执行真实 Tauri visible/hidden/close CPU/RSS、多机传输、跨进程唤醒或真实 provider 原始来源矩阵。本轮没有新桌面窗口、生产部署或用户历史清理。

## 兼容、回滚及历史处理

新前端与新 Tauri 后端一起发布；旧后端不认识新命令时，本地 journal 交接会进入恢复状态，不能让新前端单独配旧 native。旧客户端忽略新表，但不会删除表；回滚应保留 journal，恢复新版消费者后继续传输。旧版不会主动处理新 journal，因此回滚期不能承诺附件自动恢复。

未自动扫描或重传历史会话，未删除历史附件、正文或原生 transcript。新增记录没有 session 外键级联删除，避免远程根 ID 与本地会话 ID 混淆导致待交付内容丢失；未来引用回收应结合 F8 单独定义。没有云 schema 或套餐配置变化。

## 验证记录

整合已合并的 #2122 后执行：

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/features/Org2Cloud/org2CloudSyncEngine*.test.ts \
  src/features/Org2Cloud/conversationFileDelivery.test.ts \
  src/features/Org2Cloud/conversationFileOutbox.test.ts \
  src/features/Org2Cloud/syncSessionSharedFiles.test.ts \
  src/features/Org2Cloud/sessionSharedFileCandidates.test.ts \
  src/features/Org2Cloud/sharedSessionFilesClient.test.ts \
  src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter.test.ts \
  src/features/Org2Cloud/SessionConversation/conversationTurnRunner.test.ts

cargo test --manifest-path src-tauri/Cargo.toml --lib \
  agent_sessions::shared_file_outbox::tests -- --test-threads=1

pnpm typecheck:fast
pnpm check:boundaries
pnpm check:circular
pnpm check:test-placement
git diff --check
```

前端 **20 files / 249 passed**；Rust **8 passed**。类型检查、改动文件 ESLint、边界（0 新违规）、循环（无循环）、测试目录和 whitespace 检查通过。Rust 使用本任务已有 target 缓存；首次构建缺 PM sidecar，补齐被忽略的本地 symlink 后通过，没有提交二进制。

前端测试覆盖 producing boundary、publisher、worker、replay sender 与原有共享文件 client；Rust 测试覆盖 SQLite reopen、双连接 lease、CAS、组织配额退避、新任务继承退避、缺失源恢复和原生命令往返。首次新增测试修正了错误构造参数和无关候选顺序断言；扩大回归时同步引擎的测试 fixture 补齐真实“空 outbox”响应，避免将缺少 Tauri IPC 当作待重试存储故障。没有降低 idle 无周期同步的断言。

无布局改动，截图不能证明这些持久化不变量；未提供桌面 E2E 或性能测量的替代性截图。
