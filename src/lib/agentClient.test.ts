import { describe, expect, it } from 'vitest';
import { parseSSE } from './agentClient';

describe('parseSSE', () => {
  it('parses complete frames and keeps the remainder', () => {
    const { events, rest } = parseSSE('data: {"type":"text","delta":"a"}\n\ndata: {"type":"done","reason":"end_turn"}\n\ndata: {"ty');
    expect(events).toEqual([
      { type: 'text', delta: 'a' },
      { type: 'done', reason: 'end_turn' },
    ]);
    expect(rest).toBe('data: {"ty');
  });
  it('drops malformed frames and ignores comments', () => {
    const { events } = parseSSE(': ping\n\ndata: not json\n\ndata: {"type":"error","message":"x"}\n\n');
    expect(events).toEqual([{ type: 'error', message: 'x' }]);
  });
  it('joins multi-line data', () => {
    const { events } = parseSSE('data: {"type":"text",\ndata: "delta":"b"}\n\n');
    expect(events).toEqual([{ type: 'text', delta: 'b' }]);
  });
});
