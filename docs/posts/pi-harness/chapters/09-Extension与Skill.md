# 第 09 节：Extension 与 Skill——怎样增加工具和工作方法

假设你希望 PI 成为代码取证助手：读取相关代码，给出准确出处；同时禁止模型调用 bash。这里至少涉及两种内容：可执行的限制逻辑，以及指导模型怎样找证据的文字。

PI 用 Extension 接入代码，用 Skill 提供任务方法。两者可以配合，也可以独立使用。本节依据固定源码，示例代码供阅读或后续实验，本次未加载扩展或运行模型。

## 一、先把几个常用名字对上具体对象

| 名称 | 实际形式 | 示例 |
|---|---|---|
| Tool | 名称、描述、schema 和 execute 函数 | read、echo |
| Extension | 加载到 PI 的可执行模块 | 注册工具、命令、hook |
| Skill | SKILL.md 和它引用的材料 | 怎样按源码回答问题 |
| Prompt template | 可复用的提示文字 | 展开固定的审查问题 |
| MCP | 发现和调用外部能力的协议 | 从服务取得工具列表并调用 |

RAG 则是检索和生成的组织方式，可以通过工具接入；它不是这张表里某一个文件格式的同义词。

## 二、最小 Extension 在什么时候运行

普通扩展导出一个工厂函数，加载器把 `ExtensionAPI` 传给它。工厂被调用时，你可以注册能力。

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // 在这里登记工具、命令或事件处理函数
}
```

要区分两次调用：扩展初始化时调用工厂；以后运行到特定事件时，才调用你登记的 handler。工厂初始化不是模型的一次工具执行。

查看 [扩展初始化与加载](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/extensions/loader.ts#L595-L650) 时，先找导出函数怎样被取得，再看调用时传入的 API 来自哪里。

## 三、registerTool 先登记定义

[registerTool](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/extensions/loader.ts#L289-L301) 做的事情是检查参数 schema 的基本形式，把工具定义存进扩展自己的工具表，再触发工具集合刷新。

```ts
extension.tools.set(tool.name, {
  definition: tool,
  sourceInfo: extension.sourceInfo,
});
runtime.refreshTools();
```

登记工具不会立即执行 execute，也不意味着模型已经调用。还要经过当前工具集合和 exposure 策略，工具才以相应方式供模型或脚本使用。

`ToolDefinition` 同时有模型相关字段、执行字段和 UI 字段。名称、description、parameters 告诉模型怎样提出调用；execute 决定宿主真实动作；label 和渲染字段用于显示。见 [类型定义](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/extensions/types.ts#L574-L642)。

## 四、读一个 echo 工具示例

下面的代码按当前接口编写，展示最小结构；没有作为本轮实跑结果。

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "echo_note",
    label: "Echo note",
    description: "Return the supplied text unchanged.",
    parameters: Type.Object({ text: Type.String() }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: params.text }],
        details: { characterCount: params.text.length },
      };
    },
  });
}
```

模型看见的是这个工具的调用说明，不会拿到函数源码并自行运行。它提出 `echo_note({text:"hello"})` 后，宿主找到已登记的 execute，再执行并回传。

`content` 面向模型，`details` 可以用于显示或程序记录。若工具还要供 codemode 可靠消费，可以设计 structuredContent/outputSchema；声明输出 schema 本身不等于普通 core 自动验证所有输出。

## 五、扩展工具怎样进入第四节的执行管线

[wrapRegisteredTool](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/extensions/wrapper.ts#L1-L29) 把注册定义适配为 AgentTool，并为 execute 提供运行上下文。

```text
扩展 registerTool
→ 当前工具集合刷新
→ 包装为 AgentTool
→ Agent Loop 按名称找到它
→ prepare / validate / before
→ execute
→ after / ToolResult
```

当前 wrapper 的主要职责是上下文适配。工具调用和结果拦截由 AgentSession 安装在 agent-core hooks 上，不能把所有控制都归到 wrapper。

这一层拆分让内建工具和扩展工具共享普通工具执行规则，同时扩展仍能获得自己的 ctx。

## 六、hook 怎样登记、怎样影响结果

你写：

```ts
pi.on("tool_call", async event => {
  if (event.toolName === "bash") {
    return { block: true, reason: "本会话不允许 bash" };
  }
  return undefined;
});
```

[on 的实现](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/extensions/loader.ts#L270-L286) 将 handler 放进事件对应的数组。返回的函数用于取消这次登记。

真正执行时，AgentSession 将 beforeToolCall 接到扩展运行器：

```text
beforeToolCall
→ AgentSession._beforeToolCall
→ emitToolCall
→ 已注册的 tool_call handlers
→ 返回 block/reason
```

[接线位置](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/agent-session.ts#L652-L701)；[处理函数调度](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/extensions/runner.ts#L1242-L1260)。当前 tool_call handlers 按注册集合顺序处理，遇到 block 就返回。

执行后对应 tool_result，可以查看或修改结果。要留意不同事件的异常策略：当前 tool_call 处理异常会沿前置准备路径阻止执行；tool_result 扩展运行器则记录 handler 异常并继续遍历。不要假设所有事件 handler 抛错后的行为完全一致。

前置 hook 是可信可执行代码的一部分。普通 core 中参数在 before 之前校验，before 可以原地改 args，之后没有自动复验；第 04 节已经解释这个边界。扩展应自己维护最终值有效性，避免把原本通过校验的参数改坏。

## 七、Skill 是怎样被发现的

看 [loadSkillFromFile](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/skills.ts#L277-L345)：它读取文件全文，解析 frontmatter，检查 name 和 description，保存名称、描述、文件路径、目录和来源等元信息。

示意文件：

```markdown
---
name: evidence-note
description: 回答代码实现问题时，定位实际调用链并给出源码依据。
---

先定位用户提到的入口和直接调用者。
读取相关实现，区分代码事实、推测和未验证行为。
回答时给出文件与函数位置。
找不到实现时说明缺口，不补造执行结果。
```

这些文字告诉模型怎样工作。真正读取文件仍由 read 或其他已提供的工具执行，Markdown 文件不会自己启动一个执行器。

## 八、渐进加载具体节省了什么

容易误解的是“需要时才读 Skill”。当前加载器启动阶段已经读过磁盘文件来解析元信息；渐进发生在模型上下文的提供方式。

[formatSkillsForPrompt](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/skills.ts#L358-L387) 主要给模型提供：

```text
name
description
location
以及匹配任务时读取 Skill 正文的说明
```

模型先看到目录，决定适用后再读正文，然后按正文查附件或脚本。这样不需要把每个 Skill 的全文一次塞进窗口。

description 应让模型知道何时适用。正文则承载具体步骤。描述模糊会导致选错 Skill；正文冗长会增加读入成本；两者的质量需要用真实任务验证。

`disable-model-invocation: true` 会让该 Skill 不出现在自动选择目录中，但可显式调用。这个开关控制模型发现方式，不是 OS 文件权限。

## 九、显式 /skill 命令走另一条入口

用户输入 `/skill:evidence-note 解释登录逻辑` 时，[\_expandSkillCommand](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/core/agent-session.ts#L2142-L2169) 查到 Skill，重新读取文件、去掉 frontmatter，将正文包装为带名称、路径和相对路径说明的文本块，再接用户参数。

```text
显式命令 → 找到 Skill → 正文展开到输入 → 后续模型处理
```

这和模型先读目录、再主动调用 read 取正文的自动发现路线不同。读学习资料时应说明正在讲哪一条，不能把所有 Skill 使用都写成同一个时序。

未知 Skill 名或读取失败的行为也由这段代码处理；失败不能冒充成功加载。

## 十、Extension、Skill、工具各自怎么配合

以代码取证任务为例：

```text
Skill：要求先定位调用者、读实现、给出处
read 工具：负责取得源码内容
Extension hook：阻止本会话不允许的工具动作
宿主验收：检查回答引用是否真的支持结论
```

Skill 可以要求“只读”，但真正能执行哪些动作，还取决于工具集合、代码检查和环境权限。一个已加载的 Extension 本身就是同进程可执行代码，不能靠它的名字假定已被沙箱隔离。

如果你需要所有文件读取都限制在一个目录，应该在实际执行路径落实路径与符号链接处理，并用环境限制进一步约束；仅在 Skill 中写一句“别读外面”不是确定性实现。

## 十一、学习时做两种小实验

第一种研究工具契约：给 echo_note 合法参数、缺参数、空字符串，先预测 schema 和 execute 的结果，再检查实际调用记录。

第二种研究 Skill 发现：保持问题和工具不变，比较有目录、无目录、显式 /skill 三种输入。观察模型是否读正文、读了哪些附件、最终回答是否有证据。只检查“模型说用了 Skill”不够。

本节未进行这些实验，也不声称示例提高了回答质量。执行时把模型、输入、工具和 Skill 版本记下来，才有可比较的结果。

## 十二、面试可以怎样追问

从“如何给 Agent 增加能力”开始：你会新增工具还是写 Skill？函数在哪里注册？模型什么时候知道它？谁执行？参数错误在哪里拒绝？hook 是哪一阶段调用？Skill 正文什么时候进入输入？插件出错怎样处理？

把这条链说明白后，第 10 节就只是将其中一部分执行函数接到外部 MCP 服务。
