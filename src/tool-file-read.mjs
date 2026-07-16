/**
 * ════════════════════════════════════════════════════════════════════
 *  Mini Agent(最终版)—— 多轮工具调用 + 目标日志格式
 * ════════════════════════════════════════════════════════════════════
 *
 *  核心公式:Agent = 大模型 + 循环(loop) + 一组工具(tools)
 *
 *  数据流(每一轮的三拍节奏):
 *  「决策入史 → 执行回填 → 再次求解」
 *
 *  铁律:assistant 消息(含 tool_calls)和它对应的 ToolMessage
 *        必须【成对、按序】进入 messages,配对靠 tool_call_id。
 *
 *  运行:node ./src/mini-agent.mjs
 * ════════════════════════════════════════════════════════════════════
 */

// ───────────── 第 0 区:依赖 ─────────────
import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

dotenv.config();

// ───────────── 第 1 区:模型 ─────────────
// temperature: 0 → 工具调用要的是稳定决策,不是创意
// baseURL 可配置 → 同一套代码,换 URL 即可跑千问/任何 OpenAI 兼容服务
const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME || "qwen-coder-turbo",
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0,
    configuration: {
        baseURL: process.env.OPENAI_API_BASE_URL,
    },
});

// ───────────── 第 2 区:工具箱 ─────────────
// 模型永远不会「执行」工具,它只在回复里写下调用意图(tool_calls),
// 真正执行的是第 4 区你写的循环。模型出意图,你的代码出手。

/** 工具 1:读文件 */
const readFileTool = tool(
    async ({ filePath }) => {
        const content = await fs.readFile(filePath, "utf-8");
        // 用 Buffer.byteLength 得到「字节」数;content.length 是「字符」数,
        // 中文一个字符占 3 字节,两者不同——日志里报字节更接近文件真实大小
        console.log(
            `  [工具调用] read_file("${filePath}") - 成功读取 ${Buffer.byteLength(content, "utf-8")} 字节`
        );
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

/** 工具 2:列目录
 *  存在的意义:单工具永远测不出多轮循环的 bug。
 *  「先 list 再 read」的任务会强制模型走两轮,一测便知循环是否修好。
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
        console.log(`  [工具调用] list_files("${dirPath}") - 找到 ${lines.length} 个条目`);
        return `Contents of ${dirPath}:\n${lines.join("\n")}`;
    },
    {
        name: "list_files",
        description:
            "列出指定目录下的文件和子目录,包含文件大小。不确定有哪些文件、或需要按大小/名称挑选文件时使用。",
        schema: z.object({
            dirPath: z.string().describe("要列出的目录路径,如 'src' 或 '.'"),
        }),
    }
);

const tools = [readFileTool, listFilesTool];
const modelWithTools = model.bindTools(tools);

// ───────────── 第 3 区:初始对话 ─────────────
const messages = [
    new SystemMessage(
        "你是一个代码分析助手。使用提供的工具来完成用户的任务。" +
        "完成任务后,直接给出清晰的中文答案,不要再调用工具。"
    ),
    new HumanMessage(
        // 这个任务刻意需要「先 list 后 read」两轮工具调用,用来验证多轮循环:
        "请列出 src 目录下的文件,找出其中最大的 .mjs 文件,读取它并用三句话概括这个文件在做什么。"
    ),
];

// ───────────── 第 4 区:Agent Loop(心脏) ─────────────
//
// ★ 多轮的关键就一处:messages.push(response) 是 while 内的【第一行】,
//   保证每一轮的决策都先入历史,再执行、再回填。
//   (若把它放在 while 之前,只有首轮决策入史,第二轮 ToolMessage
//    找不到配对的 assistant,多轮即断裂——这是最常见的坑)

const MAX_TURNS = 10; // 保险丝:防止无限循环烧钱
let turn = 0;

let response = await modelWithTools.invoke(messages);

while (response.tool_calls && response.tool_calls.length > 0) {
    if (++turn > MAX_TURNS) {
        console.error(`\n[熔断] 超过 ${MAX_TURNS} 轮仍未完成,强制停止。`);
        break;
    }

    // ①【决策入史】—— 多轮修复点,勿动
    messages.push(response);

    console.log(`\n[检测到 ${response.tool_calls.length} 个工具调用]`);

    // ②【执行】并行跑本轮所有工具调用(Promise.all 保序,index 可放心配对)
    const toolResults = await Promise.all(
        response.tool_calls.map(async (toolCall) => {
            const matched = tools.find((t) => t.name === toolCall.name);
            if (!matched) {
                return `错误: 找不到工具 ${toolCall.name}`;
            }
            console.log(`  [执行工具] ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
            try {
                return await matched.invoke(toolCall.args);
            } catch (error) {
                // Agent 与脚本的分水岭:报错不崩溃,把错误文本还给模型,
                // 让它看到失败并自行调整。错误是喂给模型的信息,不是程序的终点。
                return `错误: ${error.message}`;
            }
        })
    );

    // ③【回填】结果包成 ToolMessage,靠 tool_call_id 与决策配对
    response.tool_calls.forEach((toolCall, index) => {
        messages.push(
            new ToolMessage({
                content: toolResults[index],
                tool_call_id: toolCall.id, // 配对的唯一凭证,漏了模型就「失忆」
            })
        );
    });

    // ④【再次求解】带着新证据回到模型;若它仍要工具,进入下一轮
    response = await modelWithTools.invoke(messages);
}

// ───────────── 第 5 区:收尾 ─────────────
console.log("\n[最终回复]");
console.log(response.content);