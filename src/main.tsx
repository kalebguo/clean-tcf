import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startCloud } from "./cloud/cloud";
import { startSnapshots } from "./platform/snapshot";
import "./styles/globals.css";

startCloud();
startSnapshots();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
