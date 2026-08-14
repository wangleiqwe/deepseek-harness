/** Copy dictionaries for the image-caption settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Image caption',
  enabled: 'Enable image captioning (text-only models can read pasted images)',
  provider: 'Vision provider',
  model: 'Vision model',
  onError: 'On caption failure',
  onErrorPlaceholder: 'Continue with a placeholder',
  onErrorFail: 'Fail the turn',
  loading: 'Loading…',
  error: 'Failed to load image captioning settings.',
  retry: 'Retry',
  noProvider: 'None selected',
  noVisionModels: 'This provider declares no image-capable models; configure a vision provider on the Models page first.',
  disabledHint: 'While disabled, pasted images reach the main model directly — text-only models reject image content.',
}

export const zh = {
  nav: '图片识别',
  enabled: '启用图片识别（纯文本模型也能读懂贴入的图片）',
  provider: '视觉供应商',
  model: '视觉模型',
  onError: '识别失败时',
  onErrorPlaceholder: '继续处理（用占位说明）',
  onErrorFail: '终止本轮',
  loading: '正在加载…',
  error: '无法加载图片识别设置。',
  retry: '重试',
  noProvider: '未选择',
  noVisionModels: '该供应商没有声明支持图片的模型，请先在「模型」页配置一个视觉供应商。',
  disabledHint: '关闭后，贴入的图片会直接发给主模型——纯文本模型会拒绝图片内容。',
}

/** Section copy key set. */
export type ImageCaptionKey = keyof typeof en
