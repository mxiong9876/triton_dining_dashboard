import React from "react";
import { createRoot } from "react-dom/client";
import TritonDiningDashboard from "./triton-dining-dashboard.jsx";

// Find the <div id="root"> in index.html and render the app into it.
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <TritonDiningDashboard />
  </React.StrictMode>
);
