/**
 * ════════════════════════════════════════════════════════════════════
 *  Mini Agent(教学版)—— 手写 Agent Loop 的最小完整实现
 * ════════════════════════════════════════════════════════════════════
 *
 *  这个文件回答一个问题:「一个 Agent 到底是怎么运转的?」
 *
 *  核心公式:Agent = 大模型 + 循环(loop) + 一组工具(tools)
 *
 *  数据流(一次任务的完整生命周期):
 *
 *    messages(对话历史)
 *        │
 *        ▼
 *    invoke(模型) ──► response
 *        │                │
 *        │      有 tool_calls?
 *        │        │            │
 *        │       没有 ────────► 输出最终答案,结束
 *        │        │
 *        │       有
 *        │        ▼
 *        │    ① push(response)      ← 模型的「决策」入历史
 *        │    ② 执行每个工具
 *        │    ③ push(ToolMessage)   ← 工具的「结果」入历史
 *        │        │
 *        └────────┘(回到 invoke,进入下一轮)
 *
 *  铁律:assistant 消息(含 tool_calls)和它对应的 ToolMessage
 *        必须【成对、按序】进入 messages,配对靠 tool_call_id。
 *        —— 这就是你昨天自己发现的那个 bug 的答案。
 *
 *  运行:npx tsx src/mini-agent.mjs
 *  (或 node src/mini-agent.mjs,取决于你的项目配置)
 * ════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────
//  第 0 区:依赖
//  没有新东西,和你原文件一致,只是归了类
// ─────────────────────────────────────────────────────
import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

dotenv.config();

// ─────────────────────────────────────────────────────
//  第 1 区:模型
//
//  为什么 temperature: 0?
//  → 工具调用场景要的是「稳定的决策」,不是创意。
//    (但记住你笔记里那句:0 也不保证 100% 一致)
//
//  为什么 baseURL 可配置?
//  → 这就是「OpenAI 兼容模式」的意义:同一套代码,
//    换个 URL 就能跑千问/DeepSeek/任何兼容服务。
//    模型是可替换的零件,harness(本文件)才是你的资产。
// ─────────────────────────────────────────────────────
const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME || "qwen-coder-turbo",
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0,
    configuration: {
        baseURL: process.env.OPENAI_API_BASE_URL,
    },
});

// ─────────────────────────────────────────────────────
//  第 2 区:工具箱
//
//  每个工具 = 执行函数 + 元信息(name/description/schema)
//
//  关键认知:模型永远不会「执行」工具——它只会在回复里
//  写下「我想调用 read_file,参数是 {...}」这段 JSON。
//  真正执行的是下面第 4 区你写的循环。
//  模型出意图,你的代码出手,这就是分工。
//
//  description 写给谁看?→ 写给模型看的!它是模型决定
//  「什么时候用这个工具」的唯一依据,措辞值得斟酌。
// ─────────────────────────────────────────────────────

/** 工具 1:读文件 */
const readFileTool = tool(
    async ({ filePath }) => {
        const content = await fs.readFile(filePath, "utf-8");
        return `File content of ${filePath}:\n${content}`;
    },
    {
        name: "read_file",
        description: "读取指定路径文件的完整内容。需要查看某个文件里写了什么时使用。",
        schema: z.object({
            filePath: z.string().describe("要读取的文件路径,相对于项目根目录"),
        }),
    }
);

/** 工具 2:列目录(新增)
 *  为什么加它?→ 单工具永远测不出多轮循环的 bug。
 *  有了它,模型面对「读取 src 里最大的文件」这类任务时,
 *  必须先 list 再 read —— 天然触发两轮循环,
 *  你的 loop 是否修好,一测便知。
 */
const listFilesTool = tool(
    async ({ dirPath }) => {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const lines = await Promise.all(
            entries
                .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
                .map(async (e) => {
                    if (e.isDirectory()) return `[dir]  ${e.name}/`;
                    const stat = await fs.stat(path.join(dirPath, e.name));
                    return `[file] ${e.name}  (${stat.size} bytes)`;
                })
        );
        return `Contents of ${dirPath}:\n${lines.join("\n")}`;
    },
    {
        name: "list_files",
        description: "列出指定目录下的文件和子目录,包含文件大小。不确定有哪些文件、或需要按大小/名称挑选文件时使用。",
        schema: z.object({
            dirPath: z.string().describe("要列出的目录路径,如 'src' 或 '.'"),
        }),
    }
);

const tools = [readFileTool, listFilesTool];
const modelWithTools = model.bindTools(tools);

// ─────────────────────────────────────────────────────
//  第 3 区:初始对话
//
//  SystemMessage 是你对模型行为的「出厂设定」。
//  注意:这里刻意不再逐条教它工作流程——工具的
//  description 已经足够,过度指挥反而限制它的规划能力。
//  (对比你原版的 system prompt,体会一下差别)
// ─────────────────────────────────────────────────────
const messages = [
    new SystemMessage(
        "你是一个代码分析助手。使用提供的工具来完成用户的任务。" +
        "完成任务后,直接给出清晰的中文答案,不要再调用工具。"
    ),
    new HumanMessage(
        // 这个任务刻意需要「先 list 后 read」两轮工具调用,
        // 专门用来验证多轮循环:
        "请列出 src 目录下的文件,找出其中最大的 .mjs 文件,读取它并用三句话概括这个文件在做什么。"
    ),
];

// ─────────────────────────────────────────────────────
//  第 4 区:Agent Loop(整个文件的心脏)
//
//  ★ 与你原版的关键区别只有一处,但它决定了单轮与多轮:
//
//    原版:messages.push(response) 在 while 之【前】
//          → 只有第一轮的决策进了历史
//          → 第二轮的 ToolMessage 找不到配对的 assistant
//          → 多轮断裂
//
//    现在:push 是 while 内的【第一行】
//          → 每一轮的决策都先入历史,再执行、再回填
//          → 任意多轮都成立
//
//  读这个循环时,在脑中默念每轮的三拍节奏:
//  「决策入史 → 执行回填 → 再次求解」
// ─────────────────────────────────────────────────────
const MAX_TURNS = 10; // 保险丝:防止模型陷入无限调用,烧钱又卡死
let turn = 0;

let response = await modelWithTools.invoke(messages);

while (response.tool_calls && response.tool_calls.length > 0) {
    if (++turn > MAX_TURNS) {
        console.error(`\n[熔断] 超过 ${MAX_TURNS} 轮仍未完成,强制停止。`);
        break;
    }

    // ①【决策入史】—— 本轮 bug 修复点,勿动
    messages.push(response);

    console.log(`\n━━ 第 ${turn} 轮:模型请求 ${response.tool_calls.length} 个工具 ━━`);

    // ②【执行】并行跑本轮所有工具调用
    //    Promise.all 保序:返回数组顺序 = tool_calls 顺序,
    //    所以下面才能放心用 index 配对。
    const toolResults = await Promise.all(
        response.tool_calls.map(async (toolCall) => {
            const matched = tools.find((t) => t.name === toolCall.name);
            if (!matched) {
                // 防模型幻觉:点名了不存在的工具 → 把错误当结果还给它
                return `错误:不存在名为 ${toolCall.name} 的工具`;
            }
            console.log(`   ├─ ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
            try {
                return await matched.invoke(toolCall.args);
            } catch (error) {
                // ★ Agent 与普通脚本的分水岭:
                //   报错不 throw、不崩溃,而是把错误文本交还给模型,
                //   让它自己看到失败并调整策略(换参数/换工具/放弃)。
                //   错误是喂给模型的信息,不是程序的终点。
                return `错误:${error.message}`;
            }
        })
    );

    // ③【回填】每条结果包成 ToolMessage,靠 tool_call_id 与决策配对
    response.tool_calls.forEach((toolCall, index) => {
        messages.push(
            new ToolMessage({
                content: toolResults[index],
                tool_call_id: toolCall.id, // ← 配对的唯一凭证,漏了它模型就「失忆」
            })
        );
    });

    // ④【再次求解】带着新证据回到模型;若它仍要工具,进入下一轮
    response = await modelWithTools.invoke(messages);
}

// ─────────────────────────────────────────────────────
//  第 5 区:收尾
//  循环退出 = 模型认为证据已足够,response.content 即最终答案。
//  注意:最后这个 response 不需要 push——对话到此结束,
//  没有「下一轮」需要读取它了。(想想为什么循环内的就必须 push?)
// ─────────────────────────────────────────────────────
console.log(`\n━━ 完成(共 ${turn} 轮工具调用)━━\n`);
console.log(response.content);