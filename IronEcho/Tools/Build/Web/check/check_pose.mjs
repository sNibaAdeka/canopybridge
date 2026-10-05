// Replays the Python tracker's reference sessions (pose_reference.py) through the browser port (site/src/pose.js)
// and checks that punch events match exactly and block / lean agree once both are calibrated.
//   node check_pose.mjs reference.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'site', 'src', 'pose.js'), 'utf8');
const { PoseProcessor } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const sessions = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let ok = true;
for (const s of sessions) {
  const proc = new PoseProcessor();
  let maxBlock = 0;
  let maxLean = 0;
  let compared = 0;
  s.frames.forEach((f, i) => {
    const world = f.world ? f.world.map(([x, y, z, visibility]) => ({ x, y, z, visibility })) : null;
    proc.process(world, f.t);
    const [, pyCal, pyBlock, pyLean] = s.continuous[i];
    if (pyCal && proc.cal) {
      compared++;
      maxBlock = Math.max(maxBlock, Math.abs(proc.block - pyBlock));
      maxLean = Math.max(maxLean, Math.abs(proc.lean - pyLean));
    }
  });
  const js = proc.punches.map(([t, side]) => `${t.toFixed(4)}:${side}`);
  const py = s.punches.map(([t, side]) => `${t.toFixed(4)}:${side}`);
  const same = JSON.stringify(js) === JSON.stringify(py);
  const close = maxBlock < 1e-4 && maxLean < 1e-4; // reference values are rounded to 5 decimals
  console.log(`${s.name}: punches js=${js.length} py=${py.length} ${same ? 'IDENTICAL' : 'DIFFERENT'}; block/lean max diff ${maxBlock.toExponential(1)}/${maxLean.toExponential(1)} over ${compared} frames`);
  if (!same) console.log('  js', js.join(' '), '\n  py', py.join(' '));
  ok = ok && same && close && compared > 0 && js.length > 0;
}
console.log(ok ? 'POSE PORT MATCHES THE TRACKER' : 'MISMATCH');
process.exit(ok ? 0 : 1);
