import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  loadFavorites,
  addFavorite,
  removeFavorite,
  pruneMissingAgentFavorites,
  isFavorite as checkIsFavorite,
  type FavoritePane,
} from '../lib/favoritePanes'
import { findLocalServerById } from '../lib/localServers'
import { useAppContext } from '../contexts/AppContext'

interface UseFavoritePanesResult {
  favorites: FavoritePane[]
  currentIndex: number
  isFavorited: boolean
  toggleFavorite: (info: {
    paneId: string
    sessionName: string
    windowName: string
    paneCommand: string
    serverId: string
    serverType: 'local' | 'hub'
    serverName: string
    }) => void
  removeFromFavorites: (fav: FavoritePane) => void
  navigateToNext: () => void
  navigateToPrev: () => void
  navigateToFavorite: (fav: FavoritePane) => void
}

export function useFavoritePanes(serverId?: string, paneId?: string): UseFavoritePanesResult {
  const [favorites, setFavorites] = useState<FavoritePane[]>([])
  const navigate = useNavigate()
  const { storeManager } = useAppContext()
  const navigatingRef = useRef(false)

  // 加载收藏列表
  useEffect(() => {
    loadFavorites()
      .then(pruneMissingAgentFavorites)
      .then(setFavorites)
  }, [])

  const currentIndex = serverId && paneId
    ? favorites.findIndex(f => f.serverId === serverId && f.paneId === paneId)
    : -1

  const isFavorited = serverId && paneId
    ? checkIsFavorite(favorites, serverId, paneId)
    : false

  const toggleFavorite = useCallback((info: {
    paneId: string
    sessionName: string
    windowName: string
    paneCommand: string
    serverId: string
    serverType: 'local' | 'hub'
    serverName: string
  }) => {
    const doToggle = async () => {
      if (checkIsFavorite(favorites, info.serverId, info.paneId)) {
        await removeFavorite(info.serverId, info.paneId)
      } else {
        await addFavorite({
          serverId: info.serverId,
          serverType: info.serverType,
          serverName: info.serverName,
          paneId: info.paneId,
          sessionName: info.sessionName,
          windowName: info.windowName,
          paneCommand: info.paneCommand,
        })
      }
      const updated = await loadFavorites()
      setFavorites(await pruneMissingAgentFavorites(updated))
    }
    doToggle()
  }, [favorites])

  const removeFromFavorites = useCallback((fav: FavoritePane) => {
    const doRemove = async () => {
      await removeFavorite(fav.serverId, fav.paneId)
      setFavorites(await loadFavorites())
    }
    doRemove()
  }, [])

  const navigateTo = useCallback(async (fav: FavoritePane) => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    try {
      // 跨 Agent 时先 preconnect
      if (fav.serverId !== serverId) {
        const local = await findLocalServerById(fav.serverId)
        storeManager.preconnect(
          local ? 'local' : 'hub',
          fav.serverId,
          local || undefined,
        )
      }
      const urlPaneId = fav.paneId.replace('%', '')
      navigate(`/s/${fav.serverId}/t/${urlPaneId}`)
    } finally {
      navigatingRef.current = false
    }
  }, [serverId, storeManager, navigate])

  const navigateToNext = useCallback(() => {
    if (favorites.length === 0) return
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % favorites.length
      : 0
    navigateTo(favorites[nextIndex])
  }, [favorites, currentIndex, navigateTo])

  const navigateToPrev = useCallback(() => {
    if (favorites.length === 0) return
    const prevIndex = currentIndex >= 0
      ? (currentIndex - 1 + favorites.length) % favorites.length
      : favorites.length - 1
    navigateTo(favorites[prevIndex])
  }, [favorites, currentIndex, navigateTo])

  return {
    favorites,
    currentIndex,
    isFavorited,
    toggleFavorite,
    removeFromFavorites,
    navigateToNext,
    navigateToPrev,
    navigateToFavorite: navigateTo,
  }
}
