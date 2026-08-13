import type { SubscriptionInfo } from '../api/types'
import { getWebToken, getWebUrl } from './platform'
import { storage } from './storage'

const SUBSCRIPTION_CACHE_KEY = 'tgent_subscription_cache'

interface SubscriptionCacheRecord {
  webUrl: string
  userId: string
  subscription: SubscriptionInfo | null
}

let memoryCache: SubscriptionCacheRecord | null = null
let cacheLoaded = false
let loadPromise: Promise<void> | null = null

function getUserIdFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const parsed = JSON.parse(atob(padded)) as { userId?: unknown }
    return typeof parsed.userId === 'string' ? parsed.userId : null
  } catch {
    return null
  }
}

function isSubscription(value: unknown): value is SubscriptionInfo {
  if (!value || typeof value !== 'object') return false
  const sub = value as Partial<SubscriptionInfo>
  return typeof sub.active === 'boolean'
    && typeof sub.planName === 'string'
    && typeof sub.currentPeriodEnd === 'string'
}

function parseCache(raw: string | null): SubscriptionCacheRecord | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SubscriptionCacheRecord>
    if (typeof parsed.webUrl !== 'string' || typeof parsed.userId !== 'string') return null
    if (parsed.subscription !== null && !isSubscription(parsed.subscription)) return null
    return parsed as SubscriptionCacheRecord
  } catch {
    return null
  }
}

async function loadCache(): Promise<void> {
  if (cacheLoaded) return
  if (!loadPromise) {
    loadPromise = (async () => {
      let stored: SubscriptionCacheRecord | null = null
      try {
        stored = parseCache(await storage.get(SUBSCRIPTION_CACHE_KEY))
      } catch {
        // A storage failure must not block opening a server.
      }
      // A fresh server response may have populated the cache while storage was loading.
      if (!cacheLoaded) {
        memoryCache = stored
        cacheLoaded = true
      }
    })().finally(() => {
      loadPromise = null
    })
  }
  await loadPromise
}

/** Read the last known subscription for the currently logged-in user. */
export async function getCachedSubscription(): Promise<SubscriptionInfo | null> {
  const [token, webUrl] = await Promise.all([getWebToken(), getWebUrl()])
  if (!token) return null
  const userId = getUserIdFromToken(token)
  if (!userId) return null

  await loadCache()
  if (memoryCache?.userId !== userId || memoryCache.webUrl !== webUrl) return null
  return memoryCache.subscription
}

/** Update both the in-memory value and the persistent app cache. */
export async function setCachedSubscription(
  userId: string,
  subscription: SubscriptionInfo | null,
): Promise<void> {
  const record: SubscriptionCacheRecord = {
    webUrl: await getWebUrl(),
    userId,
    subscription,
  }
  memoryCache = record
  cacheLoaded = true
  try {
    await storage.set(SUBSCRIPTION_CACHE_KEY, JSON.stringify(record))
  } catch {
    // Keep the fresh in-memory value even if persistence is temporarily unavailable.
  }
}

export async function clearCachedSubscription(): Promise<void> {
  memoryCache = null
  cacheLoaded = true
  try {
    await storage.remove(SUBSCRIPTION_CACHE_KEY)
  } catch {
    // The in-memory cache is already cleared.
  }
}
