import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Provider } from "./components/ui/provider";
import { LoadingProvider } from "./context/loading";
import { PacksProvider } from "./context/packs";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider>
      <LoadingProvider>
        <PacksProvider>
          <App />
        </PacksProvider>
      </LoadingProvider>
    </Provider>
  </React.StrictMode>,
);
