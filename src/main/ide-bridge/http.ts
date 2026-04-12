/** IDE bridge HTTP route handlers — mounted in main server.ts */

import type { IncomingMessage, ServerResponse } from 'http'
import { getActiveWindowAsync } from '../activeWindow'
import { getIdeState } from './state'
import { readIdeSelection } from './selection'

type JsonFn = (res: ServerResponse, status: number, data: Record<string, unknown>) => void

export function handleIdeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  localJson: JsonFn
): boolean {
  // GET /ide/state
  if (url === '/ide/state' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const win = await getActiveWindowAsync()
      if (!win) return { error: 'No active window' }
      const state = getIdeState(win)
      if (!state) return { error: 'Active window is not an IDE' }
      return state as unknown as Record<string, unknown>
    })
    return true
  }

  // GET /ide/selection
  if (url === '/ide/selection' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const win = await getActiveWindowAsync()
      if (!win) return { error: 'No active window' }
      const sel = await readIdeSelection(win)
      return sel as unknown as Record<string, unknown>
    })
    return true
  }

  return false
}

function handleAsync(
  res: ServerResponse,
  localJson: JsonFn,
  fn: () => Promise<Record<string, unknown>>
): void {
  fn().then(
    (data) => {
      const status = data.error ? 400 : 200
      localJson(res, status, data)
    },
    () => localJson(res, 500, { error: 'Internal error' })
  )
}
