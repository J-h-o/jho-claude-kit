---
name: craft
description: Switch craft mode (the always-on coding rules) between lite, full, strict, and off.
argument-hint: "[lite|full|strict|off]"
disable-model-invocation: true
---
The craft hook has already applied any level change in: $ARGUMENTS

Reply in one line only.
- A valid level was given: "Craft mode: <level>."
- Anything else was given: say it isn't a level and nothing changed, then list the options: lite, full, strict, off.
- No level was given: name the current level from the craft rules in your context (or "off" if none are there), then list the options: lite, full, strict, off.
