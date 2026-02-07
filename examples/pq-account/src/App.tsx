import "./styles/globals.css";

import { Outlet } from "@tanstack/react-router";

import { Header } from "./components/Header";
import { Tabs } from "./components/Tabs";

export const App = () => {
  return (
    <>
      <Header />

      <main className="max-w-4xl mx-auto px-6 py-8">
        <Tabs />

        <Outlet />
      </main>

      <footer className="text-center py-12 border-t border-border mt-12">
        <p className="text-sm text-text-muted">
          <a
            href="https://zknox.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover transition-colors font-medium"
          >
            ZKNOX
          </a>
          {" — "}
          Post-Quantum Security for Ethereum
        </p>
      </footer>
    </>
  );
};
