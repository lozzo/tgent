import { test, expect } from '@playwright/test'

test.describe('desktop terminal prototype', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/desktop-prototype')
    await expect(page.locator('.desktop-prototype-shell')).toBeVisible()
  })

  test('supports nested splits, resizing, focus, maximize and restore', async ({ page }) => {
    const panes = page.locator('.desktop-terminal-pane')
    await expect(panes).toHaveCount(1)
    const originalTerminal = panes.first().locator('.xterm')
    await originalTerminal.evaluate(element => element.setAttribute('data-render-instance', 'original'))
    const initialHeader = panes.first().locator('.desktop-pane-header')
    await expect(initialHeader).toContainText('Singapore production')
    await expect(initialHeader).toContainText('deploy / api / %8')
    await expect(initialHeader).toHaveAttribute('style', /--connection-color: #4f7dff/)

    await page.keyboard.press('Meta+d')
    await expect(panes).toHaveCount(2)
    await expect(panes.first().locator('.xterm')).toHaveAttribute('data-render-instance', 'original')
    await expect(panes.first().locator('.desktop-pane-terminal')).not.toHaveCSS('transition-property', 'opacity')

    await panes.nth(1).click()
    await page.keyboard.press('Meta+Shift+d')
    await expect(panes).toHaveCount(3)
    await expect(panes.first().locator('.xterm')).toHaveAttribute('data-render-instance', 'original')

    const divider = page.locator('.desktop-pane-divider').first()
    const before = await divider.boundingBox()
    if (!before) throw new Error('Divider not found')
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await page.mouse.down()
    await page.mouse.move(before.x + 110, before.y + before.height / 2)
    await page.mouse.up()

    const activeBefore = await page.locator('.desktop-terminal-pane.is-active').getAttribute('data-pane-id')
    await page.keyboard.press('Meta+Alt+ArrowLeft')
    const activeAfter = await page.locator('.desktop-terminal-pane.is-active').getAttribute('data-pane-id')
    expect(activeAfter).not.toBe(activeBefore)

    await page.keyboard.press('Meta+Shift+Enter')
    await expect(panes).toHaveCount(1)
    await expect(page.locator('.desktop-terminal-workspace')).toHaveClass(/is-maximized/)

    await page.keyboard.press('Meta+Shift+Enter')
    await expect(panes).toHaveCount(3)
    await expect(page.locator('.desktop-terminal-workspace')).not.toHaveClass(/is-maximized/)
  })

  test('monitors generic PTY output and jumps to a terminal across background tabs', async ({ page }) => {
    await page.keyboard.press('Meta+d')
    await page.locator('.desktop-terminal-pane').nth(1).click()
    await page.keyboard.press('Meta+Shift+d')

    const watch = page.getByRole('navigation', { name: 'Observed terminal activity' })
    const apiWatch = watch.getByRole('button', { name: /Open api watch/ })
    const workerLogs = watch.getByRole('button', { name: /Open worker logs/ })
    const inference = watch.getByRole('button', { name: /Open inference shell/ })
    await expect(apiWatch).toHaveAttribute('data-activity-state', 'working')
    await expect(workerLogs).toHaveAttribute('data-activity-state', 'quiet')
    await expect(inference).toHaveAttribute('data-activity-state', 'attention')

    await page.keyboard.press('Meta+t')
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.getByRole('tab', { name: 'New tab' })).toHaveAttribute('aria-selected', 'true')
    await expect(picker).toBeVisible()
    await picker.getByRole('combobox', { name: 'Find a terminal' }).fill('release builder')
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()
    await expect(page.getByRole('tab', { name: 'release builder' })).toHaveAttribute('aria-selected', 'true')
    await apiWatch.click()
    await expect(page.getByRole('tab', { name: /deploy/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.desktop-terminal-pane.is-active .desktop-pane-header')).toContainText('deploy / api / %8')

    await inference.click()
    const activeTerminal = page.locator('.desktop-terminal-pane.is-active .xterm-helper-textarea')
    await activeTerminal.focus()
    await page.keyboard.type('status')
    await page.keyboard.press('Enter')
    await expect(inference).toHaveAttribute('data-activity-state', 'working')
    await expect(inference).toHaveAccessibleName(/receiving output/i)

    await page.keyboard.type('missing-command')
    await page.keyboard.press('Enter')
    await expect(inference).toHaveAttribute('data-activity-state', 'attention')
    await expect(inference).toHaveAccessibleName(/last command returned an error/i)
  })

  test('broadcasts only to explicit targets across remote objects', async ({ page }) => {
    await page.keyboard.press('Meta+d')
    const panes = page.locator('.desktop-terminal-pane')
    await expect(panes).toHaveCount(2)
    await panes.nth(1).click()
    await page.keyboard.press('Meta+Shift+d')
    await expect(panes).toHaveCount(3)

    await page.getByRole('button', { name: 'Choose broadcast targets' }).click()
    const targetPicker = page.getByRole('dialog', { name: 'Broadcast targets' })
    await expect(targetPicker).toBeVisible()
    await expect(targetPicker.getByRole('checkbox')).toHaveCount(3)
    await targetPicker.getByRole('checkbox', { name: /worker logs/ }).click()
    await expect(targetPicker).toContainText('2 selected')
    await targetPicker.getByRole('button', { name: 'Start' }).click()

    await expect(page.getByRole('button', { name: 'Adjust broadcast targets' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.desktop-pane-broadcast')).toHaveCount(2)

    await panes.nth(0).click()
    const sourceTextarea = panes.nth(0).locator('.xterm-helper-textarea')
    await sourceTextarea.focus()
    await page.keyboard.type('status')
    await page.keyboard.press('Enter')

    const terminalRows = page.locator('.desktop-terminal-pane .xterm-rows')
    await expect(terminalRows.nth(0)).toContainText('rollout stable')
    await expect(terminalRows.nth(1)).not.toContainText('rollout stable')
    await expect(terminalRows.nth(2)).toContainText('rollout stable')
  })

  test('supports shortcut split and pane context menu', async ({ page }) => {
    await page.keyboard.press('Meta+d')
    await expect(page.locator('.desktop-terminal-pane')).toHaveCount(2)

    await page.locator('.desktop-terminal-pane').first().click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Split local view below/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Close panel view/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()

    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await expect(page.getByRole('menuitem', { name: /Switch terminal/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Browse tmux topology/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Split local view right/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Browse files/ })).toBeVisible()
  })

  test('coalesces the surviving terminal resize when a split panel closes', async ({ page }) => {
    await page.keyboard.press('Meta+d')
    const panes = page.locator('.desktop-terminal-pane')
    await expect(panes).toHaveCount(2)

    const survivingTerminal = panes.first().locator('.desktop-terminal-xterm')
    const survivingXterm = survivingTerminal.locator('.xterm')
    await survivingXterm.evaluate(element => element.setAttribute('data-render-instance', 'survivor'))

    await panes.nth(1).getByRole('button', { name: /Close panel view/ }).click()
    await expect(panes).toHaveCount(1)
    await expect(survivingXterm).toHaveAttribute('data-render-instance', 'survivor')
    await expect(survivingTerminal).toHaveAttribute('data-layout-settling', 'true')
    await expect(survivingTerminal).not.toHaveAttribute('data-layout-settling', 'true', { timeout: 1_000 })
    await expect(panes.first()).toHaveCSS('width', `${await page.locator('.desktop-pane-layout').first().evaluate(element => element.clientWidth)}px`)
  })

  test('picks a terminal and replaces only the current local view binding', async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 720 })
    const panes = page.locator('.desktop-terminal-pane')
    const paneIdBefore = await panes.first().getAttribute('data-pane-id')

    await page.keyboard.press('Meta+p')
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    await expect(picker).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(7)
    const fitsViewport = await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)
    expect(fitsViewport).toBe(true)

    const search = page.getByRole('combobox', { name: 'Find a terminal' })
    await expect(search).toBeFocused()
    await search.fill('inference')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')

    await expect(picker).toBeHidden()
    await expect(panes).toHaveCount(1)
    await expect(panes.first()).toHaveAttribute('data-pane-id', paneIdBefore ?? '')
    await expect(panes.first().locator('.desktop-pane-header')).toContainText('edge-tokyo')
    await expect(panes.first().locator('.desktop-pane-header')).toContainText('inference / serve / %3')
  })

  test('fuzzy searches every terminal identity field, highlights matches and keeps selection visible', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 440 })
    await page.keyboard.press('Meta+p')
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    const search = picker.getByRole('combobox', { name: 'Find a terminal' })

    await search.fill('rlsbld')
    const release = picker.getByRole('option', { name: /release builder/i })
    await expect(release).toBeVisible()
    await expect.poll(async () => (await release.locator('mark').allTextContents()).join('')).toBe('rlsbld')

    await search.fill('tok ser')
    const tokyo = picker.getByRole('option', { name: /inference shell.*Tokyo edge.*serve/i })
    await expect(tokyo).toBeVisible()
    await expect(tokyo.locator('mark')).not.toHaveCount(0)

    await search.fill('')
    for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowDown')
    const selectedOption = picker.locator('[role="option"][aria-selected="true"]')
    await expect(selectedOption).toBeVisible()
    await expect.poll(() => selectedOption.evaluate(element => {
      const item = element.getBoundingClientRect()
      const list = element.parentElement!.getBoundingClientRect()
      return item.top >= list.top - 1 && item.bottom <= list.bottom + 1
    })).toBe(true)
  })

  test('creates a pending local tab and keeps client terminals in the tgent session', async ({ page }) => {
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(1)

    await page.getByRole('button', { name: 'New terminal tab' }).click()
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    await expect(tabs).toHaveCount(2)
    await expect(page.getByRole('tab', { name: 'New tab' })).toHaveAttribute('aria-selected', 'true')
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('status')).toHaveText('tgent session')

    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(tabs).toHaveCount(1)
    await expect(page.getByRole('tab', { name: /deploy/ })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('button', { name: 'New terminal tab' }).click()
    await picker.getByRole('button', { name: 'New terminal' }).click()
    await expect(picker).toBeHidden()
    await expect(tabs).toHaveCount(2)
    await expect(page.getByRole('tab', { name: 'terminal-1' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.desktop-terminal-pane.is-active .desktop-pane-header')).toContainText('tgent / terminal-1')
  })

  test('reuses an existing tab instead of attaching the same terminal twice', async ({ page }) => {
    const tabs = page.getByRole('tab')
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })

    await page.keyboard.press('Meta+t')
    await picker.getByRole('combobox', { name: 'Find a terminal' }).fill('api watch')
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()
    await expect(tabs).toHaveCount(1)
    await expect(page.getByRole('tab', { name: /deploy/ })).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Meta+t')
    await picker.getByRole('combobox', { name: 'Find a terminal' }).fill('worker logs')
    await page.keyboard.press('Enter')
    await expect(tabs).toHaveCount(2)
    await expect(page.getByRole('tab', { name: 'worker logs' })).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Meta+p')
    await picker.getByRole('combobox', { name: 'Find a terminal' }).fill('api watch')
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()
    await expect(tabs).toHaveCount(2)
    await expect(page.getByRole('tab', { name: /deploy/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'worker logs' })).toHaveAttribute('aria-selected', 'false')
  })

  test('keeps resident terminal renderers mounted while switching tabs', async ({ page }) => {
    const originalTerminal = page.locator('.desktop-terminal-tab-surface').first().locator('.xterm')
    await originalTerminal.evaluate(element => element.setAttribute('data-render-instance', 'original-tab'))

    await page.keyboard.press('Meta+t')
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    await picker.getByRole('combobox', { name: 'Find a terminal' }).fill('worker logs')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name: 'worker logs' })).toHaveAttribute('aria-selected', 'true')
    expect(await originalTerminal.evaluate(element => {
      const surface = element.closest('.desktop-terminal-tab-surface') as HTMLElement | null
      return Boolean(surface && surface.clientWidth > 1 && surface.clientHeight > 1 && getComputedStyle(surface).visibility === 'hidden')
    })).toBe(true)

    await page.getByRole('tab').first().click()
    await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true')
    await expect(originalTerminal).toHaveAttribute('data-render-instance', 'original-tab')
    await expect(originalTerminal.locator('.xterm-rows')).not.toBeEmpty()
  })

  test('browses the full remote tmux tree and replaces the current view from a pane node', async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 720 })
    const pane = page.locator('.desktop-terminal-pane').first()
    const paneIdBefore = await pane.getAttribute('data-pane-id')

    await page.getByRole('button', { name: 'Open tmux topology' }).click()
    const browser = page.getByRole('dialog', { name: 'Tmux topology' })
    const tree = browser.getByRole('tree', { name: 'Remote tmux hierarchy' })
    await expect(browser).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: /Singapore production/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(tree.getByRole('treeitem', { name: /api watch/ })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: /gateway logs/ })).toBeVisible()

    const singapore = tree.getByRole('treeitem', { name: /Singapore production/ })
    await singapore.click()
    await expect(singapore).toHaveAttribute('aria-expanded', 'false')
    await expect(tree.getByRole('treeitem', { name: /api watch/ })).toHaveCount(0)
    await singapore.click()
    await tree.getByRole('treeitem', { name: /inference shell/ }).click()

    await expect(browser).toBeHidden()
    await expect(pane).toHaveAttribute('data-pane-id', paneIdBefore ?? '')
    await expect(pane.locator('.desktop-pane-header')).toContainText('edge-tokyo')
    await expect(pane.locator('.desktop-pane-header')).toContainText('inference / serve / %3')
    const fitsViewport = await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)
    expect(fitsViewport).toBe(true)
  })

  test('drags a topology terminal into a directional split with a live size preview', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
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

    const preview = page.getByTestId('pane-drop-preview')
    await expect(preview).toBeVisible()
    await expect(preview).toHaveClass(/is-right/)
    await expect(preview).toContainText('Split right')
    await expect(preview).toContainText(/\d+×\d+px/)
    await expect(preview).toContainText(/\d+×\d+/)

    await page.mouse.up()
    await expect(page.locator('.desktop-terminal-pane')).toHaveCount(2)
    await expect(page.locator('.desktop-terminal-pane').nth(1).locator('.desktop-pane-header')).toContainText('edge-tokyo')
    await expect(page.locator('.desktop-terminal-pane').nth(1).locator('.desktop-pane-header')).toContainText('inference / serve / %3')
  })

  test('creates, renames and kills a tmux pane from the topology tree', async ({ page }) => {
    await page.getByRole('button', { name: 'Open tmux topology' }).click()
    await page.getByRole('button', { name: 'Actions for window api' }).click()
    await page.getByRole('menuitem', { name: 'New pane' }).click()

    const createDialog = page.getByRole('dialog', { name: 'New pane' })
    await createDialog.getByRole('textbox', { name: 'pane name' }).fill('diagnostics')
    await createDialog.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('treeitem', { name: /diagnostics/ })).toBeVisible()

    await page.getByRole('button', { name: 'Actions for pane diagnostics' }).click()
    await page.getByRole('menuitem', { name: 'Rename terminal' }).click()
    const renameDialog = page.getByRole('dialog', { name: 'Rename terminal' })
    await renameDialog.getByRole('textbox', { name: 'New name' }).fill('latency watch')
    await renameDialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('treeitem', { name: /latency watch/ })).toBeVisible()

    await page.getByRole('button', { name: 'Actions for pane latency watch' }).click()
    await page.getByRole('menuitem', { name: 'Kill pane' }).click()
    const deleteDialog = page.getByRole('dialog', { name: 'Kill pane' })
    await expect(deleteDialog).toContainText('bound local views will become detached')
    await deleteDialog.getByRole('button', { name: 'Kill', exact: true }).click()
    await expect(page.getByRole('treeitem', { name: /latency watch/ })).toHaveCount(0)
  })

  test('keeps the old binding on connection failure and succeeds after retry', async ({ page }) => {
    const panes = page.locator('.desktop-terminal-pane')
    const paneIdBefore = await panes.first().getAttribute('data-pane-id')

    await page.keyboard.press('Meta+p')
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    const search = page.getByRole('combobox', { name: 'Find a terminal' })
    await search.fill('gateway')
    const gateway = page.getByRole('option', { name: /gateway logs/ })
    await expect(gateway).toContainText('Frankfurt edge')
    await expect(gateway).toContainText('Offline')
    await page.keyboard.press('Enter')

    await expect(picker).toHaveAttribute('aria-busy', 'true')
    await expect(picker.getByRole('status')).toHaveText('Connecting to Frankfurt edge')
    await expect(panes.first().locator('.desktop-pane-header')).toContainText('prod-sg-01')

    await expect(picker).toHaveAttribute('aria-busy', 'false')
    await expect(picker.getByRole('alert')).toContainText('Frankfurt edge timed out')
    await expect(panes.first().locator('.desktop-pane-header')).toContainText('prod-sg-01')
    await picker.getByRole('button', { name: 'Retry' }).click()
    await expect(picker).toHaveAttribute('aria-busy', 'true')
    await expect(picker.getByRole('status')).toHaveText('Connecting to Frankfurt edge')

    await expect(picker).toBeHidden()
    await expect(panes.first()).toHaveAttribute('data-pane-id', paneIdBefore ?? '')
    await expect(panes.first().locator('.desktop-pane-header')).toContainText('edge-fra-01')
    await expect(panes.first().locator('.desktop-pane-header')).toContainText('edge / gateway / %8')
  })

  test('keeps a local view when its tmux pane ends and allows rebinding', async ({ page }) => {
    const pane = page.locator('.desktop-terminal-pane').first()
    const paneIdBefore = await pane.getAttribute('data-pane-id')
    const terminal = pane.locator('.xterm-helper-textarea')
    await terminal.focus()
    await page.keyboard.type('exit')
    await page.keyboard.press('Enter')

    const detached = pane.locator('.desktop-pane-detached')
    await expect(detached).toBeVisible()
    await expect(detached).toContainText('tmux pane %8 ended')
    await expect(pane.locator('.desktop-pane-header')).toContainText('detached')
    await expect(pane.locator('.desktop-terminal-xterm')).toHaveCount(0)

    await detached.getByRole('button', { name: 'Choose terminal' }).click()
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    await page.getByRole('combobox', { name: 'Find a terminal' }).fill('inference')
    await page.keyboard.press('Enter')

    await expect(picker).toBeHidden()
    await expect(pane).toHaveAttribute('data-pane-id', paneIdBefore ?? '')
    await expect(pane.locator('.desktop-pane-header')).toContainText('edge-tokyo')
    await expect(pane.locator('.desktop-terminal-xterm')).toBeVisible()
  })

  test('keeps file management available without occupying the terminal by default', async ({ page }) => {
    await expect(page.locator('.desktop-file-panel')).toBeHidden()
    await page.getByRole('button', { name: 'Open file browser' }).click()
    await expect(page.getByRole('dialog', { name: /Files on prod-sg-01/ })).toBeVisible()
    await page.getByRole('option', { name: /release-notes.md/ }).click()
    await expect(page.getByRole('option', { name: /release-notes.md/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: 'Close file browser' }).click()
    await expect(page.locator('.desktop-file-panel')).toBeHidden()
  })

  test('records, validates and persists desktop shortcuts with visible feedback', async ({ page }) => {
    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: /Shortcuts/ }).click()

    const binding = settings.getByRole('button', { name: /Change shortcut for Terminal picker/ })
    const row = binding.locator('xpath=../..')
    await binding.click()
    await expect(binding).toHaveAttribute('aria-pressed', 'true')
    await expect(binding).toContainText('Press keys')
    await expect(row).toHaveClass(/is-recording/)
    await expect(row.getByRole('status')).toHaveText('Esc to cancel')

    const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    await page.keyboard.press(apple ? 'Meta+d' : 'Control+d')
    await expect(row.getByRole('alert')).toHaveText('Already used by Split right')
    await expect(binding).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Escape')
    await expect(binding).toHaveAttribute('aria-pressed', 'false')
    await expect(row).not.toHaveClass(/is-recording/)

    await binding.click()
    await page.keyboard.press('Control+Alt+k')
    await expect(binding).toHaveAttribute('aria-pressed', 'false')
    await expect(row.getByRole('status')).toContainText('saved')

    const savedShortcut = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('tgent_desktop_settings') || '{}')
      return saved.shortcuts?.terminalPicker
    })
    expect(savedShortcut).toBe(apple ? 'Control+Alt+K' : 'Mod+Alt+K')
  })

  test('persists desktop opacity, chrome tone and a custom background image', async ({ page }) => {
    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    let settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: /Appearance/ }).click()

    await expect(settings.getByRole('option')).toHaveCount(16)
    await settings.getByRole('radio', { name: 'Midnight' }).click()
    await settings.getByRole('slider', { name: 'Window opacity' }).fill('73')
    await settings.locator('input[type="file"]').setInputFiles({
      name: 'focus.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    })
    await expect(settings.locator('.desktop-settings-background-thumb')).toBeVisible()
    await expect(settings.getByText('focus.png')).toBeVisible()

    await expect.poll(async () => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('tgent_desktop_settings') || '{}')
      return [saved.appearance?.chromeTone, saved.appearance?.windowOpacity, saved.appearance?.backgroundImageEnabled]
    })).toEqual(['midnight', 0.73, true])

    await page.reload()
    await expect(page.locator('.desktop-prototype-shell')).toBeVisible()
    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: /Appearance/ }).click()
    await expect(settings.getByRole('radio', { name: 'Midnight' })).toHaveAttribute('aria-checked', 'true')
    await expect(settings.getByRole('slider', { name: 'Window opacity' })).toHaveValue('73')
    await expect(settings.getByText('focus.png')).toBeVisible()
  })

  test('applies a light theme to the complete desktop chrome and dialogs', async ({ page }) => {
    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: /Appearance/ }).click()
    await settings.getByRole('option', { name: 'GitHub Light, light theme' }).click()

    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.colorScheme)).toBe('light')
    await expect.poll(() => page.locator('.desktop-window-bar').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)')
    await expect.poll(() => settings.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(246, 248, 250)')
    await expect.poll(() => page.locator('.desktop-terminal-workspace').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)')

    await settings.getByRole('button', { name: 'Close settings' }).click()
    await page.keyboard.press('Meta+p')
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    await expect.poll(() => picker.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(246, 248, 250)')
  })

  test('configures Quake Mode and persists native window preferences', async ({ page }) => {
    await page.evaluate(() => {
      const state = {
        enabled: true,
        shortcut: 'Control+`',
        updates: [] as Array<{ heightRatio: number; minHeight: number; alwaysOnTop: boolean }>,
        enableChanges: [] as boolean[],
        shortcutChanges: [] as string[],
      }
      ;(window as any).__quakeTestState = state
      ;(window as any).go = { main: { App: {
        Status: async () => ({
          quakeEnabled: state.enabled,
          quakeShortcut: state.shortcut,
          hotkeyAvailable: state.enabled,
          quake: { active: false, visible: true, settings: { heightRatio: 0.45, minHeight: 360, alwaysOnTop: true } },
        }),
        UpdateQuakeSettings: async (settings: { heightRatio: number; minHeight: number; alwaysOnTop: boolean }) => {
          state.updates.push(settings)
          return { active: false, visible: true, settings }
        },
        SetQuakeEnabled: async (enabled: boolean) => {
          state.enabled = enabled
          state.enableChanges.push(enabled)
          return {
            quakeEnabled: enabled,
            quakeShortcut: state.shortcut,
            hotkeyAvailable: enabled,
          }
        },
        SetQuakeShortcut: async (shortcut: string) => {
          state.shortcut = shortcut
          state.shortcutChanges.push(shortcut)
          return {
            quakeEnabled: state.enabled,
            quakeShortcut: shortcut,
            hotkeyAvailable: state.enabled,
          }
        },
      } } }
    })

    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: /Quake Mode/ }).click()

    await expect(settings.getByRole('heading', { name: 'Quake Mode' })).toBeVisible()
    const runtimeStatus = settings.locator('.desktop-settings-runtime-status')
    await expect(runtimeStatus).toHaveText('Global hotkey ready')
    const enabled = settings.getByRole('switch', { name: 'Enable Quake Mode' })
    await expect(enabled).toBeChecked()
    const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    const shortcut = settings.getByRole('button', { name: /Change Quake Mode shortcut/ })
    await expect(shortcut).toHaveText(apple ? '⌃`' : 'Ctrl+`')
    await shortcut.click()
    await expect(shortcut).toHaveAttribute('aria-pressed', 'true')
    await expect(shortcut).toContainText('Press keys')
    await page.keyboard.press(apple ? 'Meta+p' : 'Control+p')
    await expect(settings.getByRole('alert')).toHaveText('Already used by Terminal picker')
    await page.keyboard.press('Control+Alt+k')
    await expect(shortcut).toHaveAttribute('aria-pressed', 'false')
    await expect(settings.getByRole('status').filter({ hasText: 'saved' })).toBeVisible()

    const height = settings.locator('#desktop-quake-height')
    await height.fill('65')
    await expect(settings.locator('output[for="desktop-quake-height"]')).toHaveText('65%')
    await settings.getByRole('switch', { name: 'Keep Quake window always on top' }).click()
    await enabled.click()
    await expect(enabled).not.toBeChecked()
    await expect(runtimeStatus).toHaveText('Disabled')

    const result = await page.evaluate(() => ({
      calls: (window as any).__quakeTestState,
      saved: JSON.parse(localStorage.getItem('tgent_desktop_settings') || '{}'),
    }))
    expect(result.calls.updates).toContainEqual({ heightRatio: 0.65, minHeight: 360, alwaysOnTop: true })
    expect(result.calls.updates).toContainEqual({ heightRatio: 0.65, minHeight: 360, alwaysOnTop: false })
    expect(result.calls.enableChanges).toContain(false)
    expect(result.calls.shortcutChanges).toContain(apple ? 'Control+Alt+K' : 'Mod+Alt+K')
    expect(result.saved.quake).toEqual({
      enabled: false,
      shortcut: apple ? 'Control+Alt+K' : 'Mod+Alt+K',
      heightRatio: 0.65,
      alwaysOnTop: false,
    })
  })

  test('pairs a cloud agent in place without replacing the desktop workspace', async ({ page }) => {
    await page.route('**/mock-hub/api/agents', async route => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'agent-remote-build',
          name: 'Remote Build',
          hostname: 'buildbox.local',
          osInfo: 'linux',
          labels: null,
          online: true,
          paired: false,
          hubId: 'hub-1',
          hubHttpUrl: null,
          tokenId: null,
          tokenName: null,
          lastSeen: null,
          createdAt: '2026-08-10T00:00:00.000Z',
        }]),
      })
    })
    await page.evaluate(() => {
      localStorage.setItem('tgent_web_token', 'desktop-test-token')
      localStorage.setItem('tgent_web_url', `${window.location.origin}/mock-hub`)
    })

    await page.keyboard.press('Meta+t')
    const picker = page.getByRole('dialog', { name: 'Terminal picker' })
    await picker.getByRole('combobox', { name: 'Find a terminal' }).fill('release builder')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.getByRole('tab', { name: 'release builder' })).toHaveAttribute('aria-selected', 'true')

    const hashBefore = await page.evaluate(() => window.location.hash)
    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByText('Remote Build')).toBeVisible()
    await settings.getByRole('button', { name: 'Pair Remote Build' }).click()

    const pairing = page.getByRole('dialog', { name: 'Pair agent' })
    await expect(pairing).toBeVisible()
    await expect(pairing.getByPlaceholder('Pair Code')).toBeFocused()
    await expect(pairing.getByRole('button', { name: /scan/i })).toHaveCount(0)
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe(hashBefore)

    await page.keyboard.press('Escape')
    await expect(pairing).toBeHidden()
    await expect(settings).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.getByRole('tab', { name: 'release builder' })).toHaveAttribute('aria-selected', 'true')
  })

  test('disables a saved connection without deleting its credentials', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('tgent_local_servers', JSON.stringify([{
        id: 'saved-build-server',
        name: 'Build server',
        addr: 'http://192.168.1.18:8080',
        password: 'preserved-secret',
        addedAt: 1,
        privateKeySeed: 'preserved-key',
      }]))
    })

    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    let settings = page.getByRole('dialog', { name: 'Settings' })
    const enabled = settings.getByRole('switch', { name: 'Enable Build server' })
    await expect(enabled).toBeChecked()
    await enabled.click()
    await expect(enabled).not.toBeChecked()
    await expect(settings.getByRole('button', { name: 'Connect to Build server' })).toBeDisabled()

    await expect.poll(async () => page.evaluate(() => {
      const [server] = JSON.parse(localStorage.getItem('tgent_local_servers') || '[]')
      return {
        disabled: server?.disabled,
        password: server?.password,
        privateKeySeed: server?.privateKeySeed,
      }
    })).toEqual({ disabled: true, password: 'preserved-secret', privateKeySeed: 'preserved-key' })

    await settings.getByRole('button', { name: 'Close settings' }).click()
    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByRole('switch', { name: 'Enable Build server' })).not.toBeChecked()
  })

  test('configures a persistent connection color and exposes it in terminal picker rows', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('tgent_local_servers', JSON.stringify([{
        id: 'saved-build-server',
        name: 'Build server',
        addr: '',
        password: '',
        socketPath: '/tmp/tgent-build.sock',
        addedAt: 1,
        color: '#4f7dff',
      }]))
    })

    await page.getByRole('button', { name: 'More terminal actions' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Edit Build server' }).click()
    await settings.getByRole('button', { name: 'Use connection color #d85a67' }).click()
    await settings.getByRole('button', { name: 'Test and save' }).click()

    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tgent_local_servers') || '[]')[0]?.color)).toBe('#d85a67')
    const row = settings.locator('.desktop-settings-connection-row', { hasText: 'Build server' })
    await expect.poll(() => row.evaluate(element => getComputedStyle(element).getPropertyValue('--connection-color').trim())).toBe('#d85a67')

    await settings.getByRole('button', { name: 'Close settings' }).click()
    await page.keyboard.press('Meta+p')
    const options = page.getByRole('dialog', { name: 'Terminal picker' }).getByRole('option')
    await expect(options.first()).toHaveAttribute('style', /--connection-color:/)
    await expect.poll(() => options.evaluateAll(elements => new Set(elements.map(element => getComputedStyle(element).getPropertyValue('--connection-color').trim())).size)).toBeGreaterThan(1)
  })

  test('merges direct and cloud records by daemon identity without losing local credentials', async ({ page }) => {
    const result = await page.evaluate(async () => {
      localStorage.setItem('tgent_local_servers', JSON.stringify([{
        id: 'direct-server',
        name: 'My build host',
        addr: 'http://build.local:8080',
        password: 'local-secret',
        addedAt: 2,
        color: '#d28b2c',
      }, {
        id: 'cloud-server',
        name: 'Cloud build host',
        addr: '',
        password: '',
        addedAt: 1,
        hubAgentId: 'agent-build',
        hubAddr: 'https://hub.example',
        privateKeySeed: 'paired-seed',
      }]))
      const { attachHubIdentity, getLocalServers } = await import('/src/lib/localServers.ts')
      await attachHubIdentity('direct-server', 'agent-build', 'https://hub.example')
      return getLocalServers()
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'direct-server',
      name: 'My build host',
      addr: 'http://build.local:8080',
      password: 'local-secret',
      hubAgentId: 'agent-build',
      hubAddr: 'https://hub.example',
      privateKeySeed: 'paired-seed',
      color: '#d28b2c',
    })
  })

  test('successful pairing re-enables a saved connection and announces the update', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('tgent_local_servers', JSON.stringify([{
        id: 'paired-build-server',
        name: 'Remote Build',
        addr: '',
        password: '',
        addedAt: 1,
        hubAgentId: 'agent-remote-build',
        pairCode: 'old-pair-code',
        privateKeySeed: 'old-seed',
        disabled: true,
      }]))
    })

    const result = await page.evaluate(async () => {
      let changes = 0
      window.addEventListener('tgent-local-servers-change', () => { changes++ })
      const { addOrUpdateByHubAgentId } = await import('/src/lib/localServers.ts')
      const server = await addOrUpdateByHubAgentId({
        name: 'Remote Build',
        addr: '',
        password: '',
        hubAgentId: 'agent-remote-build',
        pairCode: 'new-pair-code',
        privateKeySeed: 'new-seed',
      })
      return { disabled: server.disabled, pairCode: server.pairCode, privateKeySeed: server.privateKeySeed, changes }
    })

    expect(result).toEqual({
      disabled: false,
      pairCode: 'new-pair-code',
      privateKeySeed: 'new-seed',
      changes: 1,
    })
  })
})

test('desktop startup never mounts the mobile server list while restoring the last terminal', async ({ page }) => {
  await page.addInitScript(() => {
    const pending = () => new Promise(() => {})
    ;(window as any).go = {
      main: {
        App: {
          BridgePort: async () => 0,
          Command: async () => '',
          NextEvent: pending,
          DiscoverLocalTGent: pending,
        },
      },
    }
  })
  await page.goto('/#/')
  await expect(page.getByRole('status', { name: 'Restoring terminal workspace' })).toBeVisible()
  await expect(page.locator('.desktop-startup-shell')).toContainText('tmux')
  await expect(page.locator('h1', { hasText: 'tgent' })).toHaveCount(0)
  await expect(page.locator('[class*="rounded-2xl"]')).toHaveCount(0)
})

test('desktop startup discards a restored remote hash before local discovery', async ({ page }) => {
  await page.addInitScript(() => {
    const pending = () => new Promise(() => {})
    ;(window as any).go = {
      main: {
        App: {
          BridgePort: async () => 0,
          Command: async () => '',
          NextEvent: pending,
          DiscoverLocalTGent: pending,
        },
      },
    }
  })

  await page.goto('/#/s/remote-endpoint/t/42')
  await expect(page).toHaveURL(/\/#\/$/)
  await expect(page.getByRole('status', { name: 'Restoring terminal workspace' })).toBeVisible()
})

test('desktop startup prefers the discovered local socket over the last remote endpoint', async ({ page }) => {
  await page.addInitScript(() => {
    const pending = () => new Promise(() => {})
    localStorage.setItem('tgent_desktop_last_server', 'remote-endpoint')
    localStorage.setItem('tgent_local_servers', JSON.stringify([{
      id: 'remote-endpoint',
      name: 'Remote endpoint',
      addr: 'https://remote.example.com',
      password: '',
      addedAt: 1,
    }]))
    ;(window as any).go = {
      main: {
        App: {
          BridgePort: async () => 0,
          Command: async () => '',
          NextEvent: pending,
          DiscoverLocalTGent: async () => ({
            found: true,
            address: 'http://127.0.0.1:8080',
            name: 'This computer',
            socketPath: '/Users/example/.tgent/tgent.sock',
            agentId: 'local-agent',
          }),
        },
      },
    }
  })

  await page.goto('/#/s/remote-endpoint/t/42')
  await expect.poll(() => page.evaluate(() => {
    const servers = JSON.parse(localStorage.getItem('tgent_local_servers') || '[]')
    const local = servers.find((server: any) => server.socketPath)
    return local ? { socketPath: local.socketPath, hash: window.location.hash } : null
  })).toMatchObject({
    socketPath: '/Users/example/.tgent/tgent.sock',
    hash: expect.stringMatching(/^#\/s\/(?!remote-endpoint)/),
  })
})
