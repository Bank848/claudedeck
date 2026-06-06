import React from 'react'
import ReactDOM from 'react-dom/client'

// Bundled fonts (offline, hashed by Vite). Subset to the weights we use.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'

import './theme/tokens.css'
import './theme/globals.css'

import App from './App'
import { SettingsProvider } from './settings/SettingsContext'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </React.StrictMode>,
)
