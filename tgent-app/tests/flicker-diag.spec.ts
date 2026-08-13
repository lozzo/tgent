import { test, expect, devices } from '@playwright/test'

const PANE_ID = '%18'
const TERMINAL_URL = `/terminal/${encodeURIComponent(PANE_ID)}`

function waitMs(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('mobile: deep flicker diagnosis', async ({ browser }) => {
  const iPhone = devices['iPhone 13']
  const ctx = await browser.newContext({ ...iPhone })
  const page = await ctx.newPage()

  // Collect console logs
  const logs: { time: number; text: string }[] = []
  const t0 = Date.now()
  page.on('console', msg => {
    logs.push({ time: Date.now() - t0, text: msg.text() })
  })

  await page.goto(TERMINAL_URL)

  // Inject deep monitoring script immediately after page loads
  await page.evaluate(() => {
    const t0 = performance.now()
    const events: string[] = []
    const log = (msg: string) => {
      const t = (performance.now() - t0).toFixed(1)
      const entry = `[${t}ms] ${msg}`
      events.push(entry)
      console.log(`[MONITOR ${t}ms] ${msg}`)
    }

    // Monitor scroll events on window, document, body
    window.addEventListener('scroll', () => {
      log(`window.scroll scrollY=${window.scrollY} docScrollTop=${document.documentElement.scrollTop}`)
    }, true)

    // Monitor all scroll events (capture phase)
    document.addEventListener('scroll', (e) => {
      const el = e.target as Element
      const tag = el === document ? 'document' : (el?.className || el?.tagName || 'unknown')
      const scrollTop = el === document ? document.documentElement.scrollTop : (el as HTMLElement)?.scrollTop
      log(`scroll on ${tag} scrollTop=${scrollTop}`)
    }, true)

    // Monitor header size changes
    const header = document.querySelector('header')
    if (header) {
      const hro = new ResizeObserver((entries) => {
        for (const e of entries) {
          log(`header resize: ${e.contentRect.width}x${e.contentRect.height}`)
        }
      })
      hro.observe(header)
    }

    // Monitor main container size changes
    const main = document.querySelector('main')
    if (main) {
      const mro = new ResizeObserver((entries) => {
        for (const e of entries) {
          log(`main resize: ${e.contentRect.width}x${e.contentRect.height}`)
        }
      })
      mro.observe(main)
    }

    // Monitor xterm viewport scroll
    const checkXtermViewport = () => {
      const vp = document.querySelector('.xterm-viewport') as HTMLElement
      if (vp) {
        let lastScrollTop = vp.scrollTop
        vp.addEventListener('scroll', () => {
          log(`xterm-viewport scroll: ${lastScrollTop} -> ${vp.scrollTop}`)
          lastScrollTop = vp.scrollTop
        })
        log(`xterm-viewport found, initial scrollTop=${vp.scrollTop}`)

        // Also observe its size
        const vpro = new ResizeObserver((entries) => {
          for (const e of entries) {
            log(`xterm-viewport resize: ${e.contentRect.width}x${e.contentRect.height}`)
          }
        })
        vpro.observe(vp)
      } else {
        setTimeout(checkXtermViewport, 50)
      }
    }
    checkXtermViewport()

    // Monitor DOM mutations on header (text changes)
    if (header) {
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'childList' || m.type === 'characterData') {
            log(`header DOM mutation: ${header.textContent?.trim().substring(0, 80)}`)
          }
        }
      })
      mo.observe(header, { childList: true, subtree: true, characterData: true })
    }

    // Use PerformanceObserver to detect layout shifts
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const ls = entry as any
          log(`layout-shift value=${ls.value?.toFixed(4)} hadRecentInput=${ls.hadRecentInput}`)
          if (ls.sources) {
            for (const src of ls.sources) {
              log(`  shift source: ${src.node?.nodeName} from=${JSON.stringify(src.previousRect)} to=${JSON.stringify(src.currentRect)}`)
            }
          }
        }
      })
      po.observe({ type: 'layout-shift', buffered: true })
    } catch {}

    // Track requestAnimationFrame to count frames
    let frameCount = 0
    const trackFrames = () => {
      frameCount++
      if (frameCount <= 30) { // only log first 30 frames
        log(`rAF frame #${frameCount}`)
      }
      if (frameCount < 60) requestAnimationFrame(trackFrames)
    }
    requestAnimationFrame(trackFrames)

    ;(window as any).__monitorEvents = events
  })

  // Wait for everything to settle
  await waitMs(5000)

  // Get final state
  const finalState = await page.evaluate(() => {
    const header = document.querySelector('header')
    const main = document.querySelector('main')
    const vp = document.querySelector('.xterm-viewport') as HTMLElement
    return {
      headerHeight: header?.getBoundingClientRect().height,
      headerText: header?.textContent?.trim(),
      mainHeight: main?.getBoundingClientRect().height,
      xtermViewportScrollTop: vp?.scrollTop,
      xtermViewportScrollHeight: vp?.scrollHeight,
      xtermViewportClientHeight: vp?.clientHeight,
      windowScrollY: window.scrollY,
      docScrollTop: document.documentElement.scrollTop,
    }
  })

  await page.screenshot({ path: 'tests/screenshots/deep-final.png' })

  // Print all logs
  console.log('\n=== All Console Logs ===')
  for (const l of logs) {
    console.log(`  [${l.time}ms] ${l.text}`)
  }

  // Filter monitor events
  const monitorLogs = logs.filter(l => l.text.includes('[MONITOR'))
  console.log('\n=== Monitor Events ===')
  for (const m of monitorLogs) {
    console.log(`  [${m.time}ms] ${m.text}`)
  }

  // Filter layout shifts
  const shiftLogs = logs.filter(l => l.text.includes('layout-shift'))
  console.log('\n=== Layout Shifts ===')
  for (const s of shiftLogs) {
    console.log(`  ${s.text}`)
  }

  // Filter scroll events
  const scrollLogs = logs.filter(l => l.text.includes('scroll') && l.text.includes('[MONITOR'))
  console.log('\n=== Scroll Events ===')
  for (const s of scrollLogs) {
    console.log(`  [${s.time}ms] ${s.text}`)
  }

  console.log('\n=== Final State ===', JSON.stringify(finalState, null, 2))

  await ctx.close()
})
