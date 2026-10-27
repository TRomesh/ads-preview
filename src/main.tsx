import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { CmsTiles } from './CmsTiles.tsx'
import { ResizeLab } from './ResizeLab.tsx'

// Two pages, one query parameter. A router would be three dependencies and a
// build step for a link.
const lab = new URLSearchParams(location.search).has('lab')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{lab ? <ResizeLab /> : <CmsTiles />}</StrictMode>,
)
