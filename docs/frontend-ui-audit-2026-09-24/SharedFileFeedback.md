# SharedFileFeedback UI audit

| Line                                                                 | Element                                   | Verdict          | Reason                                                                                    | Suggested change                             |
| -------------------------------------------------------------------- | ----------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| `SharedSessionFileLink.tsx:30`; `SharedSessionFilesContext.tsx:74`   | 两个附件入口的 lazy fallback              | fix              | 原 `null` fallback 让真实点击暂时没有反馈；这是同一范围的两处入口                         | 已一并接入可关闭的加载壳，不修改全局组件配置 |
| `SharedSessionFileViewer.tsx:186`                                    | 错误与恢复                                | fix              | 路径查询无记录与请求异常不同；用户不应靠关窗重开才能重试                                  | 已区分未上传与读取失败，在当前窗口重试       |
| `SharedSessionFileDialog.tsx:9`                                      | 两处 fallback 与 Viewer 的共同 Modal 外壳 | abstract         | 三处需要一致的标题、关闭行为和加载语义                                                    | 已抽取特性内共享外壳，复用 ModalSystem       |
| `SharedSessionFileViewer.tsx:193`; `SharedSessionFileViewer.tsx:227` | 重试与下载按钮                            | keep with reason | 使用共享 Button 的默认 secondary/default，保留键盘、禁用和 loading 行为，没有手写按钮样式 | 保留                                         |
| `SharedSessionFileLink.tsx:18`                                       | 文件链接                                  | keep with reason | 原生 anchor 保留真实 href 和键盘链接语义；点击在应用内预览，未新增 div/span 替代控件      | 保留原样                                     |
| `SharedSessionFileViewer.tsx:207`                                    | 图片/PDF/文本预览                         | keep with reason | 现有有界预览尺寸、主题 token、安全文本和 iframe sandbox 与本次反馈一致                    | 保留，不扩大预览范围                         |

Verdict totals: **2 fix**, **3 keep with reason**, **1 abstract**.

## 范围与实现边界

本 PR 实施审计 F9 的即时加载反馈和原位重试，不修改收集器、自动上传、文件访问协议或配额规则。Agent 回答中的 Markdown / `[file:…]` 自动上传继续保留。服务器尚未提供逐文件上传状态，因此这里只把成功查询但无记录标为“尚未上传”，不能推断是额度、发送端离线或文件已丢失；其他异常保留通用读取错误。完整 outbox 状态需后续服务端合同支持。

## 架构与生命周期

架构检查覆盖十层中本次相关部分：1 编译与回归；2 三处壳的复用；3/4 区分未上传与请求失败；5/6 不把缺失记录当作权限或执行错误；7 点击后可理解、可恢复；8 无 wire 变化；9 两个入口相同反馈；10 重试保留身份、端点及 share capability 校验。未审计无关 Rust/provider 内核或修改 canonical transcript。

| Area               | Verdict | Evidence                                                          | Change or reason kept                           | Verification                                                  |
| ------------------ | ------- | ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| Background work    | keep    | 每次挂载/显式重试只创建一个请求 effect，cleanup abort             | 无新增轮询、自动重试、扫描或后台订阅            | 重试时旧 signal 终止，关闭时新 signal 终止的渲染测试          |
| Memory             | keep    | 只保留当前文件、错误枚举和重试计数；既有 Blob URL effect 清理保留 | 不增加 app-lifetime cache；按需加载预览         | 源码检查；真实 RSS 未测                                       |
| Scope/isolation    | fix     | 异步 catch 与成功分支使用同一个 stillCurrent 校验                 | 旧身份/端点/capability 的错误不覆盖当前窗口结果 | 延迟旧 capability 错误、当前结果保留的回归                    |
| Rendering/hot path | fix     | 两个 Suspense 入口共享同步加载壳                                  | Viewer 仍 lazy，未点击时不读取文件              | 挂起真实 dynamic import，点击后检查加载和关闭；两个入口均覆盖 |

生命周期范围：unopened 无附件读取；active 仅一次请求；close/unmount abort；retry 是用户发起的新请求；account/endpoint/capability 切换沿用 guard。未增加 hidden/visible 工作或 timer，未改变文件源解析、上传、secondary 实例或 provider 适配器。不将渲染组件测试外推为桌面、多机或所有 provider 通过。

## 验证

- `pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/SharedSessionFileDialog.test.ts src/features/Org2Cloud/SharedSessionFileViewer.test.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts src/features/Org2Cloud/downloadSharedSessionFile.test.ts`：4 files / 37 tests passed
- `pnpm typecheck:fast`：通过
- `pnpm exec eslint src/features/Org2Cloud/SharedSessionFileDialog.tsx src/features/Org2Cloud/SharedSessionFileDialog.test.ts src/features/Org2Cloud/SharedSessionFileLink.tsx src/features/Org2Cloud/SharedSessionFilesContext.tsx src/features/Org2Cloud/SharedSessionFileViewer.tsx src/features/Org2Cloud/SharedSessionFileViewer.test.ts`：通过
- `pnpm check:i18n-keys`：15 个语言目录齐全，五类检查均 0 新增问题
- `git diff --check`：通过
- 已检查修改的生产组件和 diff：新增操作使用共享 Button，无 raw button JSX、native button creation 或可点击 div/span/input 绕过；测试 mock 的 button 是 fixture。没有新增表单输入

**Performance verdict: blocked**。组件测试证明本次请求与清理逻辑，但没有真实 Tauri 的 visible/hidden/close CPU/RSS 测量。本轮不启动额外桌面实例，未补明暗主题/窄屏截图、原生焦点切换或全桌面 E2E；这些视觉与运行时路径仍待验证，不声称体验或性能已经完整验收。
