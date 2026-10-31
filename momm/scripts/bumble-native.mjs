// Native entry gate: called only after the original independent report is persisted.
// No prompt, worker response or caller flag can activate credential policy.
import {REMOTE_POLICY_ACTIVE} from './reviewer-registry.mjs';
import {BUMBLE_PEER_DEFAULT_ENABLED, BUMBLE_PEER_SCHEMA} from './bumble-peer-review.mjs';
// The unsigned synthetic shadow seam is not part of the native entry API.
// Signed host compositions are separate components; the default policy flag
// does not establish host qualification or govern arbitrary in-process callers.
// Explicit owner-host pilot composition, separate from default activation.
// It requires a pinned signed one-use plan and original sealed baseline.
export {createBumbleOAuthPilot} from './bumble-oauth-pilot.mjs';
export function nativeBumbleReadiness(){
  return {schema:'momm-bumble-native-readiness/1',policy_active:REMOTE_POLICY_ACTIVE,policy_scope:'default_native_entry',
    credentials_read:false,dispatched:0,qualified_workers:0,quorum_votes:0,
    baseline_order:'independent whole-piece reports sealed first',
    physical_capacity:'global owner-private reservation component; native binding pending',
    peer_contract:BUMBLE_PEER_SCHEMA,shadow_enabled:BUMBLE_PEER_DEFAULT_ENABLED,
    oauth_pilot:'signed_one_use_host_composition_available; host qualification required',
    shadow_status:'issued_key_route_retired; signed_oauth_host_unqualified',status:'policy_required',completion:false};
}
export async function runNativeBumbleStage(options){
  // Deliberately before dereferencing any caller-supplied credentials or hooks.
  if(!REMOTE_POLICY_ACTIVE)return {...nativeBumbleReadiness(),reason:'Native owner-approval broker and adapter qualification are not active. The development authentication direction does not activate a connector. No credentialed preflight or inference occurred.'};
  // An accepted future policy does not silently turn incomplete components live.
  // Cross-run reservation binding, release/status verification, protected owner
  // receipts, platform stores and the supervised HTTP worker must be qualified.
  void options;
  return {...nativeBumbleReadiness(),status:'adapter_not_qualified',reason:'Native transport and resource-release qualification are incomplete; no worker dispatched.'};
}
