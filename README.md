node-proxmox
============

NodeJs Module to interract with Proxmox VE API

Usage
============
```
var px = require('node-proxmox')('hostname', 'username', 'authtype', 'password');

px.get('/nodes/', callback(nodes));
px.post('/nodes/', body, callback(nodes));
px.put('/nodes/', body, callback(nodes));
px.del('/nodes/', callback(nodes));
```
