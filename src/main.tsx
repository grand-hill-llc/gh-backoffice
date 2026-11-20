import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter-tight/latin-300.css";
import "@fontsource/inter-tight/latin-400.css";
import "@fontsource/inter-tight/latin-500.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "./styles/tokens.css";
import "./styles/gh.css";
import "./styles/app.css";
import App from "./App";
import { PrefsProvider } from "./lib/prefs";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </React.StrictMode>
);
