# 原生会话一致性：工具结果边界修复与验收

## 问题和验收范围

用户报告同一 `read_file` 结果在原生历史与标准会话中长度不同（164 项中的第 94 项，11890 对 11899）。本机已只读检查已知实例的持久消息、事件、原生记录和本任务测试实例，尚未定位该次调用。不能把下面的复现自动等同于该事件的根因，也不能宣称用户旧会话已恢复。报错补充 session ID，便于以后定位实际来源；不记录正文。

本 PR 的主题是：ORG2 写入 Codex 的工具结果必须逐字往返，明确状态必须保持；原生程序补充非业务标识不能让幂等重试失败。验收包括：

- 生产写入器到生产读取器往返后，工具名称、参数、配对、输出和错误状态一致
- JSON、空正文、Unicode、CRLF、首尾空白、看似执行器消息的正文都不触发二次解释
- 原生 Codex 接受实际写入格式，真实请求中内容一致，关闭重开后仍一致
- 真正正文分叉、错误配对、重复结果、格式损坏仍拒绝
- 不覆盖旧文件，不引入轮询、重试循环或新持久缓存

本机历史日志另确认多次同类拦截，差异包括工具调用/结果顺序、参数与压缩后的历史长度；这些日志不证明当前代码仍有相同生产缺陷，也不能归因于本 PR 的两个复现。当前 ORG2 界面处于新会话页，没有显示本次报告；未修改该实例数据。

## 已确认的生产边界问题

权威输入是标准会话传入 `codex_response_items` 的 `NativeConversationItem::ToolResult`。旧写入器将成功输出直接写成字符串，错误输出包装成执行器 JSON；读取器又对所有这些字符串执行 JSON、脚本失败和后台任务识别。由此同一份文件内容可能被当成控制信息：`{"output":"literal","session_id":1}` 被拆解，正文中的 `Script failed` 可以把成功结果改成失败。

这是编码与解码约定不对称，不是应放宽语义前缀校验的问题。新增回归在旧读取路径上已因成功状态变为失败而失败。

另一个实测问题：Codex 0.154.0 会给注入的工具结果补 `fco_*` ID。原有后缀检查逐字段比较整个 JSON，因而可能在注入成功但响应丢失后的重试中误报冲突。允许的差异仅限原请求未提供、原生端补充的结果 ID；调用 ID、正文和其余字段仍严格比较。

## 设计

1. 原生 function item ID 使用明确的 `fc_orgii_v1_` 前缀标记 ORG2 的输出协议版本。它属于 provider 支持的 ID 字段，不把私有参数塞进工具 arguments。
2. 所有结果统一编码为现有 exec 风格的字符串 JSON `{exit_code, output}`：0 成功、1 失败、130 中断。编码与解码定义在同一 Rust 模块。
3. 读取器只从原生 response-item ID 取得版本标识，放入现有有界 pending-call 记录；业务 arguments 中的同名字段不能选择协议。新增伪装参数反例。解码只做一层。输出正文是不可再解释的字符串；不再经过 shell 状态、后台 cell 或工具重命名推断。版本化数据损坏时明确报错，不默默退回猜测。
4. 没有版本标识的原生/旧数据继续走原读取路径。不会为一次升级重写用户历史，也不会从长度差猜测哪份内容才正确。
5. 保留严格语义前缀比较。真正分叉仍拦截，错误信息增加 session ID。

## 历史数据与兼容性

没有数据库迁移，没有历史清理或生产数据写入。旧会话若已发生不同投影，需要先拿到原始文件与标准事件的同一调用，比较逐字差异、来源、版本与哈希，再确定是否可以只重建派生视图。若需创建替代执行会话，应保留原生文件和标准正文，验证全量一致后再切换绑定。本文没有授权或执行此类历史修复。

新格式会增加固定包装与字符串转义开销。工具正文未删改，但旧版本客户端仍有正文推断逻辑，所以同一会话的所有读取端应升级；不保证降级后也能正确处理这些特殊正文。回滚只停止新格式写入，保留已写入记录和兼容读取器；不要用覆盖原生历史的方式回滚。

## 十层架构核查

| 层            | 结论       | 证据/边界                                                         |
| ------------- | ---------- | ----------------------------------------------------------------- |
| 编译          | 见验证记录 | 修改 Rust 所属 crate 与原生写入测试                               |
| 去重          | 修复       | 编解码集中；原写入器状态包装函数删除                              |
| 命名          | 明确       | 工具 output 与 transport envelope 分开                            |
| 语义          | 修复       | 正文不再产生 status/background 控制信息                           |
| 默认分支      | 保守       | v1 严格解码；旧格式不猜测性迁移                                   |
| 领域边界      | 保留       | Codex 协议放 Codex 模块，标准会话类型不改                         |
| 可理解性      | 明确       | 版本前缀、单层解码与拒绝条件有注释和反例                          |
| Wire          | 实测       | Rust 生成 response items，安装版 Codex 的注入与模型请求验证       |
| 入口对称      | 核查       | materialize/synchronize 共用写入器；完整/流式访问/分页共用 parser |
| Resolver 对称 | 不涉及     | 未修改账号、工作目录或 provider 优先级链                          |

同类入口检查覆盖标准 TS 投影、Rust Agent 持久历史、Claude 原生读写、Codex 原生读写和后缀重试。当前补丁修改 Codex 边界；Claude/Agent 的所有生命周期、所有 provider/所有旧会话不在已证实通过范围，不能据此宣称全局无一致性问题。

## 性能与生命周期

| Area               | Verdict | Evidence                                                         | Change or reason kept                | Verification            |
| ------------------ | ------- | ---------------------------------------------------------------- | ------------------------------------ | ----------------------- |
| Background work    | keep    | 同步既有按需读取路径                                             | 不新增 timer/listener/worker/重试    | 源码调用链              |
| Memory             | keep    | 单条结果解码与原有历史收集器                                     | 不新增全局容器；额外 JSON 字符串包装 | 编解码与读取回归        |
| Scope/isolation    | keep    | 原生 RPC 测试用临时 profile、HOME、loopback 模型、macOS 网络沙箱 | 不访问真实账号或模型服务             | 冷启动/重开测试         |
| Rendering/hot path | keep    | 无 React 修改；只在已有 transcript parser 中按 ID 分支           | 新格式绕开重复推断                   | 完整读取与 visitor 比较 |

| Provider      | Raw transition                       | App/UI state            | Topology/boundary                              | Expected invariant                 | Observed evidence    |
| ------------- | ------------------------------------ | ----------------------- | ---------------------------------------------- | ---------------------------------- | -------------------- |
| Codex         | 创建与重复读取                       | 离线真实 JSONL          | 本地写入→读取→语义检查                         | 正文/状态不变；真实分叉被拒绝      | 生产读写回归         |
| Claude Code   | 创建与重复读取                       | 离线真实 JSONL          | 本地写入→读取→语义检查                         | 同一组正文/状态一致                | 同组跨 provider 回归 |
| Codex 0.154.0 | 注入、追加两轮、重启                 | 真实 app-server；无 GUI | 临时 profile→loopback 请求→原生 rollout→读取器 | 注入正文一致、版本 ID 保留、无重复 | 原生 RPC 集成回归    |
| Codex/Claude  | compact/rotate/delete、旧行打开/固定 | GUI                     | 云上传/另一台下载                              | 全生命周期一致                     | 本 PR 未新增实测     |

本改动没有常驻后台资源；未进行新版本完整桌面可见/隐藏 CPU/RSS 和云端全生命周期验收。**Performance verdict: blocked**（这些实机矩阵单元未覆盖，不代表已发现常驻性能回归）。

## 验证记录

以下命令均在独立工作区运行；根 crate 命令复用本任务已有 Cargo target 缓存，已补齐本地 PM sidecar 软链接，不提交构建产物。

- `cargo check --manifest-path src-tauri/Cargo.toml -p orgtrack_core --all-targets`：通过，无 warning
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core materialized_tool_results_preserve_opaque_body_and_explicit_status -- --nocapture`：修改读取路径前红、修改后绿；旧路径把成功正文里的 `Script failed` 推断成失败
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core sources::codex -- --test-threads=1`：120 passed，4 ignored（既有真实图片素材/资源验收）
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p orgtrack_core --all-targets -- -D warnings`：通过
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings`：通过
- `ORG2_TEST_CODEX_BIN=/opt/homebrew/bin/codex cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::cli::native_materializer::tests -- --include-ignored --test-threads=1`：56 passed；包括显式启用的安装版 Codex 0.154.0 回归，两个隔离进程、两次 loopback 模型请求、五个注入工具结果、原生文件再次读回。Claude 锁子测试由父测试实际启动验证；单独调用它没有独立覆盖含义
- `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::cli::parsers::codex_app_server::catalog::tests -- --test-threads=1`：9 passed，2 ignored（既有 provider/project 原生配置测试）；新后缀重试、正文变化、额外字段、重复结果反例通过
- `pnpm exec vitest run --config config/vitest.config.ts src/engines/SessionCore/conversations/nativeConversationMaterializer.test.ts src/engines/SessionCore/conversations/localConversationContinuation.test.ts`：2 文件、109 passed
- `python3 -m py_compile src-tauri/src/agent_sessions/cli/native_materializer/opaque_tool_native_probe.py`：通过
- `git diff --check`：通过

根 crate 的首次构建因独立工作区缺本地 sidecar 停止，补齐后通过。新跨 provider fixture 首次因测试未使用真实 `orgii_evt_*` 用户 ID 而失败，改成生产 ID 契约后通过。原生 RPC 首次严格比较失败揭示 vendor 补充的 `fco_*` ID；正文逐字相等，最终仅排除该字段并在生产幂等边界补反例测试。

本 PR 未运行收费模型推理、生产云写入或 GUI 验收；没有修改 UI 布局，因此截图不提供额外证据。未新增完整压缩/轮转/云重连/桌面 CPU/RSS 测量；未证明用户报告的旧会话已恢复。
