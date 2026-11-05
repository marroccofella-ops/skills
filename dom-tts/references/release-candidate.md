# Dom TTS 0.5.0-rc.4 — reliability source candidate

This source candidate repairs word boundaries, long-reply expiry/deadlines, rolling harness delivery, native failure reporting and publisher trust checks on top of public 0.5.0-rc.2. Its browser/core, expanded installer and optional studio scope is retained. It is not a finished stable 0.5 release or trusted Windows installer. A reviewed source-file recipe, manifest and SHA256 receipt identify packaged source bytes.

## Included

- Local browser speech with same-document connection recovery, bounded per-chat scheduler sources, queue-pressure draining and provider-specific Stop.
- Display-first supplied live-paragraph relay and supplied completion notifier. Both use identities explicitly provided by their owning caller; neither discovers chats or reads transcripts.
- Managed installer transaction recovery, explicit native-settings migration and supplied Codex/Claude/OpenClaw event adapters.
- Historical rollback to the source-pinned published RC2 snapshot, verified without running backup scripts. Use this candidate's external installer for rollback and rollforward; unknown legacy snapshots are refused.
- Windows native speech, tray, setup and signing/readiness source; no compiled executable or certificate.
- Optional local voice-studio source with separate recording/remote-request consent and opt-in provider selection; no microphone, cloud request or credential is activated by install.
- Word/sentence-aware supplied speech, activity-based queue expiry, duration-aware deadlines and bounded rolling host histories. Controlled regressions cover long sessions; they do not certify human hearing or every Desktop chat.
- Source-anchored publisher pins and actual PE product/version matching. The publisher policy is empty until reviewed signing is available. New tray autostart registration is refused pending a managed startup trust design.
- Exact-socket identity proof for descriptor clients and encrypted RPC for an already-loaded trusted browser page. The older tray browser transport/opener is refused. Client/server/page must upgrade together; a fresh trusted server link and explicit Enable are required. This does not authenticate newly loaded HTML from a stale URL after port reuse.

Run `npm test` for the core corpus and smoke checks, or `npm run test:all` for manifest verification and the complete portable regression plan. The latter can take many minutes on Windows and includes compile-only metadata inspection; it does not execute generated native components or replace listening tests. Hosted CI uploads exact-head source artifacts. Publication is a separate reviewed action; the old RC2 automatic cleanup/tagging steps have been removed.

## Run the local browser provider

Use Node 18 or newer, preferably a maintained LTS. No npm install is required. Run `node scripts/experimental/browser-session.js`, open its private loopback link, choose a local voice and explicitly Enable spoken replies. Keep that page open. Check `node scripts/doctor.js --browser true`, then submit supplied text with `node scripts/browser-speak.js --text "A supplied reply." --enqueue true --wait false`. A queued job is not completed audio or human hearing. Use wait=true only for an explicit voice test.

Stop through `node scripts/browser-speak.js --command stop`. It clears queued input and suppresses further delivery until explicit Restart. A fresh page or restarted server requires Enable.

## Stable acceptance still required

The relay exports `hostForwardingRequired:true` and `automaticDesktopSubscription:false`. Every-chat progressive speech requires the owning Desktop client to forward its live public events. The completion-only notification route cannot create paragraph events. The source package does not attach itself to existing Desktop chats.

Exact-candidate live multi-chat/browser lifecycle and listening tests, native Windows clean-second-host/macOS/Linux audio receipts, actual harness trigger scoring, independent release acceptance and trusted signed Windows component/setup tests remain gates. Portable hosted CI and injected media/provider tests do not replace those results. Track [issue 70](https://github.com/marroccofella/skills/issues/70).

The expanded desktop programme also needs a reviewed managed startup design and
guarded tray browser controls/opener; those routes are currently disabled. Source
presence is not acceptance of a working signed desktop programme.

Historical evidence in EVOLUTION.md and COMPATIBILITY.md applies only to its named versions. Existing source and protocol regressions are retained; new expanded-source checks exercise consent, cancellation, trust refusal, package integrity, managed recovery and explicit adapter boundaries without using a live microphone or cloud account.
