import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { getSettings } from "./api";
import { applyTheme, normalizeTheme, watchSystemTheme } from "./theme";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/responsive-fixes.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// The server copy wins over the localStorage mirror used for the first paint.
getSettings()
  .then((settings) => applyTheme(normalizeTheme(settings.theme)))
  .catch(() => undefined);
watchSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
