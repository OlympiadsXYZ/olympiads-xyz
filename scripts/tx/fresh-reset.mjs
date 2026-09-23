// The batch.mjs --fresh reset for done-but-unpromoted API jobs (promote:false, paid checker): keep the old
// working dir aside as evidence and drop the job entry, so queue-start can open an agent-reader job.
import fs from 'node:fs';
import { paperDir, updateJobs, findContentFile } from './lib.mjs';
for (const id of process.argv.slice(2)) {
  if (findContentFile(id)) { console.log(`${id}: already in content/problems, left alone`); continue; }
  const dir = paperDir(id);
  const aside = `${dir}.superseded-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (fs.existsSync(dir)) fs.renameSync(dir, aside);
  updateJobs(state => { delete state.jobs[id]; });
  console.log(`${id}: job dropped; old dir kept at ${aside}`);
}
