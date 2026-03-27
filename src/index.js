import { ProxmoxClient, ProxmoxError } from './client.js';

export { ProxmoxClient, ProxmoxError };

/**
 * Factory function — convenience shorthand.
 *
 * @example
 * // API token auth (recommended for PVE 7+/8+)
 * import proxmox from 'node-proxmox';
 * const client = proxmox('pve.example.com', {
 *   tokenId: 'root@pam!mytoken',
 *   tokenSecret: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
 * });
 *
 * @example
 * // Password auth (legacy, still supported)
 * import proxmox from 'node-proxmox';
 * const client = proxmox('pve.example.com', {
 *   username: 'root',
 *   password: 's3cret',
 *   realm: 'pam',
 * });
 */
export default function proxmox(hostname, options) {
  return new ProxmoxClient(hostname, options);
}
