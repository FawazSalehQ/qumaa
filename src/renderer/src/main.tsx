import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
// Bundled by Vite into the app, so typography is identical on macOS and Windows
// and nothing is fetched at runtime.
import '@fontsource-variable/inter'
// Inter ships no Arabic subset, so the brand name would otherwise fall back to
// a different system face on each platform. Cairo covers Arabic and is
// proportioned to sit next to Inter.
import '@fontsource-variable/cairo'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
