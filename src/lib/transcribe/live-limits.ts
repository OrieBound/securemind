/**
 * Limits for direct live captions, shared by the browser client and the server.
 *
 * The browser streams audio straight to Amazon, so the server never learns how long a session ran.
 * It therefore counts every session at the longest an honest session can last (the browser stops
 * itself at MAX_LIVE_SESSION_MINUTES) and allows a fixed number of sessions per person per UTC day.
 * Past that number voice still works: the browser falls back to the whole-recording pass, which is
 * billed by the exact second, and the words appear after Done instead of while speaking.
 *
 * Plain constants only, so the browser bundle can import this file.
 */

/** Longest one direct session runs before the browser ends it. Also what each session is billed as. */
export const MAX_LIVE_SESSION_MINUTES = 10;

/** Direct live sessions one person may start per UTC day. */
export const LIVE_SESSIONS_PER_DAY = 30;
