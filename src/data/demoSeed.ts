import {
  createFolder,
  createItemsBatch,
  deleteFolder,
  deleteItem,
  getFolders,
  getItems,
  seedFoldersIfEmpty,
  seedItemsIfEmpty,
  updateFolder,
  updateItem,
} from "./itemStore";
import type { ItemType, ProcessStatus, ReadingStatus } from "../types";

const SHOWCASE_ROOT_TITLE = "演示资料库";
let demoSeedPromise: Promise<void> | undefined;

type ShowcaseItem = {
  title: string;
  folder: string;
  type: ItemType;
  processStatus: ProcessStatus;
  readingStatus: ReadingStatus;
  tags: string[];
  summary: string;
  favorite?: boolean;
  sourceUrl?: string;
};

const showcaseItems: ShowcaseItem[] = [
  { title: "Daymark RC4 发布验收清单", folder: "Daymark", type: "document", processStatus: "待整理", readingStatus: "待阅读", tags: ["演示资料", "发布", "Windows"], summary: "覆盖安装、数据保留、系统凭据、备份恢复与 NSIS 安装包的发布前检查。" },
  { title: "自动工作回顾 v1 设计说明", folder: "Daymark", type: "project", processStatus: "已整理", readingStatus: "已阅读", tags: ["演示资料", "AI", "增量总结"], summary: "记录滚动工作回顾的数据流、增量游标、失败回滚和隐私边界。", favorite: true },
  { title: "本地优先产品原则", folder: "产品与规划", type: "note", processStatus: "已整理", readingStatus: "需复习", tags: ["演示资料", "产品原则", "隐私"], summary: "Daymark 的核心约束：数据默认留在本机，AI 行为清晰可见并由用户控制。", favorite: true },
  { title: "首次使用引导文案评审", folder: "产品与规划", type: "document", processStatus: "待整理", readingStatus: "阅读中", tags: ["演示资料", "Onboarding", "文案"], summary: "围绕“这东西是干什么的”整理定位、隐私说明和三个开始入口。" },
  { title: "用户访谈：为什么需要工作记忆", folder: "产品与规划", type: "note", processStatus: "收件箱", readingStatus: "待阅读", tags: ["演示资料", "用户研究"], summary: "访谈摘录：用户需要跨工具保存决策、过程和可追溯的工作上下文。" },
  { title: "资料库信息架构草案", folder: "产品与规划", type: "document", processStatus: "待整理", readingStatus: "待阅读", tags: ["演示资料", "资料库", "信息架构"], summary: "目录、智能集合、阅读状态、整理状态与知识关联之间的层级关系。" },
  { title: "季度路线图：从 RC 到稳定版", folder: "产品与规划", type: "project", processStatus: "已整理", readingStatus: "已阅读", tags: ["演示资料", "路线图"], summary: "聚焦稳定性、公开仓库准备、完整备份和可解释的 AI 工作流。" },
  { title: "竞品观察：本地知识管理工具", folder: "阅读与灵感", type: "url", processStatus: "收件箱", readingStatus: "待阅读", tags: ["演示资料", "竞品", "知识管理"], summary: "比较本地笔记、稍后读、个人知识库和 AI 工作记忆产品的边界。", sourceUrl: "https://example.com/daymark-demo/local-first-tools" },
  { title: "API Key 系统凭据迁移记录", folder: "AI 与自动化", type: "document", processStatus: "已整理", readingStatus: "已阅读", tags: ["演示资料", "安全", "Keyring"], summary: "桌面端凭据按 provider 与 Base URL 分域保存，Web 模式保留开发降级。" },
  { title: "对话增量读取边界案例", folder: "AI 与自动化", type: "note", processStatus: "待整理", readingStatus: "需复习", tags: ["演示资料", "Codex", "Claude Code"], summary: "覆盖半行 JSONL、文件缩短、offset 失效、失败不推进游标等情况。" },
  { title: "滚动总结提示词实验记录", folder: "AI 与自动化", type: "document", processStatus: "收件箱", readingStatus: "阅读中", tags: ["演示资料", "Prompt", "总结"], summary: "测试已完成、正在进行、关键决策、风险和待办六段式输出结构。" },
  { title: "AI 请求脱敏规则备忘", folder: "AI 与自动化", type: "note", processStatus: "已整理", readingStatus: "需复习", tags: ["演示资料", "脱敏", "安全"], summary: "识别常见 token、私钥、云凭据和高熵字符串，并在发送前进行本地替换。" },
  { title: "自动回顾失败重试策略", folder: "AI 与自动化", type: "document", processStatus: "待整理", readingStatus: "待阅读", tags: ["演示资料", "容错", "游标"], summary: "AI 失败、取消或超时时不推进 offset，确保下一次仍能完整处理增量。" },
  { title: "React 工作台控件层级规范", folder: "前端与交互", type: "document", processStatus: "已整理", readingStatus: "已阅读", tags: ["演示资料", "React", "设计系统"], summary: "定义 28、32、36、40px 四档控件尺寸和主要、次要、辅助操作层级。", favorite: true },
  { title: "顶部快速记录交互状态机", folder: "前端与交互", type: "project", processStatus: "待整理", readingStatus: "阅读中", tags: ["演示资料", "Tauri", "交互"], summary: "整理热区、展开、左右吸附、自由固定、自动收回和保存关闭状态。" },
  { title: "日期选择弹层视觉验收", folder: "前端与交互", type: "image", processStatus: "收件箱", readingStatus: "不需要", tags: ["演示资料", "日期选择", "视觉"], summary: "深浅主题下检查弹层背景、选中状态、今天高亮和边界溢出。" },
  { title: "空状态降噪记录", folder: "前端与交互", type: "note", processStatus: "已归档", readingStatus: "已阅读", tags: ["演示资料", "空状态", "留白"], summary: "首页移除多余面板，只保留“今天还很安静。”这一行轻提示。" },
  { title: "键盘焦点与 Tab 顺序检查", folder: "前端与交互", type: "document", processStatus: "待整理", readingStatus: "待阅读", tags: ["演示资料", "无障碍", "键盘"], summary: "检查弹窗焦点锁定、图标按钮 aria-label 和 focus-visible 状态。" },
  { title: "Windows NSIS 打包笔记", folder: "技术研究", type: "document", processStatus: "已整理", readingStatus: "已阅读", tags: ["演示资料", "NSIS", "构建"], summary: "记录正式构建、安装包路径、SHA256、覆盖安装和未签名提示。" },
  { title: "WebView2 与 Vite 开发模式", folder: "技术研究", type: "note", processStatus: "收件箱", readingStatus: "待阅读", tags: ["演示资料", "WebView2", "Vite"], summary: "开发版 exe 依赖 127.0.0.1 Vite 服务，正式包则读取内置静态资源。" },
  { title: "IndexedDB 事务恢复测试", folder: "技术研究", type: "document", processStatus: "待整理", readingStatus: "需复习", tags: ["演示资料", "IndexedDB", "备份"], summary: "核心恢复使用单事务覆盖写入，任何失败都不应留下半恢复状态。" },
  { title: "Rust 窗口生命周期排查", folder: "技术研究", type: "note", processStatus: "待整理", readingStatus: "阅读中", tags: ["演示资料", "Rust", "窗口"], summary: "梳理主窗口、顶部热区、快速记录面板和看门狗之间的状态竞争。" },
  { title: "依赖安全审计记录", folder: "技术研究", type: "archive", processStatus: "已归档", readingStatus: "已阅读", tags: ["演示资料", "RustSec", "公开仓库"], summary: "记录 PDF 解析、XML 和并发依赖的安全公告及升级计划。" },
  { title: "RC2 覆盖安装验收报告", folder: "项目档案", type: "archive", processStatus: "已整理", readingStatus: "已阅读", tags: ["演示资料", "RC2", "验收"], summary: "覆盖安装后资料、日志、记忆、主题、布局和系统凭据均保持可用。" },
  { title: "RC3 交互层级校准报告", folder: "项目档案", type: "archive", processStatus: "已整理", readingStatus: "已阅读", tags: ["演示资料", "RC3", "视觉"], summary: "统一按钮可发现性、控件高度、文字明暗和键盘焦点。" },
  { title: "公开仓库前检查清单", folder: "项目档案", type: "document", processStatus: "收件箱", readingStatus: "待阅读", tags: ["演示资料", "GitHub", "审计"], summary: "检查提交历史、作者邮箱、许可证、Actions 日志、发布资产和敏感信息。" },
  { title: "每周产品评审会议纪要", folder: "会议与决策", type: "note", processStatus: "待整理", readingStatus: "不需要", tags: ["演示资料", "会议", "决策"], summary: "决定暂停堆叠功能，优先打磨产品定位、稳定性和资料库工作台体验。" },
  { title: "资料库厚重感讨论", folder: "会议与决策", type: "note", processStatus: "收件箱", readingStatus: "待阅读", tags: ["演示资料", "资料库", "设计评审"], summary: "厚重感应来自规模、层级、元数据和功能可见性，而不是装饰、阴影或大卡片。" },
  { title: "稍后阅读：信息检索的渐进披露", folder: "阅读与灵感", type: "url", processStatus: "收件箱", readingStatus: "待阅读", tags: ["演示资料", "阅读", "检索"], summary: "研究如何在高密度工作台中保持清晰层级，并逐步显示复杂操作。", sourceUrl: "https://example.com/daymark-demo/progressive-disclosure" },
  { title: "灵感摘录：安静的软件", folder: "阅读与灵感", type: "note", processStatus: "已整理", readingStatus: "需复习", tags: ["演示资料", "灵感", "产品气质"], summary: "真正安静的软件不是功能少，而是把复杂性安排在用户需要它出现的位置。" },
];

export function seedDemoDataIfEmpty() {
  demoSeedPromise ??= runDemoSeed();
  return demoSeedPromise;
}

async function runDemoSeed() {
  await Promise.all([seedItemsIfEmpty(), seedFoldersIfEmpty()]);
  await seedLibraryShowcaseData();
  await normalizeLibraryShowcaseData();
}

async function seedLibraryShowcaseData() {
  const existingFolders = await getFolders();
  const existingRoot = existingFolders.find((folder) => folder.title === SHOWCASE_ROOT_TITLE);
  const root = existingRoot ?? (await createFolder({ title: SHOWCASE_ROOT_TITLE, sortOrder: 20_000 }));
  const folderTitles = ["产品与规划", "技术研究", "前端与交互", "AI 与自动化", "项目档案", "Daymark", "阅读与灵感", "会议与决策"];
  const demoFolderIds = new Set(
    existingFolders.filter((folder) => folder.title === SHOWCASE_ROOT_TITLE).map((folder) => folder.id),
  );
  let foundNestedFolder = true;
  while (foundNestedFolder) {
    foundNestedFolder = false;
    for (const folder of existingFolders) {
      if (folder.parentId && demoFolderIds.has(folder.parentId) && !demoFolderIds.has(folder.id)) {
        demoFolderIds.add(folder.id);
        foundNestedFolder = true;
      }
    }
  }

  const folderMap = new Map<string, string>();
  for (const folder of existingFolders) {
    if (demoFolderIds.has(folder.id) && !folderMap.has(folder.title)) {
      folderMap.set(folder.title, folder.id);
    }
  }

  for (const [index, title] of folderTitles.entries()) {
    if (folderMap.has(title)) continue;
    const parentId =
      title === "前端与交互" || title === "AI 与自动化"
        ? folderMap.get("技术研究")
        : title === "Daymark"
          ? folderMap.get("项目档案")
          : root.id;
    const folder = await createFolder({
      title,
      parentId,
      sortOrder: 20_100 + index,
    });
    folderMap.set(title, folder.id);
  }

  const existingDemoTitles = new Set(
    (await getItems()).filter((item) => item.tags.includes("演示资料")).map((item) => item.title),
  );
  await createItemsBatch(showcaseItems
    .filter((item) => !existingDemoTitles.has(item.title))
    .map((item) => ({
      title: item.title,
      type: item.type,
      processStatus: item.processStatus,
      readingStatus: item.readingStatus,
      folderId: folderMap.get(item.folder),
      tags: item.tags,
      content: `# ${item.title}\n\n${item.summary}\n\n这是一条用于观察 Daymark 资料库在真实数据规模下视觉表现的演示资料。`,
      aiSummary: item.summary,
      favorite: item.favorite ?? false,
      sourceUrl: item.sourceUrl,
      todos: item.processStatus === "待整理" ? ["补充标签", "确认归档目录"] : [],
    })));
}

async function normalizeLibraryShowcaseData() {
  const folders = await getFolders();
  const roots = folders.filter((folder) => folder.title === SHOWCASE_ROOT_TITLE);
  if (roots.length === 0) return;

  const demoFolderIds = new Set(roots.map((folder) => folder.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && demoFolderIds.has(folder.parentId) && !demoFolderIds.has(folder.id)) {
        demoFolderIds.add(folder.id);
        changed = true;
      }
    }
  }

  const demoFolders = folders.filter((folder) => demoFolderIds.has(folder.id));
  const canonicalByTitle = new Map<string, (typeof demoFolders)[number]>();
  for (const folder of demoFolders) {
    if (!canonicalByTitle.has(folder.title)) {
      canonicalByTitle.set(folder.title, folder);
    }
  }

  const canonicalRoot = canonicalByTitle.get(SHOWCASE_ROOT_TITLE);
  const expectedParentTitle = new Map<string, string>([
    ["前端与交互", "技术研究"],
    ["AI 与自动化", "技术研究"],
    ["Daymark", "项目档案"],
  ]);

  for (const [title, folder] of canonicalByTitle) {
    if (title === SHOWCASE_ROOT_TITLE) continue;
    const parentTitle = expectedParentTitle.get(title) ?? SHOWCASE_ROOT_TITLE;
    const expectedParentId = canonicalByTitle.get(parentTitle)?.id ?? canonicalRoot?.id;
    if (expectedParentId && folder.parentId !== expectedParentId) {
      await updateFolder(folder.id, { parentId: expectedParentId });
    }
  }

  const items = (await getItems()).filter((item) => item.tags.includes("演示资料"));
  const keptTitles = new Set<string>();
  for (const item of items) {
    if (keptTitles.has(item.title)) {
      await deleteItem(item.id);
      continue;
    }
    keptTitles.add(item.title);
    const currentFolderTitle = folders.find((folder) => folder.id === item.folderId)?.title;
    const canonicalFolderId = currentFolderTitle ? canonicalByTitle.get(currentFolderTitle)?.id : undefined;
    if (canonicalFolderId && canonicalFolderId !== item.folderId) {
      await updateItem(item.id, { folderId: canonicalFolderId });
    }
  }

  for (const folder of demoFolders) {
    if (canonicalByTitle.get(folder.title)?.id !== folder.id) {
      await deleteFolder(folder.id);
    }
  }
}
