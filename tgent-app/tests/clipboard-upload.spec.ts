import { expect, test } from '@playwright/test'

test('intercepts a Wails paste before xterm can insert clipboard text again', async ({ page }) => {
  await page.goto('/#/desktop-prototype')

  const result = await page.evaluate(async () => {
    ;(window as any).go = { main: { App: {} } }
    const { interceptWailsTerminalPaste } = await import('/src/lib/platform.ts')
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    let nativePasteCount = 0
    let xtermPasteCount = 0

    textarea.addEventListener('paste', event => {
      if (interceptWailsTerminalPaste(event)) nativePasteCount++
    }, { capture: true })
    textarea.addEventListener('paste', () => { xtermPasteCount++ })

    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    textarea.dispatchEvent(event)
    textarea.remove()
    return { nativePasteCount, xtermPasteCount, defaultPrevented: event.defaultPrevented }
  })

  expect(result).toEqual({ nativePasteCount: 1, xtermPasteCount: 0, defaultPrevented: true })
})

test('coalesces the Command+V key path with the following WKWebView paste event', async ({ page }) => {
  await page.goto('/#/desktop-prototype')

  const result = await page.evaluate(async () => {
    const { createWailsPasteEventGate } = await import('/src/lib/platform.ts')
    const gate = createWailsPasteEventGate()
    gate.expectPasteEvent()
    return [gate.consumePasteEvent(), gate.consumePasteEvent()]
  })

  expect(result).toEqual([true, false])
})

test('treats URL clipboard content as text when no explicit image is available', async ({ page }) => {
  await page.goto('/#/desktop-prototype')

  const result = await page.evaluate(async () => {
    const url = 'https://example.com/releases/archive?file=image.png#details'
    ;(window as any).go = {
      main: {
        App: {
          ReadClipboardImage: async () => ({}),
        },
      },
    }
    ;(window as any).runtime = { ClipboardGetText: async () => url }
    const { readWailsTerminalClipboard } = await import('/src/lib/platform.ts')
    return readWailsTerminalClipboard()
  })

  expect(result).toEqual({ kind: 'text', text: 'https://example.com/releases/archive?file=image.png#details' })
})

test('uses the atomic native clipboard classification for browser URL pasteboards', async ({ page }) => {
  await page.goto('/#/desktop-prototype')

  const result = await page.evaluate(async () => {
    ;(window as any).go = {
      main: {
        App: {
          ReadTerminalClipboard: async () => ({
            kind: 'text',
            text: 'https://example.com/from-public-url',
            image: {},
          }),
          ReadClipboardImage: async () => { throw new Error('legacy path must not run') },
        },
      },
    }
    ;(window as any).runtime = { ClipboardGetText: async () => { throw new Error('runtime path must not run') } }
    const { readWailsTerminalClipboard } = await import('/src/lib/platform.ts')
    return readWailsTerminalClipboard()
  })

  expect(result).toEqual({ kind: 'text', text: 'https://example.com/from-public-url' })
})

test('falls back to URL text when native image decoding fails', async ({ page }) => {
  await page.goto('/#/desktop-prototype')

  const result = await page.evaluate(async () => {
    ;(window as any).go = {
      main: {
        App: {
          ReadClipboardImage: async () => { throw new Error('unsupported pasteboard type') },
        },
      },
    }
    ;(window as any).runtime = { ClipboardGetText: async () => 'file:///Users/example/project' }
    const { readWailsTerminalClipboard } = await import('/src/lib/platform.ts')
    return readWailsTerminalClipboard()
  })

  expect(result).toEqual({ kind: 'text', text: 'file:///Users/example/project' })
})

test('uploads a clipboard image completely before returning its remote path', async ({ page }) => {
  await page.goto('/#/desktop-prototype')

  const result = await page.evaluate(async () => {
    const { FileTransferStore } = await import('/src/state/FileTransferStore.ts')
    const sentFrameTypes: number[] = []
    const apiPaths: string[] = []

    class FakeFileChannel {
      binaryType = 'arraybuffer'
      bufferedAmount = 0
      bufferedAmountLowThreshold = 0
      onopen: (() => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null

      addEventListener() {}
      removeEventListener() {}
      send(frame: Uint8Array) { sentFrameTypes.push(frame[0]) }
      close() { this.onclose?.() }
    }

    const transport = {
      async sendApiRequest(_method: string, path: string) {
        apiPaths.push(path)
        if (path === '/files/upload/init') {
          return { status: 200, body: { transfer_id: 'ul-clipboard', size: 4, chunk_size: 2 } }
        }
        if (path === '/files/upload/complete') {
          return { status: 200, body: { path: '/tmp/tgent/clipboard/image.png' } }
        }
        return { status: 404, body: { error: 'unexpected request' } }
      },
      createFileChannel() {
        const channel = new FakeFileChannel()
        queueMicrotask(() => channel.onopen?.())
        return channel
      },
    }

    const store = new FileTransferStore()
    store.setTransport(transport as any)
    const path = await store.uploadTemporaryFile(
      new File([new Uint8Array([1, 2, 3, 4])], 'image.png', { type: 'image/png' }),
      '/tmp/tgent/clipboard',
    )

    return {
      path,
      apiPaths,
      sentFrameTypes,
      transfer: store.getSnapshot().transfers[0],
    }
  })

  expect(result.path).toBe('/tmp/tgent/clipboard/image.png')
  expect(result.apiPaths).toEqual(['/files/upload/init', '/files/upload/complete'])
  expect(result.sentFrameTypes).toEqual([0x01, 0x01, 0x02])
  expect(result.transfer).toMatchObject({ status: 'completed', transferredSize: 4 })
})
