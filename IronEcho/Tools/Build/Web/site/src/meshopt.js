// Camera build only: robots ship meshopt-compressed (EXT_meshopt_compression) to fit the single-file page.
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

globalThis.IRONECHO_MESHOPT = MeshoptDecoder;
