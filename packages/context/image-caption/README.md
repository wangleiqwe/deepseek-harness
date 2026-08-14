# @deepseek-ai/dsh-image-caption

English | [中文](README.zh.md)

Agent-plane content transform that lets **text-only main models work with
pasted images**: when a user message entering a step carries image blocks,
this plugin captions each image through a configured vision route and
replaces the block with the caption text, so the main model reads what the
image says instead of being rejected for unsupported content.

## Mount

Opt-in — a preset row or a home patch layer, never a shipped default:

```yaml
- id: image-caption
  name: '@deepseek-ai/dsh-image-caption'
  config:
    provider: opencode-go
    model: minimax-m3
```

`provider` and `model` are required: no vision route is a safe default for
every deployment. The provider route must be registered (e.g. through the
pi-ai adapter profile) and its model must accept image input. Optional
fields:

- `prompt` — the captioning prompt; defaults to a verbatim-transcription
  instruction in [`src/config.ts`](src/config.ts).
- `maxTokens` — output cap per caption; defaults to 1024.
- `onError` — `placeholder` (default) replaces a failed caption with a text
  block naming the failure code so the step still proceeds; `fail` lets the
  failure end the turn.

## Behavior

The plugin listens on the `agent/pre-step` waterfall with `prepend: true`
and delegates downstream first, so every other listener sees the original
messages and this transform lands last:

- image-free decisions pass through untouched;
- each `ImageBlock` becomes a text block prefixed with the durable
  `CAPTION_PREFIX` ("The user attached an image to this message. …") followed
  by the vision model's description;
- sibling blocks keep their order, and the message keeps its `user` source;
- an empty caption is a failure (the image's meaning must not vanish
  silently), and an aborted step never starts a caption call;
- a composition without the attachments service stays inert — image blocks
  cannot appear there — and reports `NO_ATTACHMENTS` per image if one ever
  does.

The loop logs exactly the returned batch as `user/message` events, so the
model-visible ⟺ logged invariant holds and replay reconstructs the captioned
request. The invariant companion
([`src/invariant.ts`](src/invariant.ts)) pins the durable relation: a
`user/message` carrying the caption prefix must not retain an image block.

## Model effects

Each image-bearing message adds one auxiliary LLM call to the configured
vision route (input: the image plus the prompt; output: the caption). Token
and cost accounting for that call rides the vision provider's own billing;
the main model's request is unchanged except for the caption text replacing
the image block.

## Known limitations

- The caption call leaves `GenerateOptions.purpose` unset — the closed
  `purpose` union has no image-caption member yet.
- Failure placeholders carry the structured error code only, not provider
  messages.
- Only user content carries images today, so the transform only inspects
  user-role messages.
