No longer maintained. 
============

node-proxmox
============

NodeJs Module to interract with Proxmox VE API. Full async.

Usage
============
```
var px = require('node-proxmox')('hostname', 'username', 'authtype', 'password');

px.get('/nodes/', callback(data));
px.post('/nodes/{node}/storage/{storage}/content/{volume}', body, callback(data));
px.put('/nodes/{node}/dns', body, callback(data));
px.del('/nodes/{node}/storage/{storage}/content/{volume}', callback(data));
```

Ressources
============

Proxmox API documentation : http://pve.proxmox.com/pve2-api-doc/
