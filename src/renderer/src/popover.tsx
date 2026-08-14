import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Popover } from "./PopoverPanel";

import "@fontsource/instrument-serif/400.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";

import "./styles/tokens.css";
import "./styles/popover.css";

const container = document.getElementById("root");
if (!container) throw new Error("root container missing");

createRoot(container).render(
  <StrictMode>
    <Popover />
  </StrictMode>
);
