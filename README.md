<h1 align="center">deveggs 🥚</h1>
<p align="center">
  <a href="#install"><img alt="Works with any harness" src="https://img.shields.io/badge/works%20with-any%20harness-blue?style=flat-square"></a>
  <a href="https://x.com/kunggaochicken"><img alt="X" src="https://img.shields.io/badge/X-@kunggaochicken-black?style=flat-square"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square"></a>
</p>

<h3 align="center">One basket of your personal preferences and skills. Every agent you use.</h3>

<p align="center">
  <img src="assets/header.jpg" alt="deveggs, the developer eggsperience: you tell your agents preferences and ask for skills, each is laid as an egg on trial, tried across Claude Code, Codex and Cursor, and you hatch it into a permanent chicken or crack it. One basket, every agent." width="100%">
</p>

Every developer works with agents differently. Stacks like
[gstack](https://github.com/garrytan/gstack) and
[pstack](https://github.com/cursor/plugins/blob/main/pstack) are great, but they are
*someone else's* loop. Mining your old transcripts for a stack picks up weak, noisy
signals. Harness-local memory (Claude Code memory, Codex memories, Cursor rules, …)
helps, but each harness keeps its own copy and puts its own slant on it.

deveggs gives you **one personal basket** to build your own loop: preferences,
workflows and skills that every coding agent you use reads. New ideas go in as eggs
on trial. Only the ones that prove themselves become permanent.

<p align="center">
  <img src="assets/workflow.svg" width="880" alt="Workflow in three color-coded columns (You, your agent, your basket). 1: you say how you like to work. 2: your agent drafts an egg and asks to lay it. 3: you say yes; saying no saves nothing. The egg goes on trial in your basket. 4: your agent follows it every session and logs whether it helped. After 3 helped and none didn't, it's ready to hatch and your agent suggests it. 5: only you hatch it, and it becomes a permanent chicken every agent follows. You can crack an egg or a chicken anytime, and it's never suggested again.">
</p>

## How it works

- **🥚 Egg:** something you want to try. Agents follow it and log whether it
  helped (✓) or got in the way (✗).
- **🐣 Ready:** 3 ✓ and no ✗. Agents suggest hatching it, but only you decide.
- **🐔 Chicken:** permanent. Agents follow it without question. If you're already
  sure ("always…", "never…"), lay it straight as a chicken.
- **💥 Cracked:** rejected or retired. It stays on file so it's never laid again.

Skills work the same way: an egg skill is on trial, a chicken skill is permanent.

## Install

Paste this into **one** coding agent (Claude Code, Codex, Cursor, …):

```text
Set up deveggs for me by following
https://github.com/kunggaochicken/deveggs/blob/main/INSTALL.md
Confirm with me before changing any files outside the deveggs repo.
```

That agent forks the repo (so your basket is saved in your own GitHub repo) and wires up every coding agent it finds on your machine.
It links the deveggs skill into each one and adds a short deveggs prompt to each one's
global instructions. It shows you the plan and waits for your yes. Requires
Node >= 22.18 and git.

## Usage

You mostly just talk to your agent. It runs these for you:

```bash
deveggs lay "End each turn with a one-line summary"   # 🥚 try it out
deveggs lay "Never push to main" --chicken            # 🐔 already sure
deveggs feedback <id> --good                          # log a trial
deveggs hatch <id>                                    # 🥚 -> 🐔
deveggs crack <id>                                    # 💥
```

## Your basket, and everyone else's

- **`my-basket/`** is yours. Your fork commits it, so it's saved and syncs across
  machines. Upstream ignores it, and CI keeps it out of upstream PRs.
- **`shared-baskets/`** holds baskets people chose to share. Borrow anything you like:
  it always enters your basket as an egg on trial. To share yours, open a PR that adds
  a reviewed copy under [`shared-baskets/<you>/`](shared-baskets/README.md).

## Why

- **Try before you commit.** Preferences you *think* you have and ones that hold up
  in practice aren't the same.
- **You hatch, agents don't.** Agents lay eggs and log trials. Only you decide what
  becomes permanent.
- **One basket, every harness.** Plain Markdown under git, not locked to any one
  harness.
- **Never explain yourself twice.** Tell one agent once, and every agent knows.

Under the hood: [architecture](assets/architecture.svg) ·
[repo setup](assets/setup.svg) · [AGENTS.md](AGENTS.md)
