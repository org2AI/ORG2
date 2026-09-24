# 分享链接附件授权落地

对应 Share Sessions 审计 F3。此前 guest 正文使用 replay token，附件只走组织成员 RPC；现在已登录访客的附件 lookup/get 使用同一 replay token，后端复用正文 resolver。

后端配套：[ORGII-cloud-infra #147](https://github.com/org2AI/ORGII-cloud-infra/pull/147)。先部署新增 RPC，再发布客户端；本次没有生产部署。

## 权威边界

- 服务端根据 token 解析权威 org/session ID，不信任调用方坐标或 metadata 的 source alias。越界 file ID、匿名、过期/撤销、metadata-only、软保留期和删除统一拒绝。
- 成员读写和上传额度不变；guest 不能上传。没有公共 URL、接收者本机读取或失败后改用其他权限的 fallback。
- token 从 imported replay 进入挂载中的 React Context，路径附件和显式 `orgii-file` 链接共用；不编码到文件 URL、DOM 或下载文件名。
- token/账号/端点变化后取消旧请求并拒绝旧结果，已加载结果也与 token 绑定。卸载清理原有 abort 和 Blob URL。
- 不修改历史记录。仅 alias 关联而无权威 session 归属的历史文件不自动放宽读取，需先单独核实和迁移。

## 十层检查

| 层            | 结论                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| 编译          | `pnpm typecheck:fast` 通过；变更文件 ESLint 通过                              |
| 结构/重复     | 只有一处文件 RPC 客户端；新增 Context 在独立叶模块，避免 lazy Viewer 循环依赖 |
| 命名          | member API 保留原名，guest API 明确 `_by_share`                               |
| 语义          | JWT 代表登录身份，share token 代表 replay capability；不把两者混用            |
| 默认分支      | 无 token 保留成员 API；有 token 必须使用 guest API，拒绝后不降级              |
| 跨域          | 模型正文不能指定 token；token 来自已导入分享上下文                            |
| 可理解性      | guest 权限与读取 API 配套，不靠加入组织解决                                   |
| Wire          | 测试实际序列化 body：guest 请求不含 client org/session；内容 hash 校验保留    |
| 入口          | 路径 lookup 和显式 file ID 均传 capability；成员入口保持不带 token            |
| Resolver 对称 | lookup/get 都经同一后端 resolver；过期/撤销/retention/删除语义相同            |

## 生命周期与性能

| Area               | Verdict | Evidence                               | Change or reason kept                     | Verification                             |
| ------------------ | ------- | -------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| Background work    | keep    | 仍只在 viewer 挂载/引用变化时读取      | 没有新轮询、定时器或 worker               | viewer 测试检查请求数                    |
| Memory             | keep    | Context 随挂载存活，仍保留单个当前文件 | 不新增全局 token/cache registry           | 卸载与 abort 回归                        |
| Scope/isolation    | fix     | 原 guest capability 未传至附件         | token + endpoint 限定，结果绑定当前 token | token 更换、跨端点、登出后的延迟结果回归 |
| Rendering/hot path | keep    | 新 Context 值按 endpoint/token memoize | 普通渲染不重启请求                        | 单次挂载请求及编译器 lint 检查           |

| 生命周期                         | 证据/限制                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------- |
| 挂载、关闭、重开                 | jsdom 测试；原请求可取消                                                         |
| 登录/登出、token 变化            | 延迟结果丢弃回归；没有跨实际账户端到端测试                                       |
| endpoint 变化                    | 不转发另一端点的 token；原 endpoint identity 校验保留                            |
| 撤销、过期、retention、删除      | 配套 SQL 隔离库测试拒绝；不承诺抹除已下载字节                                    |
| visible/hidden、断网恢复、双实例 | 未新增桌面实测；原请求超时/生命周期不变                                          |
| provider 原始历史                | 未执行 Codex/Claude rewrite/rotate；本 PR 不改变 ingestion，不宣称其兼容性已验收 |

Performance verdict: blocked（未执行桌面 CPU/RSS、双机 HTTP/JWT、后台/前台完整矩阵）。这是授权修复，不宣称性能改善。

## 验证和上线

- `pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts src/features/Org2Cloud/SharedSessionFileViewer.test.ts src/features/Org2Cloud/sharedSessionFileReference.test.ts`：3 files / 33 passed
- `pnpm typecheck:fast` 和七个变更 TS/TSX 文件的 ESLint：通过
- 后端隔离 SQL：正常内容和 revision lookup、缺失路径、九种拒绝场景、guest 禁止上传、函数 execute 权限均通过
- 不涉及控件和布局改变；检查变更没有新增原生 button/input 或点击替代元素。上下文改动不改变视觉，因此未新增截图
- 老后端没有新 RPC 时 guest 附件仍显示失败，正文不受影响；不能声称客户端 PR 单独合并即可恢复访客附件
- 回滚客户端后恢复原成员 API；后端新增 API 可以保留或撤销 execute 权限，无数据删除或持久格式回退
