import { useEffect, useRef } from "react";

interface ConsoleProps {
  output: string;
}

export function Console({ output }: ConsoleProps) {
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div className="console">
      <div className="console-header">
        <span className="console-dot red"></span>
        <span className="console-dot yellow"></span>
        <span className="console-dot green"></span>
        <span className="console-title">Output</span>
      </div>
      <div className="console-output" ref={outputRef}>
        {output}
      </div>
    </div>
  );
}
