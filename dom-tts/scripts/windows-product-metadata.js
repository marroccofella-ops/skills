'use strict';

const PRODUCT_NAME = 'Dom TTS';
const TITLES = Object.freeze({speech: 'Dom TTS Speech', tray: 'Dom TTS Tray', setup: 'Dom TTS Setup'});

// Assembly/FileVersion use four bounded numeric fields. The exact package version,
// including its prerelease/build suffix, remains the informational product version.
function windowsProductMetadata(version, component) {
  if (!Object.hasOwn(TITLES, component)) throw Error('Unknown Windows product component');
  const match = typeof version === 'string' && version.length <= 80 && version.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
  if (!match || match.slice(1, 4).some(part => String(Number(part)) !== part || Number(part) > 65534) ||
      match[4]?.split('.').some(part => /^[0-9]+$/.test(part) && part.length > 1 && part[0] === '0')) {
    throw Error('Package version cannot be represented by Windows product metadata');
  }
  const numericVersion = match.slice(1, 4).join('.') + '.0';
  return {productName: PRODUCT_NAME, productVersion: version, assemblyVersion: numericVersion, fileVersion: numericVersion, title: TITLES[component]};
}

function windowsAssemblySource(version, component) {
  const metadata = windowsProductMetadata(version, component);
  // All values are fixed strings or validated ASCII version data, never code input.
  return ['using System.Reflection;',
    '[assembly: AssemblyProduct(' + JSON.stringify(metadata.productName) + ')]',
    '[assembly: AssemblyTitle(' + JSON.stringify(metadata.title) + ')]',
    '[assembly: AssemblyVersion(' + JSON.stringify(metadata.assemblyVersion) + ')]',
    '[assembly: AssemblyFileVersion(' + JSON.stringify(metadata.fileVersion) + ')]',
    '[assembly: AssemblyInformationalVersion(' + JSON.stringify(metadata.productVersion) + ')]', ''].join('\n');
}

module.exports = {windowsProductMetadata, windowsAssemblySource};
