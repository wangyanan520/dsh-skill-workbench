// 宿主路由测试桥：直接调用真实的 makeRoutes，不 mock scanSkills，也不监听端口。
//
// 为什么不用 page-regression 的 fetch mock：那条路径只覆盖客户端渲染，所有非 /list
// 请求都返回 {}，保存/审核/脏检查/hash 四条写路径没有一条真的走到宿主。这里用
// loopback fake req/res 把请求送进真实 handler，夹具仍由 test/fixture.mjs 提供。
import { EventEmitter } from 'node:events';
import { makeRoutes } from '../host/routes.js';

const API_BASE = '/api/dsh-skill-workbench';

function makeRequest({ method = 'GET', url = '/', body, remoteAddress = '127.0.0.1', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = `${API_BASE}${url}`;
  req.socket = { remoteAddress };
  req.headers = { host: '127.0.0.1:61751', 'content-type': 'application/json', ...headers };
  req.destroy = () => {};
  const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  setImmediate(() => {
    if (payload) req.emit('data', payload);
    req.emit('end');
  });
  return req;
}

function makeResponse() {
  return {
    headersSent: false,
    status: 0,
    headers: null,
    bodyText: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(text) {
      this.bodyText = text === undefined || text === null ? '' : String(text);
    },
    destroy() {},
  };
}

/**
 * 创建可直接调用的宿主路由桥。
 * @param {{ctx?: object, config?: object, jobs?: object}} [options]
 * @returns {{routes: object[], call: Function, get: Function, post: Function}}
 */
export function createHarness({ ctx, config, jobs } = {}) {
  const routeCtx = ctx || { workingDirectory: { get: () => null } };
  const jobManager = jobs || { snapshot: () => [] };
  const routes = makeRoutes(routeCtx, { jobs: jobManager, config });
  const byPath = new Map(routes.map((route) => [route.path, route]));

  async function call(method, path, body, options = {}) {
    const [pathname] = String(path).split('?');
    const route = byPath.get(`${API_BASE}${pathname}`);
    if (!route) throw new Error(`route not found: ${method} ${pathname}`);
    const req = makeRequest({ method, url: path, body, ...options });
    const res = makeResponse();
    await route.handler(req, res);
    let json = null;
    try {
      json = res.bodyText ? JSON.parse(res.bodyText) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text: res.bodyText, headers: res.headers, req, res };
  }

  return {
    routes,
    call,
    get: (path, options) => call('GET', path, undefined, options),
    post: (path, body, options) => call('POST', path, body, options),
  };
}
