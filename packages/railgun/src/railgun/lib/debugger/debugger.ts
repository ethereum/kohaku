import { EngineDebugger } from "../models/engine-types";

export class EngineDebug {
  private static engineDebugger: Optional<EngineDebugger>;

  static init(engineDebugger: EngineDebugger) {
    this.engineDebugger = engineDebugger;
  }

  static log(msg: string) {
    if (this.engineDebugger) {
      this.engineDebugger.log(msg);
    }
  }

  static error(err: Error, ignoreInTests = false) {
    if (this.engineDebugger) {
      this.engineDebugger.error(err);
    }

    if (this.isTestRun() && !ignoreInTests) {
      console.error(err);
    }
  }

  static isTestRun() {
    return process.env.NODE_ENV === "test";
  }

  static verboseScanLogging() {
    return this.engineDebugger?.verboseScanLogging ?? false;
  }
}
