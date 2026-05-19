# RiskPilot 质量门禁

## 本地验收流程

在提交代码前，必须确保以下三个命令全部通过：

```bash
# 1. TypeScript 类型检查（零错误）
npm run typecheck

# 2. 单元测试（全部通过）
npm test

# 3. 构建（无报错）
npm run build
```

## 命令说明

| 命令 | 作用 | 通过标准 |
|------|------|----------|
| `npm run typecheck` | 运行 `tsc --noEmit` 检查主进程和渲染进程 | 零类型错误 |
| `npm test` | 运行 vitest 单元测试 | 全部测试通过 |
| `npm run build` | 运行 electron-vite 构建 | 构建成功退出码 0 |

## 测试策略

- 测试应直接 import 生产代码，不复制逻辑
- 共享工具函数放在 `electron/utils/` 目录
- 测试文件放在 `tests/unit/` 目录
- 新增功能必须配套测试覆盖

## 当前测试覆盖

- `asset-upsert.test.ts` — 市场检测、资产类型识别、成本计算
- `import-parsing.test.ts` — CSV 解析、字段映射、行验证
- `market-provider.test.ts` — Mock 行情数据生成
- `alert-evaluation.test.ts` — 告警规则评估、状态机转换
