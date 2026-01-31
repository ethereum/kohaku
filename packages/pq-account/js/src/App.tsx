import "./styles/globals.css";

import { useState } from "react";

import { CreateAccountPanel } from "./components/CreateAccountPanel";
import { Header } from "./components/Header";
import { SendTransactionPanel } from "./components/SendTransactionPanel";
import { Tabs } from "./components/Tabs";

function App() {
  const [activeTab, setActiveTab] = useState<"create" | "send">("create");

  return (
    <>
      <Header />

      <main className="main-container">
        <Tabs activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "create" && <CreateAccountPanel />}

        {activeTab === "send" && <SendTransactionPanel />}
      </main>

      <footer className="footer">
        <p>
          <a href="https://zknox.com" target="_blank" rel="noopener noreferrer">
            ZKNOX
          </a>{" "}
          — Post-Quantum Security for Ethereum
        </p>
      </footer>
    </>
  );
}

export default App;
