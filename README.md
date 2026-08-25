# opencode-rewind

Claude Code style `/rewind` for [opencode](https://opencode.ai) — **git-free**, prompt-based snapshots.

Each user prompt (non-`/` command) is snapshotted to `.opencode/rewind/snapshots/<id>/` and recorded in `.opencode/rewind/history.json`. List prompts via `/rewind`, select one to restore.

## Features
- **Auto snapshot** on every user input (up to 50, ignores `.git/node_modules/.cache`)
- **Non-destructive** — file-based copy, no git required; works in non-git projects
- **Interactive** — `/rewind` lists prompts, `/rewind 2 --confirm` restores
- **Agent tools** — `rewind`, `list_checkpoints`, `restore_checkpoint`

## Installation

### From npm (after publish)
```bash
opencode plugin add opencode-rewind
# or in opencode.json: "plugin": ["opencode-rewind"]
```

### Local (current)
```bash
mkdir -p .opencode/plugin
cp node_modules/opencode-rewind/src/index.ts .opencode/plugin/rewind.ts
# or
cp D:/code/opencode-rewind/src/index.ts .opencode/plugin/rewind.ts
```
Restart opencode to activate.

## Usage

| Command | Description |
|---------|-------------|
| `/rewind` | List last 10 prompts |
| `/rewind 2` | Preview prompt #2, ask for confirm |
| `/rewind 2 --confirm` | Restore to prompt #2 |
| `/checkpoints` | Alias for `/rewind` |
| `/checkpoint foo` | Manual snapshot with label `foo` |
| `/undo` | Alias for `/rewind 1` |

Agent natural language:
```
列出 checkpoints
恢复到第2个检查点
```

Storage:
- Snapshots: `.opencode/rewind/snapshots/<id>/`
- History: `.opencode/rewind/history.json`

## Publish
```bash
npm login
npm publish --access public
```

## License
MIT
