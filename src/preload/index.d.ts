import type { ElectronAPI } from '../renderer/src/lib/types'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
