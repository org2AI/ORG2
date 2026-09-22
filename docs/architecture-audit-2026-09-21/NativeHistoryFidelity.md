# 会话历史一致性修复

本 PR 修复原生历史转移与前端投影的六项一致性问题。权威读写边界、兼容性与回滚说明如下；当前独立分支的验证记录单独列出。

## 数据源、根因与写入边界

权威来源为 Codex / Claude 原始 JSONL，或内置 Agent 的 SQLite `agent_messages`。发送前重新加载来源，经过 ingestion / canonical projection 与 native projection 比较，再追加后续内容。严格比较继续拒绝真正的历史差异。

| Line                               | Element                              | Verdict | Reason                                       | Suggested change                                                                    |
| ---------------------------------- | ------------------------------------ | ------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| nativeConversationProjection.ts:82 | canonical 私有事件分类               | fix     | 工具名中 thinking/reasoning 被误当成内部思考 | 结构化工具事件优先保留；名称不再覆盖事件类型                                        |
| normalizer.rs:648                  | normalizer 参数解析                  | fix     | 已提取的业务 input 被再次拆包                | 仅带明确工具名标识的通用 tool_call 包装层拆包；已命名工具保留完整参数               |
| normalizer.rs:707                  | normalizer 调用身份                  | fix     | 业务 args.call_id 覆盖协议 ID                | 顶层、result 协议 ID 优先；仅缺少协议身份时保留旧参数兜底                           |
| load_llm.rs:72                     | Agent 权威历史读取                   | fix     | 模型请求的旧图片裁剪混入历史身份             | 独立 load_native_history 保留所有有效历史图片；模型请求仍使用原裁剪策略             |
| native_materializer.rs:513         | Agent typed seed / SQLite / 前端读取 | fix     | 工具错误状态在写入时消失                     | 新增 tool_is_error，往返保留失败位；中断在 portable 合同中属于失败                  |
| messages.rs:800                    | Agent 摘要 seed / 双侧投影           | fix     | 摘要被降为普通用户消息                       | 使用已有 compact_from_sequence 标记，保留完整摘要与有效尾部；模型请求仍按原规则生成 |

永久覆盖位于 normalizer_tests、native_materializer tests、load_llm_tests、session_snapshots_tests，以及 nativeConversationMaterializer、agentMessageAdapters、createRustAgentAdapter 的既有测试文件。源级测试使用真实 provider parser、真实 ingestion、真实 SQLite 写入与读回，不以渲染断言替代生产边界验证。

## 状态与边界验证

| 状态/输入                         | 预期行为                                         | 覆盖                                          |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| Codex/Claude 两次调用相同业务目标 | 两个协议 ID 独立，input/options/call_id 参数完整 | 原始 JSONL → parser → ingestion → native 比较 |
| 合法 thinking/reasoning 工具      | 调用与结果均保留                                 | canonical projection 测试                     |
| Agent 两条带图消息                | 全部图片参与历史比较；模型视图只保留最新图片     | 真实 seed → SQLite → 两种历史投影             |
| 失败结果与摘要导入                | 保留错误位、摘要类型、完整文本                   | 真实 materialize → authoritative read-back    |
| 重复导入、追加新消息              | 重复导入不增写，追加后缀再次读取为空             | 同一数据库往返测试                            |
| 内容或错误位冲突                  | 拒绝覆盖，原记录可读且不变                       | 负向重试断言                                  |
| 历史图片文件缺失                  | 明确失败，不静默删除图片或改变数据库             | load_native_history 负向测试                  |
| 旧数据库 / 再次启动               | 增列默认 false，旧内容不变，再次迁移保留已写状态 | 内存旧表迁移测试                              |
| abort / 会话切换                  | 保留既有 signal 与会话维护序列化                 | 未新增异步资源；既有 continuation/native 套件 |

## 历史兼容与恢复

没有清理或重写用户已有历史。新增 SQLite 列为 `INTEGER NOT NULL DEFAULT 0`，旧 JSON 通过 serde 默认值继续读取，前端字段可选；数据库初始化执行增列，已有列可重复初始化。没有新依赖或新后台迁移任务。

更新后，仍保留完整原始文件的 CLI 会话会按修正后的规则重新投影。旧版本已转入 Agent 并丢失的错误位或摘要身份，无法凭空恢复；本次不猜测或批量修改这些记录。旧图片源文件缺失也不伪造附件。

回滚代码时可保留新增列，旧代码使用显式列名，忽略该列；无需删除数据或降级表结构。回滚会恢复旧投影缺陷，新增状态将不被旧版本识别。运行中的桌面后端需要重建并重新启动才能使用新逻辑。

## 十层检查

| Layer         | 覆盖与边界                                                            |
| ------------- | --------------------------------------------------------------------- |
| 1 编译        | Rust 目标测试与 TypeScript 检查，结果见下方验证记录                   |
| 2 重复/调用链 | native 与 ingestion 共用参数及名字转换；模型与权威历史各有明确入口    |
| 3 命名        | exec 别名沿用既有 resolver；工具名不充当隐私事件类型                  |
| 4 语义重载    | 区分 input 包装层、业务 call_id、摘要边界、模型视图                   |
| 5 默认分支    | 旧错误位默认 false；图片缺失拒绝精确转移                              |
| 6 跨层边界    | 显示摘要解析不删改 canonical 文本，模型图片裁剪不改变历史身份         |
| 7 可理解性    | 新入口及字段带用途注释；无额外状态服务                                |
| 8 序列化      | JSONL、typed seed、SQLite 增列、serde 默认、TS 字段往返               |
| 9 入口一致性  | Codex、Claude、Agent 各有实际来源夹具；其他 provider 未新增兼容性声明 |
| 10 对称性     | 读写保留参数、工具配对、失败位、图片、摘要，并检验冲突拒绝            |

未做全仓库重构、UI 组件审查或真实模型 API 调用。无布局/操作控件变化，无需视觉截图。

## 验证记录

结果与性能边界见 [NativeHistoryFidelity 性能与验证记录](../org2-performance-guard-2026-09-21/NativeHistoryFidelity.md)。
