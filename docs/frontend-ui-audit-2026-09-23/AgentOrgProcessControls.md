# Agent Org Process Controls UI audit

| Line                                                                                   | Element              | Verdict          | Reason                                                                                                          | Suggested change |
| -------------------------------------------------------------------------------------- | -------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/InputArea/components/ActiveProcesses.tsx:94`                    | 进程 Stop 图标按钮   | keep with reason | 保留共享 Button 的 tertiary、mini、iconOnly、危险色悬停与现有标题；此次只补全精确停止身份                       | None             |
| `src/engines/ChatPanel/blocks/ShellBlock/index.tsx:217`                                | 终端块停止回调       | keep with reason | 复用终端块的共享动作控件，将后台给出的登记身份完整传递；未引入新原生控件                                        | None             |
| `src/engines/ChatPanel/blocks/TerminalBlock/index.tsx:75`                              | 随悬停展开的停止控件 | keep with reason | 现有共享 Button 的 custom 布局保留零宽到 20px 的调用方几何、圆形状态和 aria-label；标准固定尺寸会破坏该折叠几何 | None             |
| `src/engines/ChatPanel/blocks/TerminalBlock/index.tsx:236`                             | 未知进程状态         | keep with reason | 使用现有状态文字、text-3 色彩与 common 的国际化键，不把无归属登记伪装成已退出                                   | None             |
| `src/modules/WorkStation/shared/SidebarModules/Terminal/TerminalSidebarContent.tsx:76` | 侧栏进程停止动作     | keep with reason | 保留现有列表动作与共享终端组件，仅传递各进程登记身份；无新增输入或按钮外观                                      | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

检查范围为此次改动的生产组件和差异。未增加原生按钮、可点击 div/span 或原生表单输入。进程卡片已有实际渲染点击测试；真实桌面截图和清理场景待阶段验收补充。
