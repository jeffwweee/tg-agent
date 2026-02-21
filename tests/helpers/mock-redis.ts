/**
 * Mock Redis Client for Testing
 *
 * In-memory mock of Redis Streams operations.
 */

export interface MockMessage {
  id: string;
  fields: Record<string, string>;
}

export interface MockPendingMessage {
  id: string;
  consumer: string;
  idle: number;
  delivered: number;
}

export class MockRedis {
  private streams: Map<string, MockMessage[]> = new Map();
  private consumerGroups: Map<string, Map<string, MockPendingMessage[]>> = new Map();
  private idCounter = 0;

  async xadd(streamKey: string, _id: string, ...args: (string | number)[]): Promise<string> {
    if (!this.streams.has(streamKey)) {
      this.streams.set(streamKey, []);
    }

    const fields: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      const value = args[i + 1];
      if (key !== undefined && value !== undefined) {
        fields[String(key)] = String(value);
      }
    }

    this.idCounter++;
    const id = `${Date.now()}-${this.idCounter}`;

    const stream = this.streams.get(streamKey);
    if (stream !== undefined) {
      stream.push({ id, fields });
    }

    return id;
  }

  async xgroup(
    command: string,
    streamKey: string,
    groupName: string,
    _start: string,
    _mkstream?: string
  ): Promise<void> {
    if (command !== 'CREATE') {
      return;
    }

    if (!this.streams.has(streamKey)) {
      this.streams.set(streamKey, []);
    }

    if (!this.consumerGroups.has(streamKey)) {
      this.consumerGroups.set(streamKey, new Map());
    }

    const groups = this.consumerGroups.get(streamKey);
    if (groups !== undefined && !groups.has(groupName)) {
      groups.set(groupName, []);
    }
  }

  async xreadgroup(
    command: string,
    groupName: string,
    consumerName: string,
    countKey: string,
    count: string,
    blockKey: string,
    block: string,
    streamsKey: string,
    streamKey: string,
    start: string
  ): Promise<Array<[string, Array<[string, string[]]>]> | null> {
    const stream = this.streams.get(streamKey);
    if (stream === undefined || stream.length === 0) {
      return null;
    }

    const groups = this.consumerGroups.get(streamKey);
    const pending = groups?.get(groupName);

    const entries: Array<[string, string[]]> = [];

    for (const msg of stream) {
      // Check if already pending
      const isPending = pending?.some((p) => p.id === msg.id);
      if (!isPending) {
        const fields: string[] = [];
        for (const [key, value] of Object.entries(msg.fields)) {
          fields.push(key, value);
        }
        entries.push([msg.id, fields]);

        // Add to pending
        if (groups !== undefined) {
          if (!groups.has(groupName)) {
            groups.set(groupName, []);
          }
          const groupPending = groups.get(groupName);
          if (groupPending !== undefined) {
            groupPending.push({
              id: msg.id,
              consumer: consumerName,
              idle: 0,
              delivered: 1,
            });
          }
        }
      }
    }

    if (entries.length === 0) {
      return null;
    }

    return [[streamKey, entries]];
  }

  async xack(streamKey: string, groupName: string, ...ids: string[]): Promise<number> {
    const groups = this.consumerGroups.get(streamKey);
    const pending = groups?.get(groupName);
    if (pending === undefined) {
      return 0;
    }

    let acked = 0;
    for (const id of ids) {
      const index = pending.findIndex((p) => p.id === id);
      if (index >= 0) {
        pending.splice(index, 1);
        acked++;
      }
    }

    return acked;
  }

  async xpending(
    streamKey: string,
    groupName: string,
    ..._args: (string | number)[]
  ): Promise<[number, string, string, Array<[string, string, number, number]>] | null> {
    const groups = this.consumerGroups.get(streamKey);
    const pending = groups?.get(groupName);
    if (pending === undefined || pending.length === 0) {
      return [0, '-', '-', []];
    }

    return [
      pending.length,
      pending[0]?.consumer ?? '-',
      pending[pending.length - 1]?.consumer ?? '-',
      pending.map((p) => [p.id, p.consumer, p.idle, p.delivered] as [string, string, number, number]),
    ];
  }

  async xclaim(
    streamKey: string,
    groupName: string,
    consumerName: string,
    _minIdle: number,
    ...ids: string[]
  ): Promise<Array<[string, string[]]>> {
    const groups = this.consumerGroups.get(streamKey);
    const pending = groups?.get(groupName);
    if (pending === undefined) {
      return [];
    }

    const claimed: Array<[string, string[]]> = [];

    for (const id of ids) {
      const pendingMsg = pending.find((p) => p.id === id);
      if (pendingMsg !== undefined) {
        pendingMsg.consumer = consumerName;
        pendingMsg.idle = 0;

        const stream = this.streams.get(streamKey);
        const msg = stream?.find((m) => m.id === id);
        if (msg !== undefined) {
          const fields: string[] = [];
          for (const [key, value] of Object.entries(msg.fields)) {
            fields.push(key, value);
          }
          claimed.push([id, fields]);
        }
      }
    }

    return claimed;
  }

  async quit(): Promise<void> {
    // No-op for mock
  }

  clear(): void {
    this.streams.clear();
    this.consumerGroups.clear();
    this.idCounter = 0;
  }
}
