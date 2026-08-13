import { test, expect } from '@playwright/test'

async function buildReviewLayout(page: import('@playwright/test').Page) {
  await page.goto('/#/desktop-prototype')
  await page.keyboard.press('Meta+d')
  await page.locator('.desktop-terminal-pane').nth(1).click()
  await page.keyboard.press('Meta+Shift+d')
  const activeTextarea = page.locator('.desktop-terminal-pane.is-active .xterm-helper-textarea')
  await activeTextarea.focus()
  await page.keyboard.type('kubectl get pods')
  await page.keyboard.press('Enter')
}

async function expectVisuallyCentered(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error('Dialog or viewport bounds unavailable')
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2)
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2)
}

test('desktop review screenshot has no viewport overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await buildReviewLayout(page)
  await expect(page.locator('.desktop-terminal-pane')).toHaveCount(3)
  const fitsViewport = await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)
  expect(fitsViewport).toBe(true)
  await page.screenshot({
    path: '../design/exports/tgent-desktop-gui-prototype.png',
    fullPage: true,
  })
})

test('compact desktop review screenshot has no viewport overflow', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 720 })
  await buildReviewLayout(page)
  await expect(page.locator('.desktop-terminal-pane')).toHaveCount(3)
  const fitsViewport = await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)
  expect(fitsViewport).toBe(true)
  await page.screenshot({
    path: '../design/exports/tgent-desktop-gui-prototype-compact.png',
    fullPage: true,
  })
})

test('terminal activity watch shows generic PTY states without opening another panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/desktop-prototype')
  await page.keyboard.press('Meta+d')
  await page.locator('.desktop-terminal-pane').nth(1).click()
  await page.keyboard.press('Meta+Shift+d')
  const watch = page.getByRole('navigation', { name: 'Observed terminal activity' })
  await expect(watch.locator('[data-activity-state="working"]')).toHaveCount(1)
  await expect(watch.locator('[data-activity-state="quiet"]')).toHaveCount(1)
  await expect(watch.locator('[data-activity-state="attention"]')).toHaveCount(1)
  const workingSignal = watch.locator('[data-activity-state="working"] .desktop-terminal-watch-signal')
  await expect(workingSignal).toBeVisible()
  expect(await workingSignal.evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('desktop-terminal-watch-breathe')
  await page.screenshot({
    path: '../design/exports/tgent-desktop-terminal-activity.png',
    fullPage: true,
  })
})

test('terminal activity breathing respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/desktop-prototype')
  const workingSignal = page.locator('[data-activity-state="working"] .desktop-terminal-watch-signal')
  await expect(workingSignal).toBeVisible()
  expect(await workingSignal.evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none')
})

test('file browser stays progressive and overlays the active terminal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await buildReviewLayout(page)
  await page.getByRole('button', { name: 'Open file browser' }).click()
  await expect(page.locator('.desktop-file-panel')).toBeVisible()
  await page.screenshot({
    path: '../design/exports/tgent-desktop-files-prototype.png',
    fullPage: true,
  })
})

test('terminal picker keeps terminal identity ahead of remote topology', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await buildReviewLayout(page)
  await page.keyboard.press('Meta+p')
  const picker = page.getByRole('dialog', { name: 'Terminal picker' })
  await expect(picker).toBeVisible()
  await expectVisuallyCentered(page, picker)
  await page.screenshot({
    path: '../design/exports/tgent-desktop-terminal-picker.png',
    fullPage: true,
  })
})

test('terminal picker shows an in-place connection state for an offline remote object', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await buildReviewLayout(page)
  await page.keyboard.press('Meta+p')
  await page.getByRole('combobox', { name: 'Find a terminal' }).fill('gateway')
  await page.keyboard.press('Enter')
  const picker = page.getByRole('dialog', { name: 'Terminal picker' })
  await expect(picker).toHaveAttribute('aria-busy', 'true')
  await expect(picker.getByRole('status')).toHaveText('Connecting to Frankfurt edge')
  await page.screenshot({
    path: '../design/exports/tgent-desktop-terminal-picker-connecting.png',
    fullPage: true,
  })
})

test('terminal picker keeps the current terminal visible after a connection failure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await buildReviewLayout(page)
  await page.keyboard.press('Meta+p')
  await page.getByRole('combobox', { name: 'Find a terminal' }).fill('gateway')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Frankfurt edge timed out')
  await page.screenshot({
    path: '../design/exports/tgent-desktop-terminal-picker-failed.png',
    fullPage: true,
  })
})

test('broadcast target picker stays compact across remote objects', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await buildReviewLayout(page)
  await page.getByRole('button', { name: 'Choose broadcast targets' }).click()
  const picker = page.getByRole('dialog', { name: 'Broadcast targets' })
  await expect(picker).toBeVisible()
  await expectVisuallyCentered(page, picker)
  await page.screenshot({
    path: '../design/exports/tgent-desktop-broadcast-targets.png',
    fullPage: true,
  })
})

test('tmux topology browser preserves the complete remote tree on demand', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await buildReviewLayout(page)
  await page.getByRole('button', { name: 'Open tmux topology' }).click()
  const topology = page.getByRole('dialog', { name: 'Tmux topology' })
  await expect(topology).toBeVisible()
  await expectVisuallyCentered(page, topology)
  await page.screenshot({
    path: '../design/exports/tgent-desktop-topology-browser.png',
    fullPage: true,
  })
})

test('topology node actions keep tmux CRUD progressive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/desktop-prototype')
  await page.getByRole('button', { name: 'Open tmux topology' }).click()
  await page.getByRole('button', { name: 'Actions for window api' }).click()
  await expect(page.getByRole('menu', { name: 'api actions' })).toBeVisible()
  await page.screenshot({
    path: '../design/exports/tgent-desktop-topology-crud-menu.png',
    fullPage: true,
  })
})

test('topology drag projects the split size before the terminal is placed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/desktop-prototype')
  await page.getByRole('button', { name: 'Open tmux topology' }).click()
  const source = page.getByRole('treeitem', { name: /inference shell/ })
  const target = page.locator('.desktop-terminal-pane').first()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('Drag source or target not found')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 12, sourceBox.y + sourceBox.height / 2, { steps: 3 })
  await page.mouse.move(targetBox.x + targetBox.width - 36, targetBox.y + targetBox.height / 2, { steps: 10 })
  await expect(page.getByTestId('pane-drop-preview')).toHaveClass(/is-right/)
  await page.screenshot({
    path: '../design/exports/tgent-desktop-topology-drag-preview.png',
    fullPage: true,
  })
  await page.mouse.up()
})

test('detached tmux pane preserves the local split layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await buildReviewLayout(page)
  const activeTerminal = page.locator('.desktop-terminal-pane.is-active .xterm-helper-textarea')
  await activeTerminal.focus()
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(page.locator('.desktop-pane-detached')).toBeVisible()
  await page.screenshot({
    path: '../design/exports/tgent-desktop-pane-detached.png',
    fullPage: true,
  })
})
