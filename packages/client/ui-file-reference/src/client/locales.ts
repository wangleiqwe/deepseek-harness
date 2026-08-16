/**
 * `file-reference` namespace dictionaries: the composer file-picker copy.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'picker.open': '引用工作区文件',
  'picker.title': '选择要引用的文件',
  'picker.filter': '筛选文件',
  'picker.loading': '正在读取工作区文件…',
  'picker.empty': '没有匹配的文件',
  'picker.error': '无法读取该目录',
  'picker.noWorkspace': '当前会话没有关联的工作区目录',
  'picker.confirm': '插入引用',
  'picker.cancel': '取消',
  'picker.truncated': '结果已截断，仅显示前 {n} 个文件',
  'picker.item': '引用 {name}',
  'picker.path': '目录路径',
  'picker.workspace': '工作区根目录',
  'picker.expand': '展开文件夹 {name}',
  'picker.collapse': '收起文件夹 {name}',
  'picker.dirLoading': '正在读取该文件夹…',
  'picker.dirError': '无法读取该文件夹',
} satisfies Record<string, string>

/** The file-reference namespace key union. */
export type FileReferenceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'picker.open': 'Reference workspace files',
  'picker.title': 'Select files to reference',
  'picker.filter': 'Filter files',
  'picker.loading': 'Reading workspace files…',
  'picker.empty': 'No matching files',
  'picker.error': 'Cannot read this directory',
  'picker.noWorkspace': 'This session has no associated workspace directory',
  'picker.confirm': 'Insert references',
  'picker.cancel': 'Cancel',
  'picker.truncated': 'Results truncated; first {n} files shown',
  'picker.item': 'Reference {name}',
  'picker.path': 'Directory path',
  'picker.workspace': 'Workspace root',
  'picker.expand': 'Expand folder {name}',
  'picker.collapse': 'Collapse folder {name}',
  'picker.dirLoading': 'Reading this folder…',
  'picker.dirError': 'Cannot read this folder',
} satisfies Record<FileReferenceKey, string>
