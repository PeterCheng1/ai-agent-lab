# ai-agent-lab

> Hands-on experiments and notes while learning AI agent development with LangChain.js

学习 AI Agent 开发的练习仓库。基于 **LangChain.js**(`@langchain/openai`)调用大模型,通过阿里云 **DashScope 的 OpenAI 兼容模式**接入通义千问,循序渐进地实践从「基础对话」到「工具调用(tool calling)」的 Agent 核心能力。

## 技术栈

- **Node.js**(ESM,`.mjs`)
- **LangChain.js** — `@langchain/openai`、`@langchain/core`
- **zod** — 定义工具参数结构
- **dotenv** — 管理环境变量
- 模型:通义千问(via DashScope OpenAI 兼容接口)

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`,填入你自己的密钥:

```bash
cp .env.example .env
```

| 变量 | 说明 |
|---|---|
| `OPENAI_API_KEY` | DashScope 的 API Key |
| `OPENAI_API_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `MODEL_NAME` | 模型名,如 `qwen-coder-turbo` / `qwen-plus` / `qwen-max` |

> ⚠️ `.env` 含真实密钥,已在 `.gitignore` 中忽略,**切勿提交到仓库**。

### 3. 运行示例

```bash
node ./src/hello-langchain.mjs      # 基础对话
node ./src/tool-file-read.mjs       # 工具调用
```

## 示例说明

### `src/hello-langchain.mjs` — 基础对话

最小可运行示例:创建 `ChatOpenAI` 实例,`.invoke()` 发一句话,打印模型回复。用来理解 LangChain 调用大模型的基本流程(消息进 → `AIMessage` 出)。

### `src/tool-file-read.mjs` — 工具调用(Tool Calling)

一个带工具调用循环的 Mini Agent:

1. 用 `tool()` 定义一个 `read_file` 工具(读取指定文件内容)
2. `model.bindTools()` 把工具挂到模型上
3. `while` 循环处理工具调用:
   - 模型返回 `tool_calls`(说它想调用哪个工具)
   - 代码执行工具,把结果包成 `ToolMessage` 追加回对话
   - 再次 `invoke`,直到模型不再需要工具、给出最终回答

演示了 Agent 最核心的骨架:**模型决策 → 代码执行工具 → 结果回填 → 再决策**。

## 学习路线(TODO)

- [x] 基础对话调用
- [x] 工具调用(单轮)
- [ ] 结构化输出(`.withStructuredOutput()`,返回 JSON 对象)
- [ ] 多轮 / 多工具连续调用
- [ ] 更多工具(写文件、列目录等)

## 参考

- [LangChain.js 文档](https://js.langchain.com/)
- [DashScope OpenAI 兼容模式](https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope)
