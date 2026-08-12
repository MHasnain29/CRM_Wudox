import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initAgencySwitchListener } from "./lib/switchAgency";

initAgencySwitchListener();

createRoot(document.getElementById("root")!).render(<App />);
