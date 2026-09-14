// A discrepancy report is experimental evidence, never a publication receipt.
const object = properties => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text = {type:'string'};
export const CHECK_SCHEMA = object({
 schemaVersion:{type:'integer',enum:[1]},
 verdict:{type:'string',enum:['no-material-defect-found','needs-repair','cannot-verify']},
 inspectedBlockIds:{type:'array',items:text},
 issues:{type:'array',items:object({blockId:{type:['string','null']},category:{type:'string',enum:['omission','invention','math','wording','order','points','figure','normalization','uncertainty']},severity:{type:'string',enum:['critical','major','minor']},candidateText:text,sourceReading:text,sourceBbox:{type:'array',items:{type:'number'},minItems:4,maxItems:4},explanation:text})},
 uncertainties:{type:'array',items:text}
});

function candidateBlockIds(candidate) {
 const blocks=candidate?.blocks;
 if(!Array.isArray(blocks)||!blocks.length)return null;
 const ids=new Set();
 for(const block of blocks){
  if(!block||typeof block.id!=='string'||!block.id.trim()||ids.has(block.id))return null;
  ids.add(block.id);
 }
 return ids;
}

export function validateCheck(report,candidate) {
 const errors=[];
 if(!report||report.schemaVersion!==1||!CHECK_SCHEMA.properties.verdict.enum.includes(report.verdict)||!Array.isArray(report.inspectedBlockIds)||!Array.isArray(report.issues)||!Array.isArray(report.uncertainties))return ['invalid discrepancy report'];
 const ids=candidateBlockIds(candidate),seen=new Set(report.inspectedBlockIds);
 if(!ids)return ['invalid or duplicate candidate block identity'];
 if(!ids.size||seen.size!==report.inspectedBlockIds.length||seen.size!==ids.size||[...ids].some(id=>!seen.has(id)))errors.push('incomplete or duplicate block inspection');
 for(const issue of report.issues){
  const schema=CHECK_SCHEMA.properties.issues.items;
  if(!issue||Object.keys(issue).length!==schema.required.length||schema.required.some(k=>!Object.hasOwn(issue,k))){errors.push('invalid issue');continue;}
  if(issue.blockId!==null&&!ids.has(issue.blockId))errors.push('issue references unknown block');
  if(!schema.properties.category.enum.includes(issue.category)||!schema.properties.severity.enum.includes(issue.severity))errors.push('invalid issue category/severity');
  if(['candidateText','sourceReading','explanation'].some(k=>typeof issue[k]!=='string')||!issue.explanation?.trim())errors.push('missing issue evidence');
  const b=issue.sourceBbox;
  if(!Array.isArray(b)||b.length!==4||b.some(n=>!Number.isFinite(n)||n<0||n>1000)||b[0]>=b[2]||b[1]>=b[3])errors.push('invalid source evidence box');
 }
 if(report.uncertainties.some(u=>typeof u!=='string'||!u.trim()))errors.push('invalid uncertainty');
 if(report.verdict==='no-material-defect-found'&&(report.uncertainties.length||report.issues.some(i=>i?.severity!=='minor')))errors.push('passing verdict contradicts findings');
 if(report.verdict==='needs-repair'&&!report.issues.length)errors.push('repair verdict without located discrepancy');
 if(Object.keys(report).some(k=>!CHECK_SCHEMA.required.includes(k)))errors.push('unexpected report field');
 return errors;
}

export function bindCheckCandidate(item,candidate) {
 if(!candidateBlockIds(candidate?.page)||!candidate.item)throw Error('Checker requires a page draft with unique nonempty block IDs');
 for(const key of ['id','paperId','documentRole','sourcePdfSha256','imageSha256']){
  if(typeof item?.[key]!=='string'||!item[key].trim()||item[key]!==candidate.item[key])throw Error('Candidate/source mismatch: '+key);
 }
 if(!Number.isSafeInteger(item.pdfPage)||item.pdfPage<1||item.pdfPage!==candidate.item.pdfPage)throw Error('Candidate/source mismatch: pdfPage');
 // Old original-view plans may omit the transform, but an explicitly rotated
 // view must never silently bind to original-page coordinates.
 if((item.viewTransform??'original')!==(candidate.item.viewTransform??'original'))throw Error('Candidate/source mismatch: viewTransform');
 return candidate.page;
}
