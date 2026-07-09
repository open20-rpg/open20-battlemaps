import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Provider } from "./components/ui/provider";
import { LoadingProvider } from "./context/loading";
import { PacksProvider } from "./context/packs";
import { MapProvider } from "./context/map";
import { ModalStackProvider } from "./context/modalStack";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider>
      <ModalStackProvider>
        <LoadingProvider>
          <PacksProvider>
            <MapProvider>
              <App />
            </MapProvider>
          </PacksProvider>
        </LoadingProvider>
      </ModalStackProvider>
    </Provider>
  </React.StrictMode>,
);
