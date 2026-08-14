<div align="center">

# Agent Cockpit

**本机 AI coding agent 的可观测性工具。**

不只看谁在跑，而是看哪个会话已经坏掉了，
以及它还能不能救。

[![CI](https://github.com/jokerailab/agent-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/jokerailab/agent-cockpit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
[![Release](https://img.shields.io/github/v/release/jokerailab/agent-cockpit?include_prereleases)](https://github.com/jokerailab/agent-cockpit/releases)

[English](README.md) · [简体中文](README.zh-CN.md)

<img src="docs/screenshots/01-health-audit.png" width="720" alt="会话体检：每个近期会话都打分、诊断并给出处理建议">

</div>

---

## 为什么要有它

coding agent 不会干脆地失败，它是慢慢变得没用的。

它开始回复但什么都不产出。它把一个词重复四千遍。它把上下文窗口烧在一份自己
已经用不上的对话记录上。从外面看，这三种情况跟「还在正常干活」长得一模一样，
于是你继续敲「继续」，每一轮都在真金白银地花钱，而对话记录烂得更彻底。

正确做法通常是放弃这个会话，把任务交接给一个新的。但前提是你得知道**哪个**
会话烂了，以及**为什么**。

Agent Cockpit 给每个近期会话打 0 到 100 分，指出唯一值得处理的那个问题，
并告诉你该 compact、该交接，还是该直接弃掉。它常驻菜单栏，关掉窗口后继续盯。

## 它做什么

**会话健康度打分。** 十条规则扫你的会话日志，识别上下文撑爆、空转（回复什么
都没产出）、复读死循环、工具报错风暴、反复压缩抖动、卡死催促。每个会话给一个
分数、一条主诊断、一句具体建议。完整模型（含校准数据与已知误报）见
[docs/HEALTH-MODEL.md](docs/HEALTH-MODEL.md)。

**守护式通知。** 最值回票价的一条：agent 干完这轮、正在等你时弹通知。另外还有
燃烧速率过高、限额即将触顶、进程跑飞、孤儿 dev server。关着窗口也照样触发。

**成本与限额，口径老实。** 按公开单价算的等价 API 成本、5h / 7d 限额窗口、
每分钟燃烧速率。如果你走订阅，它报的是等价价值和回本倍数，而不是假装你被按
token 扣了钱。未知模型显示 `—`，不瞎猜。

**自动发现。** 零配置识别 17 个 agent。加一个新的 = 在一个数组里加一条：
[docs/ADDING-AN-AGENT.md](docs/ADDING-AN-AGENT.md)。

**实时进程监控。** 带 agent 归属的进程树（能把 `node` 还原成真正的 agent）、
按整机核数归一化的 CPU、监听端口、孤儿 dev server 检测、一键 kill。

<div align="center">
<img src="docs/screenshots/02-session-cards.png" width="420" alt="会话卡片：健康 banner、上下文占用、token 构成、燃烧速率">
<img src="docs/screenshots/03-popover.png" width="400" alt="菜单栏 popover：待你回复队列、限额条、告警">
</div>

## 隐私

这个 app 会读你的会话日志，里面是你的对话内容。所以：

**它完全不发任何网络请求。** 没有遥测、没有统计、没有崩溃上报、没有更新检查、
没有账号。所有数据都在本地一个 SQLite 文件里。

别信我，自己验：

```bash
grep -rnE "fetch\(|axios|https?://|net\.request|WebSocket" src/
```

唯一命中是某个样式表里 SVG 的 XML 命名空间。运行时依赖只有 `better-sqlite3`
和 `systeminformation`，整个项目里没有 HTTP 客户端。

对话文本只在内存里解析用于打分，从不落盘。数据库里只存数字。完整的读写清单见
[PRIVACY.md](PRIVACY.md)。

## 安装

从 [Releases](https://github.com/jokerailab/agent-cockpit/releases) 下载最新的
`.dmg`，拖进「应用程序」。

这个 app 是 ad-hoc 签名，没有花钱买苹果开发者证书做公证。所以首次打开时
macOS 会拦，这是正常的，多一步就好：

1. 双击打开，macOS 提示「无法验证开发者」或「已损坏」
2. 打开 **系统设置 → 隐私与安全性**，往下滚
3. 找到 Agent Cockpit，点 **仍要打开**

只需一次，不是每次。如果你不想信任二进制包，自己构建：
`npm install && npm run dist:mac`。

## 平台支持

| 平台 | 状态 |
| --- | --- |
| macOS（arm64 / x64） | ✅ 支持，作者每天在用 |
| Windows | ⚠️ CI 能构建能过类型检查，作者没实际跑过。欢迎 PR |
| Linux | ⚠️ 同上。AppImage 打包配置有，但未验证 |

说实话：发现层写了 Windows 和 Linux 的平台路径，打包目标也在，但没人确认过它
在那两个平台真的能用。你要是试了，不管成没成，开个 issue 都有价值。

## 已支持的 agent

| | | |
| --- | --- | --- |
| Claude Code `†` | Codex `†` | Gemini CLI |
| Cursor | Windsurf | Antigravity |
| opencode | Aider | Goose |
| Amp | Cline | Continue |
| Qwen Code | 通义灵码 Lingma | CodeBuddy |
| Trae | CodeGeeX | |

`†` 支持会话内省（上下文、token、成本）。健康度打分只有 Claude Code，因为它是
唯一暴露了逐轮信号的日志格式，原因见
[模型的局限](docs/HEALTH-MODEL.md#known-limits-and-false-positives)。
其余 agent 有检测、进程归属和资源监控，UI 会明确标注这一点，而不是给你看一堆零。

## 开发

```bash
npm install
npm run rebuild    # 按 Electron ABI 重建 better-sqlite3
npm run dev        # Electron + renderer 热更
npm run verify     # 类型检查 + 中文残留检查 + 测试（CI 的门槛）
npm test           # 只跑单测
npm run build      # 三进程产物到 out/
npm run dist:mac   # 打 dmg
```

需要 Node 20+。

`npm run rebuild` 这步不能省：`better-sqlite3` 是原生模块，npm 装的是匹配你
Node 运行时的预编译包，而 Electron 的 ABI 不一样（npm 有时候甚至会拉错 CPU
架构）。跳过它 app 能起来，但所有数据库调用都会报 `incompatible architecture`
或 `NODE_MODULE_VERSION`。任何动了 lockfile 的 `npm install` 之后都要重跑一次。
打包时 `npmRebuild` 会自动处理，不用管。

## 文档

- [架构](docs/ARCHITECTURE.md)：进程划分、IPC 契约、增量日志读取、进程归属、存储
- [健康模型](docs/HEALTH-MODEL.md)：每条规则、校准依据、以及它在哪里会判错
- [新增一个 agent](docs/ADDING-AN-AGENT.md)：5 分钟就能提的贡献
- [隐私](PRIVACY.md)：到底读了什么、写了什么
- [贡献指南](CONTRIBUTING.md)

## 许可

MIT © 乔氪智造 (Joker AI Lab)
