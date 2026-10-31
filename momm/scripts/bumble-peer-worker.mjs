// Retired issued-key shadow route. OAuth-only qualification uses the separate OAuth worker.
// No caller, receipt or command can activate a file-key reader here.
import './launch-guard.mjs';
import path from 'node:path';import {fileURLToPath} from 'node:url';
// Historical audit bytes retained unchanged; this retired route never invokes it.
const WINDOW_AUDIT = String.raw`
$ErrorActionPreference='Stop'
try {
 Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
 $file=([Console]::In.ReadToEnd()|ConvertFrom-Json).path
 $me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $item=Get-Item -LiteralPath $file -Force
 $acl=Get-Acl -LiteralPath $file
 $ok=(-not $item.PSIsContainer) -and (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) -and ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $me)
 $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
 if($rules.Count -eq 0){$ok=$false}
 foreach($rule in $rules){if($rule.AccessControlType -eq 'Allow' -and @($me,'S-1-5-18','S-1-5-32-544') -notcontains $rule.IdentityReference.Value){$ok=$false}}
 @{verified=$ok}|ConvertTo-Json -Compress
}catch{'{"verified":false}'}
`;
void WINDOW_AUDIT;
const refused=()=>({schema:'momm-bumble-peer-worker-result/1',attempt_id:null,transport:'refused',payload:'protected_preflight_refused',finished:false,content:null,duration_ms:0});
export function validateShadowConnection(){throw Error('Issued-key transport is unsupported; use the qualified OAuth route.');}
export function readProtectedServiceKey(){throw Error('Issued-key credential reads are unsupported.');}
export async function runPeerShadowWorker(){return refused();}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.stdout.write(JSON.stringify(refused())+'\n');process.exitCode=2;}
