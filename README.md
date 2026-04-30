# 🐺 狼人杀联机版 — Werewolf Online

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-6c3ce0?style=flat-square&logo=github" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-d4a843?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-3cb878?style=flat-square&logo=nodedotjs" alt="Node.js" />
  <img src="https://img.shields.io/badge/players-6~18-e04040?style=flat-square" alt="Players" />
</p>

<p align="center">
  <b>✨ 一个支持 6~18 人实时在线对战的狼人杀游戏</b><br/>
  星空月夜主题 · 实时语音级交互 · 自动断线保护 · 完整的 E2E 测试覆盖
</p>

<p align="center">
  <a href="#快速开始">🚀 快速开始</a> •
  <a href="#角色介绍">🎭 角色介绍</a> •
  <a href="#技术栈">🛠 技术栈</a> •
  <a href="#测试">🧪 测试</a>
</p>

---

## 🌙 项目简介

**狼人杀联机版** 是一款基于 Web 的实时多人社交推理游戏。无需下载客户端，打开浏览器即可与好友联机对战。项目采用星空月夜视觉主题，配合中国风书法字体，营造沉浸式的狼人杀氛围。

> 🎯 **核心体验**：创建房间 → 邀请好友 → 自动发牌 → 昼夜交替 → 推理投票 → 胜负揭晓

### 在线演示

```bash
# 本地一键启动，5 秒开局
npm install
npm start
# 打开 http://localhost:3000 即可游玩
```

---

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| 🌌 **沉浸式 UI** | 星空背景 + 动态月光 + 中国风书法字体，支持响应式布局 |
| ⚡ **实时对战** | 基于 Socket.IO 的 WebSocket 通信，延迟低于 100ms |
| 🏠 **房间系统** | 6 位随机大写字母+数字房间号，支持 6~18 人灵活开局 |
| 🎭 **6 大角色** | 狼人、村民、预言家、女巫、猎人、守卫，平衡性精心调校 |
| 💬 **双频道聊天** | 白天全员公聊 + 夜晚狼人密聊，信息隔离不出戏 |
| 🔌 **断线保护** | 玩家断线自动跳过操作，归来无缝重连 |
| ⏱️ **限时投票** | 白天投票限时 60 秒，节奏紧凑不拖沓 |
| 📱 **多端兼容** | 支持桌面端、手机端、平板浏览器访问 |
| 🧪 **自动化测试** | Playwright E2E 测试 + GitHub Actions CI/CD |

---

## 🎭 角色介绍

| 角色 | 阵营 | 能力 | 难度 |
|------|------|------|------|
| 🐺 **狼人** | 狼人阵营 | 每晚与队友商议并猎杀一名玩家 | ⭐⭐ |
| 👨‍🌾 **村民** | 好人阵营 | 无特殊能力，通过推理和投票找出狼人 | ⭐ |
| 🔮 **预言家** | 好人阵营 | 每晚查验一名玩家身份（好人/狼人） | ⭐⭐⭐ |
| 🧪 **女巫** | 好人阵营 | 拥有一瓶解药和一瓶毒药，各可使用一次 | ⭐⭐⭐ |
| 🏹 **猎人** | 好人阵营 | 被淘汰时可开枪带走一名玩家 | ⭐⭐ |
| 🛡️ **守卫** | 好人阵营 | 每晚守护一名玩家，不可连续守护同一人 | ⭐⭐⭐ |

> 系统根据玩家人数自动匹配最优角色配置，确保游戏平衡性。

---

## 🛠 技术栈

### 后端
- **Node.js** — 高性能运行时
- **Express** — 轻量级 Web 框架
- **Socket.IO** — 实时双向事件通信

### 前端
- **HTML5 + CSS3** — 语义化标记与现代样式
- **Vanilla JavaScript** — 原生 JS，零框架依赖
- **Canvas API** — 动态星空背景渲染
- **Google Fonts** — 马善政书法字体 + 站酷小薇体

### 测试 & DevOps
- **Playwright** — 端到端自动化测试
- **GitHub Actions** — CI/CD 流水线

---

## 🚀 快速开始

### 环境要求
- Node.js ≥ 18
- npm ≥ 9

### 安装与启动

```bash
# 1. 克隆仓库
git clone https://github.com/20190441309/Werewolf-game.git
cd Werewolf-game

# 2. 安装依赖
npm install

# 3. 启动服务器
npm start

# 4. 打开浏览器访问
open http://localhost:3000
```

### 邀请好友
1. 点击「创建房间」生成 6 位房间号
2. 将房间号分享给好友
3. 好友输入房间号加入，人满即可开始！

---

## 🧪 测试

本项目拥有完整的自动化测试体系：

```bash
# 安装 Playwright 浏览器
npm run prepare:e2e

# 运行端到端测试
npm run test:e2e
```

### CI/CD 流水线

每次 `push` 到 `main` / `develop` 分支时，GitHub Actions 会自动执行：
- ✅ 依赖安装
- ✅ Playwright 浏览器初始化
- ✅ 全量 E2E 测试
- ✅ 测试报告归档（保留 30 天）

---

## 📁 项目结构

```
Werewolf-game/
├── .github/workflows/e2e.yml   # GitHub Actions CI 配置
├── public/
│   └── index.html              # 静态入口页面
├── tests/
│   └── playwright/
│       ├── e2e.spec.js         # 端到端测试用例
│       └── functional.spec.js  # 功能测试用例
├── server.js                   # Express + Socket.IO 服务端
├── werewolf-game.html          # 游戏主页面（核心前端）
├── playwright.config.js        # Playwright 配置
├── TEST_PLAN.md                # 完整测试计划文档
├── package.json
└── README.md
```

---

## 🎮 游戏流程

```
大厅等待 → 角色分配 → 🌙 夜晚行动 → ☀️ 白天讨论 → 🗳️ 公开投票
    ↑                                                           │
    └──────────────── 轮回直到某方获胜 ───────────────────────────┘
```

**胜负判定**：
- 🐺 **狼人获胜**：所有神职或所有平民出局
- 👨‍🌾 **好人获胜**：所有狼人出局

---

## 🤝 贡献

欢迎提交 Issue 或 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支：`git checkout -b feature/xxx`
3. 提交更改：`git commit -m "feat: add xxx"`
4. 推送分支：`git push origin feature/xxx`
5. 提交 Pull Request

---

## 📜 开源协议

本项目基于 [MIT License](LICENSE) 开源。

---

<p align="center">
  <b>🌙 月圆之夜，谁是狼人？</b><br/>
  <sub>Made with ❤️ by <a href="https://github.com/20190441309">Huang jun</a></sub>
</p>
