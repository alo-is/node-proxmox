# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [2.0.0] — 2026-03-27

### Breaking Changes

- **ESM-first** — package is now an ES module (`"type": "module"`). CJS users
  must use the async loader: `const { ProxmoxClient } = await require('node-proxmox').load()`.
- **Constructor signature** — positional args replaced with options object:
  `new ProxmoxClient(hostname, { username, password, realm })`.
- **Promises** — all methods return Promises instead of taking callbacks.
- **Errors thrown** — API errors now throw `ProxmoxError` instead of being
  silently swallowed.
- **Node.js 18+** required (dropped support for Node.js < 18).

### Added

- **API token authentication** (`tokenId` + `tokenSecret`) for Proxmox VE 7+/8+.
  API tokens don't require CSRF and never expire unless revoked.
- **60+ convenience methods** for QEMU VMs, LXC containers, storage, cluster,
  tasks, firewall, SDN, backup, pools, access management.
- **`waitForTask()`** — polls a task UPID until completion with configurable
  interval and timeout.
- **`ProxmoxError`** class with `statusCode`, `endpoint`, `method`, `data`.
- **VMID validation** — all convenience methods validate VMIDs as positive
  integers, preventing path injection.
- **Login deduplication** — concurrent requests share a single in-flight login
  promise.
- **Configurable** port, scheme (`http`/`https`), TLS validation, request timeout.
- **Jest test suite** (24 tests) with real HTTP mock servers.
- **GitHub Actions CI** — test matrix (Node 18/20/22) + coverage.
- **GitHub Actions publish** — automated npm publish on `v*` tag push with
  provenance.
- **ESLint** flat config.
- **UPGRADE.md** migration guide from v0.x.

### Removed

- **OpenVZ** keyword (Proxmox dropped OpenVZ in PVE 4.0).
- Old `node-proxmox.js` single-file module.

## [0.1.2] — 2014-11-21

- Fixed chunk handling for large responses.

## [0.1.1] — 2014-03-15

- Renamed: sync → async.

## [0.1.0] — 2014-03-15

- Initial release (deprecated — critical bug).

[2.0.0]: https://github.com/alo-is/node-proxmox/compare/v0.1.2...v2.0.0
[0.1.2]: https://github.com/alo-is/node-proxmox/releases/tag/v0.1.2
[0.1.1]: https://github.com/alo-is/node-proxmox/releases/tag/v0.1.1
[0.1.0]: https://github.com/alo-is/node-proxmox/releases/tag/v0.1.0
