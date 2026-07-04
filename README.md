# AltPart AI — Vercel 部署版

元器件替代决策智能体。前端静态页 + Serverless Functions 后端，一键部署到 Vercel。

## 目录结构

```
altpart-vercel/
├── api/                          # Vercel Serverless Functions（自动识别为接口）
│   ├── health.js                 # GET  /api/health  健康检查+配置状态
│   ├── feedback.js               # GET/POST /api/feedback  用户反馈
│   ├── v2/
│   │   ├── recommend.js          # POST /api/v2/recommend  本地优先推荐(10选5)
│   │   ├── part-detail/[pn].js   # GET  /api/v2/part-detail/:pn  器件详情
│   │   └── check-local/[pn].js   # GET  /api/v2/check-local/:pn  本地库检查
│   ├── bom/process.js            # POST /api/bom/process  BOM批量(≤8)
│   ├── lifecycle/[pn].js         # GET  /api/lifecycle/:pn  生命周期
│   └── _lib/                     # 共享模块（下划线开头，不暴露为接口）
│       ├── _cors.js              # CORS+方法校验包装
│       ├── pipeline.js           # 推荐流程编排
│       ├── ezplm.js              # ezPLM本地库适配
│       ├── gemini.js             # Gemini调用
│       ├── component.js          # 参数查询
│       ├── category-templates.js # 品类模板
│       ├── scoring-node.js       # 评分引擎
│       └── cache.js              # 内存缓存（含KV替换说明）
├── public/
│   └── index.html                # 前端（静态，自动探测后端）
├── vercel.json
├── package.json
└── .env.example
```

## 部署方式一：网页导入（最简单）

1. 把这个文件夹推到 GitHub 仓库
2. 打开 https://vercel.com/new ，导入该仓库
3. Framework Preset 选 **Other**（无需构建），其余默认，点 Deploy
4. 部署完成后到 **Settings → Environment Variables** 添加：
   - `GEMINI_API_KEY` = 你的 Gemini Key（必填，否则推荐功能不可用）
   - `EZPLM_API_BASE` / `EZPLM_API_TOKEN`（可选，不填用内置演示数据）
5. 在 **Deployments** 里点 **Redeploy** 让环境变量生效

## 部署方式二：命令行

```bash
npm i -g vercel
cd altpart-vercel
vercel                 # 首次部署（预览环境）
vercel env add GEMINI_API_KEY    # 录入密钥
vercel --prod          # 正式部署
```

## 本地调试

```bash
npm i -g vercel
cp .env.example .env.local   # 填入 GEMINI_API_KEY
vercel dev                   # http://localhost:3000
```

## 验证部署

- 打开站点首页，顶部横幅会显示后端状态：
  - **前端演示模式** → 后端未部署/不可达，用内置 mock 数据
  - **后端已连接 · Gemini已配置 ✓** → 实时推荐可用
- 直接访问 `https://你的域名/api/health` 查看 JSON 配置状态

## 工作模式

| 条件 | 行为 |
|------|------|
| 未配 `GEMINI_API_KEY` | 前端用内置演示数据，所有 UI 可正常浏览 |
| 配了 `GEMINI_API_KEY`，未配 ezPLM | 真实 AI 推荐；本地库用内置 mock（STM32F103/GD32F103/LM358） |
| 都配置 | 完整生产模式：ezPLM 本地库优先 + AI 兜底 |

前端会自动尝试调用 `/api/v2/recommend`，**失败时无缝回退到演示数据**，因此即使后端没配好，页面也永远可用。

## 重要限制（Serverless 特性）

1. **内存不持久**：`cache.js` 和 `feedback.js` 用内存存储，冷启动即清空。
   生产需替换为 **Vercel KV**（见 `_lib/cache.js` 顶部注释）或数据库。
2. **函数超时**：`vercel.json` 设 `maxDuration: 30s`。
   - Hobby 计划上限 60s；BOM 批量因此限制单次 ≤8 个物料，大 BOM 请前端分批。
   - 单次推荐含多次 AI 调用，通常 6–15s。
3. **冷启动**：首次或闲置后调用有 1–2s 冷启动延迟，属正常。

## 接入真实 ezPLM

编辑 `api/_lib/ezplm.js`，三个函数对应 ezPLM 端点：

| 函数 | 期望端点 |
|------|---------|
| `queryLocalDB(pn)` | `GET {EZPLM_API_BASE}/api/parts/:pn` |
| `queryLocalDBBatch(pns)` | `POST {EZPLM_API_BASE}/api/parts/batch` |
| `queryPartDetail(pn)` | `GET {EZPLM_API_BASE}/api/parts/:pn/detail` |

字段映射集中在 `normalizeEzplmPart()` / `normalizeEzplmDetail()`，ezPLM 返回字段名不同只改这两处。

## 升级到持久化（推荐生产配置）

```bash
# 安装 Vercel KV
npm i @vercel/kv
# 在 Vercel 控制台 Storage 创建 KV 数据库并关联项目
# 然后按 _lib/cache.js 注释替换 get/set/delete 实现
```
