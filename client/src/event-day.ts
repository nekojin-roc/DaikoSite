const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// Japan uses UTC+09:00 without daylight saving time. Return the UTC instant
// corresponding to midnight in Japan, regardless of the viewer's time zone.
export function startOfJstDay(now: number = Date.now()): number {
  return Math.floor((now + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

export function nextJstDay(now: number = Date.now()): number {
  return startOfJstDay(now) + DAY_MS;
}
