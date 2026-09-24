# Agent Org 暂停交付、结算禁发与请求恢复验证记录

## 构建身份

- 分支：`codex/agent-org-background-history`
- 基线提交：`6fabe38ac9bd1a5cc6c26affdaf15c006d868711`
- 状态：基线提交加未提交工作区差异；未提交、未推送、未创建 PR
- BuildFast：`/private/tmp/ORG2-agent-org-background-history/src-tauri/target/dev-build/bundle/macos/ORG2.app`
- 主二进制 SHA-256：`1d5d9c725818c88716cd9c94303f2e5ad6c5fb13cd6c5937e3ba0fdc5fa9669a`

## 自动验证结果

| 范围                      | 命令或场景                                                                                              | 结果                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 核心 Rust                 | `cargo test -p agent_core --lib`                                                                        | 3739 通过，0 失败，3 个仓库既有压力测试按约定忽略                                                 |
| 持久化                    | `cargo test -p session_persistence --lib`                                                               | 65 通过                                                                                           |
| Rust 编译                 | `cargo check -p agent_core --all-targets`                                                               | 通过                                                                                              |
| Rust 静态检查             | `cargo clippy -p agent_core --all-targets -- -D warnings`                                               | 通过                                                                                              |
| 应用静态检查              | `cargo clippy -p org2 --lib -- -D warnings`                                                             | 通过                                                                                              |
| 前端全量单测              | `pnpm test`                                                                                             | 2261 个文件通过，17075 项通过，2 项预期失败，3 项跳过                                             |
| 本次前端重点回归          | 8 个相关 Vitest 文件                                                                                    | 92 项通过                                                                                         |
| TypeScript                | `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`                                                 | 通过；默认 4 GiB Node 堆会 OOM，因此按资源配置重跑                                                |
| 前端 lint                 | `pnpm lint`                                                                                             | 通过                                                                                              |
| 质量脚本                  | `pnpm check:circular`、`pnpm check:test-placement`、`pnpm check:i18n-keys`、`pnpm check:i18n:contracts` | 全部通过；国际化质量检查中的 6 个无效值属于 develop 允许基线                                      |
| 暂停恢复交付 E2E          | 真实渲染控件暂停、恢复，原任务跨代完成，报告持久化，团队 Idle                                           | 冻结代码连续 3 轮通过                                                                             |
| 结算草稿与 Stop/Retry E2E | 真实输入框输入、按 Enter、Stop、Retry；核对无消息落库且草稿保留                                         | 冻结代码连续 3 轮通过                                                                             |
| 长历史未挂载目标          | 57 个真实渲染执行轮、目标未挂载、详情跳转、重载与缩略导航                                               | 按预期失败：`Oldest private turn did not remain visible after minimap navigation`；本次未修改导航 |
| 构建                      | `pnpm run tauri:build:fast`                                                                             | 最终冻结源码构建通过，耗时 453.5 秒                                                               |

暂停恢复 E2E 在成员只完成 `start`、尚未写入完成结果时点击暂停。恢复后，新代次继续同一个第 1 代任务；测试核对任务完成、正式交付凭证、最终报告、Idle 以及 provider 请求数量，没有依赖用户追加提醒。

结算 E2E 在报告流式生成期间输入真实草稿并按 Enter，核对数据库没有接收这条消息；输入框仍可编辑，按钮保持 Stop 能力。Stop 后输入解锁，Retry 建立新报告尝试后再次禁发，成员任务没有重跑。

## 失败与环境阻塞

- 仓库默认的 Webpack E2E 启动器在当前安装的 `webpack-dev-server` v5 下仍传入 v4 的对象形式 `proxy`，所以托管式 WDIO 在应用启动前失败。本次没有升级依赖或修改公共构建配置；改用仓库已有 Rspack 前端服务、同一调试应用和固定隔离 `ORGII_HOME` 完成目标 E2E。
- 完整 final-summary spec 中，`before` 窗口的既有 `probeObsoleteAssignmentWake` 依赖 info 级日志；复用服务环境未产生该日志，因此在到达 Stop 断言前环境阻塞。`stream` 窗口已连续 3 轮覆盖本次新增的禁发、草稿、Stop 和 Retry 行为。
- `cargo fmt --all -- --check` 会报告仓库中与本次差异无关的既有 Rust 格式差异；本次所有改动的 Rust 文件已单独执行 `rustfmt --edition 2021 --check` 并通过，未把全库格式化噪声带入差异。
- 长历史导航失败是用户明确要求保留的已知问题。测试没有跳过、吞异常或改成反向成功断言。
- 没有调用真实 provider、没有使用 Computer Use，也没有执行 65 分钟运行测试；这是本轮用户明确调整后的验收范围。

## 边界结论

- 最终结算状态仍以持久化报告回执为唯一事实，前端提示与后端拒绝使用同一状态语义。
- 被拒绝任务的恢复按团队、执行、工具回执和原始用户事件精确核验；找不到准确来源时失败关闭，不猜相邻消息。
- 没有新增业务表、迁移、轮询、定时器、依赖或后台服务。
- 既有历史不改写、不清理；旧回执缺来源时只显示不可恢复。
