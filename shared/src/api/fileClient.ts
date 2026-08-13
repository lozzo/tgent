import type { WebRTCTransport } from './transport'
import type { DirListResponse, FileEntry, TransferInit, PreviewResponse, BatchResult } from '../types/files'

/** 创建文件 API 客户端（通过 WebRTC DataChannel） */
export function createFileApi(transport: WebRTCTransport) {
  async function req<T>(path: string, body?: unknown): Promise<T> {
    const resp = await transport.sendApiRequest('POST', path, body)
    if (resp.status >= 400) {
      const err = resp.body as { error?: string }
      throw new Error(err?.error || `File API failed: ${resp.status}`)
    }
    return resp.body as T
  }

  return {
    listDir: (path?: string, offset?: number, limit?: number) =>
      req<DirListResponse>('/files/list', { path: path || '', offset: offset || 0, limit: limit || 500 }),

    stat: (path: string) =>
      req<FileEntry>('/files/stat', { path }),

    mkdir: (path: string) =>
      req<{ path: string }>('/files/mkdir', { path }),

    delete: (path: string) =>
      req<{ path: string }>('/files/delete', { path }),

    rename: (path: string, newPath: string) =>
      req<{ path: string }>('/files/rename', { path, new_path: newPath }),

    downloadInit: (path: string, offset?: number) =>
      req<TransferInit>('/files/download/init', { path, ...(offset != null && offset > 0 ? { offset } : {}) }),

    uploadInit: (path: string, size: number, resumeId?: string) =>
      req<TransferInit>('/files/upload/init', { path, size, ...(resumeId ? { resume_id: resumeId } : {}) }),

    uploadComplete: (transferId: string) =>
      req<{ path: string }>('/files/upload/complete', { transfer_id: transferId }),

    copy: (paths: string[], dest: string) =>
      req<{ copied: number; results: BatchResult[] }>('/files/copy', { paths, dest }),

    move: (paths: string[], dest: string) =>
      req<{ moved: number; results: BatchResult[] }>('/files/move', { paths, dest }),

    batchDelete: (paths: string[]) =>
      req<{ deleted: number; errors: BatchResult[] }>('/files/batch-delete', { paths }),

    preview: (path: string, maxSize?: number) =>
      req<PreviewResponse>('/files/preview', { path, max_size: maxSize }),
  }
}

export type FileApi = ReturnType<typeof createFileApi>
