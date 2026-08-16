# @deepseek-ai/dsh-client-ui-file-reference

English | [中文](README.zh.md)

The **composer file-reference plugin**: two affordances that insert plain-text `@rel` references to files under the session workspace — the `@`-file menu (a trigger source in the ui-input-trigger pipeline, registered above the subagent group) whose directory rows carry a trailing slash and a folder glyph, and the file-picker button (an entry in the `conversation.input.left` tool-row seat, paperclip icon) whose modal browses the workspace as a directory tree: folders expand and collapse in place with each level lazy-loaded from the host's one-level listing, and a path editor jumps the browsed base directory to any fully qualified path — rows below the workspace root reference by absolute host path. Both derive from the host's bounded listings (`host.listFiles` / `host.listLevel`, served by `dsh-host-file-browser`): the source caches one listing per session for 30 seconds (TTL) with in-flight coalescing, and the modal reads levels per expand with abort-on-close.

Behavior facts: candidates are the listing's root-relative paths (forward-slash spelling; directories end with `/`), filtered case-insensitively by path or base name in breadth-first host order; a session with no workspace account (ungrouped) or a failed listing yields an empty menu group, while the modal shows its own explanatory surface (no-workspace / unreadable / truncated notices). A menu pick inserts `@rel ` with a trailing space that closes the trigger token. In the modal, the workspace root is the initial base; folder rows expand/collapse, an unreadable folder reverts to collapsed with an inline hint and retries on the next click, and the path editor's Enter jumps the base to the typed directory (the workspace-root button returns); the modal's confirm appends `@rel1 @rel2` with single-space separation at the end of the draft (one machine transaction, one undo step — the read and write run in the same synchronous turn). The button disables while the input is outside the plain phase. All references are plain text per the [plain-text-reference decision](../../../.agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md): no occurrence identity, no codec — the literal ships to the model, which resolves the workspace-relative path with its own file tools.

## Model Experience

### Plain-text file references

#### What the model sees

Each picked reference adds the literal text `@<path>` to the user's prompt — the same text the draft shows, no wrapping markup: workspace-relative under the session root, absolute when picked from a directory outside it. The model is expected to treat it as a path (relative under its working directory, absolute when it starts with a drive or `/`) and read it with its file tools; nothing else about the request changes. The listing cache never reaches the model.

#### Token effect

The reference text itself only: one `@` token per picked file, counted as ordinary prompt tokens. No additional context messages, tool schemas, or prompt sections are registered.

#### KV Cache effect

None beyond the ordinary prompt text above; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No draft decoration** — `@路径` tokens are not highlighted in the composer (the text-ref scan only matches word-ish names, and paths contain separators/dots). A path-lexicon decoration would need a scan extension in ui-conversation.
- **Insertion always appends at the end of the draft** — the paperclip writes after the current text rather than at the caret; the `@` menu replaces its trigger span.
- **Levels are listed per expand** — the modal holds the levels it has already loaded; files created by the agent during an open modal do not appear until the folder is re-expanded (the root re-reads on reopen).
- **Outside-workspace references are absolute host paths** — a row browsed via the path editor below the workspace root inserts `@<absolute path>`; the model must resolve it against the host filesystem rather than its working directory.
- **Skip policy is host-owned** — hidden entries, `node_modules`, and `.git` are omitted by `dsh-host-file-browser`; the client cannot change the policy per session.
