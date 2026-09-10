# ORG2 Remote 首版提审资料包

状态：工程准备稿，未在 App Store Connect 提交。日期：2026-09-08。
配合 [发布检查清单](ios-launch-readiness.md) 使用。文案描述的是待验收功能，不代表功能已在 Release 真机包通过。

## 商店文案草稿

| 字段         | 简体中文                                                        | 英文                                                                                                |
| ------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 名称         | ORG2 Remote                                                     | ORG2 Remote                                                                                         |
| 副标题       | 随时查看电脑上的 Agent 会话                                     | Your desktop agents, on mobile                                                                      |
| 关键词       | Agent,远程,会话,开发,编程,工作流                                | agent,remote,desktop,sessions,developer,coding,workflow                                             |
| 首版更新说明 | 首个 iOS 版本：连接你的 ORG2 桌面，查看会话进展并处理待批准操作 | First iOS release: connect to your ORG2 desktop, follow sessions, and respond to approval requests. |

中文介绍：

ORG2 Remote 是 ORG2 桌面的移动遥控客户端。在 iPhone 上查看电脑中的 Agent 会话、阅读消息，并在授权范围内发送消息、停止任务或处理待批准操作。

登录 ORG2 Cloud 后，按照引导与自己的桌面配对。桌面启用公网 Relay 连接时，可以在不同网络下访问已配对电脑。

使用前需要安装兼容的 ORG2 桌面版本，并保持电脑运行和网络连接。Remote 不是在手机本地运行 Agent 的独立应用。可用操作取决于桌面授予的权限。

英文介绍：

ORG2 Remote is the mobile companion for your ORG2 desktop. Follow agent sessions on your iPhone, read messages, and—when permitted by your desktop—send messages, stop tasks, or respond to approval requests.

Sign in to ORG2 Cloud and follow the pairing flow to connect your own desktop. With the public Relay connection enabled on your desktop, you can access a paired computer from another network.

A compatible ORG2 desktop installation, a running computer, and a network connection are required. Remote does not run agents independently on your phone. Available actions depend on the permissions granted by your desktop.

不提前宣传图片、离线使用、后台通知、端到端加密或无需桌面等未验收能力。图片能力通过真机验收后再补充文案和截图。

## 需要负责人填写的商店字段

- 发布团队及 App Store Connect 应用记录：待账号登录后核实
- Bundle ID：当前代码为 `org2ai.org2.remote`；团队归属、可注册性尚未核实
- SKU：由发布团队确定；不自动创建应用记录
- 版本：候选 `0.1.0`；build number 必须查询已上传记录后选取
- 支持 URL、真实支持邮箱、版权主体：待负责人提供
- 隐私政策 URL：当前为 `https://org2-cloud-infra.vercel.app/legal/privacy`，但内容尚不适合发布
- 分类、年龄分级、价格、地区、内容权利、交易者状态：由负责人逐项确认，不能根据应用名推断
- 审核联系人与审核测试凭据：只填入 Apple 后台相应字段，不放仓库、聊天或截图

## 审核环境与操作说明

Apple 要求审核人员能实际访问应用功能，并获得必要的账号、硬件或其他资源。
参见 [App Review Guidelines — Before You Submit](https://developer.apple.com/app-store/review/guidelines/#before-you-submit)。

准备一个只含合成数据的专用审核桌面和独立审核账户。禁止使用开发者的私人会话、真实工作文件或生产管理员账号。
不要用静态的过期配对二维码充当可操作的审核环境；若审核需要动态配对码，先确定可用的提供渠道和人工响应流程。

待 Release 真机验证以下路径后，将实际步骤填写至审核备注：

1. 打开 App，使用审核账户完成 ORG2 Cloud 登录，确认浏览器能返回 App
2. 按“扫描或粘贴配对码”进入配对，在专用桌面生成有效配对码
3. 核对桌面和手机显示的短语，完成确认
4. 在会话页打开合成测试会话，查看历史消息和状态
5. 发送一条无副作用的测试消息；批准/拒绝仅使用隔离的测试请求
6. 关闭并重新打开 App，验证已配对设备恢复，不要求重新扫码
7. 在设置中验证隐私政策入口；账号删除使用单独的一次性测试账户，不能删除常驻审核账户

审核备注英文草稿（只有配套环境和步骤验收后才可提交）：

ORG2 Remote is a companion to ORG2 desktop. The agents run on the paired desktop, not on the iPhone. A dedicated review desktop with synthetic sessions will be provided for review. The desktop must remain online. Remote actions are limited by the permissions granted during pairing. Please use the review account and pairing instructions supplied in the review information fields.

## 截图拍摄清单

只截取真实 Release 候选版本，使用合成会话，保留截图原始尺寸。按 Apple 后台当前要求选择设备尺寸；当前 Xcode 项目若同时支持 iPad，也必须验证 iPad。

| 画面       | 展示目标                             | 不得出现                                |
| ---------- | ------------------------------------ | --------------------------------------- |
| 会话列表   | 已连接的专用桌面和几条明确的合成会话 | 私人标题、工作区路径、空列表假成功      |
| 会话详情   | 可读的消息和任务状态                 | 私有代码、访问令牌、未经验证的图片占位  |
| 待批准操作 | 用户可控的批准/拒绝操作              | 真正有破坏性的命令                      |
| 设备与设置 | 配对管理、账号与隐私入口             | 配对凭据、真实邮箱、localhost、调试错误 |

## 隐私与删除链路的代码核对记录

下面是检查范围内的事实，不是最终 App Privacy 标签，也不是完整 SDK 审计。
相关 Remote 功能仍在 `junyu/remote-relay-contract` 的未提交工作区；Cloud 源码检查于 `junyu/relay-account-auth-draft`。

| 边界               | 证据                                                                                                                 | 当前结论 / 待办                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 登录身份           | Remote `platform/supabaseMobileAuthClient.ts`、`platform/tauri/tauriMobileAuthClient.ts`                             | 处理账户身份和会话令牌；不能直接勾选“无数据收集”                                                         |
| 本地凭据           | `apps/remote-ios/src-tauri/src/lib.rs`                                                                               | 原生存储调用 Keychain；这不说明云端的数据收集、保留或日志策略                                            |
| Relay 接入         | Remote `platform/tauri/nativeSocketPreparation.ts`；Cloud `mobile-relay-worker/src/broker.ts`                        | 使用账户凭据申请短期连接票据；历史票据失败尚缺实际响应证据，不通过放宽校验掩盖                           |
| 图片               | Desktop `src-tauri/src/api/mobile_bridge/adapters/images.rs`；Remote `components/transcript/MobileMessageImages.tsx` | 存在图片读取与传输路径，真机展示仍待验收                                                                 |
| 相机               | `Info.ios.plist`；Remote `platform/scanCameraQr.ts`                                                                  | 用于配对二维码；必须核对最终归档权限和拒绝权限后的粘贴恢复                                               |
| 隐私政策           | 线上 `/legal/privacy`，HTTP 200；Cloud `apps/org2-cloud-web/app/legal/privacy/page.tsx`                              | 实际仍有草稿横幅及 `privacy@org2.example` 占位邮箱，发布阻塞                                             |
| 删除入口           | Remote `screens/settings/SettingsTab.tsx` → Cloud `/account`                                                         | 只验证入口存在，不证明删除成功                                                                           |
| 删除服务           | Cloud `apps/org2-cloud-web/app/api/account/delete/route.ts`                                                          | 先执行 `cloud_delete_account` 再软删除 Auth 用户；第二步失败返回 `dataDeleted: true`，需要恢复流程与测试 |
| 删除后访问         | 同一删除路由没有直接清理 Relay 的调用                                                                                | 不能据此断言仍可访问，但必须验证 Relay 配对撤销、已签发 JWT/现有连接失效和云数据删除范围                 |
| 隐私清单与出口声明 | 检查的原生源码中未发现 `PrivacyInfo.xcprivacy`；Info 未配置出口声明                                                  | 需要实际 SDK/API 和加密用途审计、负责人确认后加入归档；不生成虚假的全空合规声明                          |

线上隐私政策于 2026-09-08 通过公开 HTTP GET 读回，确认草稿提示及占位联系方式；未操作账号删除、未提交法律声明。

## 放行记录

工程自动化、产品验收和账号授权是三个独立门槛。当前均不得标记整体完成。

- 发布工具：见 PR #1418 和 `ios-launch-readiness.md`
- 功能来源：未提交 Remote 改动必须审查并纳入可复现的 release SHA
- 真机：必须按发布清单逐项记录构建号、设备、网络、结果和无敏感信息的证据
- 账号：等待 Apple 发布账号登录、团队确认和 iOS 分发凭据
- 隐私：等待真实联系方式、政策审查、数据及加密声明确认
- 上传：以上门槛未通过，不设置已批准 SHA，不上传 TestFlight，不提交审核

本次工程预检（Remote 工作区仍含未提交内容，不能作为不可变 release SHA 的验收记录）：

- `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote`：51 个文件、290 项通过；测试仍有既存 QRScanScreen 的 React act 警告和测试环境 Tauri 调用告警
- `pnpm exec tsc --noEmit`：通过
- `pnpm build:mobile-native`：通过；有 Browserslist 数据过旧提示
- 生产 JavaScript 中未检出 `local-development.invalid`、`createDevelopmentAuthSession`、`localhost:1999`；这是静态检查，不替代归档和离开开发环境后的真机启动
- 将旧的开发入口静态渲染测试改为“恢复中 → 无已配对设备 → 欢迎页”的实际 React 挂载测试，保留“不构建认证客户端”，并断言无演示入口；该改动留在 Remote 工作区，未混入发布工具 PR
- `node --test scripts/ios-release/readiness.test.mjs`：发布工具 15 项通过
