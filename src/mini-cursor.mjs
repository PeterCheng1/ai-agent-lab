import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { readFileTool, writeFileTool, executeCommandTool, listDirectoryTool } from './all-tools.mjs';
import chalk from 'chalk';

const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME || "qwen-coder-turbo",
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0,
    configuration: {
        baseURL: process.env.OPENAI_API_BASE_URL
    },
});

const tools = [
    readFileTool,
    writeFileTool,
    executeCommandTool,
    listDirectoryTool
]

// 绑定工具模型
const modelWithTools = model.bindTools(tools);

// Agent 执行函数
async function runAgentWithTools(query, maxIterations = 30) {
    const messages = [
        new SystemMessage(`你是一个项目管理助手，试用工具完成任务。
            当前工作目录：${process.cwd()}
            工具：
            1、 read_file: 读取文件
            2、 write_file: 写入文件
            3、 execute_command: 执行命令（支持 workingDirectory 参数）
            4、 list_directory: 列出目录内容

            重要规则 - execute_command： 
            - workingDirectory 会自动切换到指定目录
            - 使用 workingDirectory 时，绝对不要在 command 中使用 cd 命令切换目录
            - 错误例子：{ command: "cd react-todo-app && pnpm install", workingDirectory: "react-todo-app" }
            这是错误例子！因为 workingDirectory 已经在 react-todo-app 目录下了，command 中不应该再使用 cd 切换目录
            - 正确例子：{ command: "pnpm install", workingDirectory: "react-todo-app" }
            这样就正确了，因为 workingDirectory 已经在 react-todo-app 目录下了，直接执行命令即可了

            回复要简洁，只说做了什么。
        `),
        new HumanMessage(query)
    ]

    for (let i = 0; i < maxIterations; i++) {
        console.log(chalk.bgGreen(`正在等待 AI 思考...`));
        // 调用模型，获取响应
        const response = await modelWithTools.invoke(messages);
        // 将模型响应加入消息列表
        messages.push(response);

        // 检查是否有工具调用
        if (!response.tool_calls || response.tool_calls.length === 0) {
            console.log(`\n AI最终回复: \n ${response.content} \n`);
            return response.content;
        }

        // 执行工具调用
        for (const toolCall of response.tool_calls) {
            // 寻找工具
            const foundTool = tools.find(t => t.name === toolCall.name);
            // 如果寻找到工具
            if (foundTool) {
                // 调用工具, 并传入参数
                const toolResult = await foundTool.invoke(toolCall.args);
                // 将工具调用结果封装为 ToolMessage 并加入消息列表
                messages.push(new ToolMessage({
                    content: toolResult,
                    tool_call_id: toolCall.id
                }))
            }
        }
    }

    return messages[messages.length - 1].content
}

const case1 = `创建一个功能丰富的 React TodoList 应用:

1. 创建项目: echo -e "n\nn" | pnpm create vite react-todo-app --template react-ts
2. 修改 src/App.tsx, 实现完整功能的 TodoList:
  - 添加、删除、编辑、标记完成
  - 分类筛选 (全部/进行中/已完成)
  - 统计信息显示
  - localStorage 数据持久化
3. 添加复杂样式:
  - 渐变背景 (蓝到紫)
  - 卡片阴影、圆角
  - 悬停效果
4. 添加动画:
  - 添加/删除时的过渡动画
  - 使用 CSS transitions
5. 列出目录确认

注意: 使用 pnpm, 功能要完整, 样式要美观, 要有动画效果

之后在 react-todo-app 项目中:
1. 使用 pnpm install 安装依赖
2. 使用 pnpm run dev 启动服务器
`;

try {
    await runAgentWithTools(case1);
} catch (error) {
    console.error(`\n❌ 错误: ${error.message}\n`);
}