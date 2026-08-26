import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Wizard from './Wizard.tsx'

createRoot(document.getElementById('root')!).render(<StrictMode>{window.location.pathname === '/wizard' ? <Wizard /> : <App />}</StrictMode>)
