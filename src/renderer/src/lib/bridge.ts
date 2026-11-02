import type { SoFyBridge } from '../../../shared/types'
import { createMockBridge } from './mock'

export const isDesktop = typeof window !== 'undefined' && Boolean(window.sofy)

export const bridge: SoFyBridge = (typeof window !== 'undefined' && window.sofy) || createMockBridge()
