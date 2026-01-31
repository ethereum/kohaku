interface TabsProps {
  activeTab: "create" | "send";
  onTabChange: (tab: "create" | "send") => void;
}

export function Tabs({ activeTab, onTabChange }: TabsProps) {
  return (
    <div className="tabs">
      <button
        className={`tab ${activeTab === "create" ? "active" : ""}`}
        onClick={() => onTabChange("create")}
      >
        <span className="tab-icon">🔐</span>
        Create Account
      </button>
      <button
        className={`tab ${activeTab === "send" ? "active" : ""}`}
        onClick={() => onTabChange("send")}
      >
        <span className="tab-icon">📤</span>
        Send Transaction
      </button>
    </div>
  );
}
