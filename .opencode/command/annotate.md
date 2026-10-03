---
description: Start the dev stack with browser annotations, capture feedback until I say DONE, then analyze, wait for my review, implement the approved fixes, and stop the dev server.
---

Run the annotation-feedback loop for the web UI (docs/UI-ANNOTATION-TOOLING.md).
If `$ARGUMENTS` is non-empty, treat it as extra focus instructions for this run.

## 1. Preflight — agentation MCP

- Confirm the `agentation` MCP tools are exposed in this session (list pending
  annotations / watch / resolve). If they are missing, STOP and tell me to
  enable the `agentation` server in `.opencode/opencode.jsonc` and restart
  opencode. Do not try to work around a missing MCP with copy/paste.
- An MCP *call* failing right now is expected when the dev stack is down (the
  HTTP store on :4747 comes up with the dev server in step 2); the tools being
  listed is what matters here.

## 2. Start the dev stack with annotations

- If port 4747 is already listening, reuse the running stack — it already has
  the annotation server on.
- If 5173/3000 are occupied but 4747 is not, the stack is running WITHOUT
  annotations: ask me whether to stop it and restart with the flag.
- Otherwise start `bun run dev -- --annotate` as a background/long-running
  process (never foreground), then wait until `http://localhost:5173` responds.
  Remember the process so you can stop it in step 5.
- If the stack fails to boot, report the error and stop — do not guess.

## 3. Capture-only loop

- Use the agentation MCP watch tool (batch window ~10s) to wait for annotation
  batches. On a quiet timeout, silently re-arm the watch — do not ask me
  anything. Keep answering my messages while looping.
- For each batch: append every annotation (id, kind, session, full content) to
  `.omo/evidence/annotations-<YYYYMMDD-HHmmss>.md` — one file per run, created
  on the first batch. This is the durable capture.
- Do NOT touch UI code in this phase — no fixes, no resolves. A one-line
  progress note per batch is fine; keep watching until step 4.

## 4. On DONE — analyze, then wait for my review

- When I send DONE (exactly that word) in chat: stop re-arming watches.
- Analyze all captured annotations: group them, map each to the UI code
  (docs/DESIGN.md), and propose a concrete fix per annotation (or argue why
  one should be rejected/dismissed instead).
- Present the analysis as a plan (the plan-annotation tool per the repo's
  plan-review workflow) and wait for my review. Do not implement anything
  until I approve.

## 5. Implement approved fixes, then stop

- Keep the dev stack running — it is your verification surface (HMR, visual
  checks) while implementing.
- Implement only the fixes I approved (follow docs/DESIGN.md); run
  typecheck/lint to verify.
- Resolve each annotation you addressed with a short summary via the
  agentation resolve tool; leave an annotation open if I reject your change.
- When implementation is done: stop only the dev-stack process you started in
  step 2, confirm ports 4747/5173/3000 are free again, and point me at the
  capture file.
