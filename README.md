# 绩效表结算（纯前端 / GitHub Pages）

本项目用于离线解析地学馆绩效表（优先适配你们的 **docx 5列表格模板：第1列=字段名，第2~5列=内容区且可能重复**），并依据量化表（xlsx：含“标准事项/单价”列）完成：

- 解析与结构修复（去重取值，防止重复列被计多次）
- 讲解档位判断（跨校区/紧急/重要复杂/默认讲解）
- 计次/计价/汇总（A~D）
- 800封顶 + 超额分配（E~F，尽量减少代收人人数；支持优先代收名单）
- 一键导出 Excel

## 本地运行
```bash
npm i
npm run dev
```

## 构建
```bash
npm run build
```

将 `dist/` 部署到 GitHub Pages（Settings → Pages → Build and deployment → GitHub Actions 或选择 /docs/dist）。

## 重要说明
- 当前版本重点适配 docx 模板；xlsx/图片可后续扩展。
- “量化表模板”需要包含列：`标准事项(或事项名称)` 与 `单价`。
- 匹配策略：精确匹配优先；否则用字符重合度做近义候选（并落入异常表）。你可以在 `src/lib/extract.ts` 中替换为更强的同义词表或 embedding。
