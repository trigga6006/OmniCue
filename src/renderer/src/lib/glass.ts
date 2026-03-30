/** Standard glass shadow — references adaptive CSS tokens from main.css */
export const glassStyle = {
  boxShadow:
    '0 8px 32px var(--g-shadow-color), 0 0 0 0.5px var(--g-shadow-edge), inset 0 0.5px 0 var(--g-shadow-inset)',
}

/** Heavier glass shadow for panels (HistoryPanel, SettingsPanel) */
export const glassPanelStyle = {
  boxShadow:
    '0 24px 64px var(--g-shadow-color-heavy), 0 0 0 0.5px var(--g-shadow-edge), inset 0 0.5px 0 var(--g-shadow-inset-subtle)',
}

/** Context menu glass shadow */
export const glassMenuStyle = {
  boxShadow:
    '0 16px 48px var(--g-shadow-color-heavy), 0 0 0 0.5px var(--g-shadow-edge), inset 0 0.5px 0 var(--g-shadow-inset)',
}
