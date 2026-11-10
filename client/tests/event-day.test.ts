import assert from 'node:assert/strict';
import test from 'node:test';
import { nextJstDay, startOfJstDay } from '../src/event-day';

test('events move to the past at midnight in Japan', () => {
  const beforeMidnight = Date.parse('2026-11-10T14:59:59.999Z');
  const afterMidnight = Date.parse('2026-11-10T15:00:00.000Z');
  const eventEarlyOnNovember10 = Date.parse('2026-11-09T15:00:00.000Z');
  const eventLateOnNovember10 = Date.parse('2026-11-10T14:59:59.999Z');
  const eventOnNovember11 = Date.parse('2026-11-10T15:00:00.000Z');

  assert.equal(startOfJstDay(beforeMidnight), eventEarlyOnNovember10);
  assert.equal(nextJstDay(beforeMidnight), afterMidnight);
  assert.ok(eventEarlyOnNovember10 >= startOfJstDay(beforeMidnight));
  assert.ok(eventLateOnNovember10 < startOfJstDay(afterMidnight));
  assert.ok(eventOnNovember11 >= startOfJstDay(afterMidnight));
  assert.equal(nextJstDay(afterMidnight), Date.parse('2026-11-11T15:00:00.000Z'));
});
