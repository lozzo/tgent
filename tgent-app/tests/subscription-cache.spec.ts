import { expect, test } from '@playwright/test'

const BASE = 'http://localhost:30233'
const USER_ID = 'subscription-cache-user'

function makeToken(userId: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId })}.signature`
}

test('persists subscriptions across app reloads and isolates them by user', async ({ page }) => {
  const token = makeToken(USER_ID)
  await page.addInitScript(({ tokenValue }) => {
    localStorage.setItem('tgent_web_token', tokenValue)
  }, { tokenValue: token })

  await page.goto(`${BASE}/#/`)
  await page.evaluate(async ({ userId }) => {
    const loadModule = new Function('return import("/src/lib/subscriptionCache.ts")') as () => Promise<any>
    const cache = await loadModule()
    await cache.setCachedSubscription(userId, {
      active: true,
      planName: 'Pro',
      currentPeriodEnd: '2099-01-01T00:00:00.000Z',
    })
  }, { userId: USER_ID })

  await expect.poll(() => page.evaluate(() => localStorage.getItem('tgent_subscription_cache')))
    .toContain(USER_ID)

  // Reload resets module memory, so the next read must come from persistent storage.
  await page.reload()
  const cached = await page.evaluate(async () => {
    const loadModule = new Function('return import("/src/lib/subscriptionCache.ts")') as () => Promise<any>
    return (await loadModule()).getCachedSubscription()
  })
  expect(cached).toMatchObject({ active: true, planName: 'Pro' })

  await page.evaluate(tokenValue => {
    localStorage.setItem('tgent_web_token', tokenValue)
  }, makeToken('another-user'))
  const otherUserCache = await page.evaluate(async () => {
    const loadModule = new Function('return import("/src/lib/subscriptionCache.ts")') as () => Promise<any>
    return (await loadModule()).getCachedSubscription()
  })
  expect(otherUserCache).toBeNull()
})
