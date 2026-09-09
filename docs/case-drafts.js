const key=id=>`zhigou-case-draft:${id}`;
export function readCaseDraft(storage,id){try{const draft=JSON.parse(storage.getItem(key(id))||'null');return draft?.unitId===id&&draft.version===1?draft:null;}catch{return null;}}
export function writeCaseDraft(storage,id,draft){try{storage.setItem(key(id),JSON.stringify({...draft,unitId:id,version:1,at:Date.now()}));return true;}catch{return false;}}
export function compatibleCaseDraft(draft,unit,targets){
  if(!draft||draft.unitId!==unit.id)return {fields:{},reviews:{}};
  const fields={...(draft.fields||{})};
  if(draft.contextBase!==JSON.stringify(unit.teachingContext||{})){delete fields.audience;delete fields.scenario;}
  const reviews={};for(const target of targets){const saved=draft.reviews?.[target.id];if(saved?.fingerprint===target.fingerprint)reviews[target.id]=saved;}
  return {fields,reviews};
}
