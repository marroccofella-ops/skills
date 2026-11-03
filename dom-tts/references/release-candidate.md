# Dom TTS 0.5.0-rc.1 — portable source candidate

This prerelease provides reviewed source for testing. It is not the completed
stable 0.5 programme, a signed Windows installer, or automatic speech in every
existing Desktop chat.

## Changes

- Completed messages and sources roll out of bounded history, allowing long
  sessions to continue beyond the old 64-message admission failure.
- Unsaid paragraph segments drain when queue capacity becomes available. A
  partially admitted reply cannot falsely report completed playback.
- Explicit supplied chat sources have separate scheduling. One failed chat does
  not block another; global Stop remains authoritative and never restarts itself.
- The live Codex relay forwards public commentary, partial answers and optionally
  final-answer paragraphs from an owning client's already-selected event stream.
  It does not scan stored chats, open host sockets, read reasoning or subscribe to
  Desktop globally. Final notification and live final streaming are exclusive routes.
- The completion adapter reads only its supplied final event, checks the source
  build, uses chat-specific scheduling and returns after admission.
- Queue-aware diagnostics distinguish a connected browser from paused, stopped,
  failed or congested delivery. Browser connection recovery never replays audio.

## Download and verify

Download `dom-tts-source.zip` with its `dom-tts-source.zip.sha256.json` receipt.
Compare the archive SHA256 with the receipt before extracting. The ZIP contains
the `dom-tts` skill directory and its file-integrity manifest. It excludes settings,
runtime state, credentials, transcripts, recordings and private evidence. The
manifest and SHA256 provide integrity checks, not publisher code signing.

The archive is produced only after the candidate's portable test matrix succeeds.
Hosted tests include synthetic/injected playback and real Windows permission checks;
they do not establish that audio was audible on each platform.

## Run locally

Use an existing Node 18+ installation (a maintained LTS is recommended). No npm
dependency installation is required. For a new native Agent Skills installation,
change into the extracted `dom-tts` directory, preview
`node scripts/install.js --target codex --dry-run`, then run the same
command without `--dry-run`. This installs for the current local user's compatible
Codex chats; it does not configure every remote/cloud harness.

Existing expanded private installations contain different optional features and
installer recovery support. Keep their retained snapshot and test this portable
candidate in an isolated skill directory before replacing them.

For browser speech, start `node scripts/experimental/browser-session.js`, open its
printed private local link, select an installed local voice and click Enable.
Keep the companion open. Check `node scripts/doctor.js --browser true`. Stop with
`node scripts/browser-speak.js --command stop`; restart is explicit. Do not publish
the private access link or runtime descriptor.

For actual paragraphs during generation, the owning client must wire the callback
in [live paragraph forwarding](https://github.com/marroccofella/skills/blob/dom-tts-0.5.0-rc.1/dom-tts/references/codex-paragraph-speech.md) into its existing selected
message-event dispatch. A final-only Codex notification cannot provide earlier
paragraph events. In a tool-based chat, the assistant can submit each displayed
progress paragraph immediately and continue without waiting for sound.

## Remaining stable-release gates

Automatic paragraph attachment to every existing Codex Desktop chat requires a
supported host integration that is not supplied by this skill. Native audio,
Stop/device/sleep acceptance on the required independent platforms and real harness
trigger scoring remain open. The expanded Windows speech/tray/setup distribution
needs trusted signing and separate native/GUI acceptance; no certificate or signed
setup is included here. No microphone, cloud voice or execution-policy change is
enabled by this candidate.

Report the exact version/source hash, context, admission/completion versus heard
verdict, paragraph timing and safe reproduction in issue #58 and discussion #38.
Do not resubmit old or failed text to infer delivery; retained receipts are bounded.
