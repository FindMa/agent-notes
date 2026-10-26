# 第 11 节：Subagent 与 durable——委派、后台工作和恢复

前十节一直追普通 AgentSession。现在把一个任务交给另一个 Agent，先要确定：它收到哪些输入，在哪里执行，父任务是否等待，用户取消时谁停，进程重启后怎样找回工作。

当前仓库有不同实现。本节分别读普通子进程扩展示例、实验性 durable 前台子会话、durable 后台示例。它们不是普通核心默认同时启用的功能。`pi-durable` 明确标记为 Experimental，以下结论限定在提交 `eb326d2`；未运行示例或真实模型。

## 一、先判断什么任务值得委派

假设要研究登录模块：一项独立工作查 token 刷新实现，另一项查测试覆盖。如果两项都有明确入口和可核对的输出，独立上下文可以减少互相干扰，执行也可能重叠。

如果任务是“先取得 A 的结果，再据此决定 B 的输入”，拆成并行代理不一定有帮助；如果两个代理同时修改同一文件，还要额外处理冲突。

委派描述至少应包含：目标、入口或资料、允许动作、期望结果、未知信息和停止条件。子代理收到一句“继续上面的任务”，但没有父对话，就缺少必要输入。

先把任务契约写清，再决定是否需要多代理。并发数量和模型数量本身不是任务质量指标。

## 二、普通 subagent：工具函数启动另一个 PI 进程

打开 [runSingleAgent](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/examples/extensions/subagent/index.ts#L272-L425)。普通示例给子进程准备的参数包括：

```ts
const args = ["--mode", "json", "-p", "--no-session"];
```

随后补模型、思考等级、工具集合和系统提示等配置，再加入 `Task: ...` 文本，用 spawn 启动：

```ts
const proc = spawn(invocation.command, invocation.args, {
  cwd: cwd ?? defaultCwd,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
});
```

这里可以对应前面的三层通信：父 PI 把任务交给子进程；子 PI 自己调用模型；子 PI 通过 stdout JSONL 把消息交回父进程。

`shell:false` 表示这次 spawn 不先经过一层 shell 解析命令串，不表示子进程的工具从此不能运行 shell。`--no-session` 表示该调用使用的会话持久化方式受到限制，也不代表子进程没有其他文件或业务副作用。

## 三、子上下文独立，文件系统仍可能共享

普通示例给子代理传任务文本和选定配置，并没有自动复制父对话的全部 transcript。子代理必须从任务描述和自己能访问的资料开始。

与此同时，cwd 默认可能就是父工作目录。子进程在操作系统层面通常仍有启动用户的权限。独立消息历史、独立进程、独立工作目录、独立权限是不同概念。

```text
子代理 A：消息历史独立 ─┐
                      ├─ 可能都读写同一个项目目录
子代理 B：消息历史独立 ─┘
```

第五节的同进程文件修改队列，不能自动协调两个不同 PI 进程。若两个子代理需要写入，宿主还要安排文件所有权、独立 checkout 或合并流程。

## 四、single、parallel、chain 分别怎么执行

普通 [subagent 示例](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/examples/extensions/subagent/index.ts#L450-L713) 支持三种请求形式。

| 模式 | 行为 | 父工具何时拿到完整结果 |
|---|---|---|
| single | 执行一个子任务 | 子进程结束后 |
| parallel | 多个子任务在并发限制内运行 | 整批完成后 |
| chain | 按步骤执行，后项可引用前项输出 | 整条链完成后 |

当前 parallel 单次调用最多 8 个任务、4 个并发。这个上限属于该示例的一次调用，不能推广成“所有递归代理总共最多 4 个”。

chain 使用 `{previous}` 文本替换，将上一项最终输出写入下一项任务。它传的是选定文本，不是自动共享上一项的全部内存、事件和消息。

如果前一项摘要漏了关键条件，后一项不会因为名为 chain 就自动知道。要让交接可核对，应明确输出格式和证据位置。

## 五、父进程怎样收集子进程结果

父进程持续读 stdout，按换行组装记录，再 JSON.parse。它从 message_end 收集完成消息，累加模型用量，保留 stopReason、errorMessage 和 stderr，并通过 onUpdate 向父工具报告进展。

子进程 close 后，结果才完整返回。看到中途文本或工具进度，不能提前判定成功。

这个示例的取消处理向子进程发送信号。阅读 `proc.kill()` 时，要查它实际管理哪个 PID、有没有等待退出、有没有管理后代进程。不能仅凭发出 SIGTERM 就宣称整个进程树已停，或者文件改动已回滚。

这些都是普通进程包装需要面对的问题；业务执行状态仍要单独确认。

## 六、durable 为什么引入 Task 和 checkpoint

普通 JSONL 会话重建的是历史和模型上下文。进程在一次外部调用中间退出时，恢复程序还需要知道：哪项工作等待中，已经提交了什么，下一阶段在哪里。

[durable 文档](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/durable/README.md#L79-L120) 将 Task 定义为可保存 checkpoint 的状态机。任务按阶段执行，阶段提交保存状态，重启后由调度器继续处理。

可以用一个教学状态机理解：

```text
phase=prepare：准备输入
    ↓ 保存下一阶段
phase=execute：调用外部能力
    ↓ 保存结果
phase=report：报告结果
    ↓
terminal：完成或失败
```

它不等于把 JavaScript 栈、打开的 socket 和所有内存原样冻住。恢复从持久状态和阶段处理函数继续，外部动作是否可重复执行还要另外判断。

## 七、durable 前台 subagent 怎样避免重复创建

看 [实验性 Subagent 扩展](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/experimental/durable/subagent.ts#L19-L55)。每个工具调用对应一个 task，代码先在事务里按 `ownerTaskId` 查已有子会话：

```ts
const existing = (await tx.scanConversations(
  { ownerTaskId: api.taskId }, 1
)).items[0];
if (existing !== undefined) return existing.id;
```

找不到才创建。创建时复制父会话的 Agent 配置，并移除 Subagent 自身扩展，防止该子会话继续递归委派；父 transcript 不自动复制。

提交任务时用稳定 ID：

```ts
requestId: `subagent:${api.taskId}`
```

崩溃后同一个 task 重跑，可以找到之前的子会话，并用同一个 requestId 找回已有提交，减少重复投递。

随后 wait 子任务答案，读取最终文本返回父工具。它仍是前台等待：父工具没有拿到子任务答案前不会正常完成。子会话本身可以留存，之后仍可进入继续对话。

## 八、后台 subagent 为什么多了 Anchor 和 Reporter

前台方式适合“我需要它的答案才能继续”。后台方式希望父 Agent 先回答用户，子代理继续工作，完成后再回来报告。

[后台示例](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/durable/test/examples/23-subagent-background.ts#L38-L207) 增加了三类状态：

| 对象 | 保存什么或负责什么 |
|---|---|
| Subagents 文档 | 名称到子会话的对应关系、已报告答案、reporter task |
| Anchor task | 给子会话一个后台所有者，定义等待与取消的边界 |
| Reporter task | 向子会话投递任务，等答案，再报告给父会话 |

这里的 ownership 会影响 abort 和 idle 等待的范围。普通父会话取消和等待不会自动越过后台边界；宿主仍可用包含 background 的取消操作停止更大范围。

因此“父 Agent 已 idle”与“它启动的后台任务全部完成”不是同一个判断。

## 九、Reporter 的两个阶段怎样跨重启继续

Reporter 有两个 checkpoint：

```text
deliver：向子会话提交消息并等待回答
report：把选定回答作为 follow-up 提交给父会话
```

deliver 使用 `subagent:${reporter.id}` 作为请求 ID。拿到答案后，在一次提交里决定报告内容，并把答案 ID 记入已报告列表，然后保存 phase=report。

report 再用 `subagent-report:${reporter.id}` 向父会话提交 follow-up。这样恢复时可以再次执行阶段代码，但不会仅因重复提交就无条件新增同一条消息。

```text
父工具返回 Started
父模型继续回答，随后 idle
子会话继续工作
Reporter 等到答案
向父会话投递 follow-up
父会话再次活动，处理子任务结果
```

这个闭合过程需要持久任务和状态，单纯在内存里 `setTimeout` 一个回调不能替代。示例展示了设计和演示代码，本轮未运行其重启实验。

## 十、为什么 replay:safe 必须谨慎

[durable ToolTask](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/durable/src/harness/tool.ts#L45-L118) 在真实 execute 前保存调用意图和重放策略。崩溃恢复时检查：

```ts
if (savedReplay === "safe" && currentTool.replay === "safe") {
  // 允许重跑
} else {
  // 返回 interrupted，说明动作可能部分发生
}
```

必须保存时和当前实现都声明 safe，才允许恢复重跑；否则不盲目执行。这能避免部署后策略变化使旧调用被随意重放。

“safe” 是工具作者的契约声明，不能让任意外部写入自动变幂等。例如再次读取文件通常可接受，但再次执行“停止子代理”可能误停它后来开始的新任务。后台示例因此把管理工具声明为 unsafe。

稳定 requestId 能帮助提交去重，但不保证任意 HTTP 请求只执行一次。若支付服务不支持同一业务 ID 去重，durable checkpoint 也无法消除“支付成功、结果保存前进程退出”的窗口。

## 十一、普通 core 和 durable 的 hook 契约也要分别看

第 04、09 节讲到普通 core 在 beforeToolCall 后不会自动复验被原地修改的 args。而当前 durable ToolTask 在 beforeTool hooks 结束后又调用了一次 validate，再保存最终参数并执行。

见 [durable 参数复验](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/durable/src/harness/tool.ts#L62-L91)。这不是前文矛盾，而是两个实现的接口约束不同。解释源码时，应说明正在谈普通 Agent Loop 还是实验性 durable Harness。

## 十二、三条路径对照

| 问题 | 普通子进程示例 | durable 前台 | durable 后台示例 |
|---|---|---|---|
| 子任务形式 | 另一个 PI 进程 | task-owned conversation | 后台所有权下的 conversation |
| 父工具是否等待答案 | 是 | 是 | 启动/投递后先返回 |
| 父 transcript 自动复制 | 否 | 否 | 否 |
| 结果回来方式 | JSONL 收集后返回 | wait 后读答案 | Reporter follow-up |
| 重启恢复 | 不能仅凭该进程包装保证 | task/checkpoint/requestId 参与 | 同时恢复后台状态和报告阶段 |
| 工作区自动安全隔离 | 未提供这种保证 | 取决于执行环境 | 取决于执行环境 |

## 十三、四个纸面故障练习

1. 子会话已创建，父任务保存返回前退出。恢复如何找回同一个子会话？沿 ownerTaskId 查询解释。
2. 子任务消息已提交，但 wait 尚未返回。恢复如何避免再提交一份？解释稳定 requestId。
3. 答案已经选好，向父会话报告前退出。恢复从哪个 phase 继续，怎样避免重复报告？解释 checkpoint 和报告请求 ID。
4. 外部动作成功，但工具结果尚未持久化。为什么仍不能承诺业务 exactly-once？指出外部执行端的责任。

若以后真正比较多代理效果，要固定任务、模型和预算，计入重复检索、子代理用量、父代理汇总损失与等待时间。任务成功率没有改善时，并发更多也可能只是更贵。

第 12 节将这些机制放进安全边界、评测和服务验收里。
