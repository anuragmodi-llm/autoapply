/**
 * Prefixed console logger with level filtering.
 * All extension logging goes through this module for consistent formatting.
 */

const PREFIX = "[AutoApply]";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = LEVELS.info;

/**
 * Sets the minimum log level. Messages below this level are suppressed.
 * @param {"debug"|"info"|"warn"|"error"} level
 */
export function setLevel(level) {
  if (LEVELS[level] !== undefined) {
    currentLevel = LEVELS[level];
  }
}

/**
 * @param  {...any} args
 */
export function debug(...args) {
  if (currentLevel <= LEVELS.debug) console.debug(PREFIX, ...args);
}

/**
 * @param  {...any} args
 */
export function info(...args) {
  if (currentLevel <= LEVELS.info) console.info(PREFIX, ...args);
}

/**
 * @param  {...any} args
 */
export function warn(...args) {
  if (currentLevel <= LEVELS.warn) console.warn(PREFIX, ...args);
}

/**
 * @param  {...any} args
 */
export function error(...args) {
  if (currentLevel <= LEVELS.error) console.error(PREFIX, ...args);
}
