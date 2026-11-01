import {bumblerConfigControls} from './bumbler-config-controls.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
console.log(JSON.stringify(bumblerConfigControls()));
