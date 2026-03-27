import https from 'node:https';
import http from 'node:http';
import { URLSearchParams } from 'node:url';

/**
 * Error class for Proxmox API errors.
 */
export class ProxmoxError extends Error {
  constructor(message, { statusCode, endpoint, method, data } = {}) {
    super(message);
    this.name = 'ProxmoxError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.method = method;
    this.data = data;
  }
}

/** Validate and coerce a VMID to a safe integer string. */
function safeVmid(vmid) {
  const n = Number(vmid);
  if (!Number.isInteger(n) || n < 1) {
    throw new ProxmoxError(`Invalid VMID: ${vmid} (must be a positive integer)`);
  }
  return String(n);
}

/**
 * Modern Proxmox VE API client.
 *
 * Supports both ticket-based (username/password) and API token authentication.
 * Compatible with Proxmox VE 7.x and 8.x.
 */
export class ProxmoxClient {
  #hostname;
  #port;
  #scheme;
  #tokenId;
  #tokenSecret;
  #username;
  #password;
  #realm;
  #ticket;
  #csrfToken;
  #ticketExpiry;
  #rejectUnauthorized;
  #timeout;
  #basePath;
  #loginPromise;

  /**
   * @param {string} hostname - Proxmox host (IP or FQDN)
   * @param {object} options
   * @param {number}  [options.port=8006]             - API port
   * @param {string}  [options.scheme='https']        - 'https' or 'http'
   * @param {string}  [options.tokenId]               - API token ID (USER@REALM!TOKENID)
   * @param {string}  [options.tokenSecret]           - API token secret (UUID)
   * @param {string}  [options.username]               - Username for ticket auth
   * @param {string}  [options.password]               - Password for ticket auth
   * @param {string}  [options.realm='pam']            - Authentication realm
   * @param {boolean} [options.rejectUnauthorized=false] - Reject self-signed TLS certs
   * @param {number}  [options.timeout=30000]          - Request timeout in ms
   */
  constructor(hostname, options = {}) {
    if (!hostname) throw new ProxmoxError('hostname is required');

    this.#hostname = hostname;
    this.#port = options.port ?? 8006;
    this.#scheme = options.scheme ?? 'https';
    this.#tokenId = options.tokenId;
    this.#tokenSecret = options.tokenSecret;
    this.#username = options.username;
    this.#password = options.password;
    this.#realm = options.realm ?? 'pam';
    this.#rejectUnauthorized = options.rejectUnauthorized ?? false;
    this.#timeout = options.timeout ?? 30_000;
    this.#basePath = '/api2/json';
    this.#ticket = null;
    this.#csrfToken = null;
    this.#ticketExpiry = 0;
    this.#loginPromise = null;

    const hasToken = this.#tokenId && this.#tokenSecret;
    const hasCredentials = this.#username && this.#password;

    if (!hasToken && !hasCredentials) {
      throw new ProxmoxError(
        'Either tokenId+tokenSecret or username+password must be provided'
      );
    }
  }

  /** True when using API token auth (no ticket refresh needed). */
  get isTokenAuth() {
    return !!(this.#tokenId && this.#tokenSecret);
  }

  // ── Authentication ────────────────────────────────────────────────

  /**
   * Authenticate with username/password and obtain a ticket.
   * Called automatically on first request when using password auth.
   */
  async login() {
    if (this.isTokenAuth) return;

    // Prevent concurrent login attempts — reuse the in-flight promise
    if (this.#loginPromise) return this.#loginPromise;

    this.#loginPromise = this.#doLogin();
    try {
      await this.#loginPromise;
    } finally {
      this.#loginPromise = null;
    }
  }

  async #doLogin() {
    const body = new URLSearchParams({
      username: `${this.#username}@${this.#realm}`,
      password: this.#password,
    });

    const data = await this.#rawRequest('POST', '/access/ticket', body.toString(), {
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    if (!data?.ticket) {
      throw new ProxmoxError('Login failed: no ticket returned');
    }

    this.#ticket = data.ticket;
    this.#csrfToken = data.CSRFPreventionToken;
    // Proxmox tickets are valid for 2 hours; refresh after 1h50m for safety
    this.#ticketExpiry = Date.now() + 110 * 60 * 1000;
  }

  /** Ensure we have a valid auth ticket (refreshes if expired). */
  async #ensureAuth() {
    if (this.isTokenAuth) return;
    if (Date.now() >= this.#ticketExpiry) {
      await this.login();
    }
  }

  // ── Core HTTP methods ─────────────────────────────────────────────

  async get(path, params) {
    return this.#request('GET', path, params);
  }

  async post(path, data) {
    return this.#request('POST', path, data);
  }

  async put(path, data) {
    return this.#request('PUT', path, data);
  }

  async del(path, data) {
    return this.#request('DELETE', path, data);
  }

  // ── Nodes ─────────────────────────────────────────────────────────

  /** List all cluster nodes. */
  async getNodes() {
    return this.get('/nodes');
  }

  /** Get status of a specific node. */
  async getNodeStatus(node) {
    return this.get(`/nodes/${encodeURIComponent(node)}/status`);
  }

  // ── QEMU VMs ──────────────────────────────────────────────────────

  /** List VMs on a node. */
  async getQemu(node) {
    return this.get(`/nodes/${encodeURIComponent(node)}/qemu`);
  }

  /** Get VM config. */
  async getQemuConfig(node, vmid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/config`);
  }

  /** Get VM status (current runtime info). */
  async getQemuStatus(node, vmid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/status/current`);
  }

  /** Create a new VM. */
  async createQemu(node, config) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu`, config);
  }

  /** Update VM config. */
  async updateQemuConfig(node, vmid, config) {
    return this.put(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/config`, config);
  }

  /** Delete a VM. */
  async deleteQemu(node, vmid, params) {
    return this.del(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}`, params);
  }

  /** Start a VM. */
  async startQemu(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/status/start`);
  }

  /** Stop a VM. */
  async stopQemu(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/status/stop`);
  }

  /** Shutdown a VM (ACPI). */
  async shutdownQemu(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/status/shutdown`);
  }

  /** Reboot a VM (ACPI). */
  async rebootQemu(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/status/reboot`);
  }

  /** Reset a VM. */
  async resetQemu(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/status/reset`);
  }

  /** Suspend a VM. */
  async suspendQemu(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/status/suspend`);
  }

  /** Resume a VM. */
  async resumeQemu(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/status/resume`);
  }

  /** Clone a VM. */
  async cloneQemu(node, vmid, params) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/clone`, params);
  }

  /** Migrate a VM to another node. */
  async migrateQemu(node, vmid, params) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/migrate`, params);
  }

  /** Create a snapshot of a VM. */
  async snapshotQemu(node, vmid, params) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/snapshot`, params);
  }

  /** List snapshots of a VM. */
  async listQemuSnapshots(node, vmid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/snapshot`);
  }

  /** Execute a QEMU guest agent command. */
  async qemuAgentExec(node, vmid, params) {
    return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/agent/exec`, params);
  }

  /** Get QEMU guest agent exec status. */
  async qemuAgentExecStatus(node, vmid, pid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/agent/exec-status`, { pid });
  }

  // ── LXC Containers ───────────────────────────────────────────────

  /** List containers on a node. */
  async getLxc(node) {
    return this.get(`/nodes/${encodeURIComponent(node)}/lxc`);
  }

  /** Get container config. */
  async getLxcConfig(node, vmid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/config`);
  }

  /** Get container status. */
  async getLxcStatus(node, vmid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/status/current`);
  }

  /** Create a new container. */
  async createLxc(node, config) {
    return this.post(`/nodes/${encodeURIComponent(node)}/lxc`, config);
  }

  /** Update container config. */
  async updateLxcConfig(node, vmid, config) {
    return this.put(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/config`, config);
  }

  /** Delete a container. */
  async deleteLxc(node, vmid, params) {
    return this.del(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}`, params);
  }

  /** Start a container. */
  async startLxc(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/status/start`);
  }

  /** Stop a container. */
  async stopLxc(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/status/stop`);
  }

  /** Shutdown a container. */
  async shutdownLxc(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/status/shutdown`);
  }

  /** Reboot a container. */
  async rebootLxc(node, vmid) {
    return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/status/reboot`);
  }

  /** Clone a container. */
  async cloneLxc(node, vmid, params) {
    return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/clone`, params);
  }

  /** Migrate a container to another node. */
  async migrateLxc(node, vmid, params) {
    return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/migrate`, params);
  }

  /** Create a snapshot of a container. */
  async snapshotLxc(node, vmid, params) {
    return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/snapshot`, params);
  }

  /** List snapshots of a container. */
  async listLxcSnapshots(node, vmid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/snapshot`);
  }

  // ── Storage ───────────────────────────────────────────────────────

  /** List storage pools. */
  async getStorage() {
    return this.get('/storage');
  }

  /** Get storage config. */
  async getStorageConfig(storage) {
    return this.get(`/storage/${encodeURIComponent(storage)}`);
  }

  /** List storage content on a node. */
  async getNodeStorage(node, storage) {
    return this.get(`/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`);
  }

  /** Get storage status on a node. */
  async getNodeStorageStatus(node, storage) {
    return this.get(`/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/status`);
  }

  // ── Cluster ───────────────────────────────────────────────────────

  /** Get cluster status. */
  async getClusterStatus() {
    return this.get('/cluster/status');
  }

  /** Get cluster resources. */
  async getClusterResources(type) {
    const params = type ? { type } : undefined;
    return this.get('/cluster/resources', params);
  }

  /** Get next free VMID in the cluster. */
  async getClusterNextId() {
    return this.get('/cluster/nextid');
  }

  /** Get cluster options. */
  async getClusterOptions() {
    return this.get('/cluster/options');
  }

  /** Get cluster log. */
  async getClusterLog(params) {
    return this.get('/cluster/log', params);
  }

  // ── Tasks ─────────────────────────────────────────────────────────

  /** List tasks on a node. */
  async getNodeTasks(node, params) {
    return this.get(`/nodes/${encodeURIComponent(node)}/tasks`, params);
  }

  /** Get task status. */
  async getTaskStatus(node, upid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`);
  }

  /** Get task log. */
  async getTaskLog(node, upid, params) {
    return this.get(`/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/log`, params);
  }

  /** Stop a running task. */
  async stopTask(node, upid) {
    return this.del(`/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}`);
  }

  /**
   * Wait for a task to complete.
   * @param {string} node
   * @param {string} upid
   * @param {object} [options]
   * @param {number} [options.interval=2000] - Poll interval in ms
   * @param {number} [options.timeout=300000] - Max wait time in ms (default 5 min)
   * @returns {Promise<object>} Final task status
   */
  async waitForTask(node, upid, { interval = 2000, timeout = 300_000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const status = await this.getTaskStatus(node, upid);
      if (status.status === 'stopped') return status;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new ProxmoxError(`Task ${upid} did not complete within ${timeout}ms`);
  }

  // ── Access / Users / Pools ────────────────────────────────────────

  /** List users. */
  async getUsers(params) {
    return this.get('/access/users', params);
  }

  /** Get user details. */
  async getUser(userid) {
    return this.get(`/access/users/${encodeURIComponent(userid)}`);
  }

  /** List access domains/realms. */
  async getRealms() {
    return this.get('/access/domains');
  }

  /** List roles. */
  async getRoles() {
    return this.get('/access/roles');
  }

  /** List ACLs. */
  async getAcl() {
    return this.get('/access/acl');
  }

  /** List pools. */
  async getPools() {
    return this.get('/pools');
  }

  /** Get pool config. */
  async getPool(poolid) {
    return this.get(`/pools/${encodeURIComponent(poolid)}`);
  }

  /** Create a pool. */
  async createPool(poolid, comment) {
    return this.post('/pools', { poolid, comment });
  }

  /** Delete a pool. */
  async deletePool(poolid) {
    return this.del(`/pools/${encodeURIComponent(poolid)}`);
  }

  // ── Network ───────────────────────────────────────────────────────

  /** List network interfaces on a node. */
  async getNodeNetwork(node, params) {
    return this.get(`/nodes/${encodeURIComponent(node)}/network`, params);
  }

  /** Get node DNS settings. */
  async getNodeDns(node) {
    return this.get(`/nodes/${encodeURIComponent(node)}/dns`);
  }

  /** Update node DNS settings. */
  async updateNodeDns(node, config) {
    return this.put(`/nodes/${encodeURIComponent(node)}/dns`, config);
  }

  // ── Firewall ──────────────────────────────────────────────────────

  /** Get cluster firewall rules. */
  async getClusterFirewallRules() {
    return this.get('/cluster/firewall/rules');
  }

  /** Get node firewall rules. */
  async getNodeFirewallRules(node) {
    return this.get(`/nodes/${encodeURIComponent(node)}/firewall/rules`);
  }

  /** Get VM firewall rules. */
  async getQemuFirewallRules(node, vmid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/qemu/${safeVmid(vmid)}/firewall/rules`);
  }

  /** Get container firewall rules. */
  async getLxcFirewallRules(node, vmid) {
    return this.get(`/nodes/${encodeURIComponent(node)}/lxc/${safeVmid(vmid)}/firewall/rules`);
  }

  // ── Backup ────────────────────────────────────────────────────────

  /** List backup jobs. */
  async getBackupJobs() {
    return this.get('/cluster/backup');
  }

  /** Get backup job config. */
  async getBackupJob(id) {
    return this.get(`/cluster/backup/${encodeURIComponent(id)}`);
  }

  /** Create a backup job. */
  async createBackupJob(config) {
    return this.post('/cluster/backup', config);
  }

  // ── SDN (Software Defined Network, PVE 7+/8+) ────────────────────

  /** List SDN zones. */
  async getSdnZones() {
    return this.get('/cluster/sdn/zones');
  }

  /** List SDN VNets. */
  async getSdnVnets() {
    return this.get('/cluster/sdn/vnets');
  }

  /** List SDN controllers. */
  async getSdnControllers() {
    return this.get('/cluster/sdn/controllers');
  }

  /** Apply pending SDN changes. */
  async applySdn() {
    return this.put('/cluster/sdn');
  }

  // ── Version ───────────────────────────────────────────────────────

  /** Get Proxmox VE version info. */
  async getVersion() {
    return this.get('/version');
  }

  // ── Internal request machinery ────────────────────────────────────

  async #request(method, path, data) {
    await this.#ensureAuth();

    const headers = {};

    if (this.isTokenAuth) {
      headers['Authorization'] = `PVEAPIToken=${this.#tokenId}=${this.#tokenSecret}`;
    } else {
      headers['Cookie'] = `PVEAuthCookie=${this.#ticket}`;
      if (method !== 'GET') {
        headers['CSRFPreventionToken'] = this.#csrfToken;
      }
    }

    let body;
    if (method === 'GET' && data) {
      const qs = new URLSearchParams(data).toString();
      path = qs ? `${path}?${qs}` : path;
    } else if (data && method !== 'GET') {
      body = new URLSearchParams(data).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    return this.#rawRequest(method, path, body, headers);
  }

  #rawRequest(method, path, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const transport = this.#scheme === 'https' ? https : http;

      const headers = { ...extraHeaders };
      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const options = {
        hostname: this.#hostname,
        port: this.#port,
        path: `${this.#basePath}${path}`,
        method,
        headers,
        rejectUnauthorized: this.#rejectUnauthorized,
        timeout: this.#timeout,
      };

      const req = transport.request(options, (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { chunks += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(chunks);

            if (res.statusCode >= 400) {
              const errMsg = parsed.errors
                ? Object.entries(parsed.errors).map(([k, v]) => `${k}: ${v}`).join(', ')
                : parsed.message || `HTTP ${res.statusCode}`;
              reject(new ProxmoxError(errMsg, {
                statusCode: res.statusCode,
                endpoint: path,
                method,
                data: parsed,
              }));
              return;
            }

            resolve(parsed.data !== undefined ? parsed.data : parsed);
          } catch {
            if (res.statusCode >= 400) {
              reject(new ProxmoxError(`HTTP ${res.statusCode}: ${chunks}`, {
                statusCode: res.statusCode,
                endpoint: path,
                method,
              }));
            } else {
              resolve(chunks);
            }
          }
        });
      });

      req.on('error', (err) => {
        reject(new ProxmoxError(`Request failed: ${err.message}`, {
          endpoint: path,
          method,
        }));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new ProxmoxError(`Request timed out after ${this.#timeout}ms`, {
          endpoint: path,
          method,
        }));
      });

      if (body) req.write(body);
      req.end();
    });
  }
}
