import type { LogLevel } from "../pkg";

let enabled = false;

export function setTsLogLevel(level: LogLevel): void {
    enabled = String(level) !== "Off";
}

export function tsLog(...args: unknown[]): void {
    if (enabled) {
        console.log(...args);
    }
}
