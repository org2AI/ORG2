> Historical design draft. For implemented commands, use [the current rulebook](ui/rulebook.md) and [implementation notes](ui/README.md).

# ORG2 UI docs index — draft

状态：按需文档入口草案。所有 `org2 ui docs` 命令尚未实现。本目录不进入常驻 rulebook；由简短标题、任务描述、command ID 与资源位置组成，agent 只读取相关专题。

## 查询接口

```bash
org2 ui docs --list
org2 ui docs --search "open a page"
org2 ui docs targets
org2 ui docs results
org2 ui schema ui.file.open --json
```

`--list` 返回 topic ID、一句话用途；`--search` 返回至多 8 个匹配项及读取命令，不返回所有正文。支持中文/英文任务关键词，完全相同的 command ID 优先。无匹配时返回空列表与可用 topic，不做联网搜索或全量 prompt 注入。

`docs <topic>` 输出该专题 Markdown；`schema <command-id>` 输出机器契约。两者随 CLI 一起发布，不要求 app 运行。每份响应带 catalog version/hash、支持状态；实际权限、窗口 ready 和实例版本由 `capabilities` 查询。静态文档不能证明某个操作当前可执行。

## 首版专题

以下是本次已写出的参考材料入口；发布时生成器按专题抽取并打包，不能直接把开发者架构提案全部发送给 agent。

| Topic          | Read when                                                                    | Draft source                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targets`      | 选择 instance/window/session/global；处理独立窗口 follow；相对路径与权限范围 | [Select the destination](org2-ui-reference.draft.md#select-the-destination)                                                                                                |
| `files`        | 精确文件路径、行号、不可读文件；需要完整示例                                 | [Common actions](org2-ui-reference.draft.md#common-actions)、[Interpret the result](org2-ui-reference.draft.md#interpret-the-result)                                       |
| `browser`      | MyStation Browser 与 editor preview 的区别、URL 限制、加载状态               | [Common actions](org2-ui-reference.draft.md#common-actions)、[Interpret the result](org2-ui-reference.draft.md#interpret-the-result)                                       |
| `tabs`         | 查询分页、partition、tab focus、Explorer/Source Control                      | [Common actions](org2-ui-reference.draft.md#common-actions)                                                                                                                |
| `results`      | 超时、unknown、request ID、重试与状态查询                                    | [Interpret the result](org2-ui-reference.draft.md#interpret-the-result)                                                                                                    |
| `access`       | app 不可用、权限关闭、命令未发布、harness 接入                               | [Discover the available interface](org2-ui-reference.draft.md#discover-the-available-interface)、[Permissions and scope](org2-ui-reference.draft.md#permissions-and-scope) |
| `more-actions` | 导航、主题、Spotlight、布局等常用列表以外的操作                              | 见下文；当前只有源码基础，尚未发布为 public commands                                                                                                                       |

## More actions

This topic covers application actions outside the common file, page, and tab workflow. Read the relevant command reference before executing an unfamiliar action. Use live capabilities to distinguish an available command from an operation that is only documented.

| Need                                     | Existing internal foundation                               | Public status in this proposal                                                |
| ---------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Open Settings or another app destination | `app.goToSettings`、`spotlight.destination.*`              | Not exposed yet; export selected navigation actions after scope/policy review |
| Change app appearance                    | `theme.setLight`、`theme.setDark`、`theme.setHighContrast` | Not exposed yet; publish discrete theme commands with resulting state         |
| Open Spotlight or a picker               | Spotlight actions and native `spotlight` tool              | Not exposed yet; distinguish opening a picker from completing its workflow    |
| Change sidebar/chat/workstation layout   | existing sidebar/chatPanel/workstation actions             | Not exposed yet; export explicit set/show/hide operations where possible      |
| Tutorials and highlights                 | `guide.*` actions                                          | Not exposed yet; publish only after target-window behavior is defined         |

The internal IDs above are implementation evidence, not CLI commands. Do not call them through `exec` unless a running release explicitly publishes their public command and schema. An unsupported operation should be reported as unavailable; documentation does not grant permission to bypass the catalog.

每个被正式发布的长尾 command 都应包含以下短条目，沿用常用说明的写法：

```text
<command-id>
<What it does.> Use when <concrete user intent>.
Target: <scope and default resolution>.
Parameters: <generated parameter reference>.
Result: <confirmed state and meaningful limits>.
Availability: <capability, readiness, supported version>.
Example: <one executable example, validated against the schema>.
```

文档检索只是按需加载策略。发布长尾能力时只增加 catalog 条目、对应 action adapter 和专题条目，继续使用相同 broker/policy/result，不为每类操作创建新的 transport 或强制增加顶层 CLI verb。未发布项不出现在默认能力列表，只在用户确实查询该主题时说明状态。
