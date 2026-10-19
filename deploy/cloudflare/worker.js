import { DurableObject } from 'cloudflare:workers';
import { ContainerProxy, edgeFetch } from './adapter.js';
export class TamperboxCodeMode extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.proxy = new ContainerProxy(ctx, env);
    ctx.blockConcurrencyWhile(() => this.proxy.restore());
  }
  fetch(request) {
    return this.proxy.fetch(request);
  }
  alarm() {
    return this.proxy.alarm();
  }
}
export default { fetch: edgeFetch };
