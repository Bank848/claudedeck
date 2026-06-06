/// <reference types="vite/client" />

import type { ClaudeDeckApi } from '../../electron/preload'

declare global {
  interface Window {
    claudedeck: ClaudeDeckApi
  }
}

export {}
