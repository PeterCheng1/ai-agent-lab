// ───────────── 依赖导入 ─────────────
import dotenv from "dotenv";                                                  // 读取 .env 文件里的环境变量（如 API Key）
import { ChatOpenAI } from "@langchain/openai";                              // LangChain 对 OpenAI（及兼容接口）的封装
import { tool } from '@langchain/core/tools';                               // 用来把一个普通函数包装成「大模型可调用的工具」
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages"; // 三种消息类型：用户/系统设定/工具返回
import fs from "node:fs/promises";                                          // Node 内置文件系统模块（Promise 版），用于读文件
import { z } from "zod";                                                    // 类型校验库，用来描述工具参数的结构

dotenv.config();                                                            // 执行加载，把 .env 里的变量注入 process.env

// ───────────── 创建模型实例 ─────────────
const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME || "qwen-coder-turbo",                // 模型名，优先读环境变量，没有则默认千问
    apiKey: process.env.OPENAI_API_KEY,                                     // 访问密钥，从环境变量读取（避免硬编码泄露）
    temperature: 0,                                                        // 温度=0，输出更确定、少随机，适合工具调用/代码类任务
    configuration: {
        baseURL: process.env.OPENAI_API_BASE_URL                           // 接口地址，指向 DashScope 兼容端点即可调用千问
    },
});

// ───────────── 定义一个「读文件」工具 ─────────────
// tool(执行函数, 元信息)：第 1 个参数是真正干活的函数，第 2 个参数告诉模型这个工具叫什么、能干嘛、要什么参数
const readFileTool = tool(async ({ filePath }) => {                         // 注意：入参是「对象」并解构出 filePath（与下方 schema 对应）
    const content = await fs.readFile(filePath, "utf-8");                   // 按路径读取文件内容，以 utf-8 文本返回
    console.log(`Tool used to read file: ${filePath} - success read ${content.length} characters`); // 打印日志，方便观察工具是否被调用
    return `File content: ${content}`;                                     // 把文件内容作为工具的返回值交回给模型
}, {
    name: "read_file",                                                     // 工具名，模型在 tool_calls 里用这个名字来点名调用
    description: "use this tool to read the content of a file given its path", // 工具说明，模型据此判断「什么时候该用它」
    schema: z.object({                                                     // 参数结构：模型必须按这个格式生成调用参数
        filePath: z.string().describe("The path to the file to read"),     // 参数 filePath 是字符串，describe 帮模型理解含义
    }),
});

const tools = [readFileTool];                                              // 把所有工具放进数组（这里只有一个）

// bindTools：把工具「挂」到模型上，之后 invoke 时模型才知道有哪些工具可用
const modelWithTools = model.bindTools(tools);

// ───────────── 组装对话消息 ─────────────
const messages = [
    new SystemMessage(`你是一个代码助手，可以使用工具读取文件并解释代码。      // 系统消息：设定 AI 的角色与工作规则（不直接展示给用户）

工作流程:
1. 用户要求读取文件时，立即调用 read_file 工具
2. 等待工具返回文件内容
3. 基于文件内容进行分析和解释

可用工具:
- read_file: 读取文件内容（使用此工具来获取文件内容）
`),
    new HumanMessage('请读取 src/tool-file-read.mjs 文件内容并解释代码')     // 用户消息：本轮真正的提问
];

// ───────────── 发起调用 ─────────────
let response = await modelWithTools.invoke(messages);                       // 第一次调用：模型可能返回「想调用工具」的指令
// console.log(response);

messages.push(response);                                                    // 把 AI 返回的消息也放进 messages 数组，即维护完整对话记录

// ───────────── 工具调用循环 ─────────────
// 只要模型还想调用工具（tool_calls 非空），就一直循环：执行工具 → 回填结果 → 再问模型
while (response.tool_calls && response.tool_calls.length > 0) {

    console.log(`\n[检测到 ${response.tool_calls.length} 个工具调用]`);

    // 并行执行本轮所有工具调用（Promise.all 同时跑，谁先好谁先返回，最后按原顺序收集）
    const toolResults = await Promise.all(
        response.tool_calls.map(async (toolCall) => {
            const tool = tools.find(t => t.name === toolCall.name);        // 查找工具：按模型点名的 name 找到对应工具对象
            if (!tool) {                                                   // 找不到就返回错误提示（防止模型幻觉出不存在的工具名）
                return `错误: 找不到工具 ${toolCall.name}`;
            }

            console.log(`  [执行工具] ${toolCall.name}(${JSON.stringify(toolCall.args)})`); // 打印本次调用的工具名和参数
            try {
                const result = await tool.invoke(toolCall.args);           // 调用：把模型生成的参数传给工具真正执行
                return result;                                             // 返回工具的执行结果（这里是文件内容）
            } catch (error) {
                return `错误: ${error.message}`;                          // 工具执行报错时，把错误信息交回给模型而不是让程序崩溃
            }
        })
    );

    // 将工具结果添加到消息历史：遍历本轮每个工具调用，把对应结果包成 ToolMessage
    response.tool_calls.forEach((toolCall, index) => {
        messages.push(
            new ToolMessage({
                content: toolResults[index],                               // toolResults 与 tool_calls 顺序一致，用 index 取对应结果
                tool_call_id: toolCall.id,                                 // 与本次调用的 id 绑定，模型才知道这条结果回应的是哪次调用
            })
        );
    });

    // 再次调用模型，传入工具结果：模型据此给出最终答案（或继续请求下一个工具，则 while 进入下一轮）
    response = await modelWithTools.invoke(messages);
}

// ───────────── 输出最终回复 ─────────────
// 循环结束 = 模型不再需要工具，此时 response.content 就是基于文件内容的最终解释
console.log("\n[最终回复]");
console.log(response.content);
