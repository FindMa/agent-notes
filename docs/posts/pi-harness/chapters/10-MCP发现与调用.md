# 第 10 节：MCP——外部工具怎样进入 PI 的执行循环

前一节的 echo 工具直接在 PI 进程里运行。现在假设团队已有一个文档搜索服务，希望 PI 能发现它提供的工具并调用。MCP 负责客户端与服务之间的能力发现和调用约定。

本节只追当前 PI 的实际接线，不连接真实 MCP server。协议版本、默认暴露策略和路径都按 `eb326d2` 说明。

## 一、先把模型调用与 MCP 调用画在不同位置

```text
模型看到可用工具说明
→ 模型提出 toolCall
→ PI 按工具名找到执行函数
→ 执行函数通过 MCP client 请求外部 server
→ server 返回结果
→ PI 转成 ToolResult
→ 下一次模型请求看到结果
```

模型生成调用意图和 MCP 客户端发出协议请求，是不同动作。模型通常不会直接连接 MCP server。一个普通本地函数也能接工具循环；当多种客户端需要复用外部能力时，MCP 提供统一发现和调用方式。

当前仓库有自己的 `packages/mcp` 客户端实现。不能因为接口叫 MCP，就假定它必然包了一层某个官方 SDK。

## 二、CLI 自带客户端，与 SDK 默认加载不同

当前 [内建扩展列表](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/extensions/index.ts#L1-L13) 包括 MCP、codemode、tool-search 等可替换扩展。普通 CLI 启动时会把内建列表接入资源加载。

而 [SDK 的 MCP 说明](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/docs/mcp.md#L264-L272) 明确要求显式加入需要的内建扩展。`createAgentSession()` 能创建会话，不代表它已经自动连上你在 CLI 中配置的所有 MCP 能力。

这里要分别检查：客户端实现是否存在，扩展是否加载，server 是否配置，连接是否成功，工具是否注册，以及该工具当前是否可达。每一步成功都不能代替后一步。

## 三、连接时先协商，再发现能力

[McpClient.connect](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/mcp/src/client.ts#L213-L243) 先启动 transport，发送 initialize，携带协议版本、客户端信息和客户端能力。服务端返回版本与能力后，客户端验证是否支持，再发送 initialized 通知。

当前默认提出的版本是 `2025-11-25`，同时接受源码列出的几个旧版本。实际采用哪个版本取决于 server 的响应；本节没有实际协商结果。

连接运行时随后检查服务端能力：如果 server 声明 tools，才调用 listTools；只有资源能力的服务不需要回答 tools/list。见 [connectOnce](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/extensions/mcp/runtime.ts#L378-L424)。

初始化成功表示协议连接建立，不代表任意工具都可用，更不代表业务访问授权已通过。

## 四、tools/list 怎么变成 registerTool

普通工具发现链是：

```text
client.listTools()
→ MCP tools/list
→ connection.tools 保存工具列表
→ connection.onTools(this)
→ registerTools(connection)
→ createMcpToolDefinition(...)
→ pi.registerTool(definition)
```

[listTools](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/mcp/src/client.ts#L294-L295) 发出的协议方法是 `tools/list`。创建连接时，[onTools 明确绑定 registerTools](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/extensions/mcp/index.ts#L525-L536)。

`registerTools` 遍历发现的工具，把远端 name、description、inputSchema、exposure 和连接对象组装成 PI 的 ToolDefinition。见 [注册循环](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/extensions/mcp/index.ts#L368-L416)。

工具名会带上 server 命名空间，并处理名称归一化后的冲突，避免两个服务的同名工具在本地混淆。原始远端工具名仍保留，实际发给 server 时使用它。

## 五、ToolDefinition 的 execute 做了什么

[createMcpToolDefinition](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/extensions/mcp/tools.ts#L256-L294) 返回的 execute 可以简化成：

```ts
async execute(_id, params, signal, onUpdate) {
  const client = await options.getClient();
  const result = await client.callTool(tool.name, params, {
    signal,
    timeoutMs: options.timeoutMs,
    onProgress: progress => {
      onUpdate?.(/* 转成 PI 的工具进度 */);
    },
  });
  return convertMcpResult(server, tool.name, result);
}
```

注册时 `getClient` 返回的就是该工具所属的连接对象。连接的 callTool 再转给底层 McpClient，底层发送：

```text
method: tools/call
params: { name: 远端工具名, arguments: 参数 }
```

见 [客户端调用](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/mcp/src/client.ts#L376-L383)。因此调用方向可以一直追到同一个 server，不需要靠工具名猜。

signal、timeout 和进度也跨过这层适配。进度被转成 onUpdate，再进入第 04 节的 tool_execution_update；它仍然只是过程信息。

## 六、结果怎样变成模型能用的内容

MCP 服务可能返回文本、图片、资源链接、结构化数据和错误标记。PI 要把这些转换成自己支持的内容形状。

[convertMcpResult](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/extensions/mcp/tools.ts#L209-L229) 大致做：

1. 有 content blocks 时转换它们；否则可用 structuredContent 形成文本表示。
2. 错误结果没有文字时补上错误说明。
3. 对模型内容应用输出限制。
4. 在 details 保存 server、tool 和可能的完整输出位置。
5. 向程序调用者保留去掉 `_meta` 的原结果包装，作为 structuredContent。
6. 保留 `isError`。

模型通常消费 content，脚本调用者可以消费 structuredContent。不能假定所有原始 JSON 都完整塞进模型窗口，也不能把工具 content 中写“失败”与 isError 字段混为一谈。

工具结果里的图片可以经过内容转换和尺寸处理，最终以 ImageContent 进入多模态上下文；只有路径文字不等于模型已经收到像素。是否能使用图片仍取决于模型输入能力。

## 七、注册了工具，为什么模型列表里可能看不到

当前 MCP 默认 exposure 是 `codemode`。见 [暴露策略](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/docs/mcp.md#L189-L204)。

| 配置 | 模型怎样使用 |
|---|---|
| direct | 直接声明工具，模型可直接提出调用 |
| deferred | 先经 tool_search 发现，加载后供下一次模型调用 |
| codemode | 不全量声明；脚本通过 searchTools、describeTool、ALL_TOOLS 发现并调用 |
| hidden | 注册保留，但不可达 |

大工具目录如果全部写进 prompt，会占空间，也容易让模型在相似工具中选错。按需发现减少初始工具说明，但增加发现步骤，可能影响延迟和漏选，需要实际任务比较。

注意这里 MCP 配置中的 codemode 会映射到内部的相应工具暴露策略；不要只凭两个配置字符串相似就推断内部行为完全一样。也不要把 exposure 当作资源权限，它决定如何到达工具，不替服务端判断用户是否能读某份文档。

## 八、工具列表变了怎么办

连接运行时订阅 `notifications/tools/list_changed`，收到后刷新工具。当前注册机制不能直接取消注册，所以从 server 列表消失的工具会重新登记为 hidden。

这是一种保持注册对象和当前可达集合一致的处理方式。不能缓存一次 tools/list 后，就永久认为工具存在；断连、服务升级和权限变化都可能改变后续调用结果。

工具描述和 server instructions 也是外部内容。它们可以帮助选择能力，但不能自动成为高于宿主规则的授权指令。

## 九、stdio、HTTP 与 PI 自己的 JSONL 别混在一起

```text
外部程序 ── PI RPC JSONL ──> PI
PI ── MCP transport ──> MCP server
PI ── 模型 API ──> 模型服务
```

它们是三个独立连接。当前 MCP 支持 stdio 和 Streamable HTTP；普通 PI RPC 使用自己的 stdin/stdout JSONL 命令协议。即便都出现 JSON 和标准输入输出，消息方法、生命周期和对端也不同。

例如模型请求超时，是模型 API 一侧；tools/call 超时，是某个外部工具一侧；父进程不读 stdout 导致阻塞，则是 PI 输出接口一侧。诊断时先确认卡在哪一条连接。

## 十、错误要按发生位置处理

| 情况 | 应先检查 |
|---|---|
| 初始化失败 | transport、认证、协议协商、server 启动 |
| 列表为空 | server 能力、权限、分页与发现结果 |
| 注册但模型看不到 | exposure、当前激活集合、发现工具 |
| 参数不合法 | 模型参数、schema、适配后的结构 |
| tools/call 返回 isError | 服务端业务失败内容 |
| 超时但动作可能成功 | 执行端状态和幂等机制 |

MCP 的存在不能消除“执行成功但响应丢失”的失败窗口。读请求和有副作用调用也不能无差别重试。

## 十一、最小学习实验怎样安排

先把第 09 节本地 echo 工具的输入输出写清，再用一个受控 server 提供同样语义。观察 initialize、tools/list、注册、tools/call、ToolResult 五个位置，比较直接暴露与按需发现。

至少设计三个失败案例：参数缺字段、server 返回明确错误、连接中断。每个案例记录错误在哪一层产生、是否进入 execute、是否发生真实动作。本文没有创建 server 或执行该实验，不能把这份流程图写成“已完成 MCP 集成”。

面试讲解时可以沿这一条链回答：模型提出意图，PI 通过本地 ToolDefinition 接到 MCP client，server 执行动作，结果经过适配返回 Agent Loop。若改用本地函数，循环大体不变，变化的是 execute 背后的调用方式。
