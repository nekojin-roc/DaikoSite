const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** The UTC instant at the start of the current calendar day in Japan. */
export function startOfJstDay(now = Date.now()): Date {
  return new Date(Math.floor((now + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS);
}
