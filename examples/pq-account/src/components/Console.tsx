import { useEffect, useRef } from "react";

type ConsoleProps = {
  output: string;
};

export const Console = ({ output }: ConsoleProps) => {
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div className="bg-bg-secondary border border-border rounded-lg mt-6 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-tertiary border-b border-border">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          Console Output
        </span>
      </div>
      <div
        className="p-4 font-mono text-xs leading-relaxed text-text-secondary min-h-40 max-h-100 overflow-y-auto whitespace-pre-wrap wrap-break-word"
        ref={outputRef}
      >
        {output || <span className="text-text-muted">No output yet...</span>}
      </div>
    </div>
  );
};
