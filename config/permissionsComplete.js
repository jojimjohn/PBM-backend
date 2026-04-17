/**
 * DEPRECATED — merged into ./permissions.js on 2026-04-17.
 *
 * This file was never imported anywhere; it accumulated permission definitions
 * (FINALIZE_WCN, granular _ALL/_OWN variants, etc.) that the role-editor UI
 * could not see because the UI reads permissions.js via GET /roles/permissions.
 *
 * Do NOT add new permissions here. Add them to ./permissions.js instead.
 *
 * Kept as a shim so any stray require() keeps working until cleanup.
 */

module.exports = require('./permissions');
