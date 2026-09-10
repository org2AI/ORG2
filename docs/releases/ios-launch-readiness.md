# ORG2 Remote 首版发布准备

更新日期：2026-09-08。当前结论：**未达到可发布状态**。

本次准备的是独立的 iOS 发布工具链，不会自动合并 Remote 功能分支，
不创建或撤销 Apple 证书，不接受法律协议，不提交审核，不邀请测试者。
CI 构建通过不等于 Apple 已批准，也不等于真机体验已验收。

商店中英文文案、审核环境步骤、截图清单和隐私边界核对见
[首版提审资料包](ios-submission-pack.md)。线上隐私政策已读回确认：仍有草稿提示和占位联系邮箱，发布前必须修正。

## 1. 已知状态与责任人

| 项目                | 状态                                                                       | 下一步 / 负责人                                                   |
| ------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 现有 Apple 凭据     | CI 已确认只有有效的 Mac Developer ID 签名身份                              | Apple 团队管理员确认会员仍有效、团队归属与权限                    |
| iOS 分发身份        | 现有证书包未发现 Apple Distribution/iPhone Distribution                    | 管理员提供 iOS 证书和描述文件，不能复用 Mac 证书                  |
| 发布工作流          | 已编写，尚未签名实跑                                                       | 配置受保护环境和凭据后运行 build-only                             |
| 发布源代码          | 功能仍在另一个含未提交改动的 worktree                                      | 工程负责人审查、分批提交/合入，确定唯一 release SHA               |
| 原生登录/票据       | 真机曾出现 Invalid Relay connection ticket，后续模拟器成功不能证明根因消失 | 工程负责人定位原因，并在 release 真机包复测                       |
| 会话/图片           | 曾出现列表为空、历史图片不显示，尚无完整真机闭环证据                       | 核对实际会话数据和图片加载链路                                    |
| 首次配对/已配对启动 | 已有局部回归测试                                                           | 真机 release 包冷启动、离线、前后台切换实测                       |
| 隐私清单            | 检查的 iOS 源目录未发现 PrivacyInfo.xcprivacy                              | 审计实际 API/SDK 使用后声明并加入构建资源，不能随意填“无数据收集” |
| 加密出口声明        | 未确认                                                                     | 团队根据实际加密用途确认 ITSAppUsesNonExemptEncryption 和所需材料 |
| 隐私政策/账号删除   | Remote 功能分支已有入口，不代表服务端完整可用                              | 验证线上页面与真正删除账户、撤销会话/配对的结果                   |
| 商店资料与审核      | 未提交                                                                     | 产品/账号持有人确认下面的资料和商业政策                           |

## 2. Apple 团队配置（管理员）

先确认是可用于 App Store/TestFlight 的 Apple Developer Program，而不是仅个人免费签名。
核对 App ID `org2ai.org2.remote` 是否归该团队所有；个人开发版已安装不证明公司团队可注册此 ID。
如果冲突，不自动改 Bundle ID：先确认对登录回调、钥匙串、历史安装升级和服务器配置的影响。

在 App Store Connect 创建/确认 ORG2 Remote 应用记录，绑定相同 Bundle ID。
选择正确平台、SKU、主语言、内容权利、年龄分级、地区可用性和支持联系信息。
协议更新、会员续费、税务/银行/交易者资格等由账号持有人处理。

推荐首版采用**显式手动签名 + 单独上传 API Key**：不会让 CI 自动创建或撤销证书。
证书必须带私钥；描述文件必须是 App Store Connect 类型，精确匹配 Team、Bundle ID、证书及能力。
上传 API Key 按实际需要配置最小权限，不因为仅上传而默认要求 Admin。

## 3. GitHub 配置（仓库管理员）

先创建 `ios-release` Environment，设置 required reviewers、禁止自行批准、允许的发布分支。
保护工作流和发布脚本的修改权限。**只有环境名称不构成审批保护**；GitHub 计划或权限不支持时，
不要配置上传密钥，改为人工上传。不要沿用 Windows 的 `code-signing` 环境。

在受保护环境配置以下 Secrets，不要把值发到聊天、PR、日志或仓库：

| Secret                   | 用途                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| IOS_CERTIFICATE          | iOS Apple Distribution 证书与私钥的加密 .p12，base64 编码          |
| IOS_CERTIFICATE_PASSWORD | .p12 导出密码；当前工作流要求非空                                  |
| IOS_MOBILE_PROVISION     | 精确匹配 App ID 的 App Store Connect .mobileprovision，base64 编码 |
| APPLE_TEAM_ID            | 已确认的发布团队 ID                                                |
| ASC_PRIVATE_KEY          | App Store Connect API .p8 原文，不是 Mac 应用专用密码              |
| ASC_KEY_ID               | 该 API Key 的 Key ID                                               |
| ASC_ISSUER_ID            | 该 API Key 的 Issuer ID                                            |

最后三项仅上传时需要。构建依赖安装和测试步骤不注入这些秘密。
证书和描述文件由 Tauri 的原生签名流程消费；使用 GitHub 托管的临时 macOS runner，不缓存钥匙串。
上传密钥放独立临时目录并在成功/失败时删除，不上传诊断日志或钥匙串制品。

完成所有验收后，把 Environment variable `IOS_RELEASE_APPROVED_SHA` 设置为已审查的完整提交 SHA。
它是版本验收声明，不替代环境审批，也不能填分支名称。新提交必须重新验收。

## 4. 发布流程与失败恢复

1. 合入已审查的发布工具链和 Remote 功能修复，记录 Desktop、Relay/Cloud、iOS 的对应版本。
2. 手动运行 `Build iOS release candidate`，指定数字版本（如 `0.1.0`）及唯一递增 build number。
3. 保持 `upload_testflight=false`：先检查凭据、Xcode、类型与移动端测试，再构建 Release IPA。
4. 对导出的 IPA 检查签名、Team、App ID、版本、非调试权限、描述文件期限与分发类型、回调、
   相机描述、隐私清单结构、加密声明。代码不替代隐私内容审计。
5. 构建产物仅保留 IPA，保存 7 天；摘要记录 SHA-256 和代码 SHA，确认不是开发服务器壳。
6. 完成下方真机矩阵并批准对应 SHA。再运行上传模式，使用新的 build number，重新核对产物。
7. Apple 接受上传后仍需等待 processing，并处理 export compliance、TestFlight 测试信息/测试者分组。
   工作流不会自动添加测试者、提交外部测试审核、提交 App Review 或公开发布。

缺少凭据、错误版本、检查失败：停止，不上传，不降级成开发签名。
上传超时或状态不明：先去 App Store Connect 确认，不能盲目重复相同 build number。
签名材料失效：管理员更新现有 Secret，避免撤销影响 Mac 或同事发布的证书。
回退：禁用此手动 workflow，保留既有 Mac 流程。已上传的测试构建在 App Store Connect 停止测试；
不要通过改旧包或复用旧 build number 回退。已经公开发布的版本需另行发布修复版本。

## 5. Release 真机验收矩阵（每项记录证据，不能用模拟器替代）

| 场景         | 验收标准                                                      | 当前 |
| ------------ | ------------------------------------------------------------- | ---- |
| 安装/升级    | 新安装、覆盖开发版的身份差异、升级已有内测版；数据不误删      | 待测 |
| 离开开发环境 | 关闭电脑前端服务后仍显示 App UI；没有 localhost:1999 依赖     | 待测 |
| 登录         | 浏览器已登录/未登录、取消、超时、回调、过期刷新、退出再登     | 待测 |
| 账号隔离     | 切换账号不展示前一个账号的设备、会话或图片                    | 待测 |
| 首次配对     | 扫码、粘贴、相机拒绝/允许、SAS 确认、过期码、错误账户         | 待测 |
| 已配对恢复   | 冷启动直接到会话区域；网络慢不回到配对入口；失败可恢复        | 待测 |
| Relay        | 生产地址 + 同 Wi-Fi/蜂窝网、断网恢复、桌面休眠/唤醒、票据时效 | 待测 |
| 设备管理     | 多设备切换、撤销权限、断开、重复点击和旧响应隔离              | 待测 |
| 会话         | 列表/分页/空态/错误、历史轮次、实时更新、后台回来刷新         | 待测 |
| 消息与图片   | 发送、停止、批准/拒绝、只读限制、失败重试、图片预览           | 待测 |
| 隐私         | 删除账号真实生效，配对失效；隐私政策和支持链接可访问          | 待测 |
| 生命周期     | 前后台、锁屏、重复开关、取消；无无限重试或资源增长            | 待测 |
| 视觉/无障碍  | 小屏/大字/深浅色/VoiceOver；若支持 iPad 也必须覆盖 iPad       | 待测 |

## 6. 商店与审核资料

- 应用名、30 字符以内副标题、介绍、关键词、版本说明、支持 URL、隐私政策 URL。
- 真实 release 画面的截图，按 App Store Connect 当前要求的设备尺寸提供；不使用黑屏或开发占位图。
- 审核备注：说明 App 是已有桌面 Agent 的遥控客户端、如何安装桌面、完成登录和配对。
  提供隔离的审核账户/演示桌面或获批准的演示方式，不能暴露真实个人会话和生产凭据。
- 核对第三方登录是否满足 4.8 的等效登录要求/适用例外，不能把 GitHub-only 自动认定合规。
- 如果支持开户，核对应用内发起账号删除及实际删除路径；外链必须直达处理流程，不能只是客服入口。
- 隐私标签审计账户标识、会话内容、图片、诊断与第三方服务；逐项确认用途、关联身份、是否追踪。
- 核对第三方 SDK 的 privacy manifest / required-reason APIs 与最终归档，记录实际理由，不能猜 reason code。
- 确认 AI 服务数据共享告知与同意、用户内容处理和适用的安全机制。
- 确认是否售卖数字功能/订阅、是否存在导向外部购买入口，再按目标地区适用规则处理 IAP/外链。
  不在未确认商业模式时擅自加支付、删付费功能或接受协议。
- 内容分级、加密出口、许可证/第三方声明、地区经营要求由负责人确认；本清单不构成法律结论。

## 7. 当前工具验证与剩余工作

自动检查的单元测试和 shell/YAML 语法验证可在无 Apple 秘密时运行。
本地 `node --test scripts/ios-release/readiness.test.mjs`：15 项通过；覆盖实际 plist 的日期/证书数据类型、
版本输入、错误团队/应用/版本、开发/企业/Ad Hoc 描述文件、过期、回调/相机/加密声明缺失。
工作流 YAML 与所有 run 脚本通过解析和 `bash -n`；脚本通过基础 ESLint 的未定义/未使用变量检查。
已读取当前本机开发包，发布检查在“加密出口声明未配置”处拒绝，未上传或修改该包。
完整签名构建/上传目前因分发凭据缺失未执行；不得将本工作流标为“已跑通”。
功能分支中的大量未提交修改未自动带入本发布分支，尤其图标、相机与登录修复需要审查后集成。
此文档中的所有“待测”都需要真实验收记录才能修改成通过。

## 官方依据（核对于 2026-09-08）

- [Apple 提交要求 / Xcode 与 SDK 最低要求](https://developer.apple.com/app-store/submitting/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [应用内账号删除](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Tauri iOS 手动与自动签名](https://v2.tauri.app/distribute/sign/ios/)
- [Tauri App Store 构建与上传](https://v2.tauri.app/distribute/app-store/)
