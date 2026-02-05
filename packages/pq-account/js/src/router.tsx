import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
} from "@tanstack/react-router";

import App from "./App";
import { AavePanel } from "./components/AavePanel";
import { CreateAccountPanel } from "./components/CreateAccountPanel";
import { SendTransactionPanel } from "./components/SendTransactionPanel";

export const rootRoute = createRootRoute({
  component: App,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/create" />,
});

const createAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/create",
  component: CreateAccountPanel,
});

const sendTransactionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/send",
  component: SendTransactionPanel,
});

const aaveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/aave",
  component: AavePanel,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  createAccountRoute,
  sendTransactionRoute,
  aaveRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
