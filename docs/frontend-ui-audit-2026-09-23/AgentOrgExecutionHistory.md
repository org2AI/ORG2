# Agent Org Execution History UI audit

| Line                                                                                  | Element            | Verdict          | Reason                                                                                                                                           | Suggested change               |
| ------------------------------------------------------------------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `src/engines/ChatPanel/ChatHistory/GroupChatView/ExecutionDetailsButton.tsx:64`       | 查看执行详情       | keep with reason | 使用共享 Button 的 ghost、inline、loading、disabled 和可访问名称；保持群聊正文尺寸，缺少可核实目标时明确显示不可定位                             | None                           |
| `src/engines/ChatPanel/ChatHistory/renderers/InboxTranscriptCard.tsx:67`              | 收信折叠按钮       | fix              | 已将此处原有点击标题改成共享 Button，提供原生键盘操作和 aria-expanded；custom 布局保留既有事件标题的图标、文字及折叠几何，子标题不再承担点击行为 | 已完成；渲染测试覆盖展开与摘要 |
| `src/engines/ChatPanel/ChatHistory/renderers/InboxTranscriptCard.tsx:99`              | 展开发件人与收件人 | keep with reason | 延用现有事件块的 13px 正文、边框和主题色；信息来自持久来源元数据，缺失字段明确未知，不引入新的卡片样式                                           | None                           |
| `src/engines/ChatPanel/ChatHistory/renderers/GroupHeaderRenderer.tsx:275`             | 正式执行标题       | keep with reason | 使用现有间距、text-sm 与 text-text-2；实际参与者和来源组成标题，不把总结轮伪造为用户消息                                                         | None                           |
| `src/engines/ChatPanel/ChatHistory/GroupChatView/AgentOrgGroupProjectionView.tsx:415` | 群聊详情入口位置   | keep with reason | 在既有回复脚注中复用独立详情控件；未复制成员选择、分页或定位逻辑                                                                                 | None                           |
| `src/engines/ChatPanel/ChatHistory/components/ConversationMinimap.tsx:573`            | 执行导航与悬停摘要 | keep with reason | 沿用共享 Button 的 custom 标记几何、焦点和 aria-current；按正式来源生成可读名称，不再将模型收信信封用作导航文案；普通用户标题保持                | None                           |
| `src/engines/ChatPanel/ChatHistory/components/TurnPageList.tsx:194`                   | 分页列表项         | keep with reason | 沿用共享 Button、下拉令牌与原有虚拟列表；与导航标记共用来源摘要，加载前后含义一致，没有新订阅或样式分支                                          | None                           |

Verdict totals: **1 fix**, **6 keep with reason**, **0 abstract**.

检查覆盖本次改变的生产组件与差异，未新增原生按钮、替代点击 div/span 或表单字段。未发现需要跨文件逐站点修复的视觉模式；本次只将新改动的收信入口落实到共享 Button，不扩展整理其他事件块。全部 15 种语言补齐来源、收信摘要和定位状态。真实中英文、亮暗主题、窄窗口及键盘证据将在桌面验收中补充；静态和渲染测试不代替这些视觉证据。
