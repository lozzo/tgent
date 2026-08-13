/** 文件条目 */
export interface FileEntry {
  name: string
  type: 'file' | 'dir' | 'symlink' | 'symlink-dir'
  size: number
  mode: string
  mod_time: string
  link_target?: string // 软链接目标路径
}

/** 列目录响应 */
export interface DirListResponse {
  path: string
  entries: FileEntry[]
  parent: string
  total: number // 目录总条目数（用于分页）
}

/** 传输初始化响应 */
export interface TransferInit {
  transfer_id: string
  name?: string
  size: number
  chunk_size: number
  uploaded_offset?: number
}

/** 传输状态 */
export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled'

/** 传输信息（前端 UI 消费） */
export interface TransferInfo {
  id: string
  name: string
  direction: 'download' | 'upload'
  totalSize: number
  transferredSize: number
  status: TransferStatus
  startedAt: number
  error?: string
  /** 原始文件路径（用于重试下载） */
  filePath?: string
  /** 上传的 File 对象引用（用于重试上传） */
  file?: File
  /** 上传目标目录 */
  targetDir?: string
  /** 续传偏移量 */
  resumeOffset?: number
}

/** 文件预览响应 */
export interface PreviewResponse {
  path: string
  name: string
  size: number
  mime_type: string
  is_text: boolean
  content?: string
  content_base64?: string
}

/** 批量操作结果项 */
export interface BatchResult {
  source?: string
  dest?: string
  path?: string
  error?: string
}
