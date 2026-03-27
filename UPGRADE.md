# Upgrade Guide — v0.x → v2.0

## Breaking Changes

### 1. ESM-first package

`node-proxmox` v2 is an ES module. If you use CommonJS (`require`), you need to
use the async loader:

```js
// Before (v0.x — CJS)
const px = require('node-proxmox')('host', 'user', 'pam', 'pass');

// After (v2 — ESM, recommended)
import { ProxmoxClient } from 'node-proxmox';
const px = new ProxmoxClient('host', {
  username: 'user',
  password: 'pass',
  realm: 'pam',
});

// After (v2 — CJS, async)
const { ProxmoxClient } = await require('node-proxmox').load();
const px = new ProxmoxClient('host', { username: 'user', password: 'pass' });
```

### 2. Constructor signature changed

The old positional arguments are replaced with an options object:

```js
// Before
const px = require('node-proxmox')('host', 'user', 'pam', 'pass');

// After
const px = new ProxmoxClient('host', {
  username: 'user',
  password: 'pass',
  realm: 'pam', // default: 'pam'
});
```

### 3. Promises instead of callbacks

All methods now return Promises. Replace callbacks with `await` or `.then()`:

```js
// Before
px.get('/nodes/', function (data) {
  console.log(data);
});

// After
const data = await px.get('/nodes');
console.log(data);
```

### 4. Error handling

Errors are now thrown as `ProxmoxError` instances instead of being silently
swallowed. Wrap calls in try/catch:

```js
import { ProxmoxClient, ProxmoxError } from 'node-proxmox';

try {
  const nodes = await px.getNodes();
} catch (err) {
  if (err instanceof ProxmoxError) {
    console.error(err.message, err.statusCode);
  }
}
```

### 5. Node.js 18+ required

v2 requires Node.js 18 or later (LTS). Node.js 16 and below are no longer
supported.

### 6. `del()` method unchanged

The `del()` method name is preserved for backward compatibility. It still
maps to HTTP DELETE.

## New Features

### API Token Authentication (PVE 7+/8+)

No more passwords in scripts — use API tokens:

```js
const px = new ProxmoxClient('pve.example.com', {
  tokenId: 'automation@pve!deploy',
  tokenSecret: '12345678-abcd-efgh-ijkl-123456789abc',
});
```

API tokens don't need CSRF tokens and never expire (unless revoked).

### Convenience Methods

Instead of memorizing API paths, use named methods:

```js
// VM operations
const vms = await px.getQemu('pve1');
await px.startQemu('pve1', 100);
await px.cloneQemu('pve1', 100, { newid: 101, name: 'clone' });

// Container operations
const cts = await px.getLxc('pve1');
await px.startLxc('pve1', 200);

// Cluster
const resources = await px.getClusterResources('vm');
const nextId = await px.getClusterNextId();

// Tasks
const upid = await px.startQemu('pve1', 100);
const status = await px.waitForTask('pve1', upid);

// And many more — see README.md
```

### Configurable Connection

```js
const px = new ProxmoxClient('pve.example.com', {
  port: 443,                  // custom port
  scheme: 'https',            // or 'http'
  rejectUnauthorized: true,   // enforce TLS validation
  timeout: 60_000,            // request timeout in ms
});
```

## Migration Checklist

- [ ] Update Node.js to 18+
- [ ] Change `require()` to `import` (or use async CJS loader)
- [ ] Update constructor to use options object
- [ ] Replace callbacks with `async/await`
- [ ] Add `try/catch` around API calls
- [ ] Consider switching from password auth to API tokens
- [ ] Update `package.json` to `"node-proxmox": "^2.0.0"`
