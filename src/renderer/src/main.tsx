import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
// The brand typefaces, bundled by Vite so rendering is identical on macOS and
// Windows and nothing is fetched at runtime. Plex Sans has no Arabic coverage,
// which is why the Arabic family is a separate package rather than a fallback.
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
// Mono is used only for the small all-caps labels the brand specifies.
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
