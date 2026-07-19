import { createRoot } from 'react-dom/client'
import { Agentation } from 'agentation'
import { DialRoot, useDialKit } from 'dialkit'
import 'dialkit/styles.css'

function PortfolioControls() {
  useDialKit('Typography', {
    fontSize: [15, 10, 32],
    lineHeight: [1.65, 1.0, 2.5],
    letterSpacing: [0, -0.05, 0.1],
  })

  useDialKit('Layout', {
    paddingX: [32, 0, 80],
    paddingY: [96, 0, 160],
    maxWidth: [672, 320, 1200],
  })

  return null
}

function App() {
  return (
    <>
      <Agentation />
      <DialRoot />
      <PortfolioControls />
    </>
  )
}

createRoot(document.getElementById('agentation-root')).render(<App />)
