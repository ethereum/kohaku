import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";

import { ConsoleProvider } from "./components/ConsoleProvider";
import { SessionProvider } from "./components/SessionProvider";
import { wagmiConfig } from "./config/wagmi";
import { router } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ConsoleProvider>
            <RouterProvider router={router} />
          </ConsoleProvider>
        </SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
