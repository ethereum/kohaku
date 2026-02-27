export interface TcArtifacts {
  circuit: unknown;
  provingKey: ArrayBuffer;
}

export interface ArtifactLoader {
  load(): Promise<TcArtifacts>;
}

export class RemoteArtifactLoader implements ArtifactLoader {
  constructor(
    private circuitUrl: string,
    private provingKeyUrl: string
  ) { }

  async load(): Promise<TcArtifacts> {
    const [circuitResponse, provingKeyResponse] = await Promise.all([
      fetch(this.circuitUrl),
      fetch(this.provingKeyUrl),
    ]);
    const [circuit, provingKey] = await Promise.all([
      circuitResponse.json(),
      provingKeyResponse.arrayBuffer(),
    ]);
    return { circuit, provingKey };
  }
}
