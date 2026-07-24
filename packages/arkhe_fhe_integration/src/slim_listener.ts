import { createPublicClient, http, parseAbiItem } from 'viem';

export interface DecryptRequest {
  circleId: string;
  handle: bigint;
  requester: `0x${string}`;
}

export class SlimListener {
  private client: any;
  private contractAddress: `0x${string}`;
  private requestQueue: DecryptRequest[] = [];

  constructor(contractAddress: `0x${string}`, chainConfig: any) {
    this.client = createPublicClient({
      chain: chainConfig,
      transport: http(),
    });
    this.contractAddress = contractAddress;
  }

  /**
   * Starts listening for ThresholdDecryptRequested events
   */
  startListening() {
    console.log(`[SLIM LISTENER] Listening on contract ${this.contractAddress}`);

    this.client.watchEvent({
      address: this.contractAddress,
      event: parseAbiItem('event ThresholdDecryptRequested(string circleId, uint256 handle, address requester)'),
      onLogs: (logs: any) => {
        for (const log of logs) {
          const request: DecryptRequest = {
            circleId: log.args.circleId,
            handle: log.args.handle,
            requester: log.args.requester,
          };
          console.log(`[SLIM LISTENER] Captured request for Circle ${request.circleId}, Handle ${request.handle}`);
          this.requestQueue.push(request);
        }
      },
    });
  }

  /**
   * Gets the current queue of requests
   */
  getQueue(): DecryptRequest[] {
    return this.requestQueue;
  }

  /**
   * Removes a processed request from the queue
   */
  dequeue(handle: bigint) {
    this.requestQueue = this.requestQueue.filter(req => req.handle !== handle);
  }
}
