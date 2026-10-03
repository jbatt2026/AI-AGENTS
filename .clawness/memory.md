# Project lessons (Clawness memory)
<!-- Clawness retrieves from this file each prompt: `## Always` entries are
     injected every turn (keep to 3), `## Lessons` entries only when they match
     the prompt. Tell Claude "remember this: ..." or append a bullet yourself
     (one line, <=120 chars, newest at the bottom). Only lessons that would cost
     real rework if forgotten belong here — not a session log. See ENF-MEM-001. -->

## Always

## Lessons
- package.json dev/preview must stay bare `vite`: CLI --host flags override vite.config.ts localhost default
- server/guardrails.test.ts: build secret fixtures by concatenation or scan_secrets.py fails CI on the test file
