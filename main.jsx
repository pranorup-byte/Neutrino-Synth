import React from "react";
import { createRoot } from "react-dom/client";
import NeutrinoSynth from "./NeutrinoSynth.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <NeutrinoSynth />
  </React.StrictMode>
);
