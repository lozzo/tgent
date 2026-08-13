export type TGentTarget = 'app' | 'desktop'

declare const __TGENT_TARGET__: TGentTarget

export const runtimeTarget: TGentTarget = __TGENT_TARGET__
export const isDesktopTarget = runtimeTarget === 'desktop'
