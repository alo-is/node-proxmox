'use strict';

// CJS wrapper — dynamically imports the ESM module.
// Users doing `const proxmox = require('node-proxmox')` get a promise-based loader.

let _cached;

async function load() {
  if (!_cached) {
    _cached = await import('./index.js');
  }
  return _cached;
}

class ProxmoxClient {
  /**
   * Create a new ProxmoxClient.
   * In CJS mode you can also use the async factory:
   *   const { ProxmoxClient } = await require('node-proxmox').load();
   */
  constructor(hostname, options) {
    // We need to dynamically resolve the real class
    throw new Error(
      'node-proxmox v2 is an ESM package. ' +
      'Use: const { ProxmoxClient } = await require("node-proxmox").load();'
    );
  }
}

module.exports = load;
module.exports.load = load;
module.exports.ProxmoxClient = ProxmoxClient;
module.exports.default = load;
