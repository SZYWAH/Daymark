# Daymark

Daymark is a local-first desktop knowledge base for capturing daily notes, organizing resources, and turning AI-assisted reviews into long-term memory.

Daymark 是一个本地优先的个人知识库桌面应用，用来沉淀日记、资料、长期记忆和 AI 辅助回顾。它优先服务个人工作流：内容保存在本机，AI 调用只在你主动触发整理、总结或提炼时发生。

## 功能概览

- 资料库：保存笔记、文档、链接、图片和项目条目。
- 日记：记录每日内容、标签和待办。
- 记忆：维护长期记忆文档、记忆卡片和回顾建议。
- 快速记录：桌面端支持快速捕捉日记内容。
- AI 整理：支持 DeepSeek 或 OpenAI-compatible 接口。
- 核心备份：手动导出和覆盖恢复核心内容。

## 本地开发

安装依赖：

```bash
pnpm install
```

启动 Web 开发服务：

```bash
pnpm dev
```

启动 Tauri 桌面开发模式：

```bash
pnpm tauri:dev
```

构建前端：

```bash
pnpm build
```

## 检查与测试

前端类型检查：

```bash
pnpm typecheck
```

前端测试：

```bash
pnpm test
```

Rust 后端测试：

```bash
pnpm test:rust
```

全部基础检查：

```bash
pnpm check
```

GitHub Actions 会在 push 或 pull request 到 `main` 时自动执行 TypeScript、Vitest 和 Rust 测试。

## AI Key 配置

本地开发时可以复制 `.env.local.example` 为 `.env.local`，再填入自己的模型配置：

```bash
VITE_DEEPSEEK_API_KEY=sk-your-deepseek-key
VITE_DEEPSEEK_BASE_URL=https://api.deepseek.com
VITE_DEEPSEEK_MODEL=deepseek-v4-flash
```

也可以在应用设置页手动填写 API Key。桌面端会保存到系统凭据存储；Web 模式保留本机应用数据降级，仅建议用于本机开发。

## 安全与隐私

- 桌面端已启用基础 CSP，默认只允许加载本应用资源；网络请求保留 `http`/`https`，用于 DeepSeek、OpenAI-compatible 接口和本机模型服务。
- 前端错误提示会隐藏常见 API Key、Bearer token、密码和密钥字段，避免上游错误把敏感内容直接显示到界面。
- 核心备份不会导出 AI 设置、API Key、AI 草稿或历史总结报告；备份文件只保存在用户主动选择的位置，不会上传。
- `.env.local` 不应提交到 Git。若把环境变量 Key 写进打包环境，生成的应用不适合分发给他人。
- 桌面端手动 API Key 使用系统凭据存储；Web 模式仍使用本机应用数据降级，不适合共享设备。

## 核心备份

设置页提供“数据备份”区块，可以导出和恢复核心内容。

核心备份包含：

- 资料
- 目录
- 日记
- 记忆文档
- 记忆卡片
- 内容链接

核心备份不包含：

- AI 设置
- API Key
- AI 草稿
- 历史总结报告
- 会话索引
- 布局和主题偏好

恢复核心备份会覆盖当前核心内容。恢复前应用会二次确认；AI 设置、API Key、主题和布局会保留在本机，不会被备份文件改写。

## 仓库卫生

不要提交本地构建产物或大文件，例如：

- `dist/`
- `node_modules/`
- `src-tauri/target/`
- `src-tauri/target-*`
- 日志文件
- 本地工作目录 `work/`

Rust/Tauri 编译产物通常非常大，不应该放进 Git，也不需要 Git LFS。
