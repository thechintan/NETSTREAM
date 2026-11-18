/**
 * Allocates non-overlapping (rtpPort, rtcpPort) pairs on localhost for mediasoup PlainTransports
 * with rtcpMux: false. Always assigns an even RTP port paired with rtpPort + 1 for RTCP.
 */
export interface PortPair {
  rtpPort: number;
  rtcpPort: number;
}

export class PortAllocator {
  private readonly minPort: number;
  private readonly maxPort: number;
  private readonly inUse = new Set<number>();
  private cursor: number;

  constructor(minPort = 50000, maxPort = 50998) {
    // Ensure even start and valid range
    this.minPort = minPort % 2 === 0 ? minPort : minPort + 1;
    this.maxPort = maxPort % 2 === 0 ? maxPort : maxPort - 1;
    if (this.maxPort < this.minPort) {
      throw new Error(`Invalid port range: ${minPort}-${maxPort}`);
    }
    this.cursor = this.minPort;
  }

  public allocatePair(): PortPair {
    const totalSlots = Math.floor((this.maxPort - this.minPort) / 2) + 1;

    for (let attempt = 0; attempt < totalSlots; attempt++) {
      const rtpPort = this.cursor;
      const rtcpPort = rtpPort + 1;

      this.cursor += 2;
      if (this.cursor > this.maxPort) {
        this.cursor = this.minPort;
      }

      if (!this.inUse.has(rtpPort) && !this.inUse.has(rtcpPort)) {
        this.inUse.add(rtpPort);
        this.inUse.add(rtcpPort);
        return { rtpPort, rtcpPort };
      }
    }

    throw new Error(`No available UDP port pairs in range ${this.minPort}-${this.maxPort + 1}`);
  }

  public releasePair(rtpPort: number): void {
    this.inUse.delete(rtpPort);
    this.inUse.delete(rtpPort + 1);
  }

  public inUsePairCount(): number {
    return this.inUse.size / 2;
  }

  public reset(): void {
    this.inUse.clear();
    this.cursor = this.minPort;
  }
}
