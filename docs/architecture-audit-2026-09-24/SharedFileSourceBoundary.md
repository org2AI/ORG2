# 自动附件上传的文本授权边界

对应审计 F2 的正文文本入口。权威候选生产函数 `collectSessionSharedFiles` 以前解析 assistant/user Markdown 链接，并把它们交给 `syncSessionSharedFiles → readBoundedFile → uploadSharedSessionFile`。因此一条助手消息可以使没有附件来源记录的本机路径被读取并对外上传。

现在普通 Markdown 只作展示引用；只有显式用户 `[file:…]` 附件标记与既有成功写入/编辑事件进入候选。助手即使输出附件形状的 `[file:…]` 文本也不会获得权限。没有添加接收端 UI 过滤或敏感文件名黑名单，没有扫描工作区。

这不是不可变快照系统：成功工具写入的产物仍按原同步路径读取当前文件，历史版本/字节捕获及 typed manifest 仍需后续工作。仅由 shell 等工具创建、没有被既有写入事件提取记录、只在助手最终文本中出现的文件不会再自动上传；用户可以显式附加，不能以恢复这种便利为由重新授权任意模型路径。

## 验证

- `pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/sessionSharedFileCandidates.test.ts src/features/Org2Cloud/syncSessionSharedFiles.test.ts src/features/Org2Cloud/org2CloudSessionSync src/features/Org2Cloud/org2CloudSyncEngine.sharedFiles.test.ts`：7 files / 61 passed
- 新测试从真实上传入口断言模型文本不触发 capability/network、路径查找、本机读取和上传；候选测试覆盖绝对路径、跨目录相对路径、file URL、图片 Markdown 和伪附件标记
- 配额集成测试改用成功 write_file 事件作为文件来源，继续验证真实额度 RPC 拒绝不能挡正文；没有改写其正文/配额断言来掩盖失败
- `pnpm typecheck:fast`、四个变更文件 ESLint、`git diff --check`：通过
- 没有读取实际私人文件、清理历史云端对象或改变生产权限。未新增桌面/双机/provider 原始历史测试，不声称所有产物类型均已验证

## 架构与生命周期

| 层         | 检查                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| 1 编译     | 类型检查与相关测试通过                                                           |
| 2 结构     | 修复唯一候选生产函数，所有调用者共享                                             |
| 3 命名     | 注释明确“展示引用”与“上传来源”                                                   |
| 4 语义     | 模型文本不是本机文件读取/分享授权                                                |
| 5 默认     | 非 user 的附件形状文本默认不收集；Markdown 全部不授予上传                        |
| 6 边界     | 不让模型展示正文穿透到本机文件读取                                               |
| 7 可理解性 | 注明仅文本链接不自动上传的兼容影响                                               |
| 8 Wire     | 不改 RPC，改变进入上传前的候选集合                                               |
| 9 入口     | replay sender 与 conversation 使用同一 collector；显式评论附件仍独立处理用户标记 |
| 10 对称    | 绝对/相对/file URL/图片引用没有额外授权 fallback                                 |

| Area               | Verdict | Evidence                   | Change or reason kept              | Verification                 |
| ------------------ | ------- | -------------------------- | ---------------------------------- | ---------------------------- |
| Background work    | keep    | 不新增调度器或重试         | 原独立附件生命周期保留             | 原 sender 回归               |
| Memory             | keep    | 原 path Map 不新增全局保留 | 仅减少候选输入                     | 候选与无 I/O 回归            |
| Scope/isolation    | fix     | 任意助手路径会读取本机字节 | 在候选源头阻止文本授权             | 上传入口 negative regression |
| Rendering/hot path | keep    | 无 UI 改动                 | 原链接仍可展示，读取失败不回落本机 | 不适用截图                   |

Performance verdict: blocked（没有新后台资源，但未补桌面 visible/hidden、CPU/RSS 或完整 provider 矩阵，不能声称全应用性能通过）。历史数据应另行只读盘点来源与受众，未经确认不删除。
