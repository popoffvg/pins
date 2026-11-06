# pins

A Claude Code mod that keeps the links of a chat pinned, the way Slack pins items in a channel. Claude pins each new link by itself: a URL, a GitHub PR or issue, a published artifact, a doc, or a file. After every pin, Claude ranks all pins again, the most useful one for the current task first.

The pins show in a sidebar beside the chat:

```
 ◆ 2 pinned              r: ↻ refresh PRs
 ctrl+x tab: focus · 1-9: open · esc: close
╭──────────────────────────────────────╮
│  1 pins mod source                   │
│    File · hooks/register.tsx  ↗ open │
│    The hooks module of the mod.      │
╰──────────────────────────────────────╯
╭──────────────────────────────────────╮
│  2 Fix the upload retry              │
│    PR #12 · acme/app          ↗ open │
│    ● Open  ✔ CI 38/38  ◷ Review required
│    checked 1m ago  ↻ refresh         │
│    The PR this task changes.         │
╰──────────────────────────────────────╯
```

## Use

- `/pins` opens the sidebar and prints the ranked list in the chat.
- ctrl+x tab gives the sidebar the keyboard. Then:
  - 1-9 opens a pin: a file in your editor, a web link in the browser.
  - r refreshes the status of every PR.
  - Esc closes the sidebar.
- A file in the project shows its path from the project root. A file outside it shows its folder and name.

## PR and CI status

For a GitHub PR, the card shows the PR state (open, draft, merged, closed), the CI checks that passed out of all checks, and the review decision. The mod reads them with `gh pr view`, so `gh` must be installed and signed in. The status refreshes when the session starts, every 2 minutes, when a PR is pinned, on `/pins`, and on the refresh buttons. Only the latest run of each check counts, as on GitHub. A cancelled latest run counts as failed.

## Open a file

The open button runs `~/.claude/scripts/open-file.sh <path>` for a file, and `open <url>` for a web link. Put your own script at that path to pick the editor, for example `zed --existing "$1"`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pins --marketplace popoffvg/pins
```

Answer `y` to add the marketplace, then pick a scope (user scope is first).

From a shell:

```sh
claude plugin install pins --marketplace popoffvg/pins
```

The mod needs a Claude Code build that loads mods (hooks modules).
