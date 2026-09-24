# 会话回放附件调度隔离：实现与验证

本次实现对应中文设计 [#2114](https://github.com/org2AI/ORG2/pull/2114) 的第一步：正文同步不再等待附件能力探测、补传读取或网络上传。本次不实施完整持久附件 outbox、对象存储、逐附件界面或配额管理；线上容量不变。

## 根因与写入边界

正文以本机规范化事件为源，经 `Org2CloudSessionSync` 提交远端正文，并写入 `org2CloudPushCursorsAtom`。#2111 已将正文提交提前，但 `pushSession` 仍等待附件，且附件补传状态会迫使正文轮次探测能力并全量读取历史。一个慢附件可以占住 sender pass，影响之后的会话或追加正文。

现在正文只调度附件任务，不等待任务完成。正文已经干净时，待补传标记只触发独立附件工作，不影响正文的增量读取策略。共享文件版本标记仍是原有持久游标字段，没有改变存储格式。只有任务捕获的游标仍是当前游标，任务才能将附件标记为完成；否则保持待补传，下一轮重新评估。

任务由现有同步实例拥有，同时最多两个；没有新增轮询、定时器或内存等待队列。槽位用尽时保留持久待补传标记，由后续既有同步轮次重试。取消中的任务在实际结束前仍占槽，避免连续 reset 导致真实并发失控。配额冷却仍按组织执行。

查找与上传 RPC 接受可选 AbortSignal。reset、会话撤回、降为仅元数据、组织/会话移出本机范围时取消任务；异步边界再次校验身份、端点、运行代次和可见性。隐藏窗口不启动新的附件工作，在途请求结束后不再读取或上传下一个文件。能力探测仍使用现有共享探测和 15 秒超时，不能因单个任务取消而中止其他消费者的探测；附件 RPC 保留 30 秒超时。本机历史/文件读取沿用现有 IPC，不能被 AbortSignal 中断；取消后仍占槽直至读取实际结束，之后不得发起网络上传。

历史缺失正文/附件没有被删除或修改；原发布端升级后仍需补传验证。撤销请求无法撤回服务端已经完成的写入，最终权限仍由服务端 ACL 决定。

## 十层架构检查

| 层                | 覆盖范围                                       | 结果                                                                                       |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1 编译            | TypeScript、相关测试、lint                     | 见下方命令；未修改 Rust，不运行 Rust 检查                                                  |
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

可见/隐藏 idle CPU、RSS、真实网络故障及原发布端历史恢复没有运行证据。目前没有启动包含本补丁的隔离 sender/receiver 实例；按双实例验证方法仍需执行接收端正文读取、云端账本与生命周期检查。因此运行性能结论为 **Performance verdict: blocked**（缺少上述真实运行验证），不是已测通过或已发现性能失败。现有测试仅证明调度和资源数量约束。

全量历史补传仍可能读入大型会话；最多两个任务不等于字节级内存预算。持久分页 outbox、不可变文件快照、按字节预算管理及统一续聊附件 owner 仍属于设计后续实现。

## 验证命令

- `pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/org2CloudSessionSync src/features/Org2Cloud/org2CloudSyncEngine src/features/Org2Cloud/sessionSharedFile src/features/Org2Cloud/syncSessionSharedFiles.test.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter`：22 个文件、249 条测试通过。
- `pnpm typecheck:fast`：通过。
- 对本次八个 TypeScript 文件运行 `pnpm exec eslint <changed-ts-files> --max-warnings 0`，对四个生产文件运行 `pnpm exec oxlint -c src/.oxlintrc.json --max-warnings 0 <changed-production-files>`。
- `pnpm check:circular`、`pnpm check:test-placement`、`git diff --check`，结果记录在 PR 中。

没有数据库、配置、配额或持久格式迁移。回滚仅需回退客户端代码；未完成标记仍能被 #2111 的补传路径识别。下载接口未改变，新增上传配额依然不参与已有文件读取。
