import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class StartupErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('No se pudo iniciar la agenda.', error, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="boot-fallback" role="alert">
          <h1>No pudimos abrir la agenda</h1>
          <p>Actualiza la página para cargar la versión más reciente.</p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            Actualizar página
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </StrictMode>,
)
