import { Provider } from "jotai";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Provider>
        <TooltipProvider>
          <App />
          <Toaster
            position="bottom-center"
            className="flex justify-center"
            toastOptions={{ style: { width: "fit-content" } }}
          />
        </TooltipProvider>
      </Provider>
    </StrictMode>,
  );
}
