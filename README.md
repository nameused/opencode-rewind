# opencode-rewind

Claude Code style `/rewind` for [opencode](https://opencode.ai) — **git-free**, prompt-based snapshots.

Each user prompt (non-`/` command) is snapshotted to `.opencode/rewind/snapshots/<id>/` and recorded in `.opencode/rewind/history.json`. List via `/rewind`, pick a prompt with arrow keys, choose 1 of 6 actions to restore.

## Features

- **Auto snapshot** on every user prompt (up to 100, `MAX_HISTORY` in `src/index.ts:25`), plus `write`/`edit` updates the last snapshot; `bash` file-modifying commands create `auto:` entries
- **Ignores** `.git/node_modules/.opencode/.cache/dist/build/.next/coverage/tmp/logs/.turbo/out/.parcel-cache/.vite/.idea/.vscode`, skips `>50MB` files and symlinks, precisely excludes `.opencode/rewind` itself (no recursive copy)
- **Consistent .opencode handling**: `.opencode/*` (except `rewind`/`node_modules`) is snapshotted and restored; `listFilesRecursive` mirrors `snapshotWorkingTree`
- **Non-destructive** — file-level copy, no git required; works in non-git projects
- **Interactive** — `/rewind` lists last 10 prompts **sorted by timestamp desc (newest on top)** and filtered (`isIgnorablePrompt` excludes `你是 rewind 助手...` system prompts), arrow-key select → 6 actions:
  1. Restore code and conversation
  2. Restore conversation
  3. Restore code
  4. Summarize from here
  5. Summarize up to here
  6. Never mind
- **Agent tools** — `rewind`, `list_checkpoints`, `restore_checkpoint` (all filter system prompts and sort by newest)
- **Robust prompt capture** — handles `string`/`array`/`parts`/`text`/`prompt` in `chat.message` via `extractContent`/`getMessageFrom`
- **Atomic history** — `history.json` written via `tmp` + `rename`, per-file `try/catch` so one file failure doesn't break snapshot
- **Correct merge** — `auto:` prompts create new entries; only non-`auto` last prompts are updated via `updateLastSnapshot`, `lastPrompt` reset on restore

## Installation

### From npm (after publish)

```bash
npm i opencode-rewind
```

`opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-rewind"]
}
```

Restart opencode to activate.

### Local

```bash
cp plugin/rewind.ts .opencode/plugin/rewind.ts
# or
cp src/index.ts .opencode/plugin/rewind.ts
```

`src/index.ts` is the source of truth (`plugin/rewind.ts` synced).

## Usage

| Command | Description |
|---------|-------------|
| `/rewind` | Interactive list (last 10, newest on top, system prompts filtered) → arrow keys → 6 actions |
| `/rewind <index> --action=1` | Direct restore: `1=code+conv, 2=conv, 3=code, 4=summarize-from, 5=summarize-upto, 6=never` (`--confirm` alias for `1`) |
| `/checkpoint [label]` | Manual snapshot with label (`manual-<ISO>` if empty) |
| `list_checkpoints` (tool) | Same filtered/sorted list for agents |
| `restore_checkpoint {steps, action}` | Programmatic restore |

Agent natural language:

```
列出 checkpoints
恢复到第2个检查点
```

Sorting/filtering: `rewind`/`list_checkpoints` filter `isIgnorablePrompt` and sort by `timestamp` desc before slicing.

## Storage

- Snapshots: `.opencode/rewind/snapshots/<id>/`
- History: `.opencode/rewind/history.json` (atomic write, reindexed after prune, filtered on load if snapshot missing)

Restore: deletes current files not in snapshot (including `.opencode` tracked files), then copies snapshot files; empty dirs pruned; `lastPrompt` reset to restored entry.

## Limitations (same as Claude Code)

- `bash` file changes, subagents, symlinks not fully tracked — use `/checkpoint` before risky bash
- Large files `>50MB` skipped
- Symlinks skipped

## Development

```bash
node --check src/index.ts
# edit src/index.ts, sync to plugin/rewind.ts if needed
```

## Publish

```bash
npm login
npm publish --access public
```

## License

MIT
