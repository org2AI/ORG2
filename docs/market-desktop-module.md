# Market 接入 ORG2：模块与交付边界

用户只安装 ORG2。Market 不再要求单独安装连接包、Node 或 CLI，也不要求复制 Base URL、Key 或登录文件。

## 用户流程

1. 网页选择 listing 并完成购买，保留所选工作区与客户端。
2. 点击连接，唤起 ORG2；未安装时提供 ORG2 安装入口。
3. ORG2 完成浏览器授权，首次选择本机项目目录，复用现有配置切换和会话启动。
4. 后续凭据由原生模块续期；用户可以从 Settings 切回自己的账户或断开 Market。

网页只能从发出 deep link 判断“正在打开”，不能据此显示“已连接”。配置写入成功和真实模型请求成功也分别记录。

## 模块划分

| 部分                | 所有权                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| Market 网站与后台   | listing、价格、钱包、购买、工作区权限及授权交换                         |
| ORG2 的 Market 模块 | 授权与续期、工作区选项、动态凭据、模块 UI 和断开协调                    |
| ORG2 现有客户端管理 | Claude/Codex 配置格式、文件冲突检查、备份恢复、本地代理、项目与会话启动 |

代码位置：`src/features/MarketConnect`、`src-tauri/crates/market-connect`、宿主适配层 `src-tauri/src/market_connection`。通用代理通过 `dynamic_credentials::Source` 获取凭据及认证方式，不根据 Market 名字硬编码行为。应用组合入口注册该可选模块。

## 关闭与移除

关闭前，通过原有配置事务恢复仍属于 Market 的选择，再清理对应授权。遇到用户外部修改时报告冲突，保留恢复所需信息。不能覆盖用户后来切换的账户，也不能注销其全部浏览器登录。

编译时可关闭 `market-connect` feature；未注册来源的遗留选择会明确失败，不会偷偷使用其他人的 Key。编译成功不代表上述实际关闭、重启和恢复流程已经验收。

## 当前状态

已实现本地授权、动态凭据及续期、Claude Code/Codex 配置衔接、连接弹窗和 Settings 入口。网站普通连接入口已改为 ORG2。它们尚未构成可发布的一键连接全流程。

仍需完成：本机目录与启动的实机验收、Claude App 和 ORG2 自身会话适配、真实浏览器到原生授权回执、重启/续期/撤销验收、兼容的签名安装包和生产部署。不能让网站先依赖尚未发布的桌面协议。

已将原生连接提交整合到最新上游 `cd08efbc4`，按新锁文件安装依赖，并接入统一导航接口；相关 50 项测试、全量 TypeScript 检查、Rust 检查和生产构建通过。完整进展与测试边界见 `architecture-audit-2026-09-13/MarketConnection.md`。

新增：配置后可选择本机目录并通过 ORG2 内置终端启动 Claude Code/Codex。每次启动生成独立的原生配置副本，关闭终端时释放；已通过组件及原生文件隔离回归，尚未完成安装包内真实启动和请求验证。

## 桌面发布与网站 rollout

正式用户始终打开已安装的 ORG2 主应用。`ORG2 Market Acceptance` 仅为本地验收时临时构建的独立身份，不是第二个用户产品，也不进入下载入口。

发布流程在 macOS、Windows 安装包上传成功后生成 `market-native-protocol.json`，记录版本 tag、源码提交与协议版本。生成器核对 tag 指向当前 checkout，且默认 Cargo feature 包含 Market；重跑发布只接受相同标记，不覆盖不同内容。Cloud infra 的本地 rollout 使用此标记核对桌面兼容性。

该标记只说明协议兼容，不证明安装包已签名或真实连接验收通过。签名安装包与生产全流程仍须分别验证。本地 `node --test scripts/market-release/protocol.test.mjs` 的 5 项测试已通过，包含临时 Git/Cargo 项目上的真实生成命令；尚未触发新的 GitHub Release。

### Seller native connection follow-up (2026-09-13)

The seller entry now dispatches `orgii://market/seller/connect` through the
existing main-window deep-link owner. ORG2 owns browser approval, the fixed
loopback receiver, and the short-lived restricted Market credential. Credentials
and callback URLs do not cross frontend IPC. Completion displays only the
backend-confirmed binding receipt. One task owns cancellation and listener cleanup;
an ambiguous completion is read back, never blindly resubmitted. No CLI or login
file is part of the seller UI. Thirteen locales cover the native dialog.

Validation: native module 29 tests; frontend dispatch 9 tests; TypeScript Go
checker and webpack build passed. Standard `tsc` exhausted its default Node heap;
it is not recorded as a passing check. Native host compilation is checked separately.
Actual signed primary-app release, production migration/rollout, and real provider
browser-to-binding acceptance remain pending. A dispatched link and passing unit
tests are not evidence that the installed production version supports this flow.

Computer-use follow-up: Chrome dispatched the seller entry into the rebuilt native
application; the seller approval dialog rendered and Cancel dismissed it. The
production Console opened its not-found page for `/seller/accounts/authorize`,
confirming rollout is still required. No real provider authorization was submitted.
The isolated app was stopped and URL handlers restored to installed primary ORG2.
The release marker now includes sellerProtocol=1; Console rollout rejects a
buyer-only release. Marker tests (5) and rollout tests (10) passed.
