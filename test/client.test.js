import http from 'node:http';
import { ProxmoxClient, ProxmoxError } from '../src/client.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Spin up a tiny HTTP server that returns JSON. */
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function jsonResponse(res, data, statusCode = 200) {
  const body = JSON.stringify({ data });
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ── Constructor tests ────────────────────────────────────────────────

describe('ProxmoxClient constructor', () => {
  test('throws if hostname missing', () => {
    expect(() => new ProxmoxClient()).toThrow('hostname is required');
  });

  test('throws if no auth provided', () => {
    expect(() => new ProxmoxClient('pve.local')).toThrow(
      'Either tokenId+tokenSecret or username+password must be provided'
    );
  });

  test('accepts token auth', () => {
    const client = new ProxmoxClient('pve.local', {
      tokenId: 'root@pam!test',
      tokenSecret: '00000000-0000-0000-0000-000000000000',
    });
    expect(client.isTokenAuth).toBe(true);
  });

  test('accepts password auth', () => {
    const client = new ProxmoxClient('pve.local', {
      username: 'root',
      password: 'test',
    });
    expect(client.isTokenAuth).toBe(false);
  });
});

// ── Token auth requests ──────────────────────────────────────────────

describe('Token authentication', () => {
  let server, port, client;

  beforeAll(async () => {
    ({ server, port } = await createMockServer((req, res) => {
      // Capture headers for assertion
      res._reqHeaders = req.headers;
      res._reqMethod = req.method;
      res._reqUrl = req.url;

      if (req.url === '/api2/json/nodes') {
        jsonResponse(res, [{ node: 'pve1', status: 'online' }]);
      } else if (req.url === '/api2/json/version') {
        jsonResponse(res, { version: '8.3.2', release: '2' });
      } else if (req.url?.startsWith('/api2/json/nodes/pve1/qemu')) {
        jsonResponse(res, [{ vmid: 100, name: 'test-vm' }]);
      } else if (req.url?.startsWith('/api2/json/cluster/resources')) {
        jsonResponse(res, [{ id: 'qemu/100', type: 'vm' }]);
      } else {
        jsonResponse(res, null, 404);
      }
    }));

    client = new ProxmoxClient('127.0.0.1', {
      port,
      scheme: 'http',
      tokenId: 'root@pam!test',
      tokenSecret: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
  });

  afterAll(() => server.close());

  test('GET /nodes returns node list', async () => {
    const nodes = await client.getNodes();
    expect(nodes).toEqual([{ node: 'pve1', status: 'online' }]);
  });

  test('GET /version returns version info', async () => {
    const ver = await client.getVersion();
    expect(ver.version).toBe('8.3.2');
  });

  test('getQemu returns VM list', async () => {
    const vms = await client.getQemu('pve1');
    expect(vms[0].vmid).toBe(100);
  });

  test('getClusterResources with type filter', async () => {
    const res = await client.getClusterResources('vm');
    expect(res[0].type).toBe('vm');
  });

  test('raw get works', async () => {
    const nodes = await client.get('/nodes');
    expect(Array.isArray(nodes)).toBe(true);
  });
});

// ── Password auth requests ───────────────────────────────────────────

describe('Password authentication', () => {
  let server, port, client;

  beforeAll(async () => {
    ({ server, port } = await createMockServer((req, res) => {
      if (req.url === '/api2/json/access/ticket' && req.method === 'POST') {
        req.on('data', () => {});
        req.on('end', () => {
          jsonResponse(res, {
            ticket: 'PVE:root@pam:FAKE_TICKET',
            CSRFPreventionToken: 'FAKE_CSRF',
          });
        });
        return;
      }

      if (req.url === '/api2/json/nodes') {
        // Verify cookie auth
        const cookie = req.headers.cookie || '';
        if (!cookie.includes('PVEAuthCookie=')) {
          jsonResponse(res, { message: 'Unauthorized' }, 401);
          return;
        }
        jsonResponse(res, [{ node: 'pve1' }]);
        return;
      }

      jsonResponse(res, null, 404);
    }));

    client = new ProxmoxClient('127.0.0.1', {
      port,
      scheme: 'http',
      username: 'root',
      password: 'testpass',
      realm: 'pam',
    });
  });

  afterAll(() => server.close());

  test('auto-login and GET /nodes', async () => {
    const nodes = await client.getNodes();
    expect(nodes).toEqual([{ node: 'pve1' }]);
  });

  test('login() can be called explicitly', async () => {
    await client.login();
    // Should not throw
  });
});

// ── POST/PUT/DELETE ──────────────────────────────────────────────────

describe('Mutating requests', () => {
  let server, port, client;
  const requests = [];

  beforeAll(async () => {
    ({ server, port } = await createMockServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body, headers: req.headers });

        if (req.url.includes('/status/start')) {
          jsonResponse(res, 'UPID:pve1:00001234:00000000:12345678:qmstart:100:root@pam:');
        } else if (req.url.includes('/dns')) {
          jsonResponse(res, null);
        } else if (req.url.includes('/qemu/999')) {
          jsonResponse(res, 'UPID:pve1:delete');
        } else {
          jsonResponse(res, null);
        }
      });
    }));

    client = new ProxmoxClient('127.0.0.1', {
      port,
      scheme: 'http',
      tokenId: 'root@pam!test',
      tokenSecret: 'test-secret',
    });
  });

  afterAll(() => server.close());

  test('POST start VM returns UPID', async () => {
    const upid = await client.startQemu('pve1', 100);
    expect(upid).toContain('UPID');
  });

  test('PUT update DNS', async () => {
    await client.updateNodeDns('pve1', { search: 'example.com', dns1: '8.8.8.8' });
    const req = requests.find((r) => r.url.includes('/dns'));
    expect(req.method).toBe('PUT');
    expect(req.body).toContain('search=example.com');
  });

  test('DELETE VM', async () => {
    const upid = await client.deleteQemu('pve1', 999);
    expect(upid).toContain('UPID');
    const req = requests.find((r) => r.method === 'DELETE');
    expect(req.url).toContain('/qemu/999');
  });
});

// ── Error handling ───────────────────────────────────────────────────

describe('Error handling', () => {
  let server, port, client;

  beforeAll(async () => {
    ({ server, port } = await createMockServer((req, res) => {
      if (req.url.includes('/fail-json')) {
        const body = JSON.stringify({
          errors: { vmid: 'value does not look like a valid VM ID' },
        });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      if (req.url.includes('/fail-text')) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }
      jsonResponse(res, null);
    }));

    client = new ProxmoxClient('127.0.0.1', {
      port,
      scheme: 'http',
      tokenId: 'root@pam!test',
      tokenSecret: 'test-secret',
    });
  });

  afterAll(() => server.close());

  test('JSON error response throws ProxmoxError with details', async () => {
    try {
      await client.get('/fail-json');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProxmoxError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('vmid');
    }
  });

  test('Non-JSON error response throws ProxmoxError', async () => {
    try {
      await client.get('/fail-text');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProxmoxError);
      expect(err.statusCode).toBe(500);
    }
  });

  test('Connection refused throws ProxmoxError', async () => {
    const badClient = new ProxmoxClient('127.0.0.1', {
      port: 1, // won't connect
      scheme: 'http',
      tokenId: 'root@pam!test',
      tokenSecret: 'test-secret',
      timeout: 2000,
    });
    await expect(badClient.get('/nodes')).rejects.toThrow(ProxmoxError);
  });
});

// ── VMID validation ──────────────────────────────────────────────────

describe('VMID validation', () => {
  let server, port, client;

  beforeAll(async () => {
    ({ server, port } = await createMockServer((req, res) => {
      jsonResponse(res, { safe: true, url: req.url });
    }));
    client = new ProxmoxClient('127.0.0.1', {
      port, scheme: 'http',
      tokenId: 'root@pam!test', tokenSecret: 'test',
    });
  });

  afterAll(() => server.close());

  test('rejects path-traversal vmid', async () => {
    await expect(client.getQemuConfig('pve1', '100/../../access/users'))
      .rejects.toThrow('Invalid VMID');
  });

  test('rejects non-numeric vmid', async () => {
    await expect(client.startQemu('pve1', 'abc'))
      .rejects.toThrow('Invalid VMID');
  });

  test('rejects negative vmid', async () => {
    await expect(client.getLxcConfig('pve1', -5))
      .rejects.toThrow('Invalid VMID');
  });

  test('accepts numeric string vmid', async () => {
    const result = await client.getQemuConfig('pve1', '100');
    expect(result).toBeDefined();
  });

  test('accepts integer vmid', async () => {
    const result = await client.getQemuConfig('pve1', 100);
    expect(result).toBeDefined();
  });
});

// ── Login race condition ─────────────────────────────────────────────

describe('Concurrent login', () => {
  let server, port, client, loginCount;

  beforeAll(async () => {
    loginCount = 0;
    ({ server, port } = await createMockServer((req, res) => {
      if (req.url === '/api2/json/access/ticket' && req.method === 'POST') {
        loginCount++;
        req.on('data', () => {});
        req.on('end', () => {
          jsonResponse(res, {
            ticket: 'PVE:root@pam:TICKET',
            CSRFPreventionToken: 'CSRF',
          });
        });
        return;
      }
      jsonResponse(res, [{ node: 'pve1' }]);
    }));

    client = new ProxmoxClient('127.0.0.1', {
      port, scheme: 'http',
      username: 'root', password: 'test', realm: 'pam',
    });
  });

  afterAll(() => server.close());

  test('concurrent requests only trigger one login', async () => {
    const results = await Promise.all([
      client.getNodes(),
      client.getNodes(),
      client.getNodes(),
    ]);
    expect(results).toHaveLength(3);
    expect(loginCount).toBe(1);
  });
});

// ── ProxmoxError ─────────────────────────────────────────────────────

describe('ProxmoxError', () => {
  test('has correct properties', () => {
    const err = new ProxmoxError('test error', {
      statusCode: 403,
      endpoint: '/access/ticket',
      method: 'POST',
    });
    expect(err.name).toBe('ProxmoxError');
    expect(err.statusCode).toBe(403);
    expect(err.endpoint).toBe('/access/ticket');
    expect(err.method).toBe('POST');
    expect(err.message).toBe('test error');
    expect(err instanceof Error).toBe(true);
  });
});
