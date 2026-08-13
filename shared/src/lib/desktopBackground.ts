export const DESKTOP_BACKGROUND_EVENT = 'tgent-desktop-background-change'
export const MAX_DESKTOP_BACKGROUND_BYTES = 24 * 1024 * 1024

const DATABASE_NAME = 'tgent-desktop-assets'
const STORE_NAME = 'appearance'
const BACKGROUND_KEY = 'background-image'

interface StoredBackgroundImage {
  id: typeof BACKGROUND_KEY
  name: string
  type: string
  blob: Blob
}

export interface DesktopBackgroundImage {
  name: string
  type: string
  url: string
}

let cachedImage: DesktopBackgroundImage | null | undefined

async function optimizeBackgroundImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || typeof createImageBitmap === 'undefined') return file
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const maxDimension = Math.max(bitmap.width, bitmap.height)
    const pixelCount = bitmap.width * bitmap.height
    if (maxDimension <= 4096 && pixelCount <= 14_000_000 && file.size <= 12 * 1024 * 1024) return file
    const scale = Math.min(1, 4096 / maxDimension, Math.sqrt(14_000_000 / pixelCount))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>(resolve => {
      canvas.toBlob(blob => resolve(blob ?? file), 'image/webp', 0.88)
    })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open the desktop asset store.'))
  })
}

async function runRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = action(transaction.objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Unable to update the desktop asset store.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('The desktop asset update was cancelled.'))
    })
  } finally {
    database.close()
  }
}

function replaceCachedImage(record: StoredBackgroundImage | null): DesktopBackgroundImage | null {
  if (cachedImage?.url) URL.revokeObjectURL(cachedImage.url)
  cachedImage = record
    ? { name: record.name, type: record.type, url: URL.createObjectURL(record.blob) }
    : null
  return cachedImage
}

function notifyBackgroundChange(image: DesktopBackgroundImage | null): void {
  window.dispatchEvent(new CustomEvent<DesktopBackgroundImage | null>(DESKTOP_BACKGROUND_EVENT, { detail: image }))
}

export async function loadDesktopBackgroundImage(): Promise<DesktopBackgroundImage | null> {
  if (cachedImage !== undefined) return cachedImage
  if (typeof indexedDB === 'undefined') return null
  const record = await runRequest<StoredBackgroundImage | undefined>('readonly', store => store.get(BACKGROUND_KEY))
  return replaceCachedImage(record ?? null)
}

export async function saveDesktopBackgroundImage(file: File): Promise<DesktopBackgroundImage> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPEG, WebP, GIF, or AVIF image.')
  if (file.size > MAX_DESKTOP_BACKGROUND_BYTES) throw new Error('Background images must be smaller than 24 MB.')
  const blob = await optimizeBackgroundImage(file)
  const record: StoredBackgroundImage = {
    id: BACKGROUND_KEY,
    name: file.name,
    type: blob.type || file.type,
    blob,
  }
  await runRequest<IDBValidKey>('readwrite', store => store.put(record))
  const image = replaceCachedImage(record)
  if (!image) throw new Error('Unable to load the selected background image.')
  notifyBackgroundChange(image)
  return image
}

export async function removeDesktopBackgroundImage(): Promise<void> {
  if (typeof indexedDB !== 'undefined') {
    await runRequest<undefined>('readwrite', store => store.delete(BACKGROUND_KEY) as IDBRequest<undefined>)
  }
  replaceCachedImage(null)
  notifyBackgroundChange(null)
}
