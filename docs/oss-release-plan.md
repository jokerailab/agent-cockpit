# Agent Cockpit 开源执行文档（C 档）

> 状态：**待批准，尚未执行**
> 目标版本：`0.3.0`（首个公开版本）
> 制定日期：2026-08-14

---

## 0. 定位与叙事

一切包装动作服务于一句话定位：

> **Observability for your local AI coding agents.**
> 不只告诉你哪个 agent 在跑，而是告诉你哪个会话已经退化，该重开还是还能救。

**主打能力只有一个：会话健康度诊断（Session Health Audit）。** 进程监控、成本统计、告警都是配菜。理由：进程监控赛道全是玩具，而"从 jsonl 日志逆向出会话退化信号"这件事目前没有同类项目在做，`sessions/engine.ts` 里那套评分模型是本项目唯一不可替代的资产。

README 首屏、社交传播文案、docs 目录结构，全部围绕这一点组织。

### 不做的事（明确划出范围）

- 不重写 UI，不换设计系统（现有 "analog instrument spec-sheet" 主题是差异化优势）
- 不加新功能，不动 P5 路线图里没做完的部分
- 不申请 Apple Developer 证书做公证（保持 ad-hoc 签名 + 一次性 "Open Anyway" 说明）
- 不做 Windows / Linux 的实测验证，只在文档里诚实标注为未验证

---

## 1. 核查结论（本方案的事实依据）

执行前已核实，以下结论直接决定了方案里的若干设计：

| 核查项 | 结论 | 影响 |
|---|---|---|
| 出站网络请求 | **零**。全库唯一匹配是 `app.css` 里 SVG 的 `xmlns` 命名空间字面量，非网络请求。无 autoUpdater、无 telemetry、无 fetch/axios | `PRIVACY.md` 可以做强断言，并给出可复现的验证命令 |
| 中文字符串分布 | 共 10 个文件、约 315 处。集中在 `App.tsx`(199) / `PopoverPanel.tsx`(35) / `alerts/engine.ts`(23) / `sessions/engine.ts`(21) / `index.ts`(17) / `notify.ts`(11) | i18n 必须同时覆盖主进程与渲染进程，不能只做 renderer |
| 纯函数的 Electron 依赖 | `sessions/engine.ts` 本身不 import electron，但 import 了 `store/db` → `db.ts` import 了 `electron.app` | **核心算法当前无法单测**，必须先做纯函数抽离（见 Phase 3） |
| `handleAdvice()` 分支方式 | `App.tsx:400` 通过匹配中文子串分支（`d.includes("复读")`） | **i18n 后会静默失效**。必须改为按 diag key 分支，这是硬前置 |
| Git 仓库 | 尚未 `git init` | 好消息：可以干净起步，无需 filter-branch 清历史里的 dmg |
| 测试框架 | 未安装任何 | 从零引入 vitest |

---

## 2. 阶段划分

六个 Phase，按依赖顺序排列。Phase 1 到 3 有严格先后（i18n 依赖纯函数抽离的 diag key 改造），Phase 4、5 可并行。

---

### Phase 0 · 仓库卫生（前置，必须最先做）

**目的**：让 `git init` 的第一个 commit 就是干净的。任何一步做错都要重来。

**动作**

1. 扩充 `.gitignore`：
   ```gitignore
   # 已有
   node_modules/
   out/
   dist/
   release/
   *.log
   .DS_Store
   .vite/
   *.tsbuildinfo

   # 新增
   dist-share/*.dmg          # 210MB 安装包，走 GitHub Releases
   icon-source.png           # 2MB 图标源图
   .claude/settings.local.json
   ```

2. 物理删除已存在的构建残留：`tsconfig.node.tsbuildinfo`、`tsconfig.web.tsbuildinfo`

3. `icon-source.png`（2MB）处理：不入库。`build/` 下已有生成好的 `icon.icns` / `icon.ico` / `icon.png` / iconset，够用。在 `docs/` 里说明源图不随仓库分发。

4. `dist-share/` 重组：
   - `dist-share/screenshots/*.png` → 移到 `docs/screenshots/`（README 要引用，必须入库）
   - `dist-share/mock-src/*.html` → 移到 `docs/mock/`（假数据截图源码，转为贡献者工具）
   - `dist-share/README.md` → 内容是给共创工坊的上架物料，与开源无关，移出仓库或删除
   - `dist-share/*.dmg` → 不入库
   - 删除重复文件 `screenshots/01-overview.png`（是 `01-health-audit.png` 的副本）

5. `package.json` 元数据补全：
   ```jsonc
   "version": "0.3.0",
   "author": "<完整署名> (<GitHub handle>)",   // 待确认，见 §6
   "repository": { "type": "git", "url": "..." },
   "homepage": "...",
   "bugs": { "url": ".../issues" },
   "keywords": ["claude-code", "codex", "ai-agent", "observability", "electron", "devtools"]
   ```
   同时改 `electron-builder.yml:1` 的 appId 为 `io.github.jokerailab.agentcockpit`（依据见 §6）。

6. 新建 `LICENSE`（MIT，与 package.json 声明一致），署名与 `author` 保持一致。

**验收**：`git init && git add -A && git status` 后，暂存区总体积 < 5MB，无 dmg、无 tsbuildinfo、无 `settings.local.json`。

---

### Phase 1 · 纯函数抽离（i18n 与测试的共同前置）

**目的**：让核心算法既能被单测覆盖，又能承载 i18n 的 key 化改造。**这是整个方案里唯一的代码结构改动，也是后两个 Phase 的地基。**

**问题**：`sessions/engine.ts`（909 行）里混着两类代码：
- 纯计算：`degenerateRun` / `scoreHealth` / `modelLimit` / `statusFrom` / `burnRate` / `computeActivity` / `hasToolResult` / `hasToolUse` / `hasToolError` / `extractText`
- IO 与副作用：文件扫描、增量读取、`recordSpend`（→ electron）

因为同文件，测试纯函数会连带拉起 `electron.app`，在 Node 环境里直接崩。

**动作**

1. 新建 `src/main/sessions/health.ts`，迁入上述纯函数。零 import electron、零 import fs。

2. `scoreHealth()` 签名改造，这是关键一步：

   ```ts
   // 之前：直接返回中文
   interface Health { score: number; status: ...; diag: string | null }

   // 之后：返回结构化 key + 参数，文案渲染留给调用方
   export type DiagKey =
     | "contextBlown"    // 上下文撑爆
     | "contextTight"    // 上下文吃紧
     | "spinningBad"     // 空转严重
     | "spinning"        // 空转
     | "degenerate"      // 复读退化
     | "stalled"         // 反复催「继续」
     | "errorProne"      // 报错频繁
     | "churning"        // 反复压缩
     | "bloated"         // 体积臃肿
     | "tooManyTurns";   // 轮次过多

   export interface Health {
     score: number;
     status: "healthy" | "degrading" | "failing";
     diagKey: DiagKey | null;
     diagParams: Record<string, number>;   // 如 { run: 8420 }、{ pct: 22 }
   }
   ```

3. `src/shared/sessions.ts` 的 `AgentSession` / `SessionAudit` 增加字段：
   ```ts
   healthDiag: string | null;        // 保留：已翻译好的展示文案
   healthDiagKey: DiagKey | null;    // 新增：供 UI 逻辑分支使用
   ```

4. **修复 `handleAdvice()`（`App.tsx:400`）**：从匹配中文子串改为 `switch (a.healthDiagKey)`。
   当前实现 `d.includes("复读")` 在英文 locale 下会全部落到兜底分支，这是 i18n 引入的静默回归，必须在这一步一并解决。

5. `sessions/engine.ts` 保留 IO 与编排，从 `health.ts` import 纯函数。

**验收**：`npm run typecheck` 通过；`node -e "require('./src/main/sessions/health.ts')"` 等价路径下不触发 electron；行为无变化（手动跑一次 dev 对比会话体检面板输出）。

---

### Phase 2 · i18n（英文默认）

**目的**：英文成为默认语言，中文作为可选。这是 C 档的核心工作量。

#### 架构决策：共享词典 + 主进程渲染文案

考虑过两种方案：

| 方案 | 做法 | 结论 |
|---|---|---|
| A. 结构化 key 一路传到渲染层 | `Alert` 只带 key + params，renderer 翻译 | **否决**。OS 通知（`notify.ts`）和托盘/应用菜单（`index.ts`）都在主进程发出，主进程无论如何都需要一份 `t()`。这方案等于两边各维护一套 |
| B. 共享 i18n 模块，两个进程都能 `t()` | 词典放 `src/shared/i18n/`，主进程与渲染进程各自 import，locale 通过 settings 同步 | **采用**。只有一份词典，`Alert` 形状不变，通知与菜单天然支持 |

例外：`healthDiagKey` 仍要透出到渲染层（Phase 1 已做），因为 UI 需要按诊断类型做**逻辑分支**，不只是显示文案。key 用于逻辑，翻译后的字符串用于显示，两者并存不矛盾。

#### 目录结构

```
src/shared/i18n/
  index.ts     # t() / setLocale() / getLocale() / detectLocale()
  en.ts        # 英文词典（唯一的 key 真源）
  zh-CN.ts     # 中文词典
```

#### 类型安全

`en.ts` 是 key 的唯一真源，`zh-CN.ts` 用类型约束强制补全，缺 key 直接编译报错：

```ts
// en.ts
export const en = {
  "health.diag.degenerate": "Repetition loop (same token ×{run})",
  "health.diag.contextBlown": "Context window exhausted",
  "alert.context.title": "Context {pct}%",
  "tray.openCockpit": "Open Cockpit",
  // ...
} as const;
export type I18nKey = keyof typeof en;

// zh-CN.ts
import type { I18nKey } from "./en";
export const zhCN: Record<I18nKey, string> = {
  "health.diag.degenerate": "复读退化（同词 ×{run}）",
  // 少一个 key → tsc 报错
};
```

插值用 `{name}` 占位，`t(key, params)` 做简单字符串替换，不引第三方 i18n 库（依赖体积不值当，需求只有插值一项）。

#### locale 解析与同步

1. `AppSettings` 增加 `locale: "auto" | "en" | "zh-CN"`，默认 `"auto"`
2. `"auto"` 时用 `app.getLocale()` 检测，`zh` 前缀 → `zh-CN`，其余 → `en`
3. `settings.ts` 的 `applyAll()` 里调用 `setLocale()`，并触发：
   - 重建应用菜单（`Menu.setApplicationMenu`）
   - 重建托盘菜单与 tooltip
   - 通过现有的 `menuEvent` 通道广播给 renderer 触发重渲染
4. 设置面板加语言下拉（`SettingsModal`，`App.tsx:154`）

#### 改造清单（按文件，共约 315 处字符串）

| 文件 | 处数 | 要点 |
|---|---|---|
| `src/renderer/src/App.tsx` | 199 | 量最大。含 `handleAdvice()` 的 7 条建议文案（Phase 1 已改为按 key 分支，此处只翻译文案） |
| `src/renderer/src/PopoverPanel.tsx` | 35 | 菜单栏 popover |
| `src/main/alerts/engine.ts` | 23 | 8 类告警的 title/detail，全部带插值 |
| `src/main/sessions/engine.ts` | 21 | 主要是 `scoreHealth` 的 diag（Phase 1 已 key 化，此处只需在 `buildClaudeSession` 里调 `t()` 填 `healthDiag`） |
| `src/main/index.ts` | 17 | 应用菜单 + 托盘菜单 + tooltip |
| `src/main/alerts/notify.ts` | 11 | 分类名映射 + 「待你回复」通知 |
| `src/main/sessions/claude-hook.ts` | 6 | 错误信息（`~/.claude 不存在` 等） |
| `src/main/ipc/index.ts` | 1 | 一处注释里的中文「口径」，顺手清掉 |
| `src/renderer/src/styles/app.css` | 1 | 检查是否为 content 属性，是则移入 i18n |

#### 中文兜底策略

英文词典是唯一真源。若某个 key 在 `zh-CN` 缺失（理论上被类型系统挡住），`t()` 运行时回退到英文而非抛错。

**验收**：
- `npm run typecheck` 通过（缺 key 会在这里暴露）
- 系统语言设为英文启动，全界面无中文残留（含托盘菜单、OS 通知、会话体检建议）
- 设置里切到中文，界面、菜单、通知全部即时切换，无需重启
- 英文 locale 下会话体检的「建议」列显示正确分类建议，不是兜底文案（验证 Phase 1 的 key 分支改造生效）

---

### Phase 3 · 测试

**目的**：零测试是"玩具感"的第二大来源。目标不是覆盖率数字，是覆盖**核心算法**。

**技术选型**：vitest（与现有 vite 工具链同源，零额外配置负担）。

**范围**：只测 Phase 1 抽离出的纯函数 + `pricing.ts`。不测 Electron 相关模块（monitor / db / index），不做 E2E。

#### 用例清单

**`src/main/sessions/health.test.ts`**

`degenerateRun()`：
- 正常文本 → 0
- token 数 < 15 → 0（下限保护）
- 连续同词 ×8 → 返回 8（阈值边界）
- 连续同词 ×7 → 0（阈值下方）
- 交替低多样性 `a b a b a b...` ≥20 token → 返回 token 总数
- 真实退化样本（`court` ×N 缩样）→ 命中
- `null` / 空串 → 0

`scoreHealth()`：
- 全健康输入 → score 100 / `healthy` / diagKey `null`
- contextPct 0.95 → 扣 35，diagKey `contextBlown`
- contextPct 0.85 → 扣 20，diagKey `contextTight`
- 空转率 > 0.4（且样本 ≥6）→ 扣 30，`spinningBad`
- 空转率 0.2–0.4 → 扣 15，`spinning`
- 样本 < 6 → 不因空转扣分（样本量保护）
- 复读 run ≥8 → 扣 50，`degenerate`
- **多重罚分时 diagKey 取罚分最大的那条**（`pen()` 的 worst 逻辑，最容易写错的地方）
- score 钳制在 0–100
- 状态分界：70 / 40 两个边界值各测一次
- `healthy` 时 diagKey 强制为 `null`

`modelLimit()`：
- `[1m]` 后缀 → 1_000_000
- gpt / codex / o3 / o4 → 272_000
- gemini → 1_000_000
- 未知 / null → 200_000

`statusFrom()`：< 60s → active；60s–10min → recent；> 10min → idle（边界各一）

`burnRate()`：样本 < 2 → 0；时间跨度 0 → 0（除零保护）；成本回退 → 0（`Math.max(0, ...)`）；正常斜率计算

`computeActivity()`：
- 文件 age > 15min → `idle`
- 末条为 user → `working`
- stop_reason `tool_use` → `working`
- stop_reason `end_turn` → `awaiting`
- `max_tokens` / 未知 → `awaiting`

**`src/main/sessions/pricing.test.ts`**
- opus / sonnet / haiku / gpt-5 / gemini-flash 各命中正确费率
- **规则顺序**：`gemini-2.5-flash` 必须命中 flash 规则而非通用 gemini 规则
- 未知模型 → `null`（不猜）
- `priceSession()` 四类 token 加权求和 + 两位小数舍入
- model 为 `null` → `null`

**`src/shared/i18n/i18n.test.ts`**
- `t()` 插值替换正确
- 缺参数时占位符原样保留（不崩）
- zh-CN 与 en 的 key 集合完全一致（这条用运行时断言兜底类型系统）

**配套改动**
- 新增 `vitest.config.ts`，配好 `@shared` / `@renderer` 路径别名（复用 `electron.vite.config.ts` 里的定义）
- `package.json` 加 `"test": "vitest run"` 与 `"test:watch": "vitest"`
- 更新 `scripts/test.sh`：当前它是启动器（dev / app / dmg），名字有歧义。改为 `scripts/run.sh` 或在菜单里加第 4 项 "unit tests"，避免贡献者以为 `./scripts/test.sh` 是跑测试的

**验收**：`npm test` 全绿，用例数 ≥ 45。

---

### Phase 4 · 文档体系

**目的**：文档本身就是"有干货"的证据。尤其 `HEALTH-MODEL.md`，它把埋在 909 行注释里的真实校准经验翻出来给人看。

#### `README.md`（英文为主，中文版另置）

结构，从上到下：

1. 标题 + 一句话定位 + badge（CI / license / platform / release）
2. **首屏截图**：`docs/screenshots/01-health-audit.png`（招牌功能，会话体检）
3. **Why**（3 到 4 句）：agent 会退化、空转、复读、撑爆上下文，而你只能靠感觉判断该不该重开。这个工具把判断变成可量化的分数和诊断
4. **Features**：分组列，健康诊断放第一组
5. 另外两张截图（会话卡片、菜单栏 popover）
6. **Privacy**：一句强断言 + 可复现验证命令，链到 `PRIVACY.md`
7. **Install**：macOS dmg 下载 + 一次性 "Open Anyway" 四步说明
8. **Platform support** 表格：
   | Platform | Status |
   |---|---|
   | macOS (arm64 / x64) | ✅ Supported, actively used |
   | Windows | ⚠️ Builds, never verified. PRs welcome |
   | Linux | ⚠️ Builds, never verified. PRs welcome |
9. **Supported agents**：17 个 agent 表格，附一句"加一个 = 加一条 descriptor"并链到 `ADDING-AN-AGENT.md`
10. **Development**：现有命令 + `npm test`
11. Docs 索引、License

**必须删掉**："当前阶段 P0 — Electron 骨架已就绪" 整段，以及那张把 P1–P5 全标成未完成的路线图。改为真实的已完成能力清单。**这是全方案里单点收益最高的一处改动。**

`README.zh-CN.md`：中文版，顶部互相链接。

#### `docs/HEALTH-MODEL.md`（最高价值文档）

把评分模型完整摊开：

- 输入信号从哪来（Claude jsonl 的哪些字段、Codex 为何不适用）
- 十条罚分规则逐条列表：触发条件、扣分、诊断 key、**校准来源**
- 显式写出真实校准案例：`court court court...` 那次 run 13441 的复读会话；`> 200k context ⇒ 1M tier` 的探针（因为 jsonl 的 model 字段不带 `[1m]` 后缀，2026-06 验证）
- 分数到状态的映射（70 / 40）
- **已知局限与误报边界**：为什么样本 < 6 不判空转；为什么 Codex 不打健康分；哪些正常场景可能被误判

写清局限比吹准确率可信得多。

#### `docs/ARCHITECTURE.md`

- 三进程结构图（main / preload / renderer）与职责边界
- `src/shared/ipc.ts` 作为 IPC 单一契约源的设计（channel 名 + payload 形状 + `CockpitApi` 类型，一处改动两端同步）
- **增量 jsonl 解析器**：byte offset 推进、offset 永远停在换行边界（因此 UTF-8 多字节不会被切断）、文件截断/轮转的重置逻辑、`sig = mtime:size` 的缓存失效
- 发现引擎：descriptor 驱动 + 路径 token 展开（`~` / `@config` / `@appSupport`）的跨平台策略
- 监控引擎：进程归因（解释器 `node`/`python` → 映射到实际脚本）、CPU 按核归一化
- SQLite schema（4 张表）与保留策略
- Claude 配额侧信道：为什么走 statusLine hook，以及为什么它是幂等的、不覆盖用户已有配置、写前备份

#### `docs/ADDING-AN-AGENT.md`

照着 `catalog.ts` 加一条 descriptor 的教程：字段逐个解释、路径 token 语义、`PROC_TOKENS`（`monitor/engine.ts`）里补进程名匹配、本地怎么验证检测生效。目标是让贡献者 5 分钟提一个 PR。

#### `PRIVACY.md`

- **零出站网络请求**，附验证命令：
  ```bash
  grep -rnE "fetch\(|axios|https?://|net\.request|WebSocket" src/
  ```
  并说明唯一命中项是 CSS 里的 SVG 命名空间字面量
- 读取清单：`~/.claude/projects/**.jsonl`、`~/.codex/sessions/**`、各 agent 的配置目录、进程列表、监听端口、每个会话 cwd 的 `git status --porcelain`
- **写入清单**（只有三处）：应用自己的 SQLite（`userData/cockpit.db`）；`~/.claude/cockpit-statusline.sh`；`~/.claude/settings.json` 的 `statusLine` 字段（写前一次性备份为 `.cockpit-bak`，检测到用户已有 statusLine 则拒绝覆盖并报冲突）
- 会话内容（对话原文）只在内存中解析用于统计，从不落盘、从不上传
- 卸载后如何清理残留

#### `CONTRIBUTING.md` + `.github/ISSUE_TEMPLATE/`

- 开发环境、`npm test` 门槛、代码风格（跟随现有：注释解释 why 不解释 what）
- 三个 issue 模板：bug / agent support request / feature
- PR 模板：勾选 typecheck 与 test

#### `docs/mock/README.md`

说明假数据截图工作流：改 UI 后如何用 `docs/mock/*.html` 加无头 Chrome 重新生成截图，复用真实 CSS 但不泄露任何真实项目名。这是个能体现专业度的细节，值得单独成文。

---

### Phase 5 · CI 与发布

#### `.github/workflows/ci.yml`

```
触发：push 到 main、所有 PR
矩阵：ubuntu-latest / macos-latest / windows-latest
步骤：npm ci → npm run typecheck → npm test → npm run build
```

**已知风险**：`npm ci` 会为 `better-sqlite3` 走 node-gyp 编译。三平台 runner 都自带工具链，理论可行，但首次跑可能较慢或在 Windows 上出问题。**降级预案**：若 Windows job 不稳定，先只保留 ubuntu + macos，Windows 单独标为 experimental 且 `continue-on-error: true`，不阻塞 PR 合并。

#### `.github/workflows/release.yml`

- 触发：push tag `v*`
- macOS runner 跑 `npm run dist:mac`，产物（arm64 + x64 dmg）上传到 GitHub Release
- 复用 `scripts/release-mac.sh` 的逻辑，但**去掉里面的 npmmirror 国内镜像环境变量**（那是本地网络环境的产物，CI 上会拖慢甚至失败）。做法：把镜像设置改为仅当 `CI` 环境变量不存在时才导出
- Release notes 里附 "Open Anyway" 四步说明

#### 首发

- tag `v0.3.0`
- **必须本地重新构建 dmg**：appId 已变更（§6），`dist-share/` 里的旧包 bundle id 仍是 `top.qiaokezhizao.*`，不能复用。跑 `npm run release:mac` 出新包后作为 assets 上传，避免首发就依赖尚未验证的 CI 发布链路

---

## 3. 执行顺序与依赖

```
Phase 0 （仓库卫生）
   ↓  必须最先，否则 git 历史会脏
Phase 1 （纯函数抽离 + diagKey 化 + 修 handleAdvice）
   ↓  Phase 2 和 3 都依赖它
Phase 2 （i18n）        Phase 3 （测试）
   ↓                        ↓
   └──────── 合流 ──────────┘
   ↓
Phase 4 （文档）   ‖   Phase 5 （CI / 发布）   ← 可并行
   ↓
git init → 首个 commit → push → tag v0.3.0
```

Phase 3 的测试可以在 Phase 2 之前写（针对 diagKey 断言，不依赖文案），这样 i18n 改造有回归网兜底。**建议顺序：0 → 1 → 3 → 2 → 4/5**，让测试先于 i18n 落地。

---

## 4. 工作量估算

| Phase | 内容 | 估算 |
|---|---|---|
| 0 | 仓库卫生 | 0.5h |
| 1 | 纯函数抽离 + diagKey 改造 | 2h |
| 3 | vitest + 45 个用例 | 3h |
| 2 | i18n（315 处字符串 + locale 同步 + 设置项） | 6 到 8h |
| 4 | 文档体系（README ×2 + 4 篇 docs + PRIVACY + CONTRIBUTING + 模板） | 5h |
| 5 | CI + release workflow | 2h |
| | **合计** | **约 19 到 21h** |

大头是 Phase 2 的 i18n（`App.tsx` 一个文件就 199 处）和 Phase 4 的文档。

---

## 5. 风险登记

| 风险 | 影响 | 应对 |
|---|---|---|
| i18n 漏改导致英文界面出现中文残留 | 观感直接崩，且是国际受众的第一印象 | 加一条 CI 检查：`grep -rnE '[一-龥]' src/main src/renderer --include=*.ts --include=*.tsx` 只允许命中 `src/shared/i18n/zh-CN.ts` 与注释行。设为硬门槛 |
| `handleAdvice()` 的 key 化漏做 | 英文下会话体检建议全部退化为兜底文案，招牌功能显得很蠢 | Phase 1 明确处理，Phase 2 验收清单里单列一条验证 |
| better-sqlite3 在 CI 三平台编译失败 | CI badge 红，观感差于没有 CI | Windows job 先设 `continue-on-error`，稳定后再转硬门槛 |
| 翻译质量（中译英生硬） | 削弱专业感 | 术语先定表（session health / degeneration / spinning / context blown / burn rate），全文档与 UI 统一用词 |
| 首屏截图是中文界面 | 与英文 README 割裂 | i18n 完成后用 `docs/mock/` 重新生成英文截图，替换现有三张。**这项依赖 Phase 2 完成**，需排在 Phase 4 的 README 定稿之前 |
| 用真实数据截图泄露隐私 | 严重 | 一律走 `docs/mock/` 假数据渲染，绝不用真实会话截图 |

---

## 6. 已确认的决策（2026-08-14）

| 项 | 决定 |
|---|---|
| 署名 | `乔氪智造 (Joker AI Lab)`，`package.json` 的 `author` 写 `乔氪智造 (Joker AI Lab) <@jokerailab>` |
| LICENSE 版权行 | `Copyright (c) 2026 乔氪智造 (Joker AI Lab)` |
| 仓库 | `jokerailab/agent-cockpit`（已确认未被占用）。由本地 `gh` 直接创建，无需手工建 |
| commit 身份 | `user.name = jokerailab`，`user.email = 1432558+jokerailab@users.noreply.github.com`（GitHub noreply，不暴露真实邮箱）。**仅设仓库级，不动全局配置** |
| 共创工坊物料 | 不开源。`dist-share/README.md` 移到仓库外保留（后续上架仍要用），不删除 |
| **appId** | **改为 `io.github.jokerailab.agentcockpit`** |

### appId 变更的依据（修正先前判断）

先前判断「改 appId 会让已安装用户的配置目录漂移」**不成立**。实测数据目录为：

```
~/Library/Application Support/Agent Cockpit      # 打包版
~/Library/Application Support/agent-cockpit      # dev 版
```

该路径由 `productName` 决定，与 appId 无关，`cockpit.db` 不受影响。

appId 的真实作用域是 macOS `CFBundleIdentifier`（Windows 为 NSIS 卸载注册表键），全代码库零引用，仅出现在 `electron-builder.yml:1`。实测 `~/Library/Preferences/com.apple.ncprefs.plist` 中记录着 `qiaokezhizao.agentcockpit`，即**通知授权按此键索引**。

因此变更代价仅为：macOS 通知权限需重新授权一次、开机自启需重设。当前安装量近乎为零，成本可忽略；一旦有用户再改则需全员重新授权。

改用 `io.github.<handle>` 前缀是开源项目通行做法（Flathub 强制要求该类前缀），且无需实际拥有域名。保留个人域名会让使用者误以为项目与该站点存在商业关联。

**附带影响**：变更后需重新出包，旧版 `dist-share/*.dmg` 不能作为 v0.3.0 的 release asset 直接复用（bundle id 已变）。首发需重新构建，Phase 5 相应调整。

---

## 7. 最终交付清单

```
新增
  LICENSE
  PRIVACY.md
  CONTRIBUTING.md
  README.zh-CN.md
  vitest.config.ts
  src/main/sessions/health.ts
  src/main/sessions/health.test.ts
  src/main/sessions/pricing.test.ts
  src/shared/i18n/{index,en,zh-CN}.ts
  src/shared/i18n/i18n.test.ts
  docs/HEALTH-MODEL.md
  docs/ARCHITECTURE.md
  docs/ADDING-AN-AGENT.md
  docs/mock/README.md
  docs/screenshots/*.png        （英文重渲染版）
  docs/mock/*.html              （自 dist-share/mock-src 迁入）
  .github/workflows/ci.yml
  .github/workflows/release.yml
  .github/ISSUE_TEMPLATE/{bug,agent-support,feature}.md
  .github/pull_request_template.md

改写
  README.md                     （英文，全面重写）
  .gitignore
  package.json                  （元数据 + test 脚本 + 0.3.0 + vitest 依赖）
  src/main/sessions/engine.ts   （抽离纯函数 + t() 渲染 diag）
  src/shared/sessions.ts        （+ healthDiagKey）
  src/shared/settings.ts        （+ locale）
  src/main/settings.ts          （locale 生效与广播）
  src/main/index.ts             （菜单/托盘 i18n）
  src/main/alerts/{engine,notify}.ts
  src/main/sessions/claude-hook.ts
  src/renderer/src/App.tsx      （i18n + handleAdvice 按 key 分支）
  src/renderer/src/PopoverPanel.tsx
  scripts/test.sh               （更名或加单测入口）
  scripts/release-mac.sh        （CI 下跳过国内镜像）

移除出库
  dist-share/                   （dmg 走 Releases，截图与 mock 迁入 docs/）
  icon-source.png
  *.tsbuildinfo
```
