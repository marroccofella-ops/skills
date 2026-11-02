// Registry exclusions cannot reduce caller quorum or manufacture votes from duplicate profiles.
import fs from 'node:fs';
import path from 'node:path';
import {ReviewerRegistry,defaultRegistryHome} from './reviewer-registry.mjs';
// Presets and modality routing run after initial settings. Recheck the final
// list without silently replacing the owner's selection or lowering quorum.
export function assertReviewerSelection(options,{excluded=[],removed_from_selection=[]}={}){
  if(options.reviewers.some(route=>excluded.includes(route)))throw Error('A selected reviewer is excluded in saved settings. Restore it explicitly or choose a permitted selection before dispatch.');
  if(removed_from_selection.length&&new Set(options.reviewers.filter(route=>route!==options.governor)).size<(options.minSuccess??1))throw Error('Reviewer selection leaves insufficient external quorum. Restore distinct reviewers; the quorum was not lowered.');
}
function settingsPresent(root){
  try{fs.lstatSync(path.join(root,'registry.json'));return true;}
  catch(error){if(error?.code!=='ENOENT')throw error;}
  // ENOENT can also come from a dangling settings root or ancestor. Confirm
  // an existing directory before treating this as an unconfigured owner.
  let cursor=path.resolve(root);
  for(;;){
    let stat;
    try{stat=fs.lstatSync(cursor);}
    catch(error){if(error?.code!=='ENOENT')throw error;const parent=path.dirname(cursor);if(parent===cursor)throw Error('Settings ancestor could not be inspected');cursor=parent;continue;}
    if(stat.isSymbolicLink()){
      if(cursor===path.resolve(root))throw Error('Linked settings root could not be inspected');
      stat=fs.statSync(cursor); // A dangling ancestor must propagate refusal.
    }
    if(!stat.isDirectory())throw Error('Settings ancestor is not a directory');
    return false;
  }
}
export function applyReviewerSettings(options,{root=defaultRegistryHome(),project=process.cwd()}={}){
  if(options.preflight||options.doctor||options.capabilitiesMatrix)return {applied:false,excluded:[],reason:'read-only inventory, not dispatch'};
  let exists;
  try{exists=settingsPresent(root);}
  catch{throw Error('Saved reviewer settings could not be inspected. No review was dispatched.');}
  const state=exists?new ReviewerRegistry({root,project}).read():null;
  const excluded=state?.baseline_excluded||[];
  const requested=options.reviewers||[],available=[...new Set(requested.filter(route=>!excluded.includes(route)))];
  const removed=[...new Set(requested.filter(route=>excluded.includes(route)))];
  if(options.reviewersExplicit&&requested.some(route=>excluded.includes(route)))throw Error('A requested reviewer is excluded in saved settings. Restore it explicitly before dispatch.');
  const required=options.minSuccess??1;
  // Normalization never invents a new gate merely because settings exist.
  // The existing dispatcher retains its self_excluded row and structured
  // quorum_failed result. Refuse here only when saved removals reduced it.
  if(removed.length&&available.filter(route=>route!==options.governor).length<required)throw Error('Reviewer selection leaves insufficient external quorum. Restore distinct reviewers; the quorum was not lowered.');
  options.reviewers=available;
  return {applied:exists,excluded:[...excluded],removed_from_selection:removed,...(state?{registry_revision:state.revision}:{})};
}
