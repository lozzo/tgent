import { expect, test } from '@playwright/test'
import { desktopTabTitle, normalizeTerminalTitle } from '../../shared/src/lib/desktopTabTitle'

test('desktop tab follows the active terminal title instead of the tmux placeholder', () => {
  const panes = [
    { id: 'pane-a', terminalTitle: 'OpenCode' },
    { id: 'pane-b', terminalTitle: 'build logs' },
  ]

  expect(desktopTabTitle('pane-a', panes, 'tmux')).toBe('OpenCode')
  expect(desktopTabTitle('pane-b', panes, 'tmux')).toBe('build logs')
  expect(desktopTabTitle('missing', panes, 'Terminal')).toBe('Terminal')
})

test('desktop titles discard transient Braille spinner frames', () => {
  expect(normalizeTerminalTitle('⠋ tgent')).toBe('tgent')
  expect(normalizeTerminalTitle(' ⠏⠴ OpenCode ')).toBe('OpenCode')
  expect(desktopTabTitle('pane-a', [{ id: 'pane-a', terminalTitle: '⠙ build logs' }])).toBe('build logs')
})
