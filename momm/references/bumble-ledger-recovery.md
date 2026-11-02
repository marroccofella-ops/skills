# Responding to a refused Bumble store

Development guidance; this is not an automatic repair tool or permission to
release a reservation. A missing file, empty directory or failed read does not
prove that no work was admitted. Keep the original store and unknown holds.

The current implementations bind these files together:

| Store | Coupled files |
| --- | --- |
| Global capacity | `capacity.json`, `initialisation.json` |
| Supplementary stage | `stage.json`, `baseline.json`, `initialisation.json` |

`initialisation.json` is the exact current filename. A legacy store without that
binding is not silently migrated. First creation is allowed only for a root
that was absent before the operation. A retained empty root, a partial first
creation or loss of any coupled component refuses instead of starting empty.

## Safe operator response

1. Stop new admissions and do not resend the uncertain request. Preserve the
   directory, partial files and lock entries in place. Do not delete, rename or
   recreate them to make a constructor succeed; do not remove a guessed stale
   lock or kill a guessed/reused process identifier.
2. Record the actual check time, refusal class, store kind and which expected
   entries can be inspected using an already approved private metadata view.
   Failed inspection is unknown, not absence. Do not invoke a state constructor
   merely as an inspection command: it may acquire a writer lock. No credential,
   key or certificate contents are needed for this diagnosis.
3. Keep any report owner-private. Do not email raw store bytes, identifiers,
   credentials or logs. A file hash proves byte equality, not authenticated
   history or freedom from rollback.
4. Reconcile the original store identity, configuration/baseline bindings and
   every pending task/reservation/lease/epoch/fence join against authoritative
   durable backend history. A terminal reply and physical slot release are
   separate facts. Proxy completion, cancel, idle counters and reboot do not
   establish the latter; unmapped original attempts remain unknown.

## Recovery remains a separate operation

There is currently no supported automatic reset or migration command. A
maintainer-approved recovery must specify the exact original coupled state,
authenticated history, custody and rollback guarantees, and preserve every
unresolved hold. Restoring a stale backup or inventing a new marker is not that
proof. If those facts are unavailable, leave the store quarantined. A new path
or empty root must not be used to regain capacity or erase old uncertainty.

The same caution applies to a legacy connector whose saved endpoint/resource
identity no longer matches canonical validation. Do not edit its identity or
authentication mode in place. No automatic identity reconciliation tool is
claimed. A readable, known legacy authentication profile remains inert; its
private historical qualification is withheld from UI snapshots. Explicit
archive/Undo invalidates that qualification and does not clear backend holds.

These steps describe safe diagnosis and preservation. They do not establish a
working protected store, authorize deployment, reconcile an actual historical
job, qualify a native reviewer or release MOMM 1.18.
