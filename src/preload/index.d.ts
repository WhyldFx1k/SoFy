import type { SoFyBridge } from '../shared/types'

declare global {
  interface Window {
    sofy?: SoFyBridge
  }
}

export {}
