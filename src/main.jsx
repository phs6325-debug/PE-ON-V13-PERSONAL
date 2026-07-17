import "./styles/style.css";
import "./styles/assessment.css";
import "./styles/peon-v9-final-mobile-sync.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
