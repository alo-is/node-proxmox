# node-proxmox

Modern [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment) API client for Node.js.

- Supports **Proxmox VE 7.x / 8.x**
- **API token** and password/ticket authentication
- **async/await** — all methods return Promises
- Convenience methods for VMs, containers, storage, cluster, tasks, firewall, SDN, and more
- Proper error handling with `ProxmoxError`
- Zero runtime dependencies — uses only Node.js built-ins
- Node.js 18+

> Upgrading from v0.x? See [UPGRADE.md](./UPGRADE.md).

## Install

```bash
npm install node-proxmox
```

## Quick Start

### API Token Authentication (recommended)

Create an API token in the Proxmox web UI under **Datacenter → Permissions → API Tokens**.

```js
import { ProxmoxClient } from 'node-proxmox';

const px = new ProxmoxClient('pve.example.com', {
  tokenId: 'automation@pve!deploy',
  tokenSecret: '12345678-abcd-efgh-ijkl-123456789abc',
});

const nodes = await px.getNodes();
console.log(nodes);
```

### Password Authentication

```js
import { ProxmoxClient } from 'node-proxmox';

const px = new ProxmoxClient('pve.example.com', {
  username: 'root',
  password: 's3cret',
  realm: 'pam', // default
});

const nodes = await px.getNodes();
```

### Factory Function

```js
import proxmox from 'node-proxmox';

const px = proxmox('pve.example.com', {
  tokenId: 'root@pam!mytoken',
  tokenSecret: 'xxx',
});
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `port` | `8006` | API port |
| `scheme` | `'https'` | `'https'` or `'http'` |
| `tokenId` | — | API token ID (`USER@REALM!TOKENID`) |
| `tokenSecret` | — | API token secret (UUID) |
| `username` | — | Username for password auth |
| `password` | — | Password for password auth |
| `realm` | `'pam'` | Auth realm |
| `rejectUnauthorized` | `false` | Enforce TLS certificate validation |
| `timeout` | `30000` | Request timeout in ms |

## Raw API Methods

For any endpoint not covered by convenience methods:

```js
const data = await px.get('/nodes/pve1/apt/update');
await px.post('/nodes/pve1/qemu', { vmid: 100, memory: 2048 });
await px.put('/nodes/pve1/dns', { search: 'example.com' });
await px.del('/nodes/pve1/qemu/100');
```

## Convenience Methods

### Nodes

```js
await px.getNodes();
await px.getNodeStatus('pve1');
```

### QEMU VMs

```js
await px.getQemu('pve1');
await px.getQemuConfig('pve1', 100);
await px.getQemuStatus('pve1', 100);
await px.createQemu('pve1', { vmid: 100, memory: 4096, cores: 2 });
await px.updateQemuConfig('pve1', 100, { memory: 8192 });
await px.deleteQemu('pve1', 100);

// Lifecycle
await px.startQemu('pve1', 100);
await px.stopQemu('pve1', 100);
await px.shutdownQemu('pve1', 100);
await px.rebootQemu('pve1', 100);
await px.resetQemu('pve1', 100);
await px.suspendQemu('pve1', 100);
await px.resumeQemu('pve1', 100);

// Operations
await px.cloneQemu('pve1', 100, { newid: 101, name: 'my-clone' });
await px.migrateQemu('pve1', 100, { target: 'pve2' });
await px.snapshotQemu('pve1', 100, { snapname: 'before-upgrade' });
await px.listQemuSnapshots('pve1', 100);

// Guest agent
await px.qemuAgentExec('pve1', 100, { command: 'cat /etc/hostname' });
await px.qemuAgentExecStatus('pve1', 100, 1234);
```

### LXC Containers

```js
await px.getLxc('pve1');
await px.getLxcConfig('pve1', 200);
await px.getLxcStatus('pve1', 200);
await px.createLxc('pve1', { vmid: 200, ostemplate: 'local:vztmpl/debian-12.tar.zst' });
await px.updateLxcConfig('pve1', 200, { memory: 1024 });
await px.deleteLxc('pve1', 200);

await px.startLxc('pve1', 200);
await px.stopLxc('pve1', 200);
await px.shutdownLxc('pve1', 200);
await px.rebootLxc('pve1', 200);
await px.cloneLxc('pve1', 200, { newid: 201 });
await px.migrateLxc('pve1', 200, { target: 'pve2' });
await px.snapshotLxc('pve1', 200, { snapname: 'snap1' });
await px.listLxcSnapshots('pve1', 200);
```

### Cluster

```js
await px.getClusterStatus();
await px.getClusterResources();       // all
await px.getClusterResources('vm');    // VMs only
await px.getClusterResources('node');  // nodes only
await px.getClusterNextId();
await px.getClusterOptions();
await px.getClusterLog();
```

### Storage

```js
await px.getStorage();
await px.getStorageConfig('local-lvm');
await px.getNodeStorage('pve1', 'local');
await px.getNodeStorageStatus('pve1', 'local');
```

### Tasks

```js
await px.getNodeTasks('pve1');
await px.getTaskStatus('pve1', upid);
await px.getTaskLog('pve1', upid);
await px.stopTask('pve1', upid);

// Wait for a task to complete (polls every 2s, timeout 5min)
const result = await px.waitForTask('pve1', upid, {
  interval: 2000,
  timeout: 300_000,
});
```

### Access & Users

```js
await px.getUsers();
await px.getUser('root@pam');
await px.getRealms();
await px.getRoles();
await px.getAcl();
```

### Pools

```js
await px.getPools();
await px.getPool('production');
await px.createPool('staging', 'Staging environment');
await px.deletePool('staging');
```

### Network

```js
await px.getNodeNetwork('pve1');
await px.getNodeDns('pve1');
await px.updateNodeDns('pve1', { search: 'example.com', dns1: '8.8.8.8' });
```

### Firewall

```js
await px.getClusterFirewallRules();
await px.getNodeFirewallRules('pve1');
await px.getQemuFirewallRules('pve1', 100);
await px.getLxcFirewallRules('pve1', 200);
```

### Backup

```js
await px.getBackupJobs();
await px.getBackupJob('backup-12345');
await px.createBackupJob({ ... });
```

### SDN (PVE 7+/8+)

```js
await px.getSdnZones();
await px.getSdnVnets();
await px.getSdnControllers();
await px.applySdn();
```

### Version

```js
const info = await px.getVersion();
// { version: '8.3.2', release: '2', repoid: '...' }
```

## Error Handling

```js
import { ProxmoxClient, ProxmoxError } from 'node-proxmox';

try {
  await px.startQemu('pve1', 999);
} catch (err) {
  if (err instanceof ProxmoxError) {
    console.error(err.message);     // Human-readable error
    console.error(err.statusCode);  // HTTP status (e.g. 500)
    console.error(err.endpoint);    // API path
    console.error(err.data);        // Raw response data
  }
}
```

## Resources

- [Proxmox VE API Viewer](https://pve.proxmox.com/pve-docs/api-viewer/)
- [Proxmox VE API Wiki](https://pve.proxmox.com/wiki/Proxmox_VE_API)
- [Proxmox VE User Management (API Tokens)](https://pve.proxmox.com/pve-docs/chapter-pveum.html)

## License

GPL-2.0
