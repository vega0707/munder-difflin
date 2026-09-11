---
title: "Your First Hour With Munder Difflin"
description: "A minute by minute walkthrough of your first hour with Munder Difflin 0.5.2: install, setup, your first job for Michael, watching the floor, answering an ASK ME card, reading a diff, and leaving a schedule running."
date: 2026-07-03
updated: 2026-09-10
category: guides
categoryLabel: Guides
type: Non-technical
pinned: true
pinOrder: 1
primaryKeyword: "munder difflin onboarding"
secondaryKeywords: ["getting started with munder difflin", "munder difflin tutorial", "first hour with a multi-agent harness", "munder difflin setup", "scheduled agent missions", "munder difflin skills"]
tags: ["Guides", "Onboarding", "Getting Started", "Multi-Agent", "Local-First"]
author:
  name: Chaitanya Giri
  initials: CG
faq:
  - q: "How long does it take to get Munder Difflin running?"
    a: "About ten minutes if one coding CLI, like Claude Code, Codex or Antigravity, is already installed and signed in. Download the build for macOS, Windows or Linux, answer a short setup, and you are on the floor. Settings, then Prerequisites, shows anything that is still missing."
  - q: "What do I need before installing Munder Difflin?"
    a: "One supported terminal coding CLI, installed and signed in. Twelve are supported: Claude Code, Codex, Gemini CLI, Antigravity, Grok, Kimi Code, Qwen, OpenCode, Crush, Pi, Copilot and Cursor. If you do not pay for any AI subscription, Antigravity is free."
  - q: "Who is Michael and how do I give him work?"
    a: "Michael is your clone, the boss of the floor, and you stay the boss of him. You type what you want into his terminal or talk to him by voice. He breaks it into tasks, hires workers, routes messages between them, and brings you only the decisions that need you."
  - q: "Do I have to approve everything the agents do?"
    a: "Only if you want to. In ask first mode agents pause for tool approval, which is a good way to start. With auto mode on they carry on alone, and anything that genuinely needs you lands on the ASK ME board. Per agent token budgets and a circuit breaker catch runaway agents either way."
  - q: "How do I review what an agent changed?"
    a: "Open the IDE on the agent you are looking at. You can browse and edit files in its workspace and see its uncommitted changes as a diff before you accept anything."
  - q: "Does Munder Difflin keep working after I walk away?"
    a: "Yes, as long as the machine stays on. The Triggers tab holds schedules that start work on an interval or on chosen weekdays, and agents keep working through their queue while you are away. Hosted sandboxes that keep going with the lid closed are not available yet."
  - q: "Is Munder Difflin free?"
    a: "Yes. The classic office is free and MIT licensed, with unlimited local agents. Pro and Teams are optional paid plans, each with a 14 day trial."
---

<div class="callout tldr"><span class="ic">TL;DR</span><p><strong>Zero to a working AI office in an
hour.</strong> Minute 0: download. Minute 5: a short setup, including your clone's engine. Minute 15: your
<strong>first job for Michael</strong>. Minute 25: watch the floor and open a real terminal. Minute 40:
answer an <strong>ASK ME</strong> card and read a <strong>diff</strong>. Minute 50: give an agent a
<strong>skill</strong>. Minute 60: leave a <strong>schedule</strong> running and walk away.</p></div>

<video controls preload="none" playsinline poster="/media/demo/intro-poster.jpg" style="width:100%; border-radius:12px; margin:12px 0 24px;">
  <source src="/media/demo/intro.mp4" type="video/mp4" />
</video>

Most tools want you to study them before they do anything useful. This one should be doing real work inside an
hour: you brief an orchestrator, watch agents work, check a real change, and leave the office running without you.
Here is that hour, minute by minute, current as of Munder Difflin 0.5.2.

## Minute 0: Download and install

Grab the build for your system from [munderdiffl.in](https://munderdiffl.in/) or the
[latest release](https://github.com/chaitanyagiri/munder-difflin/releases/latest):

- **macOS:** one universal `.dmg` for Apple Silicon and Intel, signed and notarized by Apple.
- **Windows 10 and 11:** a setup installer, or a portable `.exe` if you would rather not install anything.
- **Linux:** an `.AppImage`.

Each release also carries a `SHA256SUMS.txt`, so you can check the file you downloaded is the real one.

You need one terminal coding CLI installed and signed in. Twelve are supported: Claude Code, Codex, Gemini CLI,
Antigravity, Grok, Kimi Code, Qwen, OpenCode, Crush, Pi, Copilot and Cursor. If you do not pay for any AI
subscription, Antigravity is free. The [install guide](/blog/how-to-install-and-use-munder-difflin/) has the exact
commands for every one of them.

## Minute 5: Setup

First launch walks you through a short setup. It starts by asking whether you are technical, which only changes how
much jargon the app shows you. Then four steps:

- **A home folder** for the app's own files: settings, agent memory and mailboxes. Use a new, empty folder.
- **Your clone.** Name it and pick the engine that powers it. Give it the most capable model you have, because it
  does the thinking and the delegating.
- **Your projects.** The folders agents may work in. A project is just a folder.
- **Permissions.** Whether agents act on their own or ask first. Start with ask first. You can change it any time.

Every install starts in the classic office, the free version, with the floor you are about to meet.

{% img "note-1", "Prerequisites in Settings shows the live status of every tool an engine needs, before it becomes a surprise." %}

## Minute 15: Your first job for Michael

You do not manage the workers. You talk to your clone, and he runs the floor. Click into Michael's terminal and
describe the job the way you would brief a capable new hire: the outcome, the folder, and what done looks like.
Prefer talking? He has a voice mode.

A good first job is small and self contained. "Read this repo and write REPORT.md explaining how it fits together"
beats "refactor everything" for hour one.

Michael turns the job into tasks on the kanban, hires a worker if he needs one, and routes messages between their
mailboxes. Each worker is a real CLI process in its own terminal and, with git isolation on, its own worktree. How he
decides what to handle and what to send your way is its own post: [how Michael routes work](/blog/how-the-god-orchestrator-works/).

## Minute 25: Watch the floor, then open a desk

The floor is not decoration. It is the state of the system. Characters walk to their desks as they work, and envelopes
fly between them when they message each other. The cast is an affectionate parody of The Office, and the whole floor is
a simulation that uses no tokens.

{% img "floor-view", "The floor mid task: every movement maps to a real event." %}

Click any agent to open its terminal. You can read the live output and type straight back into it. Want to work with
one agent without the office around it? Focus mode gives you the terminal full width, and Esc brings the floor back.
This is the moment it clicks: that character is a real CLI process, and you are reading its actual output.

{% img "note-2", "Every desk is real: a live terminal, plus a context gauge showing how much runway the agent has left." %}

## Minute 40: Answer an ASK ME card, then read the diff

At some point in the first hour an agent will need you. It might be a question only you can answer, or a step only you
can take. It shows up on the **ASK ME** board instead of hiding in a scrollback, formatted so you can read it at a
glance. Michael settles routine questions himself, so whatever reaches you deserves your attention.

Before you say yes to a change, look at it. Open the **IDE** on the agent's workspace to browse its files and see its
uncommitted changes as a diff. Read it, answer the card, and watch the work carry on. The thinking behind that gate is in
[approving AI agents without babysitting them](/blog/human-in-the-loop-approving-ai-agents/).

## Minute 50: Give an agent a skill

The **skills** tab is a catalog of skills you can install for your agents. Give your reviewer a review checklist, your
writer a style guide, and your researcher the habit of citing sources. It is the difference between hiring generalists
and hiring people who actually read the manual. More in [MCP and skills in a hive](/blog/mcp-and-skills-in-a-hive/).

## Minute 60: Leave it running

The last move of the hour is the one that changes how you use the tool: schedule something. Open the **Triggers** tab and
create a schedule with a label, who it goes to, and the prompt, which is sent word for word on every run. It can repeat on
an interval or on chosen weekdays at a set time. "Every weekday at 9, triage new GitHub issues and summarise them for me" is
a good first one.

Leave the machine on and walk away. The agents keep working, and when a new version ships the app updates itself. Hosted
sandboxes that keep working with the lid closed are not available yet, so for now the office runs wherever you run it. For
ideas on what is worth automating, read [scheduling autonomous agent missions](/blog/scheduling-autonomous-agent-missions/).

## Want the office in one window?

Everything above is the free classic office. If you would rather work in a single window, **Pro** puts the orchestrator,
agents, tasks, inbox, automations and memory in one workspace and adds **Stapler**, a small floating window that sends a
screenshot, a recorded message or a meeting transcript to your orchestrator with one line from you. **Teams** lets your
clone work with your teammates' clones. Both come with a 14 day trial, and the [pricing page](https://munderdiffl.in/#pricing)
has the details.

## The hour, in one line

Install, set up your clone, give him one job, watch the floor, answer one card, read one diff, install one skill, set one
schedule. That is the whole distance from "a CLI in a terminal" to "an office that works while you do not".

[Download Munder Difflin](https://munderdiffl.in/), free and MIT licensed. If the first hour earns it,
[a GitHub star](https://github.com/chaitanyagiri/munder-difflin) helps other people find it.
