/** IDE bridge types — shared across state, selection, navigation, stack-trace. */

export interface IdeState {
  editor: string | null
  workspacePath: string | null
  openFile: string | null
  language: string | null
  isDirty: boolean | null
}

export interface IdeSelection {
  text: string | null
  file: string | null
  language: string | null
  source: 'uia' | 'editor-state' | null
}

export interface OpenFileRequest {
  file: string
  line?: number
  column?: number
  editor?: string
}

export interface OpenFileResult {
  ok: boolean
  editor: string
  command: string
}
