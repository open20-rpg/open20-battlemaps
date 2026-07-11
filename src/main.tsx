import React from "react"
import ReactDOM from "react-dom/client"
import App from "./app/App"
import { Provider } from "./ui/chakra/provider"
import "./i18n"

// Global state lives in the zustand stores under src/stores — no providers.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider>
      <App />
    </Provider>
  </React.StrictMode>,
)
