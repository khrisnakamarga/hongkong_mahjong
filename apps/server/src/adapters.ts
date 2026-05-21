import type { RoomEvent, RoomRecord } from './types.js';

export interface RoomRepository {
  get(roomCode: string): Promise<RoomRecord | undefined>;
  save(room: RoomRecord): Promise<void>;
  delete(roomCode: string): Promise<void>;
  list(): Promise<readonly RoomRecord[]>;
}

export interface RoomEventSubscription {
  unsubscribe(): void;
}

export interface CoordinationAdapter {
  withRoomLock<T>(roomCode: string, work: () => Promise<T>): Promise<T>;
  publish(event: RoomEvent): Promise<void>;
  subscribe(listener: (event: RoomEvent) => void): RoomEventSubscription;
}

export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomRecord>();

  async get(roomCode: string): Promise<RoomRecord | undefined> {
    return this.rooms.get(roomCode.toUpperCase());
  }

  async save(room: RoomRecord): Promise<void> {
    this.rooms.set(room.roomCode.toUpperCase(), room);
  }

  async delete(roomCode: string): Promise<void> {
    this.rooms.delete(roomCode.toUpperCase());
  }

  async list(): Promise<readonly RoomRecord[]> {
    return [...this.rooms.values()];
  }
}

export class InMemoryCoordinationAdapter implements CoordinationAdapter {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(event: RoomEvent) => void>();

  async withRoomLock<T>(roomCode: string, work: () => Promise<T>): Promise<T> {
    const key = roomCode.toUpperCase();
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => next);
    this.locks.set(key, chained);

    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(key) === chained) {
        this.locks.delete(key);
      }
    }
  }

  async publish(event: RoomEvent): Promise<void> {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: RoomEvent) => void): RoomEventSubscription {
    this.listeners.add(listener);
    return {
      unsubscribe: () => this.listeners.delete(listener)
    };
  }
}
