# Agent Org 历史兼容实现与验收记录

## 范围和版本

目标：升级前的团队全部保留为只读历史；升级后新建团队进入独立执行区。
降级范围仅 v2.0.8；保留已保存内容，不保证未完成任务续跑。

分支 `codex/agent-org-history-compatibility`，叠加目标 `codex/agent-org-background-history`。
基线 `22767a2a4f3185b127bf6d5669302cffcbe6dce4`：相对方案记录的 `384a7a71d` 仅多一处子进程测试修改，生产实现相同。
官方 v2.0.8 源码为 `55b14b1937b4cac8d4ff9acc98f7e225aba9e5c9`。

## 根因与事实来源

历史事实的权威来源是持久化会话、事件正文、团队成员 materialization、可见任务输出和报告。前置 PR 修改了旧运行区 4 张表的字段/约束及严格校验指纹，导致 v2.0.8 无法接受；侧栏又依赖运行记录发现团队，旧版启动还会改变共享排队状态，因此仅放宽校验或在 UI 隐藏行无法修复。

源头修复是数据库初始化的原子隔离，以及原事件/输出/群聊写事务中的幂等副本保存。当前执行表只持有修复版新团队；历史身份和正文不依赖完整执行记录。新版列表排除普通副本是批准方案中的明确产品要求，依据持久化来源映射，不根据标题或正文猜测隐藏。旧数据保全为无执行约束的原始归档和独立历史索引，既不删除原文，也不把未完成状态改成完成/取消。验证证据见下表和最终验收记录。

## 设计到代码、验收到测试

| 契约                               | 负责位置                                                                              | 来源/入口                                              | 确定性证明                                                                       | 失败/重启边界                                       | 实机证据                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| 旧版校验固定结构，新版只执行新表   | `coordination/schema.rs`、`fixtures/official_v2_0_8_agent_org.sql`                    | 生产、测试同一 `init_agent_org_schemas`                | 固定旧指纹；39 表、79 索引、1 触发器的新指纹；旧扫描不包含新表和原始归档         | 当前区结构异常报错；全部表消失且标记存在也拒绝重建  | 实机旧区为空、新区初始为空，历史 5 根/25 会话                                |
| 首次升级原子保全，不恢复旧状态机   | `agent_org_history_store/archive.rs`、`capture.rs`                                    | v2.0.8、前置 PR 结构、中间字段、缺表                   | 事务故障回滚；原始 BLOB/DDL；原状态不改写；并发初始化只归档一次                  | 同一事务内原始副本、可见内容、旧区、新区、完成标记  | 自动检查通过；相应实机边界见最终验收记录                                     |
| 历史身份独立于执行记录             | `agent_org_history_store/read.rs`、会话目录                                           | 打开、侧栏、置顶、自定义分组、成员                     | 根和成员描述；分页游标绑定会话；部分缺表                                         | 未知关系保持 NULL，不造运行状态或验收结果           | 自动检查通过；相应实机边界见最终验收记录                                     |
| 历史不会被发送或恢复执行           | `message/send.rs`、`init/mod.rs`、`org_tasks/context.rs`、工具注册入口、turn contexts | 用户发送、队列、立即发送、恢复、群聊、干预、重试、工具 | 直接调用所有发送来源和两个工具入口均返回同一只读错误，无运行实例                 | 启动执行恢复仅查当前执行区；读取使用独立历史 API    | 历史打开、切换、翻页、重启：Command+5 零请求，usage spans 不变               |
| 副本可由旧版普通会话读取           | `agent_org_history_store/copies.rs`、`session-persistence/crud.rs`                    | 原事件事务、团队输出事务、群聊可见内容事务             | 真实 `save_events` → `load_session`；独立 ID、无授权、增量幂等、写入失败整批回滚 | 旧版可改变共享排队状态；历史正文读取不受 stale 覆盖 | 用户报告正式数据往返通过；收尾快照保留 421 个稳定映射、18 份匹配报告且无重复 |
| 旧版创建的新团队在再升级时单独归档 | `archive.rs`、`capture.rs`                                                            | 旧区出现新行                                           | 稳定来源去重；已有副本不再次导出；当前成员不被误退休                             | 正常重启只检查旧区对象和是否有行，不遍历正文        | 自动检查通过；相应实机边界见最终验收记录                                     |
| UI 浏览只读历史                    | `AgentOrgHistoryBoundary.tsx`、`useChatViewAgentOrgSurface.tsx`                       | 打开根、切换成员、展开保存内容                         | 未解析身份前不挂可写界面；过期响应丢弃；按需翻页；请求失败可显式重试             | 不生成假的 RunView，不启动运行视图轮询              | 实机根/成员/报告/翻页/归档根/置顶均通过；见验收记录                          |
| 普通会话、模板和其他对象保持原义   | `definitions/orgs.rs`、明确对象映射                                                   | 初始化和模板读取                                       | 不再删除旧模板原文；旧表归档只拥有显式集合；现有核心回归套件                     | 原始归档供恢复，不能直接接回执行                    | 自动检查通过；相应实机边界见最终验收记录                                     |

## 十层架构复核

| 层              | 结论和证据                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| 1 编译          | 应用所有目标编译与严格 Clippy 已通过；后续修改重跑对应检查                                                     |
| 2 重复/死代码   | 历史读和执行读职责分离；共享正文仍由原存储拥有；删除旧丢弃迁移路径；较大的原 schema 测试移到独立文件           |
| 3 命名          | 39 张执行表和附属索引/触发器显式改名；不在运行时替换 SQL；错误标识不随表名机械变化                             |
| 4 状态语义      | `current/history_only` 是读取和准入模式；不是任务完成/取消状态；原始状态原样归档                               |
| 5 默认分支      | 初次迁移允许已知旧结构漂移和缺表；当前执行区异常拒绝启动；身份 API 失败时 UI 不出现可写控件                    |
| 6 跨域依赖      | 核心拥有历史身份、快照和副本写入；会话持久化仅在原事务内调用核心投影；前端只接收描述与分页 DTO                 |
| 7 可理解性      | 模块按归档、事实提取、副本、读取拆分；固定旧 SQL 与测试升级输入注明出处                                        |
| 8 序列化        | 新增历史描述/分页 API；可空成员/根关系；固定错误 `agent_org_history_read_only`；副本剥离执行字段，保留可见正文 |
| 9 初始化一致    | 生产注册、独立实例和测试都使用同一初始化入口；必须独立事务；外键开关在返回时恢复                               |
| 10 读取来源一致 | 侧栏、置顶、分组和打开使用持久化历史身份；当前执行事实不从历史副本反推；新列表排除副本来源映射                 |

正式库首次升级还发现一个初始化顺序缺口：v2.0.8 已保存的群聊定向回复会在历史副本生成时尝试读取尚未创建的新版成员物化表。根因位于副本写入边界，而非 UI。现在只有当两张新版执行表都已存在时才投影当前运行成员；首次切换仍保存原正文副本，不猜造执行关系。失败尝试的迁移事务完整回滚，正式库数量和旧结构指纹均未变化。新增 `official_old_group_mention_is_copied_before_execution_schema_exists` 覆盖该边界，随后核心测试为 3,755 通过、3 忽略，会话持久化 67 通过，严格 Clippy 通过。

## 数据恢复和兼容限制

- 失败的切换整笔回滚。成功后每张旧表的无约束原始行副本和原建表 SQL 都保留。
- 原始副本没有执行索引、触发器或级联关系；恢复应从备份提取可见数据，不能自动复活旧授权/任务。
- 降级时 v2.0.8 可按原行为改变共享排队状态；本次只保证保存的历史可读。
- 副本使用普通会话，旧版可以显示其原有输入控件；它们没有指向新版团队执行区的授权。
- 增量副本直接在原事务写共享存储，不调用会话创建、自动化或云发布钩子；新版列表和目录投影排除副本。
- 本次不修改普通布局格式。历史身份每次由后端重新解析，实机验证如发现团队布局阻断打开再修正该特定快照。
- 2130 已知的长历史 minimap 最早轮定位问题不在本次范围，也不作为通过证据；不运行无关 65 分钟后台服务验收。

## 自动验证记录

完整结果、代理证据与用户最终签收见 [验收及手测指南](AgentOrgHistoryCompatibilityAcceptance.md)。

早期检查：核心库 3,747 通过、3 项原有忽略；会话持久化原有 65 项通过；新增跨存储 2 项通过；前端相关 38 项通过；应用全目标编译、严格 Clippy、typecheck、lint、循环依赖、测试位置和国际化检查通过。

后续新增测试和同一最终源码的复跑结果、实机证据以本目录最终验收记录为准；此处不将中间证据当作最终通过。

## 实机发现并修正的共享读取遗漏

Agent Station 的两个运行视图消费者也会读取历史会话。后端正确返回只读错误，但原共享 store 将错误当成暂时失败并继续 60 秒重试。现在该明确错误终止发现、丢弃当前运行投影并撤销轮询；正常团队和暂时网络错误沿用原行为。新增共享消费者/重连，以及历史与当前团队并存的回归测试，避免只在 ChatView 层禁止轮询。

缺失模板快照时，成员关系直接读取已保存的 materialization；快照只补充显示名称。回归用例同时去掉模板快照和共享父链接，仍从持久化成员关系恢复根/成员关联并保留成员正文副本。

## 验收用例到自动测试的对应

| 验收条件                                             | 测试文件与关键用例                                                                                                                                                                                                                                                                                         | 结果                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 官方旧版结构接受独立执行区与归档                     | `agent_org_history_store/tests.rs` → `official_old_validator_accepts_fixed_area_beside_new_objects_and_archives`                                                                                                                                                                                           | 自动通过；不替代官方包实机                       |
| 官方旧版群聊事件在执行区建表前仍可复制               | `agent_org_history_store/tests.rs` → `official_old_group_mention_is_copied_before_execution_schema_exists`                                                                                                                                                                                                 | 通过；正式库首次失败事务回滚后由同一数据成功升级 |
| 2105/2130、缺表与缺模板仍保存事实                    | `conformance_tests.rs` → `finalization_and_background_history_inputs_retire_without_interpreting_execution_state`、`saved_materialization_preserves_membership_without_a_template_snapshot_or_parent_link`；`tests.rs` → `partial_old_tables_keep_shared_member_identity_and_body_without_inventing_a_run` | 通过                                             |
| 原子切换及两次初始化                                 | `tests.rs` → `raw_schema_blobs_and_all_changes_roll_back_when_completion_write_fails`；`conformance_tests.rs` → `two_initializers_archive_populated_database_exactly_once`                                                                                                                                 | 通过                                             |
| 当前区损坏拒绝重建、正常重启不重复                   | `conformance_tests.rs` → `completion_marker_with_all_execution_tables_missing_is_corruption_not_first_install`、`repeated_old_team_import_does_not_retire_current_members_or_rescan_archived_bodies`                                                                                                       | 通过                                             |
| 所有发送来源和工具入口只读                           | `message/tests/history_read_only_tests.rs` → `all_send_sources_and_tool_entries_reject_history_before_loading_a_runtime`                                                                                                                                                                                   | 通过；历史运行实例不创建                         |
| 普通副本可读、旧版 stale 不遮正文、源写入与副本原子  | `session-persistence/src/history_compatibility_tests.rs` 两项测试                                                                                                                                                                                                                                          | 通过                                             |
| 侧栏、置顶与分页身份一致                             | `sidebar_history_tests.rs`、`aggregation/history_tests.rs`、`sections/tests.rs`                                                                                                                                                                                                                            | 通过；实机可发现与打开                           |
| 大历史有界分页，正常启动不扫描正文                   | `conformance_tests.rs` → `large_archive_pages_use_keyset_index_and_normal_restart_writes_no_history`；`tests.rs` → `history_pages_are_bounded_stable_and_bound_to_the_requested_session`                                                                                                                   | 通过                                             |
| UI 解析身份前禁止写入，失败/切换/分页有界            | `AgentOrgHistoryBoundary.test.ts` 5 项；`orgTasks/history.test.ts` 3 项                                                                                                                                                                                                                                    | 通过                                             |
| 共享工作站历史消费者停止 60 秒重试，当前团队保留刷新 | `agentOrgRunViewStore.test.ts` → `stops history discovery across shared surfaces and reconnects`、`discards a retired projection while continuing to poll a current team`                                                                                                                                  | 通过；最终包跨周期观察另见性能审查               |

十层均已覆盖，没有跳过编译层。实现已冻结；用户于 2026-09-25 报告两项手测验收成功。没有回传的分项证据保持用户报告属性，不由本记录补写为代理实测。
