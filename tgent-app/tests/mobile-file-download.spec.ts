import { expect, test } from '@playwright/test'

test('native download uses the scoped file channel and writes received bytes', async ({ page }) => {
  await page.goto('/#/')

  const result = await page.evaluate(async () => {
    const calls: Array<{ method: string; options: Record<string, unknown> }> = []
    let sessionOpened = false
    const capacitor = (window as any).Capacitor
    capacitor.isNativePlatform = () => true
    capacitor.getPlatform = () => 'android'
    capacitor.PluginHeaders = [{
      name: 'SaveToDownloads',
      methods: [
        { name: 'openFile', rtype: 'promise' },
        { name: 'writeChunk', rtype: 'promise' },
        { name: 'closeFile', rtype: 'promise' },
      ],
    }]
    capacitor.nativePromise = async (_plugin: string, method: string, options: Record<string, unknown>) => {
      calls.push({ method, options })
      if (method === 'openFile') {
        sessionOpened = true
        return { sessionId: 'download-session' }
      }
      return {}
    }

    const { FileTransferStore } = await import('/src/state/FileTransferStore.ts')

    class FakeFileChannel {
      binaryType = 'arraybuffer'
      bufferedAmount = 0
      bufferedAmountLowThreshold = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() { this.onclose?.() }
    }

    let fileChannel: FakeFileChannel | null = null
    let openedDestinationBeforeChannel = false
    const transport = {
      async sendApiRequest(_method: string, path: string) {
        if (path === '/files/download/init') {
          return { status: 200, body: { transfer_id: 'download-1', name: 'artifact.bin', size: 3, chunk_size: 65536 } }
        }
        return { status: 404, body: { error: 'unexpected request' } }
      },
      createFileChannel() {
        openedDestinationBeforeChannel = sessionOpened
        fileChannel = new FakeFileChannel()
        return fileChannel
      },
    }

    const store = new FileTransferStore()
    store.setStoreKey('local:test')
    store.setBridge({
      onTransferSync: () => () => {},
      sendTransferRequest: () => { throw new Error('legacy native transfer path must not run') },
    } as any)
    store.setTransport(transport as any)
    await store.startDownload('/tmp/artifact.bin')

    const channel = fileChannel as FakeFileChannel | null
    if (!channel) throw new Error('file channel was not created')
    channel.onopen?.()
    channel.onmessage?.({ data: new Uint8Array([0x01, 0, 0, 0, 0, 7, 8, 9]).buffer })
    channel.onmessage?.({ data: new Uint8Array([0x02, 0, 0, 0, 1]).buffer })
    await new Promise(resolve => setTimeout(resolve, 50))

    return {
      openedDestinationBeforeChannel,
      calls,
      transfer: store.getSnapshot().transfers[0],
    }
  })

  expect(result.openedDestinationBeforeChannel).toBe(true)
  expect(result.calls.map(call => call.method)).toEqual(['openFile', 'writeChunk', 'closeFile'])
  expect(result.transfer).toMatchObject({ status: 'completed', transferredSize: 3 })
})
