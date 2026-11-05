// Reviewed source anchor. Changes require source review and a rebuilt manifest.
// No publisher is configured for this prerelease. Receipts, environment variables,
// CLI arguments and adjacent files cannot add trusted Dom TTS publishers.
const APPROVED_PUBLISHERS=Object.freeze([]);
function reviewedPublishers(){return [...APPROVED_PUBLISHERS];}
function publisherPins(policy=reviewedPublishers){
 if(typeof policy!=='function')throw Error('Reviewed publisher policy must be a trusted function');
 const pins=policy();if(!Array.isArray(pins)||pins.length>16||pins.some(pin=>typeof pin!=='string'||!/^[a-f0-9]{40}$/i.test(pin)))throw Error('Reviewed publisher policy is invalid');
 return [...new Set(pins.map(pin=>pin.toUpperCase()))];
}
function approvedThumbprint(value,policy=reviewedPublishers){return typeof value==='string'&&/^[a-f0-9]{40}$/i.test(value)&&publisherPins(policy).includes(value.toUpperCase());}
function requireSigningPublisher(value,policy=reviewedPublishers){const pins=publisherPins(policy);if(!pins.length)throw Error('Reviewed Dom TTS publisher policy is unconfigured; signing is refused');if(!approvedThumbprint(value,()=>pins))throw Error('Signing certificate is not approved by the reviewed Dom TTS publisher policy');return value.toUpperCase();}
function publisherIdentitySource(version,policy=reviewedPublishers){
 if(typeof version!=='string'||!/^[A-Za-z0-9.+-]{1,80}$/.test(version))throw Error('Publisher identity version refused');
 const pins=publisherPins(policy);
 return 'static class TrustedPublisherIdentity { public const string ProductName=\"Dom TTS\"; public const string Version="'+version+'"; static readonly string[] Pins=new string[]{'+pins.map(pin=>'"'+pin+'"').join(',')+'}; public static bool ApprovedThumbprint(string value) { if(value==null || !System.Text.RegularExpressions.Regex.IsMatch(value,@"\\A[a-fA-F0-9]{40}\\z")) return false; foreach(string pin in Pins) if(System.String.Equals(pin,value,System.StringComparison.OrdinalIgnoreCase)) return true; return false; } }\n';
}
module.exports={reviewedPublishers,publisherPins,approvedThumbprint,requireSigningPublisher,publisherIdentitySource};
