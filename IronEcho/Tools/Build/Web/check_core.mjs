// Proves the browser core is the native core: same input script -> same state hashes.
//   node check_core.mjs <ironecho_core.wasm> <ironecho_core.js> <script.bin> [native-output.txt]
// The .js is the wasm2js fallback (classic script defining globalThis.IronEchoCoreJS).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [wasmPath, jsPath, scriptPath, nativePath] = process.argv.slice(2);

function run(exports, input) {
  const mem = () => exports.memory.buffer;
  exports._initialize && exports._initialize();
  const h = new Float64Array(input.buffer, input.byteOffset, input.length);
  exports.ie_init(h[0] | 0, h[1] | 0, h[2], h[3] | 0, h[4]);
  const frames = h[5] | 0;
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  const mix = (ptr, count) => {
    const bytes = new Uint8Array(mem(), ptr, count * 8);
    for (let i = 0; i < bytes.length; i++) {
      hash ^= BigInt(bytes[i]);
      hash = (hash * prime) & mask;
    }
  };
  const lines = [];
  for (let f = 0; f < frames; f++) {
    const o = 6 + f * 7;
    exports.ie_frame(h[o], h[o + 1] | 0, 1.0, h[o + 2], 0.0, h[o + 3], h[o + 4] | 0, 1.0, h[o + 5], h[o + 6]);
    mix(exports.ie_state(), exports.ie_state_size());
    mix(exports.ie_combat_events(), exports.ie_combat_event_count() * exports.ie_combat_event_size());
    exports.ie_clear_events();
    if ((f + 1) % 60 === 0) lines.push(`${f + 1} ${hash.toString(16).padStart(16, '0')}`);
  }
  lines.push(`final ${hash.toString(16).padStart(16, '0')}`);
  return lines;
}

const input = new Uint8Array(readFileSync(scriptPath));
const copy = () => new Float64Array(input.slice().buffer);

const wasm = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const viaWasm = run(wasm.instance.exports, copy());

const sandbox = { globalThis: {} };
sandbox.self = sandbox.globalThis;
vm.createContext(sandbox);
vm.runInContext(readFileSync(jsPath, 'utf8'), sandbox);
const viaJs = run(sandbox.globalThis.IronEchoCoreJS, copy());

let ok = JSON.stringify(viaWasm) === JSON.stringify(viaJs);
console.log(`wasm  final: ${viaWasm.at(-1)}`);
console.log(`js    final: ${viaJs.at(-1)}`);
if (nativePath) {
  const native = readFileSync(nativePath, 'utf8').trim().split('\n');
  console.log(`native final: ${native.at(-1)}`);
  ok = ok && JSON.stringify(native) === JSON.stringify(viaWasm);
}
console.log(ok ? 'IDENTICAL' : 'MISMATCH');
process.exit(ok ? 0 : 1);
