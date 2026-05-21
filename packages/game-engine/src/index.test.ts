import { describe, expect, it } from 'vitest';
import { createBootstrapRoomState } from './index.js';

describe('createBootstrapRoomState', () => {
  it('creates a four-seat bootstrap room with AI-controlled seats', () => {
    const state = createBootstrapRoomState('TEST');

    expect(state.roomCode).toBe('TEST');
    expect(state.phase).toBe('bootstrap');
    expect(state.ruleset.playerCount).toBe(4);
    expect(state.seats).toHaveLength(4);
    expect(state.seats.every((seat) => seat.controller === 'ai')).toBe(true);
  });
});