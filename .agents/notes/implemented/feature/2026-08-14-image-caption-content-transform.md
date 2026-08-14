# Agent Note: Image captioning as a content transform

Status: implemented

English | [中文](2026-08-14-image-caption-content-transform.zh.md)

## Problem

Pasted images reach the harness end to end (composer intake, attachment
storage, `ImageBlock` vocabulary), but the text-only `deepseek-official`
route rejects image content at serialization, so a session on
`deepseek-v4-pro` cannot send images at all. The vision-capable models sit on
other routes (e.g. the `opencode-go` pi-ai profile), and users want the main
model to stay text-only while images still contribute meaning — with the
vision route pickable from the settings page rather than only from a
cordis.yml edit.

## Decision

A new agent-plane plugin
[`packages/context/image-caption`](../../../../packages/context/image-caption/README.md)
(`@deepseek-ai/dsh-image-caption`) rewrites the final `agent/pre-step` batch:
every image block in a user message is captioned through a configured vision
route and replaced by a text block, so the main model reads the caption while
the image block never reaches a text-only adapter.

### Seam choice: `agent/pre-step` waterfall, delegate first

The listener registers with `{ prepend: true }` and calls `next()` before
rewriting, so every other pre-step listener (compaction pressure, goal
verification, hooks, repeat-tool-reminder) still sees the original messages,
and this transform lands last. The returned batch is what the loop logs as
`user/message` events — the model-visible ⟺ logged invariant holds without a
dedicated logging step, and replay reconstructs the captioned request. The
original message with its image block survives only in the
`agent/inbox/spliced` receipt, which is not model-visible.

### Caption request shape

One auxiliary `ctx.llm.stream` call per image: provider/model from config,
`maxTokens` capped (default 1024), the pre-step `AbortSignal` forwarded, and
the `purpose` field deliberately left unset (the closed union has no
image-caption member; widening it is deferred). The request message carries
the `ImageBlock` verbatim — adapters that read attachments (pi-ai) resolve
the bytes themselves.

### Failure semantics

An empty caption, an error finish, or an abort is a failure: under
`onError: placeholder` (default) the block becomes a text placeholder naming
the structured error code so the step proceeds; under `onError: fail` the
failure ends the turn. Nothing fails silently.

### Configuration

Every field (`enabled`, `provider`, `model`, `prompt`, `maxTokens`,
`onError`) lives in the `image-caption` settings namespace registered through
`installSettingsSection`; the schema in `src/config.ts` is the single home
for bounds and defaults. The resolved value falls back to the composition
entry (a preset row or home patch layer) per field, so a user-layer pick
overrides the shipped base without duplicating it. `provider` and `model`
have no safe default — an unconfigured route reports `UNCONFIGURED` per
image.

Two more switches complete the behavior: `autoSkipWhenMainModelAcceptsImages`
(default true) leaves messages untouched when the main route's resolved model
declares `image` input modality (the main model reads the image natively);
`enabled: false` turns the transform off entirely.

The companion client package
[`packages/client/ui-settings-image-caption`](../../../../packages/client/ui-settings-image-caption/README.md)
(`@deepseek-ai/dsh-client-ui-settings-image-caption`) registers the
「图片识别」 `settings.section`: a toggle and provider/model pickers (filtered
through the `llm.models` catalog to vision-capable entries) over
`settings.describe`/`replace` with `expectedRevision`, refreshed on the pushed
`settings/document-updated` event. The UI edits `enabled`, `provider`,
`model`, and `onError`; `prompt` and `maxTokens` stay cordis.yml-only. Serving
the namespace to configuration clients is a decision in the apiproxy allowlist
(`WEB_SETTINGS_NAMESPACES`), where `image-caption` is registered — without
that row the section renders its code defaults because `settings.describe`
filters the namespace out.

Mounting stays opt-in: the host package is declared in `apps/cli`
dependencies so bare-name resolution through the healed profiles fallback
works, but no shipped composition mounts it, and the client section renders
its code defaults when the namespace is absent.

### Durable invariant

The companion validates one relation: a `user/message` whose content carries
the caption prefix must not retain an image block (the transform replaces,
never augments). Messages without the prefix are outside the relation, which
keeps sessions on other presets valid.

## Alternatives considered

**Switch the session's main model to a vision model (config-only).** One
setting change and images flow natively — but the whole session's cost,
latency, and reasoning style move to the vision route, and the user's main
model choice is displaced. Kept as a user option; the plugin preserves the
main model.

**A `describe_image` tool instead of a transform.** The agent would call a
tool for each image, but a pasted image enters as message content that a
text-only adapter rejects before any tool call can happen — the tool cannot
rescue the message. Rejected: the transform is the only point before request
derivation.

**Caption into an additional injected message (time-context style).** A
plugin-sourced extra message would keep the original image message intact —
but that original still carries the image block into the request, which the
text-only adapter rejects. Rejected: replacement is required, not additive.

**Widen `GenerateOptions.purpose` with an `image-caption` member.** Cleaner
routing metadata, but it changes a core closed union for one consumer;
deferred until another purpose needs the same treatment.

## Consequences

**Bought**: text-only main models now receive pasted images as faithful
captions; the main route, its cost, and its tool behavior are untouched;
replay, subagent sessions on the same preset, and the durable log all carry
the captioned form automatically; the vision route and failure policy are
per-deployment configuration, editable from the settings page without a
cordis.yml edit; sessions whose main model accepts images skip the transform
entirely.

**Paid**: one extra vision call per image (latency plus the vision route's
billing — measured on `opencode-go`: minimax-m3 captioned a full UI
screenshot in ~12.5s at $0.0021); captions are lossy by nature — a bad
vision model can misinform the main model (the placeholder path caps the
damage but cannot eliminate it); a composition without the attachments
service stays inert and reports `NO_ATTACHMENTS` per image, so the plugin
mounts safely on headless profiles too.
