# AgentOrgHistoryBoundary UI audit

| Line                              | Element            | Verdict          | Reason                                                                             | Suggested change |
| --------------------------------- | ------------------ | ---------------- | ---------------------------------------------------------------------------------- | ---------------- |
| `AgentOrgHistoryBoundary.tsx:70`  | 读取失败重试       | keep with reason | 使用共享 Button；只重试当前身份查询，未解析前不能发送                              | None             |
| `AgentOrgHistoryBoundary.tsx:111` | 成员和保存内容切换 | keep with reason | 使用共享小尺寸 Button 和 aria-pressed；允许浏览；不提供运行操作                    | None             |
| `AgentOrgHistoryBoundary.tsx:143` | 只读提示           | keep with reason | 复用 SessionReadOnlyBar，15 种语言具备对应文案                                     | None             |
| `AgentOrgHistoryBoundary.tsx:208` | 历史分页           | keep with reason | 共享 Button；每页 50 条；不累计无限历史列表；失败显示重试入口                      | None             |
| `ChatView.tsx:670`                | 历史正文           | keep with reason | 复用现有正文分页和 mutationActionsDisabled；运行视图读取关闭，成员身份来自历史描述 | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

控制项复核：新增生产组件没有原生 button/input 或伪造可点击 div；没有 layout="custom" 绕过。自动测试使用真实共享 Button；打包应用已验证深色主题、英文控件、中文/英文正文、成员切换、分页和只读提示；加载/错误由组件测试覆盖。浅色主题、窄窗口和其他语言尚未实机逐项检查。没有提出全仓清理或组件配置级改动。

最终包复测：SHA 为 `845b3235a510a860aef13efb603a2f048a71bb6e6963da0c1501dbb8ffdcb58b` 的 BuildFast 已连接正式 `~/.orgii`。侧栏显示原正式会话；旧团队“规划德州扑克游戏开发”的根报告和 Implementer 正文可读，成员切换有效，界面显示“旧版本会话，仅供查看”且没有发送输入区。此前隔离包还验证了长群聊下一页/首页入口、归档根发现与置顶。Computer Use 记录留在本次对话工具记录；状态中保留的旧执行卡片是已保存回放内容，不能当作当前运行投影或新任务完成证据。

最后一次生产源检查涵盖新增历史组件、ChatView 以及历史读取 hook：没有新增原生按钮、原生表单字段、可点击 div/span 或自定义布局绕过。分页和成员按钮使用共享组件，身份未解析或失败时不挂可写正文界面。用户于 2026-09-25 报告两项实机验收成功；UI 审查本身仍只证明上表覆盖的界面边界，不替代模型请求或数据库证据。
