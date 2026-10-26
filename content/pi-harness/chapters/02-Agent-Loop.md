# 第 02 节：Agent Loop——工具执行后，为什么还要请求模型？

第一节我们认识了各个对象。这一节要把它们连接成真正的执行过程。

**核心结论：**

> Pi 不会只请求模型一次，然后结束。它会把模型提出的工具调用执行掉，将结果加入上下文，再请求模型，让模型根据新信息决定下一步。

这一节先学透整体闭环。工具内部如何校验、流式片段如何解析、并行如何调度，后面的章节再展开。

源码已核对，仍是之前的提交 `eb326d2`；本次没有修改代码，也没有运行模型。

---

## 一、先用加法例子理解循环

假设用户提出：

```text
请用 add 工具计算 2 + 3，并告诉我结果。
```

模型第一次收到问题时，并不知道工具实际执行后的结果。它先生成：

```json
{
  "type": "toolCall",
  "id": "call_1",
  "name": "add",
  "arguments": {
    "a": 2,
    "b": 3
  }
}
```

Pi 的程序看到这个结构后：

1. 找到 `add` 工具；
2. 校验参数；
3. 执行 `add(2, 3)`；
4. 得到结果 `5`；
5. 把结果加入对话；
6. 再请求模型。

第二次模型收到的不是原来的问题，而是：

```text
用户：计算 2 + 3。
assistant：调用 add，参数是 2 和 3。
toolResult：结果是 5。
```

模型再生成：

```text
结果是 5。
```

因此：

```text
第一次模型请求
    ↓
assistant 提出工具调用
    ↓
程序执行工具
    ↓
工具结果进入上下文
    ↓
第二次模型请求
    ↓
assistant 给出答案
```

**工具执行结束，只意味着获得了新信息，不意味着整个任务已经结束。**

复杂任务可能需要继续：

```text
读配置 → 找实现 → 读代码 → 修改 → 执行测试 → 根据错误再次修改
```

每次工具结果都可能改变模型的下一步选择。这就是循环的意义。

---

## 二、先认清三个函数的关系

这一节主要读：

- [agent.ts:370–556](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L370-L556)
- [agent-loop.ts:102–321](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L102-L321)
- [StreamFn 契约](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/types.ts#L19-L37)

完整调用关系是：

```text
用户调用 AgentSession.prompt()
    ↓
产品层预处理
    ↓
Agent.prompt()
    ↓
normalizePromptInput()
    ↓
runPromptMessages()
    ↓
runWithLifecycle()
    ↓
runAgentLoop()
    ↓
runLoop()
    ↓
streamAssistantResponse()
    ↓
注入的 StreamFn
    ↓
模型接入层
```

不要被相似名称绕晕：

| 函数／对象 | 职责 |
|---|---|
| `AgentSession.prompt()` | 产品层提交问题，处理会话和扩展策略 |
| `Agent.prompt()` | 核心执行入口，检查运行状态、整理输入 |
| `runAgentLoop()` | 加入本次输入、建立循环上下文、发出开始事件 |
| `runLoop()` | 真正反复请求模型、执行工具、决定继续或结束 |
| `streamAssistantResponse()` | 完成一次模型响应的消费和消息更新 |

**不是每个函数都在请求模型。** 很多函数是在准备状态、传递配置、管理生命周期。

---

## 三、第一步：`Agent.prompt()` 整理输入，并禁止同一个 Agent 同时运行

打开：

[agent.ts:370–430](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L370-L430)

核心代码：

```ts
async prompt(input, images) {
    if (this.activeRun) {
        throw new Error("Agent is already processing...");
    }

    const messages = this.normalizePromptInput(input, images);
    await this.runPromptMessages(messages);
}
```

### 1. 为什么检查 `activeRun`？

假设同一个 Agent 正在处理：

```text
任务 A：读取配置并修改代码。
```

这时另一个调用直接提交：

```text
任务 B：切换模型并分析另一个文件。
```

如果两次运行都直接修改同一份消息和状态，就可能出现：

- 两个模型响应交错；
- 工具结果插错位置；
- 当前流式消息被覆盖；
- 取消信号不知道对应哪个运行；
- 会话状态和 UI 显示不一致。

所以 Pi 对**同一个 Agent 实例**限制一个活跃运行。

这不表示整个程序只能执行一个 Agent，也不表示一轮只能执行一个工具。它限制的是：

> 同一个有状态 Agent，不允许两个独立运行同时驱动它。

运行中要追加目标，使用 `steer()` 或 `followUp()` 排队，而不是直接再次 `prompt()`。

### 2. 为什么把输入统一成 `AgentMessage[]`？

`prompt()` 可以接收字符串、单条消息或消息数组。

字符串会变成：

```ts
{
    role: "user",
    content: [
        { type: "text", text: input }
    ],
    timestamp: Date.now()
}
```

然后装进数组。

这样后面的循环只处理一种输入形式：

```ts
AgentMessage[]
```

不需要在每个阶段重复判断：

```text
这是字符串吗？
这是一个对象吗？
这是数组吗？
```

**设计收益：在入口统一数据，让核心循环保持简单。**

---

## 四、第二步：建立一次运行的生命周期

接下来是：

[agent.ts:432–445](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L432-L445)

```ts
await this.runWithLifecycle(async (signal) => {
    await runAgentLoop(
        messages,
        this.createContextSnapshot(),
        this.createLoopConfig(options),
        (event) => this.processEvents(event),
        signal,
        this.streamFunction,
    );
});
```

这里传给循环的六项数据值得逐个理解。

| 参数 | 是什么 | 为什么要传 |
|---|---|---|
| `messages` | 本次新输入 | 与之前已有历史区分 |
| `contextSnapshot` | 当前历史与可执行工具 | 循环需要知道已有信息和能做什么 |
| `loopConfig` | 模型、转换器、hooks、队列读取函数等 | 决定运行策略 |
| `event => processEvents(event)` | 事件接收函数 | 将循环过程更新为 Agent 状态，并通知监听器 |
| `signal` | 本次运行的取消信号 | 模型、工具、hooks 可以配合取消 |
| `streamFunction` | 模型调用能力 | 避免循环直接绑定某家 API |

### `runWithLifecycle()` 管什么？

[agent.ts:507–556](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L507-L556)

它大致做：

```text
创建 AbortController
    ↓
登记 activeRun
    ↓
isStreaming = true
    ↓
执行循环
    ↓
异常时生成失败消息
    ↓
finally 清理本次运行状态
```

注意，`isStreaming` 在这里覆盖整个核心运行，包括工具执行和等待监听器，不只是“模型正在吐 token”。

### 为什么还需要一个运行 Promise？

它让 `waitForIdle()` 等到当前运行和被等待的监听器结束。

因此：

```text
发出 agent_end
    ↓
等待 agent_end 的异步监听器
    ↓
finishRun()
    ↓
Agent 成为 idle
```

**“结束事件已发出”与“运行完全空闲”是两个时点。**

### `finally` 会不会删掉历史？

不会。

`finishRun()` 清理：

- `isStreaming`；
- 当前流式消息；
- pending tool call 状态；
- activeRun。

它不会把本次对话全部删除。历史要保留给下一个用户问题使用。

---

## 五、第三步：建立循环中的上下文

打开：

[agent-loop.ts:102–126](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L102-L126)

```ts
const initialMessages = declareToolChanges(context, prompts);

const newMessages = [...initialMessages];

const currentContext = {
    ...context,
    messages: [...context.messages, ...initialMessages],
};
```

这里区分了两份列表。

### 1. `currentContext.messages`

表示：

> 这个循环目前拥有的完整上下文。

它包含旧历史和本次新增内容：

```text
旧历史
＋
本次用户输入
＋
本次 assistant
＋
本次工具结果
```

它主要供后续模型请求使用。

### 2. `newMessages`

表示：

> 本次循环新产生或加入了哪些消息。

例如：

```text
本次用户输入
assistant/toolCall
toolResult
assistant/最终回答
```

它不需要重复包含所有旧历史。

### 为什么要分开？

两种用途不同：

- 请求模型，需要已有历史；
- 返回本次运行记录，需要知道新增部分。

否则你每运行一次，都可能把全部旧历史当作本次结果重复处理。

### `declareToolChanges()` 是干什么的？

它把当前可执行工具与 transcript 中已声明的工具对照，必要时加入 system 工具声明变化。

因此本次初始消息不一定只有 user，也可能有 system 更新。

第一节说过：

```text
工具函数：程序实际能执行的东西。
工具声明：模型被告知可以调用的东西。
```

这里负责保持两者的声明关系一致。实现见：

[agent-loop.ts:323–362](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L323-L362)

---

## 六、第四步：进入真正的 `runLoop()`

打开：

[agent-loop.ts:163–321](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L163-L321)

先看这几个变量：

```ts
let currentContext = initialContext;
let config = initialConfig;
let lastCompletedTurn;
let explicitContinuation = false;
let pendingMessages = await getSteeringMessages();
```

| 变量 | 可以怎样理解 |
|---|---|
| `currentContext` | 当前请求所依据的消息与工具 |
| `config` | 当前模型和运行策略 |
| `lastCompletedTurn` | 上一轮 assistant 和工具结果 |
| `pendingMessages` | 下一请求前准备加入的消息 |
| `explicitContinuation` | hook 明确要求至少再请求一次 |

前两项为什么用 `let`？

因为下一轮准备过程可以替换上下文、模型或思考配置。例如产品层压缩了历史，需要用新的上下文继续。

**循环不是拿着永远不变的一份输入反复请求。**

---

## 七、为什么有两层 `while`？

核心结构：

```ts
while (true) {
    let hasMoreToolCalls = true;

    while (hasMoreToolCalls || pendingMessages.length > 0) {
        // 准备请求
        // 请求模型
        // 执行工具
        // 更新上下文
        // 判断下一轮
    }

    // 原本准备结束，检查 follow-up
    // 检查显式 continuation
    // 都没有则结束
}
```

### 1. 内层：持续工作阶段

处理：

```text
模型请求 → 工具结果 → 下一请求
```

以及工作过程中排入的 steering。

例如：

```text
第一次：请求 read
第二次：请求 find
第三次：请求 read
第四次：输出答案
```

可以一直在同一个内层工作阶段推进。

### 2. 外层：自然停点后的追加工作

当没有工具续轮、没有 steering，Agent 原本要停了。

但可能还有 follow-up：

```text
完成后再解释一下设计取舍。
```

外层检查它，然后重新进入内层。

### 3. `hasMoreToolCalls = true` 为什么一开始就成立？

此时还没请求模型，怎么知道有工具调用？

实际上，它在这里还承担了一个作用：

> 保证进入工作循环，至少完成这次应当发生的模型请求。

随后才根据实际响应更新它。

因此不要把变量名机械解释成：

```text
当前模型肯定还有工具调用。
```

在后面的调度阶段，它更接近“工具批次是否要求自然续轮”的标记。

---

## 八、一次请求前，为什么有两个准备接口？

代码位于：

[agent-loop.ts:183–239](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L183-L239)

### 1. `prepareNextTurn`

只有已经完成上一轮、准备进入下一轮时才调用。

它拿到上一轮的：

- assistant；
- toolResults；
- currentContext；
- 本次新增消息。

它可以：

- 替换上下文；
- 加入下一轮消息；
- 更新模型；
- 更新思考级别。

产品层可以在这里做压缩或刷新配置。

### 2. `prepareRequest`

每次模型请求前调用，包括第一次。

此时待加入的消息已经追加。

它可以重新确定：

- 本次请求上下文；
- 本次模型；
- 思考配置。

接口契约见：

[types.ts:160–189](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/types.ts#L160-L189)

### 为什么不直接把压缩代码写死在 loop？

通用循环需要一种“请求前刷新”的能力，但不一定知道：

- 历史存在哪；
- 产品怎样摘要；
- 是否使用虚拟模型路由；
- 是否有自定义上下文策略。

所以提供接口，由上层注入策略。

**设计思想：循环负责正确的调用时点，产品层负责具体策略。**

---

## 九、一次模型请求到底在哪里发生？

在 Agent Loop 中，一次模型响应从这里开始处理：

```ts
const message = await streamAssistantResponse(
    currentContext,
    config,
    signal,
    emit,
    streamFunction,
);
```

见 [agent-loop.ts:241–243](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L241-L243)。

函数内部执行：

```text
应用级消息
    ↓ transformContext
转换后的应用消息
    ↓ convertToLlm
模型支持的 Message
    ↓ normalizeContext
规范化 transcript
    ↓ StreamFn
统一模型响应流
    ↓
完整 AssistantMessage
```

函数内部把请求交给注入的 StreamFn；真正的网络调用还会继续进入 ModelRuntime、Provider 和协议适配器：

[agent-loop.ts:388–407](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L388-L407)

```ts
const response = await streamFunction(config.model, llmContext, {
    ...config,
    apiKey: resolvedApiKey,
    signal,
});
```

这里的第一个 `await` 取得响应流对象，完整消息还要通过后续事件消费和 `response.result()` 获得。外层 `await streamAssistantResponse()` 等的是这次响应处理完。

`normalizeContext` 在当前路径收到的是 `{ messages }`。system 和工具声明已在消息里，因此这里主要统一上下文类型；它不自动压缩、清洗或验证整份历史。只有传入独立 systemPrompt/tools 字段时，才将它们折入开头的 system 消息。见 [transcript.ts](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/ai/src/utils/transcript.ts#L25-L34)。

### 为什么注入 `StreamFn`？

把“怎样调用模型”与“怎样调度 Agent”分离。

真实环境：

```text
StreamFn → ModelRuntime → Provider → 网络请求
```

离线测试：

```text
StreamFn → 返回预设的内存消息流
```

这样可以稳定安排：

```text
第一次一定返回 add 调用。
第二次一定返回最终文本。
```

你测试的仍是真实 loop，但模型行为可控。

不过：

> 假模型测试证明调度规则，不证明真实模型理解任务或选择工具的能力。

---

## 十、完整 assistant 如何进入上下文？

这里很容易读错。

`runLoop()` 调用后只做：

```ts
newMessages.push(message);
```

那 assistant 什么时候进入 `currentContext.messages`？

**已经在 `streamAssistantResponse()` 内部加入了。**

见：

[agent-loop.ts:414–468](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L414-L468)

流程大致是：

```text
start：先加入正在生成的 assistant
    ↓
updates：替换当前累计 assistant
    ↓
done/error：换成最终 AssistantMessage
```

因此回到 `runLoop()` 后，不必再向当前上下文追加一次 assistant。

两份列表的用途仍不同：

```text
currentContext.messages：供本循环的下一请求使用。
newMessages：记录本次新增消息。
```

同时 `message_end` 事件会让 `Agent.processEvents()` 把最终消息加入公开 state：

[agent.ts:565–578](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L565-L578)

**循环上下文和 Agent 公开状态，是通过不同路径更新的。** 它们不是向同一个数组重复插入三次。

这里的数组复制是浅拷贝，也不要将其理解为完全不可变、完全隔离的快照。

---

## 十一、模型响应之后，循环做什么？

### 1. 先检查硬错误

```ts
if (
    message.stopReason === "error" ||
    message.stopReason === "aborted"
) {
    // 完成本轮事件，结束 core run
    return;
}
```

见 [agent-loop.ts:245–256](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L245-L256)。

这条路径不继续执行响应里的工具调用。会话层之后是否重试，是外层策略。

### 2. 从内容中找 toolCall

```ts
const toolCalls = message.content.filter(
    c => c.type === "toolCall"
);
```

Pi 不是检查模型文字里有没有“调用工具”四个字，而是检查结构化内容块。

因此：

```text
文本：“我准备调用 add。”
```

与：

```json
{"type": "toolCall", "name": "add", "...": "..."}
```

不是一回事。

### 3. 执行工具，得到结果

正常调用走 `executeToolCalls()`。

若响应以 `length` 截断，则这些调用不执行，改为错误工具结果，避免残缺参数造成副作用。

这里先理解控制流程；执行管线在第 04 步深入。

### 4. 把结果加入上下文

```ts
for (const result of toolResults) {
    currentContext.messages.push(result);
    newMessages.push(result);
}
```

见 [agent-loop.ts:258–277](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L258-L277)。

到这一步，上下文是：

```text
system
user
assistant/toolCall
toolResult
```

这就是第二次模型请求的新依据。

---

## 十二、为什么工具结束后，内层循环还会再执行一次？

执行工具后：

```ts
hasMoreToolCalls = !executedToolBatch.terminate;
```

正常工具批次没有请求终止时，这个值是 `true`。

于是：

```ts
while (hasMoreToolCalls || pendingMessages.length > 0)
```

再次成立，进入下一轮请求。

**不是第二次调用 `agent.prompt()`，也不是工具主动调用模型。**

普通工具续轮仍在第一次 `Agent.prompt()` 启动的同一个 core run 里面。

### 两轮变量变化

假设没有额外队列或 hooks：

| 时点 | 模型响应 | 工具是否执行 | 续轮标记 |
|---|---|---:|---|
| 请求 1 前 | 尚无 | 否 | 初始 true，保证开始 |
| 请求 1 后 | `add(2,3)` | 是 | 正常批次 → true |
| 请求 2 后 | 文本“5” | 否 | 没有 toolCall → false |
| 自然停点 | 无待处理消息 | 否 | 结束 |

对第二轮来说，模型可以继续请求工具，而不一定输出最终答案。循环根据**新响应**判断，不提前假设任务结束。

---

## 十三、`finishTurn()`、队列与正常结束

工具结果加入后：

```ts
const decision = await config.finishTurn?.(lastCompletedTurn, signal);
await emit({ type: "turn_end", message, toolResults });
```

然后：

- `end`：结束本次 run；
- `continue`：要求至少有下一次模型请求；
- 不返回决定：保持正常调度。

之后检查 steering；当原本要停止时再检查 follow-up。

见：

[agent-loop.ts:280–321](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L280-L321)

### 一个重要细节

`finishTurn()` 要求 continue，而工具结果本来就会引发下一请求时，**不会额外再叠加一次请求**。

它表示“确保发生下一请求”，不是“无论如何多加一次”。

### 自然停止是什么？

大致是：

```text
没有工具自然续轮
没有 steering
没有 follow-up
没有显式 continuation
```

于是发出 `agent_end`。

但这不是业务验收：

```text
模型没有再调用工具
≠
代码已经正确
≠
测试已经通过
≠
用户目标已经满足
```

当前普通 core loop 也没有通用的内置 max-step 上限。持续工具调用或持续 continuation 可以继续推进。

---

## 十四、`Agent.continue()` 与内部续轮有什么区别？

这是第二节必须分清的点。

### 内部续轮

```text
请求模型 → 工具执行 → 请求模型
```

发生在同一个 `runLoop()` 中，不调用公开的 `Agent.continue()`。

### `Agent.continue()`

是在一个 core run 已结束后，利用已有上下文或队列启动新的 core run。

见：

[agent.ts:383–458](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L383-L458)

它不是无条件“让模型接着说”：

- 当前仍在运行：拒绝；
- 没有可继续消息：拒绝；
- 最后一条是 assistant 且没有排队输入：拒绝；
- 有排队输入：可以转为新的 prompt run；
- 合适的已有上下文：走 `runAgentLoopContinue()`。

产品层做错误恢复或处理新队列时，可能使用这个 API。

---

## 十五、`await agent.prompt()` 为什么不直接返回答案？

`Agent.prompt()` 返回的是：

```ts
Promise<void>
```

它代表这次运行操作结束，不直接返回最终文本。

你通常通过：

- 订阅事件获取过程；
- 读取 `agent.state.messages` 获取当前消息；
- 查看错误状态和最终消息了解结果。

低层 `runAgentLoop()` 返回本次新增消息，但 `Agent` 主要通过事件来更新自身状态。

还要注意：一些执行异常会被 `Agent` 转成失败 assistant 消息，然后正常收尾。因此：

```text
await prompt() 没抛错
```

**不能直接推出模型或业务成功。**

互斥检查等路径仍然可以抛错，不能反过来说 prompt 永远不会 reject。

---

## 十六、这一节按什么顺序读源码？

建议分四遍，不要第一次读所有工具内部代码。

### 第一遍：只画调用链

[agent.ts:370–445](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L370-L445)

找：

```text
prompt
→ normalizePromptInput
→ runPromptMessages
→ runWithLifecycle
→ runAgentLoop
```

### 第二遍：看运行状态

[agent.ts:460–556](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L460-L556)

找：

```text
contextSnapshot
loopConfig
AbortController
activeRun
isStreaming
finally
```

### 第三遍：看两轮如何推进

[agent-loop.ts:102–321](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L102-L321)

重点标：

- 初始输入在哪加入；
- 一次模型请求在哪发生；
- toolCall 在哪检测；
- toolResult 在哪回灌；
- 下一轮条件怎样成立；
- 退出条件在哪。

### 第四遍：核对模型边界与状态更新

- [streamAssistantResponse](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent-loop.ts#L381-L469)
- [processEvents](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/agent.ts#L565-L612)
- [StreamFn 类型](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/agent/src/types.ts#L19-L37)

回答：assistant 为什么不会漏进上下文，也不会被同一个数组重复加入？

---

## 十七、闭卷验收：先自己回答这六题

1. **`hasMoreToolCalls` 初始为 true，是否证明模型一定调用工具？**  
   不证明，它先保证开始一次请求，之后再根据实际结果更新。

2. **工具续轮需要调用 `Agent.continue()` 吗？**  
   不需要，仍在当前 `runLoop()` 中。

3. **为什么同时有 currentContext 和 newMessages？**  
   前者用于下一请求的完整上下文，后者记录本次新增内容。

4. **为什么模型错误、工具错误不是同一种退出方式？**  
   最终模型 error/aborted 结束 core run；普通工具错误通常作为反馈送回模型。

5. **为什么有 prepareNextTurn 和 prepareRequest？**  
   前者根据上一轮准备下一 turn，后者在每次请求前确定请求状态，包括首次。

6. **`agent_end`、idle、业务成功是否相同？**  
   不同。结束事件后还需等监听器收尾；业务成功需要独立证据。

### 面试时可以这样概括

> Pi 的 Agent 管理运行互斥、状态、取消和事件，runLoop 管理一次运行中的多轮调度。模型响应通过注入的 StreamFn 获得；结构化 toolCall 由宿主执行，结果按调用 ID 配对并加入上下文，再请求模型。内层处理工具和 steering，外层处理自然停点后的 follow-up。自然停止只是没有选出下一请求，不等于业务验收成功。

**如果你能不看资料讲清加法例子的两轮过程，并在源码中指出“请求、执行、回灌、续轮、退出”五个位置，就完成了第 02 节的核心学习。**
