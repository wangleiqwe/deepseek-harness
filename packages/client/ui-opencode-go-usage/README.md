# @deepseek-ai/dsh-client-ui-opencode-go-usage

English | [中文](README.zh.md)

Browser surface for the OpenCode Go subscription usage: the sidebar-foot indicator with a popover readout, and a dedicated settings page. Both entries read through the `opencodeUsage` Remote namespace; the Host owns the gateway request.

## Surfaces

- `sidebar.footer.action` (`id: opencode-go-usage`, order 10): a health dot plus the rolling-window percentage in the wide sidebar (dot only in the rail state). Clicking opens a popover with the three windows, their reset times, a refresh control, and a close button.
- `settings.section` (`id: opencode-go-usage`, order 12): the 「Go 套餐额度」 settings page with a short limit explainer above the same three-window readout.

Both surfaces poll the Host once on mount and every 60 seconds; a failed read renders inline with a retry.

## Model Experience

No model-visible surface: the package registers no tools, prompt sections, or model-visible events. It only adds the two additive slot entries above, which change no conversation or session content. Token and KV-cache effects: none.

## Known Limitations and Deferred Work

- The indicator reflects the last settled poll; a read that races a window reset shows the previous snapshot until the next poll.
- The popover is dismissed by its own close button only; clicks outside do not close it (the sidebar foot owns the surrounding chrome).
- Polling is per entry instance; the sidebar indicator and the settings page poll independently while both are mounted.
