import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import ThemedTooltipLayer from "./components/ui/ThemedTooltipLayer";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <ThemedTooltipLayer />
  </React.StrictMode>
);
