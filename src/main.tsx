import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { CmsTiles } from './CmsTiles.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CmsTiles />
  </StrictMode>,
)
