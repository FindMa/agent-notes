import fs from 'node:fs';
import path from 'node:path';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const node=(id,name,sub,x,y,w,h,section,extra={})=>({id,name,sub,x,y,w,h,section,...extra});
const edge=(from,to,points,label,x,y,w,extra={})=>({from,to,points,...(label?{label:{text:label,x,y,w,h:20}}:{}),...extra});

export const chapterDiagrams=[
  {chapter:1,type:'architecture',title:'先把对象与职责分清',desc:'调用方经 SDK 创建会话，Agent 推进循环，模型提供响应，工具产生真实效果，历史负责保存记录。',caption:'模型生成动作意图，宿主工具执行动作；会话、运行状态、消息与磁盘环境分别管理。',nodes:[
    node('caller','调用方','创建、订阅、提交问题',40,96,224,88,4,{tag:'INPUT'}),
    node('session','AgentSession','资源、历史与会话策略',368,96,224,88,5,{tag:'SESSION',focal:true}),
    node('agent','Agent / runLoop','运行状态、工具与续轮',696,96,224,88,3,{tag:'CORE'}),
    node('history','SessionManager','保存历史，重建上下文',40,328,224,96,2,{tag:'STATE',store:true}),
    node('tools','宿主工具','读取文件或调用外部服务',368,328,224,96,2,{tag:'TOOLS'}),
    node('model','模型接入','Provider / API adapter',696,328,224,96,6,{tag:'MODEL'}),
  ],edges:[
    edge('caller','session',[[264,140],[368,140]],'创建会话',280,112,72),
    edge('session','agent',[[592,140],[696,140]],'交给循环',608,112,72),
    edge('agent','model',[[768,184],[768,328]],'请求',776,220,48),
    edge('model','agent',[[848,328],[848,184]],'响应',856,268,48,{dashed:true}),
    edge('agent','tools',[[696,164],[648,164],[648,376],[592,376]],'调用工具',656,244,64),
    edge('session','history',[[440,184],[440,256],[152,256],[152,328]],'保存与重建',264,228,88),
  ],notes:['SDK 的初始化完成后，prompt 才启动实际工作。'],sources:[['packages/coding-agent/src/core/sdk.ts',411],['packages/agent/src/agent.ts',370]]},
  {chapter:2,type:'sequence',title:'一个工具闭环，两次模型请求',desc:'一次 prompt 驱动模型先提出工具调用，宿主执行并回填结果，模型第二次请求才根据反馈回答。',caption:'这条代表轨迹没有排队消息或重试：2 次模型请求、1 次工具执行、2 个 turn、1 个 core run。',actors:[
    {id:'caller',name:'调用方',sub:'prompt()',x:100,section:3},
    {id:'loop',name:'PI 循环',sub:'Agent / runLoop',x:340,section:6,focal:true},
    {id:'model',name:'模型接入',sub:'StreamFn',x:580,section:9},
    {id:'tool',name:'宿主工具',sub:'execute()',x:820,section:11},
  ],messages:[
    {from:'caller',to:'loop',y:152,label:'PROMPT',section:3},
    {from:'loop',to:'model',y:200,label:'REQUEST 1',section:9},
    {from:'model',to:'loop',y:248,label:'TOOL CALL',section:11,return:true},
    {from:'loop',to:'tool',y:296,label:'EXECUTE',labelX:700,section:11},
    {from:'tool',to:'loop',y:344,label:'TOOL RESULT',labelX:700,section:11,return:true},
    {from:'loop',to:'model',y:392,label:'REQUEST 2',section:12},
    {from:'model',to:'loop',y:440,label:'ANSWER',section:10,return:true,focal:true},
    {from:'loop',to:'caller',y:488,label:'RESULT',section:15,return:true},
  ],notes:['工具函数不负责再次请求模型；续轮由 runLoop 决定。'],sources:[['packages/agent/src/agent-loop.ts',163],['packages/agent/src/agent-loop.ts',242]]},
  {chapter:3,type:'architecture',title:'网络片段怎样变成消息与事件',desc:'厂商响应经过适配器和进程内 EventStream，循环得到完整消息，显示层接收事件并可输出 JSONL。',caption:'过程事件用于增量显示，最终消息用于后续判断。toolcall_delta 与 toolcall_end 都不表示工具已经执行。',nodes:[
    node('api','模型服务响应','厂商 chunk / 结束原因',40,100,224,88,5,{tag:'NETWORK'}),
    node('adapter','协议适配器','保留文本、工具参数与用量',368,100,224,88,7,{tag:'ADAPTER'}),
    node('stream','EventStream','内存事件队列 + result()',696,100,224,88,12,{tag:'IN PROCESS',focal:true}),
    node('jsonl','UI / JSONL 输出','序列化运行事件，跨进程交付',40,344,224,96,16,{tag:'OUTPUT'}),
    node('translate','流事件转换','streamAssistantResponse',368,344,224,96,14,{tag:'LOOP'}),
    node('final','完整模型消息','AssistantMessage / stopReason',696,344,224,96,15,{tag:'FINAL'}),
  ],edges:[
    edge('api','adapter',[[264,144],[368,144]],'解析',280,116,72),
    edge('adapter','stream',[[592,144],[696,144]],'PUSH',608,116,72),
    edge('stream','translate',[[808,188],[808,264],[480,264],[480,344]],'异步消费',600,236,80),
    edge('translate','final',[[592,392],[696,392]],'最终值',608,364,72),
    edge('translate','jsonl',[[368,392],[264,392]],'过程事件',280,364,72,{dashed:true}),
  ],notes:['本例的 EventStream 在进程内；JSONL 是对外记录格式。'],sources:[['packages/agent/src/agent-loop.ts',381],['packages/ai/src/utils/event-stream.ts',26]]},
  {chapter:4,type:'flowchart',title:'工具准入与结果处理的先后顺序',desc:'模型调用先经过参数准备和准入检查，拒绝分支跳过执行；已执行的异常结果仍进入后处理，再形成工具结果。',caption:'准备失败或 before block 会跳过 execute 和 after；execute 抛错则先转换成错误结果，再运行已配置的 after。',nodes:[
    node('intent','完整 toolCall','模型提出调用意图',368,40,224,56,1,{shape:'terminal'}),
    node('prepare','准备与 schema 校验','查工具、整理和验证参数',368,136,224,72,3),
    node('gate','准入通过？','beforeToolCall',384,248,192,80,6,{shape:'diamond',focal:true}),
    node('execute','execute','真实动作；异常转为结果',368,368,224,72,7),
    node('after','afterToolCall','处理已执行的结果',696,368,224,72,9),
    node('rejected','拒绝结果','未执行，也不进入 after',40,368,224,72,8),
    node('result','ToolResult','按调用 ID 回填',368,472,224,56,10,{shape:'terminal'}),
  ],edges:[
    edge('intent','prepare',[[480,96],[480,136]]),
    edge('prepare','gate',[[480,208],[480,248]]),
    edge('gate','execute',[[480,328],[480,368]],'是',488,336,28),
    edge('gate','rejected',[[384,288],[152,288],[152,368]],'否',240,260,32),
    edge('prepare','rejected',[[368,172],[80,172],[80,368]],'准备失败',88,220,96),
    edge('execute','after',[[592,404],[696,404]],'执行结果',608,376,72),
    edge('after','result',[[808,440],[808,500],[592,500]]),
    edge('rejected','result',[[152,440],[152,500],[368,500]]),
  ],notes:['schema 管结构；授权与业务条件仍需要可信代码检查。'],sources:[['packages/agent/src/agent-loop.ts',708],['packages/agent/src/agent-loop.ts',821]]},
  {chapter:5,type:'state',title:'core run 结束后，会话还可能继续',desc:'运行中的 core run 结束后交给 AgentSession 后处理，存在恢复或后续工作时再启动 core run，否则发出 agent_settled。',caption:'图展示两个结束层次。工具续轮和排队消息在运行中处理；agent_end 后还要检查外层重试、恢复和收尾扩展。',nodes:[
    node('running','core run 运行中','模型、工具、steering / follow-up',40,152,240,104,6,{shape:'state'}),
    node('ended','core run 已结束','agent_end',360,152,224,104,10,{shape:'state'}),
    node('post','会话后处理','重试、压缩恢复、收尾检查',696,152,224,104,10,{shape:'state',focal:true}),
    node('settled','本次活动收尾','agent_settled',696,400,224,96,10,{shape:'state'}),
  ],edges:[
    edge('running','ended',[[280,204],[360,204]],'退出',288,176,64),
    edge('ended','post',[[584,204],[696,204]],'检查',608,176,64),
    edge('post','settled',[[808,256],[808,400]],'无后续工作',816,312,96),
    edge('post','running',[[768,152],[768,92],[160,92],[160,152]],'恢复或继续',384,64,104,{dashed:true}),
    edge('running','running',[[112,256],[112,348],[224,348],[224,256]],'内部续轮',120,320,96,{dashed:true}),
  ],notes:['abort 发取消通知；收尾、回滚和业务验收分别判断。'],sources:[['packages/agent/src/agent-loop.ts',286],['packages/coding-agent/src/core/agent-session.ts',1821]]},
  {chapter:6,type:'flowchart',title:'先预测，再用可控实验核对',desc:'学习者先写预期，使用假模型驱动真实调度，记录事件和效果，再对照断言；不符合时回查实现并只改变一个条件。',caption:'假 StreamFn 固定模型行为，真实运行的是 harness 调度。最终文字正确，不能替代工具次数、调用 ID 和真实效果的检查。',nodes:[
    node('predict','写下预测','次数、顺序、输入与状态',368,40,224,64,1,{shape:'terminal'}),
    node('fixture','构造可控输入','假模型、工具、手动闸门',368,144,224,80,2),
    node('run','运行真实调度','收集事件与实际效果',368,264,224,80,4,{focal:true}),
    node('compare','符合预期？','断言与真实效果',384,384,192,80,10,{shape:'diamond'}),
    node('explain','解释控制位置','能指出函数和失败边界',696,384,224,80,11),
    node('review','回查实现','改一个条件，再预测',40,384,224,80,10),
  ],edges:[
    edge('predict','fixture',[[480,104],[480,144]]),
    edge('fixture','run',[[480,224],[480,264]]),
    edge('run','compare',[[480,344],[480,384]]),
    edge('compare','explain',[[576,424],[696,424]],'符合',608,396,64),
    edge('compare','review',[[384,424],[264,424]],'不符合',296,396,64),
    edge('review','fixture',[[152,384],[152,184],[368,184]],'重新预测',160,264,96,{dashed:true}),
  ],notes:['这里的“通过”只针对所测机制，不能证明真实模型能力。'],sources:[['packages/agent/test/agent-loop.test.ts',668],['packages/agent/test/agent-loop.test.ts',456]]},
  {chapter:7,type:'tree',title:'同一份 raw 历史，可以投影出不同上下文',desc:'共享历史分出旁支和当前分支，当前分支追加上下文编辑隐藏 A6，raw 记录仍全部保留。',caption:'为控制图的深度，将 S0 → U1 → A2 合并为共享历史。旁支仍保存在 raw；E7 只改变当前分支的模型可见内容。',nodes:[
    node('shared','共享历史至 A2','S0 → U1 → A2',392,72,176,64,3,{compact:true}),
    node('u3','U3','旁支用户输入',120,216,176,56,4,{compact:true}),
    node('a4','A4','旁支模型响应',120,320,176,56,4,{compact:true}),
    node('u5','U5','当前分支输入',664,216,176,56,4,{compact:true}),
    node('a6','A6','原始响应仍被保存',664,320,176,56,5,{compact:true,store:true}),
    node('edit','E7：隐藏 A6','context_edit(null)',664,424,176,56,5,{compact:true,focal:true}),
  ],edges:[
    edge('shared','u3',[[448,136],[448,176],[208,176],[208,216]],null,0,0,0,{dashed:true}),
    edge('u3','a4',[[208,272],[208,320]],null,0,0,0,{dashed:true}),
    edge('shared','u5',[[512,136],[512,176],[752,176],[752,216]]),
    edge('u5','a6',[[752,272],[752,320]]),
    edge('a6','edit',[[752,376],[752,424]]),
  ],notes:['当前 branch：S0 / U1 / A2 / U5 / A6 / E7','模型 projection：S0 / U1 / A2 / U5；A6 被隐藏，未被删除。'],sources:[['packages/coding-agent/src/core/session-manager.ts',390],['packages/coding-agent/src/core/session-manager.ts',543]]},
  {chapter:8,type:'architecture',title:'旧内容变摘要，近期工具配对保留',desc:'较早消息先序列化再生成模型摘要，近期调用和结果原文保留，共同构成新投影；raw 历史仍然保存。',caption:'keepRecentTokens 是切点预算目标，不是随意截取最后 N tokens。调用与结果不能拆散；序列化和模型摘要都可能损失信息。',nodes:[
    node('old','较早消息','本次要总结的材料',40,100,224,88,4),
    node('serialize','序列化材料','工具文本可能先截断',368,100,224,88,8),
    node('summary','模型生成摘要','包含已有摘要与新材料',696,100,224,88,7,{focal:true}),
    node('recent','近期原文','保留 toolCall + toolResult',40,324,224,96,5,{store:true}),
    node('projection','后续模型投影','system + 摘要 + 近期原文',696,324,224,96,1,{store:true}),
    node('raw','raw 历史仍保留','追加 compaction，不删除旧记录',368,444,224,80,1,{store:true}),
  ],edges:[
    edge('old','serialize',[[264,144],[368,144]],'准备',280,116,72),
    edge('serialize','summary',[[592,144],[696,144]],'摘要请求',608,116,72),
    edge('summary','projection',[[808,188],[808,324]],'摘要',816,236,64),
    edge('recent','projection',[[264,372],[696,372]],'保留原文',432,344,96),
    edge('old','raw',[[40,144],[16,144],[16,492],[368,492]],'历史记录',152,464,96,{dashed:true}),
  ],notes:['raw 存在 ≠ 本次模型看见；缓存命中也不能恢复未发送的信息。'],sources:[['packages/coding-agent/src/core/compaction/compaction.ts',872],['packages/coding-agent/src/core/compaction/utils.ts',93]]},
  {chapter:9,type:'architecture',title:'Skill 提供方法，Extension 接入执行代码',desc:'Skill 元信息引导按需读取正文，Extension 注册工具和 hook，两条路线共同影响模型和宿主的工作。',caption:'Skill 的渐进加载主要节省模型上下文。扩展初始化只登记能力，真实工具动作仍要经过执行管线。',nodes:[
    node('catalog','Skill 目录','名称、描述、文件位置',40,100,224,88,7,{tag:'KNOWLEDGE'}),
    node('body','按需读取正文','任务适用时再读步骤与附件',368,100,224,88,8,{tag:'READ'}),
    node('method','模型按方法工作','形成下一步工具调用意图',696,100,224,88,10,{tag:'MODEL'}),
    node('extension','Extension 模块','初始化工厂中的可执行代码',40,340,224,96,2,{tag:'CODE'}),
    node('register','注册工具与 hook','registerTool / pi.on',368,340,224,96,3,{tag:'REGISTER'}),
    node('execute','宿主执行管线','校验、准入、execute、结果',696,340,224,96,5,{tag:'EXECUTE',focal:true}),
  ],edges:[
    edge('catalog','body',[[264,144],[368,144]],'按需加载',280,116,72),
    edge('body','method',[[592,144],[696,144]],'提供步骤',608,116,72),
    edge('extension','register',[[264,388],[368,388]],'登记能力',280,360,72),
    edge('register','execute',[[592,388],[696,388]],'提供接口',608,360,72),
    edge('method','execute',[[808,188],[808,340]],'提出调用',816,248,88),
  ],notes:['方法说明不自动授予权限；已加载扩展也不自动获得安全隔离。'],sources:[['packages/coding-agent/src/core/skills.ts',277],['packages/coding-agent/src/core/extensions/loader.ts',270]]},
  {chapter:10,type:'sequence',title:'从发现外部工具，到回填一次调用结果',desc:'PI 与 MCP 服务建立连接并发现工具，注册暴露后模型提出调用意图，PI 调用服务并将结果回填。',caption:'这是初次发现与后续一次调用的代表过程。实际暴露受 direct / deferred / codemode 等策略控制，注册不等于全量直接声明。',actors:[
    {id:'model',name:'模型',sub:'生成调用意图',x:120,section:1},
    {id:'pi',name:'PI 客户端',sub:'注册与适配',x:480,section:4,focal:true},
    {id:'mcp',name:'MCP 服务',sub:'提供外部能力',x:840,section:3},
  ],messages:[
    {from:'pi',to:'mcp',y:144,label:'INITIALIZE',section:3},
    {from:'mcp',to:'pi',y:184,label:'能力与版本',section:3,return:true},
    {from:'pi',to:'mcp',y:224,label:'TOOLS/LIST',section:4},
    {from:'mcp',to:'pi',y:264,label:'工具定义',section:4,return:true},
    {from:'pi',to:'model',y:320,label:'暴露或发现入口',section:7},
    {from:'model',to:'pi',y:360,label:'调用意图',section:5},
    {from:'pi',to:'mcp',y:400,label:'TOOLS/CALL',section:5},
    {from:'mcp',to:'pi',y:440,label:'执行结果',section:6,return:true},
    {from:'pi',to:'model',y:480,label:'工具结果回填',section:6,return:true,focal:true},
  ],actions:[{actor:'pi',y:276,w:176,h:24,text:'注册 ToolDefinition',section:4}],notes:['协议方法实际拼写为 tools/list、tools/call；MCP 不替代模型—工具循环。'],sources:[['packages/coding-agent/src/extensions/mcp/index.ts',368],['packages/mcp/src/client.ts',376]]},
  {chapter:11,type:'architecture',title:'三种委派方式，父会话等待的边界不同',desc:'父会话按需求选择普通子进程、durable 前台或 durable 后台，分别以同步工具结果、等待答案或 Reporter 后续消息交付。',caption:'三条是可选择的实现路径，不表示每次都会同时启动。普通子进程与 durable 子会话不同；独立上下文不自动隔离文件。',nodes:[
    node('parent','父会话','按需求选择一种委派方式',40,100,208,400,1,{tall:true}),
    node('process','普通子进程','另起 PI，读取 stdout JSONL',360,108,248,88,2),
    node('sync','同步工具结果','父工具等待子进程结束',704,108,216,88,5),
    node('foreground','durable 前台','task-owned 子会话',360,268,248,88,7,{store:true}),
    node('answer','同步答案','稳定 requestId 后 wait',704,268,216,88,7),
    node('background','durable 后台','Anchor + Reporter',360,428,248,88,8,{focal:true,optional:true}),
    node('report','后续 follow-up','父调用先返回，稍后报告',704,428,216,88,9,{optional:true}),
  ],edges:[
    edge('parent','process',[[248,152],[360,152]],'选择',280,124,48),
    edge('process','sync',[[608,152],[704,152]],'等待',624,124,64),
    edge('parent','foreground',[[248,312],[360,312]],'选择',280,284,48),
    edge('foreground','answer',[[608,312],[704,312]],'等待',624,284,64),
    edge('parent','background',[[248,472],[360,472]],'选择',280,444,48,{dashed:true}),
    edge('background','report',[[608,472],[704,472]],'后台报告',612,444,88,{dashed:true}),
  ],notes:['checkpoint 保存执行阶段；外部副作用仍需要重放策略与执行端幂等。'],sources:[['packages/coding-agent/examples/extensions/subagent/index.ts',272],['packages/durable/test/examples/23-subagent-background.ts',38]]},
  {chapter:12,type:'layers',title:'四类证据分别回答四类问题',desc:'机制测试、工具效果、模型任务与服务验收分层补足证据，任何一个运行信号都不能代替实际业务结果。',caption:'这些是不同范围的证明，不是 PI 默认自带的四个自动检查器。合理拒绝、未运行和基础设施失败应分别记录。',nodes:[
    node('mechanism','机制验证','调度、配对、取消是否符合约定',104,104,800,80,5,{band:true,tag:'01',right:'假 StreamFn · 确定性断言'}),
    node('effect','工具效果','文件或外部动作实际发生了什么',104,208,800,80,5,{band:true,tag:'02',right:'回读 · diff · 执行端记录'}),
    node('model','模型任务','工具选择、约束与答案是否正确',104,312,800,80,6,{band:true,tag:'03',right:'真实模型 · 固定任务 · 评分',focal:true}),
    node('service','服务验收','身份、任务状态、恢复与配额是否可用',104,416,800,80,13,{band:true,tag:'04',right:'真实服务与环境验收'}),
  ],edges:[],notes:['从机制到交付，逐项补足证据；started / agent_end / settled 都不单独证明任务正确。'],sources:[['packages/evals/src/harness.ts',238],['packages/coding-agent/src/modes/rpc/rpc-mode.ts',394]]},
];

export const chapterDiagramCss=`
.chapter-diagram{margin:24px 0 30px;padding:18px;border:1px solid var(--line);border-radius:8px;background:var(--paper);max-width:100%;min-width:0}.chapter .chapter-diagram h3,.chapter-diagram h3{margin:0 0 8px;font-size:18px;line-height:1.65}.chapter-diagram .diagram-intro{font-size:13px;line-height:1.85;color:var(--muted);margin:0 0 15px}.chapter-diagram .diagram-scroller{width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;border-radius:6px}.chapter-diagram svg{display:block;width:100%;min-width:960px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.chapter-diagram svg text{fill:var(--text)}.chapter-diagram .cd-muted{fill:var(--muted)}.chapter-diagram .cd-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.chapter-diagram .cd-node{fill:var(--paper);stroke:var(--line);stroke-width:1.4}.chapter-diagram .cd-store{fill:var(--code)}.chapter-diagram .cd-optional{stroke-dasharray:5 4}.chapter-diagram .cd-focal{fill:var(--nav);stroke:var(--accent);stroke-width:2}.chapter-diagram .cd-edge{stroke:var(--muted);stroke-width:1.5;fill:none}.chapter-diagram .cd-return{stroke-dasharray:5 4}.chapter-diagram .cd-edge-focal{stroke:var(--accent);stroke-width:1.8}.chapter-diagram .cd-mask{fill:var(--paper)}.chapter-diagram .cd-lifeline{stroke:var(--line);stroke-width:1;stroke-dasharray:4 4}.chapter-diagram svg a:hover .cd-node,.chapter-diagram svg a:focus-visible .cd-node{stroke:var(--accent);stroke-width:2.3}.chapter-diagram svg a:focus-visible{outline:none}.chapter-diagram figcaption{font-size:13px;color:var(--muted);line-height:1.85;margin:13px 0 0}.chapter-diagram .diagram-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:12px}.chapter-diagram .diagram-actions a{text-decoration:none}.chapter-diagram .diagram-hint{font-size:12px;margin:9px 0 0;color:var(--muted)}
@media(max-width:600px){.chapter-diagram{padding:13px}.chapter .chapter-diagram h3{font-size:17px}}
@media print{.chapter-diagram{break-inside:avoid;padding:8px 0;border:0}.chapter-diagram .diagram-scroller{overflow:visible}.chapter-diagram svg{min-width:0;width:100%}.chapter-diagram .diagram-actions,.chapter-diagram .diagram-hint{display:none}}
`;

function rounded(points){
  let d=`M${points[0][0]} ${points[0][1]}`;
  for(let i=1;i<points.length-1;i++){
    const [a,b,c]=[points[i-1],points[i],points[i+1]];
    const len1=Math.abs(b[0]-a[0])+Math.abs(b[1]-a[1]);
    const len2=Math.abs(c[0]-b[0])+Math.abs(c[1]-b[1]);
    if((a[0]===b[0]&&b[0]===c[0])||(a[1]===b[1]&&b[1]===c[1])){d+=` L${b[0]} ${b[1]}`;continue;}
    const r=Math.min(8,len1/2,len2/2);
    const before=[b[0]-Math.sign(b[0]-a[0])*r,b[1]-Math.sign(b[1]-a[1])*r];
    const after=[b[0]+Math.sign(c[0]-b[0])*r,b[1]+Math.sign(c[1]-b[1])*r];
    d+=` L${before[0]} ${before[1]} Q${b[0]} ${b[1]} ${after[0]} ${after[1]}`;
  }
  return d+` L${points.at(-1)[0]} ${points.at(-1)[1]}`;
}
function maskLabel(label,href){
  const {x,y,w,h=20,text}=label;
  return `<a href="${esc(href)}"><g data-diagram-label="true"><rect class="cd-mask" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/><text class="cd-muted cd-mono" x="${x+w/2}" y="${y+14}" text-anchor="middle" font-size="12">${esc(text)}</text></g></a>`;
}
function drawNode(n,href){
  const {x,y,w,h}=n;
  const cls=`cd-node${n.focal?' cd-focal':''}${n.store?' cd-store':''}${n.optional?' cd-optional':''}`;
  const shape=n.shape==='diamond'?`<polygon class="${cls}" points="${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}"/>`:`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${n.shape==='terminal'?20:n.shape==='state'?8:6}"/>`;
  let text;
  if(n.band)text=`<text class="cd-mono cd-muted" x="${x+20}" y="${y+28}" font-size="12">${esc(n.tag)}</text><text x="${x+84}" y="${y+31}" font-size="19" font-weight="600">${esc(n.name)}</text><text class="cd-muted" x="${x+84}" y="${y+57}" font-size="13">${esc(n.sub)}</text><text class="cd-muted" x="${x+456}" y="${y+44}" font-size="14">${esc(n.right)}</text>`;
  else if(n.tall)text=`<text class="cd-mono cd-muted" x="${x+20}" y="${y+30}" font-size="12">DELEGATE</text><text x="${x+20}" y="${y+179}" font-size="24" font-weight="600">${esc(n.name)}</text><text class="cd-muted" x="${x+20}" y="${y+212}" font-size="12">${esc(n.sub)}</text>`;
  else if(n.shape==='diamond')text=`<text x="${x+w/2}" y="${y+h/2-5}" text-anchor="middle" font-size="17" font-weight="600">${esc(n.name)}</text><text class="cd-mono cd-muted" x="${x+w/2}" y="${y+h/2+17}" text-anchor="middle" font-size="11">${esc(n.sub)}</text>`;
  else if(n.action)text=`<text x="${x+w/2}" y="${y+17}" text-anchor="middle" font-size="13" font-weight="600">${esc(n.name)}</text>`;
  else if(n.compact||h<=64)text=`<text x="${x+w/2}" y="${y+24}" text-anchor="middle" font-size="17" font-weight="600">${esc(n.name)}</text><text class="cd-muted" x="${x+w/2}" y="${y+45}" text-anchor="middle" font-size="12">${esc(n.sub)}</text>`;
  else text=`${n.tag?`<rect x="${x+16}" y="${y+12}" width="${Math.max(40,n.tag.length*7+16)}" height="16" rx="2" fill="var(--code)"/><text class="cd-mono cd-muted" x="${x+24}" y="${y+24}" font-size="10">${esc(n.tag)}</text>`:''}<text x="${x+16}" y="${y+(n.tag?50:34)}" font-size="19" font-weight="600">${esc(n.name)}</text><text class="cd-muted" x="${x+16}" y="${y+(n.tag?73:59)}" font-size="12">${esc(n.sub)}</text>`;
  return `<a href="${esc(href)}" data-diagram-node="${n.id}" aria-label="${esc(n.name)}：跳转本章解释"><g data-diagram-bounds="${n.id}" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="var(--paper)"/>${shape}${text}</g></a>`;
}

export function diagramSvg(def,sectionHref){
  const slug=`pi-chapter-${String(def.chapter).padStart(2,'0')}`;
  const defs=`<defs><marker id="${slug}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6 Z" fill="var(--muted)"/></marker><marker id="${slug}-accent-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6 Z" fill="var(--accent)"/></marker></defs>`;
  let edges='',labels='',nodes='',underlay='';
  if(def.actors){
    const actors=new Map(def.actors.map(a=>[a.id,a]));
    underlay=def.actors.map(a=>`<path class="cd-lifeline" d="M${a.x} 112 V528"/>`).join('');
    for(const m of def.messages){
      const x1=actors.get(m.from).x,x2=actors.get(m.to).x;
      edges+=`<path class="cd-edge${m.return?' cd-return':''}${m.focal?' cd-edge-focal':''}" data-message="${m.label}" d="M${x1} ${m.y} H${x2}" marker-end="url(#${slug}-${m.focal?'accent-arrow':'arrow'})"/>`;
      const w=Math.max(72,[...m.label].reduce((sum,c)=>sum+(c.codePointAt(0)>127?13:8),20)),cx=m.labelX??(x1+x2)/2;
      labels+=maskLabel({x:cx-w/2,y:m.y-28,w,text:m.label},sectionHref(m.section));
    }
    nodes=def.actors.map(a=>drawNode({...a,x:a.x-80,y:56,w:160,h:56,compact:true},sectionHref(a.section))).join('');
    for(const a of def.actions??[]){const x=actors.get(a.actor).x;nodes+=drawNode({id:'register',name:a.text,sub:'',x:x-a.w/2,y:a.y,w:a.w,h:a.h,action:true},sectionHref(a.section));}
  }else{
    for(const e of def.edges){
      edges+=`<path class="cd-edge${e.dashed?' cd-return':''}" data-from="${e.from}" data-to="${e.to}" d="${rounded(e.points)}" marker-end="url(#${slug}-arrow)"/>`;
      if(e.label)labels+=maskLabel(e.label,sectionHref(def.nodes.find(n=>n.id===e.to)?.section??1));
    }
    nodes=def.nodes.map(n=>drawNode(n,sectionHref(n.section))).join('');
  }
  const notes=def.notes.map((n,i)=>`<text class="cd-muted" x="40" y="${568+i*22}" font-size="13">${esc(n)}</text>`).join('');
  const layerArrow=def.type==='layers'?`<path class="cd-edge" d="M64 120 V480" marker-end="url(#${slug}-arrow)"/><text class="cd-muted" x="40" y="82" font-size="12">补足证据</text>`:'';
  return `<svg viewBox="0 0 960 600" role="img" aria-labelledby="${slug}-title ${slug}-desc" data-chapter-diagram="${def.chapter}"><title id="${slug}-title">${esc(def.title)}</title><desc id="${slug}-desc">${esc(def.desc)}</desc>${defs}<rect x="0" y="0" width="960" height="600" fill="var(--paper)"/>${underlay}${edges}${labels}${layerArrow}${nodes}<path d="M40 544 H920" fill="none" stroke="var(--line)"/>${notes}</svg>`;
}

export function chapterDiagramMarkup(lesson,{standalone=false}={}){
  const def=chapterDiagrams.find(d=>d.chapter===lesson.number);
  if(!def)throw new Error(`Missing chapter diagram ${lesson.number}`);
  const sectionHref=i=>{
    const section=lesson.outline[i-1];
    if(!section)throw new Error(`Missing section ${i} of chapter ${lesson.number}`);
    return `${standalone?'../chapters/'+encodeURI(lesson.htmlFile):''}#${section.id}`;
  };
  const relevant=[...new Set((def.nodes??def.actors).map(n=>n.section))].slice(0,3);
  return `<figure class="chapter-diagram" id="pi-chapter-${String(lesson.number).padStart(2,'0')}"><h3>本章图解 · ${esc(def.title)}</h3><p class="diagram-intro">${esc(def.desc)}</p><div class="diagram-scroller">${diagramSvg(def,sectionHref)}</div><figcaption>${esc(def.caption)}</figcaption><div class="diagram-actions">${relevant.map(i=>`<a href="${sectionHref(i)}">${lesson.outline[i-1].text}</a>`).join('')}${!standalone?`<a href="${lesson.combined?'':'../'}figures/pi-chapter-${String(lesson.number).padStart(2,'0')}.html" target="_blank" rel="noopener noreferrer">单独看图 ↗</a>`:''}</div><p class="diagram-hint">点击节点可跳转本章解释；窄屏可在图内横向滚动。</p></figure>`;
}

export function writeChapterDiagrams(root,lessons){
  const dir=path.join(root,'figures');fs.mkdirSync(dir,{recursive:true});
  const colors=':root{color-scheme:light;--bg:#f5f3ee;--paper:#fffefa;--text:#26332e;--muted:#65736b;--line:#d9dfd6;--accent:#28664e;--code:#eef2ed;--nav:#edf1e9}*{box-sizing:border-box}body{margin:0;padding:28px;background:var(--bg);color:var(--text);font:16px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1200px;margin:0 auto;min-width:0}a{color:var(--accent)}a:focus-visible{outline:3px solid var(--accent);outline-offset:4px}.diagram-back{display:inline-block;font-size:14px;margin:0 0 15px}@media(max-width:600px){body{padding:14px}}@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#151c19;--paper:#1c2520;--text:#e0e8df;--muted:#abb9ad;--line:#3b4b40;--accent:#9ed4ac;--code:#25332a;--nav:#202c24}}';
  for(const lesson of lessons){
    const name=`pi-chapter-${String(lesson.number).padStart(2,'0')}.html`;
    fs.writeFileSync(path.join(dir,name),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>第 ${lesson.number} 节图解 · PI Harness</title><style>${colors}${chapterDiagramCss}</style></head><body><main><a class="diagram-back" href="../chapters/${encodeURI(lesson.htmlFile)}">← 返回第 ${lesson.number} 节正文</a>${chapterDiagramMarkup(lesson,{standalone:true})}</main></body></html>`);
  }
  fs.writeFileSync(path.join(root,'chapter-diagrams.json'),JSON.stringify({revision:'eb326d265ae0b88489a6d10319307780df827cdf',preset:'doc-inline',viewBox:[0,0,960,600],style:'Existing warm paper / deep green palette; system fonts',diagrams:chapterDiagrams},null,2)+'\n');
}
