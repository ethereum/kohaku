/* eslint-disable no-restricted-syntax */
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";
import { arbitrumSepolia, sepolia } from "wagmi/chains";

const SUPPORTED_CHAIN_IDS: number[] = [sepolia.id, arbitrumSepolia.id];

export function Header() {
  const { isConnected, chain } = useConnection();
  const { mutate: connect } = useConnect();
  const connectors = useConnectors();
  const { mutate: disconnect } = useDisconnect();

  const networkName = chain?.name ?? "Not Connected";
  const isSupported = chain?.id
    ? SUPPORTED_CHAIN_IDS.includes(chain.id)
    : false;

  const handleConnect = () => {
    const [injectedConnector] = connectors;

    if (injectedConnector) {
      connect({ connector: injectedConnector });
    }
  };

  return (
    <header className="header">
      <div className="header-content">
        <div className="logo">
          <a href="https://zknox.com" target="_blank" rel="noopener noreferrer">
            <img src="/zkknox.png" alt="ZKNOX" />
          </a>
        </div>
        <div className="header-center">
          {!isConnected ? (
            <button className="connect-btn" onClick={handleConnect}>
              Connect Wallet
            </button>
          ) : (
            <button className="disconnect-btn" onClick={() => disconnect()}>
              Disconnect
            </button>
          )}
          <div className="wallet-status">
            <span
              className={`status-dot ${isConnected ? "connected" : ""}`}
            ></span>
            <span>{networkName}</span>
          </div>
          {isConnected && !isSupported && (
            <div className="network-warning">⚠️ Not supported yet</div>
          )}
        </div>
        <div className="header-mascot">
          <img src="/kohaku.svg" alt="Kohaku Mascot" />
        </div>
      </div>
    </header>
  );
}
