import { parentPort, workerData } from 'node:worker_threads';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  RELEASE_SYNC,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
} from 'quickjs-emscripten';

const port = parentPort!;
const { code, discovery, timeoutMs } = workerData as {
  code: string;
  discovery?: { spec: unknown; operations: unknown };
  timeoutMs: number;
};
const deadline = Date.now() + timeoutMs;
const sourceLines = code.split('\n');
const userLineCount = code.split(/\r\n|[\n\r\u2028\u2029]/u).length;
// QuickJS's allocator budget does not account for every backing store. Cap the
// WASM linear memory as well: 256 initial / 1024 maximum 64-KiB pages.
const qjs = await newQuickJSWASMModuleFromVariant(
  newVariant(RELEASE_SYNC, {
    wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
  }),
);
const runtime = qjs.newRuntime();
runtime.setMemoryLimit(32 * 1024 * 1024);
runtime.setMaxStackSize(512 * 1024);
runtime.setInterruptHandler(() => Date.now() >= deadline);
const vm = runtime.newContext();
const pending = new Map<number, QuickJSDeferredPromise>();
let next = 0;
let wake: (() => void) | undefined;
const replies: Array<{
  id: number;
  json?: string;
  error?: {
    code: string;
    message: string;
    operation: string;
    status?: number;
    details?: unknown;
  };
}> = [];
port.on('message', (message) => {
  replies.push(message);
  const notify = wake;
  wake = undefined;
  notify?.();
});
const bridge = vm.newFunction('__call', (name, args) => {
  const deferred = vm.newPromise(),
    id = ++next;
  pending.set(id, deferred);
  port.postMessage({
    type: 'call',
    id,
    name: vm.getString(name),
    args: vm.getString(args),
  });
  return deferred.handle.dup();
});
vm.setProp(vm.global, '__call', bridge);
bridge.dispose();
// Capture intrinsics before guest code can mutate them. Inspect only data
// descriptors, never stringify an arbitrary thrown object or invoke its getters.
const describe = vm.unwrapResult(
  vm.evalCode(`(() => {
  const own=Object.getOwnPropertyDescriptor, proto=Object.getPrototypeOf;
  const create=Object.create, stringify=JSON.stringify;
  const slice=Function.prototype.call.bind(String.prototype.slice);
  const match=Function.prototype.call.bind(RegExp.prototype.exec);
  function field(value,key) {
    for(let i=0;value!==null && (typeof value==='object'||typeof value==='function') && i<8;i++,value=proto(value)) {
      const d=own(value,key); if(d) {const data=own(d,'value');return data && typeof data.value==='string'?data.value:undefined;}
    }
  }
  return error => {
    const result=create(null);
    result.name=slice(field(error,'name')||'Error',0,80);
    result.message=slice(field(error,'message')||(typeof error==='string'?error:'Guest code threw a value.'),0,1024);
    const operation=field(error,'operation');
    if(operation) result.operation=slice(operation,0,64);
    const frame=match(/tamperbox-code\\.js:(\\d+)(?::(\\d+))?/,slice(field(error,'stack')||'',0,4096));
    if(frame) {result.sourceLine=+frame[1];result.sourceColumn=+(frame[2]||1);}
    return stringify(result);
  };
})()`),
);
const makeError = vm.unwrapResult(
  vm.evalCode(`(() => {
  const parse=JSON.parse, ErrorCtor=Error, define=Object.defineProperty;
  const own=Object.getOwnPropertyDescriptor, create=Object.create;
  return raw => {
    const data=parse(raw), error=new ErrorCtor(data.message);
    for(let i=0;i<4;i++) {
      const key=i===0?'code':i===1?'status':i===2?'details':'operation';
      if(own(data,key)) {
        const descriptor=create(null);
        descriptor.value=data[key];descriptor.enumerable=true;
        define(error,key,descriptor);
      }
    }
    return error;
  };
})()`),
);
function report(error: QuickJSHandle, parsing = false) {
  if (Date.now() >= deadline) {
    port.postMessage({ type: 'error', code: 'execution_timeout' });
    return;
  }
  const diagnostic = vm.callFunction(describe, vm.undefined, error);
  if (diagnostic.error) {
    diagnostic.error.dispose();
    port.postMessage({
      type: 'error',
      code: Date.now() >= deadline ? 'execution_timeout' : 'execution_error',
    });
    return;
  }
  try {
    const { sourceLine, sourceColumn, ...details } = JSON.parse(
      vm.getString(diagnostic.value),
    ) as {
      sourceLine?: number;
      sourceColumn?: number;
      name: string;
      message: string;
      line?: number;
      operation?: string;
    };
    // QuickJS counts LF lines and Unicode code-point columns. Map its location
    // back to all JavaScript line terminators without changing literal contents.
    const index = (sourceLine ?? 0) - 2;
    if (index >= 0 && index < sourceLines.length) {
      const prefix =
        (index ? sourceLines.slice(0, index).join('\n') + '\n' : '') +
        Array.from(sourceLines[index]!)
          .slice(0, Math.max(0, (sourceColumn ?? 1) - 1))
          .join('');
      details.line = prefix.split(/\r\n|[\n\r\u2028\u2029]/u).length;
    } else if (parsing && index >= sourceLines.length) {
      // An incomplete expression can fail on the wrapper's closing line. Only
      // clamp parse errors; runtime serialization errors are not authored code.
      details.line = userLineCount;
    }
    port.postMessage({
      type: 'error',
      code: 'execution_error',
      details,
    });
  } finally {
    diagnostic.value.dispose();
  }
}
try {
  if (discovery) {
    vm.unwrapResult(
      vm.evalCode(`(() => {
      delete globalThis.__call;
      const freeze = value => {if(value && typeof value === 'object') {for(const item of Object.values(value)) freeze(item); Object.freeze(value);}return value;};
      const data = JSON.parse(${JSON.stringify(JSON.stringify(discovery))});
      Object.defineProperty(globalThis, 'spec', {value:freeze(data.spec)});
      Object.defineProperty(globalThis, 'operations', {value:freeze(data.operations)});
    })()`),
    ).dispose();
  } else
    vm.unwrapResult(
      vm.evalCode(`
    globalThis.tamperbox = (() => {
      const call = __call, stringify = JSON.stringify, parse = JSON.parse;
      const TypeErrorCtor = TypeError;
      delete globalThis.__call;
      const tools = Object.create(null);
      tools.request = async (args) => {
        const json = stringify(args);
        if (json === undefined) throw new TypeErrorCtor('Arguments to tamperbox.request must serialize to JSON.');
        return parse(await call('request', json));
      };
      return Object.freeze(tools);
    })();
  `),
    ).dispose();
  // The author's first line is line two of the synthetic guest filename.
  const evaluation = vm.evalCode(
    `(async()=>{ const value=await (async()=>{\n${code}\n})(); return JSON.stringify(value===undefined?null:value,(_k,v)=>{if(typeof v==='number'&&!Number.isFinite(v))throw new TypeError('Return finite JSON numbers.');if(typeof v==='function'||typeof v==='symbol')throw new TypeError('Return a JSON-compatible value.');return v;}); })()`,
    'tamperbox-code.js',
  );
  if (evaluation.error) {
    report(evaluation.error, true);
    evaluation.error.dispose();
  } else {
    const main = evaluation.value;
    try {
      while (true) {
        if (Date.now() >= deadline) {
          port.postMessage({ type: 'error', code: 'execution_timeout' });
          break;
        }
        for (const reply of replies.splice(0)) {
          const deferred = pending.get(reply.id);
          if (!deferred) continue;
          if (reply.error) {
            const raw = vm.newString(JSON.stringify(reply.error));
            try {
              const value = vm.callFunction(makeError, vm.undefined, raw);
              if (value.error) {
                deferred.reject(value.error);
                value.error.dispose();
              } else {
                deferred.reject(value.value);
                value.value.dispose();
              }
            } finally {
              raw.dispose();
            }
          } else {
            const value = vm.newString(reply.json!);
            deferred.resolve(value);
            value.dispose();
          }
          deferred.dispose();
          pending.delete(reply.id);
        }
        const jobs = runtime.executePendingJobs(100);
        if (jobs.error) {
          report(jobs.error);
          jobs.error.dispose();
          break;
        }
        const state = vm.getPromiseState(main);
        if (state.type === 'rejected') {
          report(state.error);
          state.error.dispose();
          break;
        }
        if (state.type === 'fulfilled') {
          const json = vm.getString(state.value);
          state.value.dispose();
          port.postMessage(
            Buffer.byteLength(json) > 2097152
              ? { type: 'error', code: 'output_size' }
              : { type: 'result', json },
          );
          break;
        }
        if (runtime.hasPendingJob())
          await new Promise<void>((resolve) => setImmediate(resolve));
        else if (replies.length === 0)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        // Pending I/O wakes via the port. The parent timer terminates a guest
        // whose promises never settle, so there is no idle polling timer.
      }
    } finally {
      main.dispose();
    }
  }
} catch {
  port.postMessage({
    type: 'error',
    code: Date.now() >= deadline ? 'execution_timeout' : 'execution_error',
  });
} finally {
  for (const deferred of pending.values()) deferred.dispose();
  describe.dispose();
  makeError.dispose();
  vm.dispose();
  runtime.dispose();
  port.close();
}
