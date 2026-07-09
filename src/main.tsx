import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Provider } from "./components/ui/provider";
import { LoadingProvider } from "./context/loading";
import { PacksProvider } from "./context/packs";
import { MapProvider } from "./context/map";
import { ModalStackProvider } from "./context/modalStack";
import { ToolsProvider } from "./context/tools";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider>
      <ModalStackProvider>
        <LoadingProvider>
          <PacksProvider>
            <MapProvider>
              <ToolsProvider>
                <App />
              </ToolsProvider>
            </MapProvider>
          </PacksProvider>
        </LoadingProvider>
      </ModalStackProvider>
    </Provider>
  </React.StrictMode>,
);
