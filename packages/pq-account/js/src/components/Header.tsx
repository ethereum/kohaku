import { useEffect, useState } from "react";
import { match, P } from "ts-pattern";
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useEnsName,
} from "wagmi";
import { arbitrumSepolia, sepolia } from "wagmi/chains";

const SUPPORTED_CHAIN_IDS: number[] = [sepolia.id, arbitrumSepolia.id];

export const Header = () => {
  const { address, isConnected, chain } = useConnection();
  const { data: ensName } = useEnsName({ address });
  const { mutate: connect } = useConnect();
  const connectors = useConnectors();
  const { mutate: disconnect } = useDisconnect();

  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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

  const formatAddress = (addr: string) =>
    ensName ?? `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const generateGradient = (addr: string) => {
    const color = `#${addr.slice(2, 8)}`;

    return `linear-gradient(135deg, ${color}, ${color}80)`;
  };

  return (
    <header className="border-b border-border bg-bg-secondary sticky top-0 z-50">
      <div className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <a
            href="https://zknox.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center"
          >
            <img src="/zknox.png" alt="ZKNOX" className="h-9 w-auto" />
          </a>
        </div>

        <div className="flex items-center gap-3">
          {match({ mounted, isConnected, address })
            .with({ mounted: true, isConnected: false }, () => (
              <button
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-all hover:shadow-md active:scale-[0.99]"
                onClick={handleConnect}
              >
                Connect Wallet
              </button>
            ))
            .with(
              { mounted: true, isConnected: true, address: P.string },
              ({ address: addr }) => (
                <button
                  className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border border-border hover:border-border-hover rounded-lg transition-all hover:shadow-sm"
                  onClick={() => disconnect()}
                  title="Disconnect"
                >
                  <div
                    className="w-6 h-6 rounded-full"
                    style={{ background: generateGradient(addr) }}
                  />
                  <span className="text-sm font-medium text-text-primary">
                    {formatAddress(addr)}
                  </span>
                </button>
              )
            )
            .otherwise(() => null)}

          <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-success" : "bg-text-muted"
              }`}
            />
            <span className="text-text-secondary text-sm">{networkName}</span>
          </div>

          {isConnected && !isSupported && (
            <div className="text-xs text-warning px-2 py-1 bg-warning/10 border border-warning/30 rounded">
              Unsupported
            </div>
          )}
        </div>

        <div>
          <img src="/kohaku.svg" alt="Kohaku" className="h-10 w-auto" />
        </div>
      </div>
    </header>
  );
};
