---
description: Start the dev stack with browser annotations, capture and fix annotation feedback until I say DONE, then stop the dev server.
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
  Remember the process so you can stop it in step 4.
- If the stack fails to boot, report the error and stop — do not guess.

## 3. Capture + process loop

- Use the agentation MCP watch tool (batch window ~10s) to wait for annotation
  batches. On a quiet timeout, silently re-arm the watch — do not ask me
  anything. Keep answering my messages while looping.
- For each batch: append every annotation (id, kind, session, full content) to
  `.omo/evidence/annotations-<YYYYMMDD-HHmmss>.md` — one file per run, created
  on the first batch. This is the durable capture.
- Then address the feedback in the UI code (follow docs/DESIGN.md) and resolve
  each annotation you addressed with a short summary via the agentation
  resolve tool. Leave an annotation open if I reject your change.
- Tell me what you captured and what you fixed, then keep watching. Repeat
  until step 4.

## 4. Stop on DONE

- When I send DONE (exactly that word) in chat: stop re-arming watches, stop
  only the dev-stack process you started in step 2, confirm ports
  4747/5173/3000 are free again, and point me at the capture file.
