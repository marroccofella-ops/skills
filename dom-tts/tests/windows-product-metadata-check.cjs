'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {ROOT, powershell, psQuote, safeEnv, writeObject} = require('../scripts/runtime');
const {sourceFiles, manifest} = require('../scripts/package');
const {windowsProductMetadata, windowsAssemblySource} = require('../scripts/windows-product-metadata');
const {buildNative} = require('../scripts/build-native');
const {buildWindowsSetup} = require('../scripts/build-windows-setup');
const {describeChildFailure} = require('../scripts/child-process-diagnostics');
const {readAssemblyVersion} = require('./fixtures/pe-assembly-version.cjs');
const {checkFixtures} = require('./fixtures/pe-assembly-fixtures.cjs');

function inspectionDiagnostic(result) {
  const diagnostic = describeChildFailure(result);
  if (!diagnostic) return null;
  const {errorCode, signal, exitStatus, stdoutBytes, stderrBytes} = diagnostic;
  // Reuse only sanitized process facts, without the speech adapter's semantics.
  const facts={schema: 'dom-tts-pe-inspection-diagnostic/1', errorCode, signal, exitStatus, stdoutBytes, stderrBytes};
  for(const line of String(result.stderr||'').split(/\r?\n/))if(line.startsWith('dom-tts-pe-read-error:'))try{
    const value=JSON.parse(line.slice('dom-tts-pe-read-error:'.length));
    if(Object.keys(value).sort().join(',')==='innerHResult,languageMode,outerHResult'&&Number.isSafeInteger(value.outerHResult)&&value.outerHResult>=-2147483648&&value.outerHResult<=2147483647&&(value.innerHResult===null||Number.isSafeInteger(value.innerHResult)&&value.innerHResult>=-2147483648&&value.innerHResult<=2147483647)&&['FullLanguage','ConstrainedLanguage','RestrictedLanguage','NoLanguage'].includes(value.languageMode))facts.readError=value;
  }catch{}
  return facts;
}

const privateCanary = 'PRIVATE_PE_INSPECTION_CANARY';
for (const errorCode of ['ENOENT', 'EPERM', 'ETIMEDOUT', 'ENOBUFS']) {
  const diagnostic = inspectionDiagnostic({error: {code: errorCode, message: privateCanary, path: privateCanary, spawnargs: [privateCanary]}, status: null, signal: null, stdout: '', stderr: ''});
  assert.equal(diagnostic.errorCode, errorCode);
  assert(!JSON.stringify(diagnostic).includes(privateCanary));
  assert.deepEqual(Object.keys(diagnostic), ['schema', 'errorCode', 'signal', 'exitStatus', 'stdoutBytes', 'stderrBytes']);
}
const unknownDiagnostic = inspectionDiagnostic({error: {code: privateCanary}, signal: privateCanary, status: privateCanary, stdout: privateCanary, stderr: privateCanary});
assert.equal(unknownDiagnostic.errorCode, 'UNKNOWN');
assert.equal(unknownDiagnostic.signal, 'UNKNOWN');
assert.equal(unknownDiagnostic.exitStatus, null);
assert.equal(unknownDiagnostic.stdoutBytes, Buffer.byteLength(privateCanary));
assert.equal(unknownDiagnostic.stderrBytes, Buffer.byteLength(privateCanary));
assert(!JSON.stringify(unknownDiagnostic).includes(privateCanary));
assert.equal(inspectionDiagnostic({status: null, signal: 'SIGTERM'}).signal, 'SIGTERM');
assert.equal(inspectionDiagnostic({status: 3221225477}).exitStatus, 3221225477);
assert.equal(inspectionDiagnostic({status: 0, stdout: '{}'}), null);
assert.equal(inspectionDiagnostic({status:1,stderr:'dom-tts-pe-read-error:'+JSON.stringify({outerHResult:-2146233087,innerHResult:-2147024891,languageMode:'FullLanguage'})}).readError.innerHResult,-2147024891);
assert(!inspectionDiagnostic({status:1,stderr:'dom-tts-pe-read-error:'+JSON.stringify({outerHResult:0,innerHResult:null,languageMode:'FullLanguage',private:privateCanary})}).readError);

const parserEvidence = checkFixtures();
const version = require('../package.json').version;
for (const component of ['speech', 'tray', 'setup']) {
  const metadata = windowsProductMetadata('3.7.11-rc.2+build.005', component);
  assert.equal(metadata.productName, 'Dom TTS');
  assert.equal(metadata.productVersion, '3.7.11-rc.2+build.005');
  assert.equal(metadata.fileVersion, '3.7.11.0');
  assert.equal(metadata.assemblyVersion, '3.7.11.0');
  assert.equal(windowsAssemblySource(version, component), windowsAssemblySource(version, component));
}
assert.equal(windowsProductMetadata('0.0.0', 'speech').fileVersion, '0.0.0.0');
assert.equal(windowsProductMetadata('65534.65534.65534', 'speech').fileVersion, '65534.65534.65534.0');
for (const invalid of ['', undefined, null, 5, '01.2.3', '1.02.3', '1.2.03', '1.2', '1.2.3.4', '65535.0.0', '0.65535.0', '0.0.65535', '1.2.3-01', '1.2.3-a..b', '1.2.3+', '1.2.3\n', '1.2.3"', '1.2.3;malformed', '1'.repeat(81)]) {
  assert.throws(() => windowsProductMetadata(invalid, 'speech'), /Package version/);
}
for (const component of ['unknown', '__proto__', 'constructor']) assert.throws(() => windowsAssemblySource(version, component), /Unknown Windows product component/);

if (process.platform !== 'win32') {
  console.log('PASS: deterministic Windows product metadata, numeric bounds, exact informational versions and unsafe version/component refusal; byte-only PE/CLI parser '+parserEvidence.accepted+' valid, '+parserEvidence.refused+' malformed, '+parserEvidence.fuzzed+' mutation and '+parserEvidence.files+' bounded-file fixtures. SKIP: actual Windows PE compilation/resource inspection on this platform.');
  process.exit(0);
}

// Compile the three real components and inspect PE resources/Assembly table bytes.
// No output executable is started, installed or treated as trusted/signed.
const base = path.join(ROOT, '.local-test');
const area = path.join(base, 'product-metadata-' + crypto.randomBytes(8).toString('hex'));
fs.mkdirSync(area, {recursive: true});
try {
  const outputs = [];
  for (const component of ['speech', 'tray']) {
    const out = path.join(area, component, component === 'speech' ? 'NativeSpeech.exe' : 'TrayCompanion.exe');
    const receipt = buildNative({out, component, unsigned: 'true'});
    assert.equal(receipt.signed, false);
    assert.equal(receipt.installed, false);
    assert.equal(receipt.productName, 'Dom TTS');
    outputs.push({component, out, receipt});
  }
  const payloadRoot = path.join(area, 'payload');
  fs.mkdirSync(payloadRoot);
  for (const file of sourceFiles()) {
    const target = path.join(payloadRoot, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(ROOT, file), target);
  }
  writeObject(path.join(payloadRoot, 'manifest.json'), manifest(payloadRoot));
  const out = path.join(area, 'setup', 'HalDomTTSSetup.exe');
  const receipt = buildWindowsSetup({out, payloadRoot, unsigned: 'true'});
  assert.equal(receipt.signed, false);
  assert.equal(receipt.executed, false);
  assert.equal(receipt.installed, false);
  outputs.push({component: 'setup', out, receipt});
  // AssemblyName.GetAssemblyName can enter the runtime's unsigned-image loading
  // policy even for inspection. Read the numeric table fields directly instead;
  // neither code execution nor trust/policy acceptance is implied by these bytes.
  const assemblyVersions = outputs.map(output => readAssemblyVersion(output.out));
  const query = '$ErrorActionPreference="Stop"; @(' + outputs.map(item => psQuote(item.out)).join(',') + ') | ForEach-Object { $v=[Diagnostics.FileVersionInfo]::GetVersionInfo($_); [ordered]@{name=[IO.Path]::GetFileName($_);productName=$v.ProductName;productVersion=$v.ProductVersion;fileVersion=$v.FileVersion;description=$v.FileDescription} } | ConvertTo-Json -Compress';
  const guardedQuery='try { '+query+' } catch { $outer=$_.Exception; $inner=$null; if($outer.InnerException){$inner=$outer.InnerException.HResult}; $facts=[ordered]@{outerHResult=$outer.HResult;innerHResult=$inner;languageMode=[string]$ExecutionContext.SessionState.LanguageMode}; [Console]::Error.WriteLine((\'dom-tts-pe-read-error:\'+($facts|ConvertTo-Json -Compress))); exit 1 }';
  const inspected = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', guardedQuery], {windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 16384, env: safeEnv()});
  assert(!inspected.error && inspected.status === 0, 'Read-only Windows PE metadata inspection failed: ' + JSON.stringify(inspectionDiagnostic(inspected)));
  const actual = JSON.parse(inspected.stdout);
  assert.equal(actual.length, 3);
  for (const [index, output] of outputs.entries()) {
    const expected = windowsProductMetadata(version, output.component);
    assert.equal(actual[index].productName, expected.productName);
    assert.equal(actual[index].productVersion, version);
    assert.equal(actual[index].fileVersion, expected.fileVersion);
    assert.equal(assemblyVersions[index], expected.assemblyVersion);
    assert.equal(actual[index].description, expected.title);
    assert.equal(output.receipt.productVersion, actual[index].productVersion);
    assert.equal(output.receipt.fileVersion, actual[index].fileVersion);
    assert(!fs.readdirSync(path.dirname(output.out)).some(name => name.startsWith('.dom-native-') || name.startsWith('.dom-tts-setup-')), 'Temporary compiler metadata/payload must be removed');
  }
  console.log('PASS: actual speech, tray and setup compilation plus FileVersionInfo product/file resources and byte-only CLI Assembly version inspection; '+parserEvidence.accepted+' valid, '+parserEvidence.refused+' malformed, '+parserEvidence.fuzzed+' mutation and '+parserEvidence.files+' bounded-file parser fixtures. Product Dom TTS; exact package ' + version + '; numeric version ' + actual[0].fileVersion + '. All outputs unsigned, unexecuted and uninstalled; signing, application-control acceptance and native/GUI acceptance remain unverified.');
} finally {
  const target = fs.realpathSync(area);
  if (path.dirname(target) !== fs.realpathSync(base) || !/^product-metadata-[a-f0-9]+$/.test(path.basename(target)) || fs.lstatSync(area).isSymbolicLink()) throw Error('Unexpected metadata fixture cleanup path');
  fs.rmSync(target, {recursive: true, force: true});
}
