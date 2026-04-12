/**
 * HTTP adapter for tool pack discovery endpoints.
 * Delegates to the shared pack resolver; keeps Electron-independent logic out.
 */

import type { ServerResponse } from 'http'
import { registry } from '../shared/tool-packs/registry'
import { resolvePack } from '../shared/tool-packs/resolver'
import { getActiveWindowAsync } from './activeWindow'

type JsonResponder = (res: ServerResponse, status: number, data: Record<string, unknown>) => void

/** GET /pack-tools — list available packs. */
export async function handlePackToolsList(
  res: ServerResponse,
  json: JsonResponder,
): Promise<void> {
  const packs = registry.map(p => ({ id: p.id, name: p.name }))
  json(res, 200, { packs })
}

/** GET /pack-tools/active — resolve the active window's pack. */
export async function handlePackToolsActive(
  res: ServerResponse,
  json: JsonResponder,
): Promise<void> {
  const winInfo = await getActiveWindowAsync()
  if (!winInfo) {
    json(res, 200, { packId: null })
    return
  }

  const result = resolvePack({
    activeApp: winInfo.activeApp || '',
    processName: winInfo.processName || '',
    windowTitle: winInfo.windowTitle || '',
  })

  if (!result) {
    json(res, 200, { packId: null })
    return
  }

  json(res, 200, {
    packId: result.packId,
    packName: result.packName,
    variant: result.variant ?? null,
    confidence: result.confidence,
    context: result.context,
  })
}
