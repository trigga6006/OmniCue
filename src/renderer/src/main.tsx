import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SettingsWindow } from '@/components/SettingsWindow'

const isSettingsWindow = window.location.hash.startsWith('#/settings-window')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSettingsWindow ? <SettingsWindow /> : <App />}
  </StrictMode>
)
