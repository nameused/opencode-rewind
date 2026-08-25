# opencode-rewind

[English](./README.md) | [中文](./README.zh-CN.md)

为 [opencode](https://opencode.ai) 提供的类 Claude Code `/rewind` 插件 — **无 git 依赖**，基于 prompt 的快照。

每个用户 prompt（非 `/` 命令）都会自动快照到 `.opencode/rewind/snapshots/<id>/` 并记录在 `.opencode/rewind/history.json`。通过 `/rewind` 列出，用方向键选择，6 选 1 恢复。

## 功能特性

- **自动快照**：每次用户输入自动快照（最多 100 条，`src/index.ts:25` 的 `MAX_HISTORY`），`write`/`edit` 会更新最后一条快照；`bash` 文件修改命令会创建 `auto:` 条目
- **忽略规则**：忽略 `.git/node_modules/.opencode/.cache/dist/build/.next/coverage/tmp/logs/.turbo/out/.parcel-cache/.vite/.idea/.vscode`，跳过 `>50MB` 大文件和软链，精确排除 `.opencode/rewind` 本身（避免递归拷贝）
- **.opencode 一致性**：`.opencode/*`（除 `rewind`/`node_modules`）会一并快照与恢复，`listFilesRecursive` 与 `snapshotWorkingTree` 逻辑一致
- **无侵入**：文件级拷贝，无需 git，非 git 项目也可用
- **交互式**：`/rewind` 列出最近 10 条，**按时间戳降序（最新在上）** 并过滤系统指令（`isIgnorablePrompt` 过滤 `你是 rewind 助手...`），方向键选择 → 6 个操作：
  1. Restore code and conversation（回退代码+对话）
  2. Restore conversation（仅对话）
  3. Restore code（仅代码）
  4. Summarize from here（从此处压缩后续）
  5. Summarize up to here（压缩此前）
  6. Never mind（取消）
- **Agent 工具**：`rewind`、`list_checkpoints`、`restore_checkpoint`（均过滤系统提示并按最新排序）
- **稳健的 prompt 提取**：`chat.message` 通过 `extractContent`/`getMessageFrom` 兼容 `string`/`array`/`parts`/`text`/`prompt` 多种格式
- **原子化历史**：`history.json` 先写 `tmp` 再 `rename`，单文件 `try/catch`，单个文件失败不影响整次快照
- **正确的合并策略**：`auto:` 提示会新建条目；仅非 `auto` 的最后一条才通过 `updateLastSnapshot` 更新，恢复后重置 `lastPrompt`

## 安装

### 从 npm 安装（发布后）

```bash
npm i opencode-rewind
```

`opencode.json`：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-rewind"]
}
```

重启 opencode 生效。

### 本地安装

```bash
cp plugin/rewind.ts .opencode/plugin/rewind.ts
# 或
cp src/index.ts .opencode/plugin/rewind.ts
```

`src/index.ts` 为源文件（`plugin/rewind.ts` 已同步）。

## 使用

| 命令 | 说明 |
|------|------|
| `/rewind` | 交互式列表（最近 10 条，最新在上，已过滤系统指令）→ 方向键 → 6 选 1 |
| `/rewind <index> --action=1` | 直接恢复：`1=code+conv, 2=conv, 3=code, 4=summarize-from, 5=summarize-upto, 6=never`（`--confirm` 为 `1` 的别名） |
| `/checkpoint [label]` | 手动快照，带标签（空则为 `manual-<ISO>`） |
| `list_checkpoints`（工具） | 供 agent 使用的同款过滤/排序列表 |
| `restore_checkpoint {steps, action}` | 编程式恢复 |

Agent 自然语言：

```
列出 checkpoints
恢复到第2个检查点
```

排序/过滤：`rewind`/`list_checkpoints` 均过滤 `isIgnorablePrompt` 并按 `timestamp` 降序截取。

## 存储

- 快照：`.opencode/rewind/snapshots/<id>/`
- 历史：`.opencode/rewind/history.json`（原子写入，超 100 条裁剪，开头重建索引，加载时过滤不存在的快照）

恢复：删除当前不在快照中的文件（含 `.opencode` 中被跟踪的文件），再拷回快照文件；空目录自动清理；恢复后重置 `lastPrompt` 为目标条目。

## 限制（与 Claude Code 一致）

- `bash` 改动、subagent、软链不完全跟踪 — 风险操作前请先 `/checkpoint`
- `>50MB` 大文件跳过
- 软链接跳过

## 开发

```bash
node --check src/index.ts
# 修改 src/index.ts，必要时同步到 plugin/rewind.ts
```

## 发布

```bash
npm login
npm publish --access public
```

## 许可证

MIT
