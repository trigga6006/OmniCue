/** Safe selection read via UI Automation. Clipboard dance lives in guided actions. */

import type { IdeSelection } from './types'
import type { ActiveWindowInfo } from '../activeWindow'
import { getIdeState } from './state'
import { getSelectedTextViaUiAutomation } from '../browser'

/** Try to read the current editor selection via UI Automation. */
export async function readIdeSelection(win: ActiveWindowInfo): Promise<IdeSelection> {
  const state = getIdeState(win)

  // Try UIA-based selection read (same approach as browser selection)
  let text: string | null = null
  try {
    text = await getSelectedTextViaUiAutomation() || null
  } catch {
    // UIA not available for this editor
  }

  return {
    text,
    file: state?.openFile || null,
    language: state?.language || null,
    source: text ? 'uia' : null,
  }
}
