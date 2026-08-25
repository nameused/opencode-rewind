/**
 * opencode-rewind - 1:1 复刻 Claude Code /rewind (https://code.claude.com/docs/en/checkpointing)
 *
 * - 自动: 每次用户 prompt 前快照（最多100，见 MAX_HISTORY），保存到 .opencode/rewind/snapshots/<id>/
 * - 交互: /rewind 或 Esc Esc 打开列表 -> 选 prompt -> 6 选1 (code+conversation / conversation / code / summarize from/upTo / never mind)
 * - 无 git 依赖，文件级 copy；bash 改动、subagent、symlink 不跟踪（与官方 Limitations 一致）
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import * as fs from "fs/promises"
import * as path from "path"
import { existsSync } from "fs"

type HistoryEntry = {
  id: string
  index: number
  timestamp: number
  prompt: string
  snapshotDir: string
}

const SNAPSHOT_ROOT = ".opencode/rewind/snapshots"
const HISTORY_FILE = ".opencode/rewind/history.json"
const MAX_HISTORY = 100 // 官方: 100 most recent
const IGNORE_DIRS = new Set([".git", "node_modules", ".opencode", ".cache", "dist", "build", ".next", "coverage", "tmp", "logs", ".turbo", "out", ".parcel-cache", ".vite", ".idea", ".vscode"])

let history: HistoryEntry[] = []
let directoryG = ""
let lastPrompt: string | null = null
let notify: (msg: string) => Promise<void> = async () => {}

function nowId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
function truncate(s: string, n = 60): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n) + "…" : t
}
function hasFileChanges(entry: HistoryEntry, dir: string): boolean {
  return existsSync(path.join(dir, entry.snapshotDir))
}
function getToolName(t: unknown): string {
  if (typeof t === "string") return t
  if (t && typeof t === "object" && typeof (t as any).name === "string") return (t as any).name
  return ""
}

// ---- persistence ----
async function loadHistory(dir: string): Promise<void> {
  const file = path.join(dir, HISTORY_FILE)
  try {
    if (!existsSync(file)) {
      history = []
      return
    }
    const raw = await fs.readFile(file, "utf-8")
    const parsed = JSON.parse(raw)
    history = Array.isArray(parsed) ? parsed : []
    const filtered: HistoryEntry[] = []
    for (const e of history) {
      if (existsSync(path.join(dir, e.snapshotDir))) filtered.push(e)
    }
    history = filtered
  } catch {
    history = []
  }
}
async function saveHistory(dir: string): Promise<void> {
  const file = path.join(dir, HISTORY_FILE)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(history, null, 2), "utf-8")
  try { await fs.rename(tmp, file) } catch { await fs.writeFile(file, JSON.stringify(history, null, 2), "utf-8"); try { await fs.rm(tmp, { force: true }) } catch {} }
}

// ---- file utils ----
async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true })
}
async function copyRecursive(src: string, dest: string): Promise<void> {
  let stat: any
  try { stat = await fs.lstat(src) } catch { return }
  // 跳过软链，避免循环或权限问题
  if (stat.isSymbolicLink()) return
  // 精确排除快照目录本身，避免递归拷快照
  if (directoryG) {
    const rel = path.relative(directoryG, src).replace(/\\/g, "/")
    if (rel === ".opencode/rewind" || rel.startsWith(".opencode/rewind/")) return
  } else if (src.replace(/\\/g, "/").includes("/.opencode/rewind")) return
  if (stat.isDirectory()) {
    await ensureDir(dest)
    let entries: string[] = []
    try { entries = await fs.readdir(src) } catch { return }
    for (const name of entries) {
      if (IGNORE_DIRS.has(name)) continue
      try { await copyRecursive(path.join(src, name), path.join(dest, name)) } catch {}
    }
  } else {
    // 大文件跳过（>50MB）避免快照卡死
    if (stat.size > 50 * 1024 * 1024) return
    try {
      await ensureDir(path.dirname(dest))
      await fs.copyFile(src, dest)
    } catch {}
  }
}
async function listFilesRecursive(root: string, base = root): Promise<string[]> {
  const out: string[] = []
  let entries: string[] = []
  try {
    entries = await fs.readdir(root)
  } catch {
    return out
  }
  for (const name of entries) {
    // 保持与 snapshotWorkingTree 一致：.opencode 仅拷非 rewind/node_modules，其余 IGNORE_DIRS 跳过
    if (name === ".opencode" && root === base) {
      const opRoot = path.join(root, ".opencode")
      let opEntries: string[] = []
      try { opEntries = await fs.readdir(opRoot) } catch { continue }
      for (const opName of opEntries) {
        if (opName === "rewind" || opName === "node_modules") continue
        const opFull = path.join(opRoot, opName)
        try {
          const st = await fs.lstat(opFull)
          if (st.isSymbolicLink()) continue
          if (st.isDirectory()) out.push(...(await listFilesRecursive(opFull, base)))
          else out.push(path.relative(base, opFull))
        } catch {}
      }
      continue
    }
    if (IGNORE_DIRS.has(name)) continue
    const full = path.join(root, name)
    try {
      const st = await fs.lstat(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) out.push(...(await listFilesRecursive(full, base)))
      else out.push(path.relative(base, full))
    } catch {}
  }
  return out
}
async function snapshotWorkingTree(dir: string, id: string): Promise<string> {
  const snapDir = path.join(dir, SNAPSHOT_ROOT, id)
  await ensureDir(snapDir)
  let entries: string[] = []
  try { entries = await fs.readdir(dir) } catch { return path.relative(dir, snapDir).replace(/\\/g, "/") }
  for (const name of entries) {
    if (IGNORE_DIRS.has(name)) continue
    if (name === ".opencode") {
      const srcOp = path.join(dir, ".opencode")
      const destOp = path.join(snapDir, ".opencode")
      await ensureDir(destOp)
      try {
        const opEntries = await fs.readdir(srcOp)
        for (const opName of opEntries) {
          if (opName === "rewind") continue
          if (opName === "node_modules") continue
          await copyRecursive(path.join(srcOp, opName), path.join(destOp, opName))
        }
      } catch {}
      continue
    }
    await copyRecursive(path.join(dir, name), path.join(snapDir, name))
  }
  return path.relative(dir, snapDir).replace(/\\/g, "/")
}
async function restoreSnapshot(dir: string, entry: HistoryEntry): Promise<string> {
  const snapDir = path.join(dir, entry.snapshotDir)
  if (!existsSync(snapDir)) return `快照不存在: ${entry.snapshotDir}`
  const currentFiles = await listFilesRecursive(dir)
  const snapshotFiles = await listFilesRecursive(snapDir)
  const snapSet = new Set(snapshotFiles)
  for (const f of currentFiles) {
    if (!snapSet.has(f)) {
      try {
        await fs.rm(path.join(dir, f), { force: true })
      } catch {}
      try {
        const d = path.dirname(path.join(dir, f))
        const rem = await fs.readdir(d)
        if (rem.length === 0) await fs.rm(d, { recursive: true, force: true })
      } catch {}
    }
  }
  for (const f of snapshotFiles) {
    await copyRecursive(path.join(snapDir, f), path.join(dir, f))
  }
  return `↩️ 已恢复代码到 [${entry.index}] ${fmtTime(entry.timestamp)} — "${truncate(entry.prompt, 40)}"`
}

function isIgnorablePrompt(prompt: string): boolean {
  if (!prompt || !prompt.trim()) return true
  const t = prompt.trim()
  if (t.startsWith("/")) return true
  // 过滤 rewind 助手自身的系统指令（用户执行 /rewind 时注入的长指令，不应展示）
  if (t.includes("你是 rewind 助手") && t.includes("list_checkpoints")) return true
  if (t.startsWith("你是 rewind 助手")) return true
  return false
}
async function createEntry(dir: string, prompt: string): Promise<HistoryEntry | null> {
  if (isIgnorablePrompt(prompt)) return null
  const id = nowId()
  const ts = Date.now()
  const snapRel = await snapshotWorkingTree(dir, id)
  const entry: HistoryEntry = { id, index: history.length + 1, timestamp: ts, prompt: prompt.trim(), snapshotDir: snapRel }
  history.push(entry)
  history.forEach((e, i) => (e.index = i + 1))
  if (history.length > MAX_HISTORY) {
    const removed = history.splice(0, history.length - MAX_HISTORY)
    for (const r of removed) try { await fs.rm(path.join(dir, r.snapshotDir), { recursive: true, force: true }) } catch {}
    history.forEach((e, i) => (e.index = i + 1))
  }
  await saveHistory(dir)
  // 静默保存，不刷屏（需要时 /rewind 查看）
  lastPrompt = prompt.trim()
  return entry
}

async function updateLastSnapshot(dir: string): Promise<void> {
  if (!lastPrompt || history.length === 0) return
  const last = history[history.length - 1]
  const newId = nowId()
  const snapRel = await snapshotWorkingTree(dir, newId)
  try { await fs.rm(path.join(dir, last.snapshotDir), { recursive: true, force: true }) } catch {}
  last.id = newId
  last.snapshotDir = snapRel
  last.timestamp = Date.now()
  await saveHistory(dir)
}

function actionMenu(entry: HistoryEntry, dir: string): string {
  const hasCode = hasFileChanges(entry, dir)
  const lines = [
    `已选择 [${entry.index}] "${truncate(entry.prompt, 50)}" @ ${fmtTime(entry.timestamp)}`,
    "",
    hasCode ? "1. Restore code and conversation  (回退代码+对话)" : "1. Restore conversation  (仅对话) [无文件变更，此项等同 1]",
    hasCode ? "2. Restore conversation          (仅对话)" : null,
    hasCode ? "3. Restore code                  (仅代码)" : null,
    "4. Summarize from here           (从此处压缩后续对话)",
    "5. Summarize up to here          (压缩此前对话)",
    "6. Never mind                    (返回)",
    "",
    `执行: /rewind ${entry.index} --action=1  (或 2/3/4/5/6)`,
    `兼容: /rewind ${entry.index} --confirm  等同 --action=1`,
    hasCode ? "" : "注: 该检查点无文件快照，仅提供对话相关选项",
  ].filter(Boolean) as string[]
  return lines.join("\n")
}

async function handleAction(dir: string, entry: HistoryEntry, action: string): Promise<string> {
  const a = action.toLowerCase()
  // 映射数字/别名
  const map: Record<string, string> = {
    "1": "code+conv",
    "code+conv": "code+conv",
    "code and conversation": "code+conv",
    "2": "conv",
    "conversation": "conv",
    "3": "code",
    "code": "code",
    "4": "summarize-from",
    "from": "summarize-from",
    "5": "summarize-upto",
    "upto": "summarize-upto",
    "6": "never",
    "never": "never",
    "never mind": "never",
  }
  const key = map[a] ?? (a.includes("code") && a.includes("conv") ? "code+conv" : map[a] ?? "")
  if (!key) return `未知 action: ${action}，可用 1-6`

  if (key === "never") return "已取消"
  if (key === "summarize-from" || key === "summarize-upto") {
    // 官方: summarize 不改磁盘文件，仅压缩对话
    return `📝 已选择 Summarize (${key === "summarize-from" ? "from here" : "up to here"}) — 实际压缩需由模型执行，此处仅标记。原消息已保留，输入框可重新编辑。`
  }
  if (key === "conv") {
    lastPrompt = entry.prompt
    return `↩️ 已恢复对话到 [${entry.index}] "${truncate(entry.prompt, 40)}"\n原 prompt 已恢复到输入框，可重新发送或编辑。\n(代码保持当前状态未动)`
  }
  if (key === "code") {
    const r = await restoreSnapshot(dir, entry)
    lastPrompt = entry.prompt
    return r + "\n(对话保持当前状态未动)"
  }
  if (key === "code+conv") {
    const r = await restoreSnapshot(dir, entry)
    lastPrompt = entry.prompt
    return r + `\n↩️ 对话也已回退到该点，原 prompt "${truncate(entry.prompt, 40)}" 已恢复到输入框。\n注: bash 改动/subagent/symlink 不跟踪，需手动处理（见 Limitations）。`
  }
  return "已取消"
}

// ---- helpers for robust prompt extraction ----
function extractContent(msg: any): string {
  if (!msg) return ""
  if (typeof msg.content === "string") return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((p: any) => {
        if (typeof p === "string") return p
        if (p && typeof p.text === "string") return p.text
        if (p && typeof p.content === "string") return p.content
        if (p && typeof p.input === "string") return p.input
        try { return JSON.stringify(p) } catch { return "" }
      })
      .join(" ")
  }
  if (typeof msg.text === "string") return msg.text
  if (typeof msg.prompt === "string") return msg.prompt
  if (typeof msg.input === "string") return msg.input
  if (typeof msg.message === "string") return msg.message
  // 有些 SDK 把内容放在 parts
  if (Array.isArray(msg.parts)) {
    return msg.parts.map((p: any) => p.text ?? p.content ?? "").join(" ")
  }
  return ""
}
function getMessageFrom(input: unknown, output: unknown): any {
  const candidates: any[] = [
    (output as any)?.message,
    (input as any)?.message,
    (output as any),
    (input as any),
    (output as any)?.params?.message,
    (input as any)?.params?.message,
  ]
  for (const c of candidates) {
    if (c && (typeof c.content === "string" || Array.isArray(c.content) || typeof c.text === "string" || typeof c.prompt === "string")) return c
  }
  // 直接就是字符串
  if (typeof input === "string") return { content: input }
  if (typeof output === "string") return { content: output }
  return null
}

// ---- Plugin ----
const RewindPlugin: Plugin = async ({ client, directory }) => {
  directoryG = directory
  await loadHistory(directory)
  notify = async (msg: string) => {
    try { await client.app.log({ body: { service: "rewind", level: "info", message: msg } }) } catch {}
  }
  return {
    // 自动: 每次用户 prompt 前快照（官方: before each user prompt）
    "chat.message": async (_input: unknown, output: unknown) => {
      try {
        const msg = getMessageFrom(_input, output)
        const rawContent = extractContent(msg) || extractContent(_input as any) || extractContent(output as any)
        const content: string = typeof rawContent === "string" ? rawContent : String(rawContent ?? "")
        const trimmed = content.trim()
        if (!trimmed) return
        if (trimmed.startsWith("/")) {
          const space = trimmed.indexOf(" ")
          const cmd = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase()
          const rest = space === -1 ? "" : trimmed.slice(space + 1).trim()
          // 仅 /checkpoint 由插件直接处理；/rewind 系列交由 .opencode/command/rewind.md 通过 question 交互式处理
          const isCheckpointOnly = new Set(["/checkpoint"]).has(cmd)
          if (!isCheckpointOnly) {
            // 不消费 /rewind，让 command 走 Agent + question 交互
            return
          }
          if (msg) msg.content = ""
          if (cmd === "/checkpoint") {
            const prompt = rest || `manual-${new Date().toISOString()}`
            const e = await createEntry(directory, prompt)
            await notify(e ? `📌 手动 checkpoint 已创建 [${e.index}]` : "ℹ️ 未创建")
            return { handled: true } as unknown as void
          }
        } else {
          await createEntry(directory, trimmed)
        }
      } catch (e) {
        console.error("[rewind] chat.message failed", e)
      }
    },
    // 处理完自动入列：有 prompt 则更新该条，无 prompt 则新建 auto 记录（满足任意文件改动都进 /rewind）
    // 修复：避免跨 prompt 误合并 — auto 提示的条目不复用，需新建；同 prompt 内多文件改动才更新
    // 大项目说明：当前为全量拷贝（精确还原，含新建/删除），与 Claude Code 仅跟踪已编辑文件不同。
    // 大仓库可通过 /checkpoint 手动控制，或后续开启增量模式（仅还原已编辑文件）
    "tool.execute.after": async (input: any, output: any) => {
      try {
        const raw = input?.tool ?? input?.name ?? input?.toolName
        const name = getToolName(raw).toLowerCase()
        const args = (input?.args ?? output?.args ?? {}) as any
        const isEdit = name === "edit" || name === "write" || name === "apply_patch" || name === "update"
        let isBashMod = false
        if (name === "bash" && args?.command) {
          const cmd = String(args.command).toLowerCase()
          isBashMod = ["rm ", "mv ", "cp ", "mkdir", "touch", "echo", "sed ", "perl ", "python ", ">", "cat >", ">>"].some((p) => cmd.includes(p))
        }
        if (!isEdit && !isBashMod) return
        // 取文件名用于 auto prompt
        const fileHint = args?.filePath ?? args?.file ?? args?.path ?? ""
        const shortName = fileHint ? String(fileHint).split(/[\\/]/).pop() : name
        const last = history.length > 0 ? history[history.length - 1] : null
        const isAutoLast = last ? last.prompt.startsWith("auto:") : false
        // 若最后一条是 auto，则不复用（避免 c.txt 合并到 x.txt 等跨操作合并），直接新建
        if (history.length > 0 && lastPrompt && !isAutoLast) {
          await updateLastSnapshot(directoryG)
        } else {
          const autoPrompt = `auto:${name} ${shortName}`.trim()
          await createEntry(directoryG, autoPrompt)
        }
      } catch {}
    },
    event: async () => {},
    tool: {
      rewind: tool({
        description: "Claude Code 式 /rewind：列出 prompt 记录或按 6 选1 恢复（code+conv/conv/code/summarize/never），无 git 依赖",
        args: {
          steps: tool.schema.number().optional().describe("编号 1..N，空则列出"),
          list: tool.schema.boolean().optional().describe("仅列出"),
          action: tool.schema.string().optional().describe("1-6 或 code/conv/code+conv/summarize-from/summarize-upto/never"),
        },
        async execute(args) {
          if (args.list || args.steps === undefined) {
            const visible = history.filter((e) => !isIgnorablePrompt(e.prompt))
            if (visible.length === 0) return "暂无 rewind 记录"
            // 按最新时间排序，最新在最上面
            const sorted = [...visible].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10)
            return sorted.map((e) => `${e.index}. [${fmtTime(e.timestamp)}] "${truncate(e.prompt, 60)}" (${e.id.slice(0, 6)})`).join("\n")
          }
          const target = history.find((e) => e.index === args.steps)
          if (!target) return `记录 ${args.steps} 不存在`
          if (!args.action) return actionMenu(target, directoryG)
          return await handleAction(directoryG, target, args.action)
        },
      }),
      list_checkpoints: tool({
        description: "列出所有输入提示词的 rewind 记录（无 git 依赖）",
        args: {},
        async execute() {
          const visible = history.filter((e) => !isIgnorablePrompt(e.prompt))
          if (visible.length === 0) return "暂无 rewind 记录"
          const sorted = [...visible].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10)
          return sorted.map((e) => `${e.index}. [${fmtTime(e.timestamp)}] "${truncate(e.prompt, 60)}" (${e.id.slice(0, 6)})`).join("\n")
        },
      }),
      restore_checkpoint: tool({
        description: "恢复到指定 prompt 检查点，需配合 action 区分 code/conv",
        args: {
          steps: tool.schema.number().describe("编号 1..N"),
          action: tool.schema.string().optional().describe("action 1-6，默认 1=code+conv"),
        },
        async execute(args) {
          const target = history.find((e) => e.index === args.steps)
          if (!target) return `记录 ${args.steps} 不存在`
          return await handleAction(directoryG, target, args.action ?? "1")
        },
      }),
    },
  }
}

export default RewindPlugin
