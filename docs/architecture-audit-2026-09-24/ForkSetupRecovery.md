# 续聊设置恢复与记忆边界

对应审计 F10。`forkTeammateSession` 原先把所有 `ForkOperationError` 当成设置失效，清记忆并再次弹窗；现在只有 `agent_unavailable` 会重新选设置一次，回放/快照/后端错误向原操作返回，不伪装成配置问题。重新选择后的成功也不再显示“已按上次配置接续”。

记忆升级为 v2：以服务器+登录用户、组织、仓库为键；无仓库时使用来源 session，避免所有无仓库续聊共用设置。保存最多 128 项、有效期 30 天，在访问时清理，不新增后台定时器。用 schema 校验配置；解析输入有 512 KiB 上限。没有可归属的登录身份时不复用记忆。选择设置过程中切账号会取消后续 fork，避免把前一身份确认的配置交给新的请求。

v1 无法确定所属身份，因此不自动迁移、不删除；升级后首次需要重新确认。本改动不修改历史正文或原生 transcript。配置只是用户上次确认的选择，执行前的 Agent/账户可用性校验仍由原执行边界负责。

## 架构检查

| 层            | 结论                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| 1 编译        | typecheck 通过；相关测试 3 files / 58 passed                                    |
| 2 结构        | 所有 promptForExecution 入口汇入同一个 fork wrapper；一个配置存储模块           |
| 3 命名        | setup memory 专指执行选择；不作为云授权凭证                                     |
| 4 语义        | 配置失效、数据错误、执行结果分别处理                                            |
| 5 默认分支    | 非 agent_unavailable 不弹设置；未登录、坏配置、过期返回无记忆                   |
| 6 边界        | 记忆不覆盖执行校验；错误不通过重选模型消除                                      |
| 7 可理解性    | 非配置错误保留原错误类型；重新选择不显示复用成功提示                            |
| 8 Wire/持久化 | 无 RPC 变更；localStorage v2 新键，不猜测 v1 身份                               |
| 9 初始化      | cloud 列表、imported replay、guest fork 共用 wrapper；headless 执行配置保持显式 |
| 10 对称       | workspace、Agent、account、model 作为同一 selection 存取，共用作用域与有效期    |

## 生命周期

| Area               | Verdict | Evidence                      | Change or reason kept                    | Verification                                      |
| ------------------ | ------- | ----------------------------- | ---------------------------------------- | ------------------------------------------------- |
| Background work    | keep    | 仅用户续聊触发存储访问        | 无轮询或过期计时器                       | 假时间前进不会产生任务                            |
| Memory             | fix     | 原 registry 无条数/有效期限制 | 128 项、30 天、输入大小限制，访问时清理  | 超量、过期、坏数据回归                            |
| Scope/isolation    | fix     | 原 repo 单键跨身份复用        | identity/org/repo 或 source session 分区 | 跨用户/端点/组织/无仓库来源、选择期间切账号回归   |
| Rendering/hot path | keep    | 无组件或布局改动              | 只修复弹窗触发条件                       | 数据错误不产生 dialog request；配置错误仅重开一次 |

本机 profile 的存储由既有隔离机制拥有；没有新增共享全局缓存。重启/module reload 重读 v2；退出登录不复用；历史 v1 只保留不读取。断网和源快照错误保留已确认配置。真实桌面多 profile、CPU/RSS、双机/provider rewrite/rotate 未新增实测，不能从函数测试推论。

Performance verdict: blocked（资源上限与身份回归已验证；未完成真实桌面生命周期和资源测量）。本变更不声称提高运行性能或解决 native/canonical 历史一致性。

## 验证

`pnpm exec vitest run --config config/vitest.config.ts src/features/TeamCollaboration/forkSession.test.ts src/features/TeamCollaboration/forkSetupMemory.test.ts src/features/TeamCollaboration/cloudSessionFork.test.ts src/features/TeamCollaboration/useForkImportedSession.test.ts`：实际发现并执行 3 files / 58 tests，通过；`cloudSessionFork.test.ts` 不存在，没有将它算作覆盖。

`pnpm typecheck:fast`、四个变更 TS 文件 ESLint、`git diff --check` 通过。未改布局、按钮或输入控件，因此未添加截图；测试直接断言生产 wrapper 是否创建设置请求。
