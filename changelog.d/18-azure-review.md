### Added

- **Every Azure mark has been reviewed against its caption, and the review is
  on record** (#18). `assets/libraries/reviews/azure.json` holds one row per
  shipped id — the sha256 of the artwork that was looked at, the verdict, the
  reviewer and the date — and the suite fails if any shipped Azure mark has no
  row, has changed since its row was written, is recorded as a mismatch, or if
  the record names an id that no longer ships. A partial review can no longer
  pass for a complete one, and a rebuild that changes a mark re-opens only that
  entry. `contact-sheet.mjs --pack <id> --review [--page N]` prints the record's
  status and renders the pack 54 marks to a page at 120px, each captioned with
  its id, upstream file, index, hash and review state, into the gitignored
  `contact-sheets/review/`.

### Fixed

- **Two Azure pairs are no longer told apart by a folder they share** (#18).
  Microsoft ships two different `Workspaces` marks in `compute` and two
  `Load Balancer Hub` marks in `networking`; the second of each was captioned
  `(Compute)` or `(Networking)`, which distinguished it from nothing. They are
  now `Workspaces (00400)` and `Load Balancer Hub (029029174)`, after
  Microsoft's file numbers. The ids are unchanged and the old captions still
  resolve. `Multifactor Authentication (Security)` keeps its suffix: that pair
  really does come from different folders.
- **Ten Azure captions no longer repeat Microsoft's file-name typos** (#18).
  `Promethus`, `Entra Privleged Identity Management`, `Defender Programable
  Board`, `Azure a`, `AzureAttestation`, `ExtendedSecurityUpdates`,
  `MachinesAzureArc`, `VPNClientWindows`, `Windows10 Core Services` and
  `Web Application Firewall Policies(WAF)` now read as the services are named.
  A new `titles` map in the azure pack holds the corrections; the ids are
  unchanged and Microsoft's spelling still resolves.
