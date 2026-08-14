# @deepseek-ai/dsh-client-ui-settings-image-caption

English | [中文](README.zh.md)

Settings surface for the host-side image-caption transform (`@deepseek-ai/dsh-image-caption`): one page on the settings panel where users turn captioning of pasted images on and off and pick the vision route that produces the captions. The Host owns the transform and the `image-caption` settings namespace; this package only projects that namespace.

## Surfaces

- `settings.section` (`id: image-caption`, order 20): the 「图片识别」 page with an enable toggle, a provider picker, a model picker filtered to catalog entries that declare the `image` input modality, and the failure policy (`placeholder` to continue with a placeholder note, `fail` to stop the turn).

The section reads the namespace through `settings.describe` and the model catalog through `llm.models`, writes through `settings.replace` with `expectedRevision`, and refetches on the pushed `settings/document-updated` event, so every open settings surface converges after a write.

## Model Experience

No model-visible surface: the package registers no tools, prompt sections, or model-visible events. The transform itself runs on the Host and is logged there; this section only adds the additive settings page above, which changes no conversation or session content. Token and KV-cache effects: none.

## Known Limitations and Deferred Work

- Only `enabled`, `provider`, `model`, and `onError` are editable here; `prompt` and `maxTokens` stay cordis.yml config of the host plugin.
- The model picker lists only models whose catalog entry declares `inputModalities` containing `image`; a provider whose catalog carries no vision-capable entry shows the "no vision models" hint instead of a picker.
- When the host plugin is not mounted, the namespace is absent and the section falls back to the code defaults (enabled, placeholder policy) with the pickers empty.
- A concurrent write elsewhere surfaces as an error line inside the section; the next load refetches the winning value.
