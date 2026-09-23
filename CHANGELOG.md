# Changelog

All notable changes to Arkitect are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/spec/v2.0.0.html).

A change adds its own one-line bullet under `### Added` / `### Changed` /
`### Removed` / `### Fixed` in `[Unreleased]` below, in the same pull request
that makes it — naming the issue or PR it came from where one exists. No
separate file, no naming scheme, no required format beyond that.

## [Unreleased]

### Added

- Draw.io `validate` warns when two edges between the same two nodes, in either direction, run along one line, naming both: drawn that way they read as one double-headed line of one kind (#272).
- Both build reports list, under `namesAProduct`, a plain box whose label names a product with a bundled mark, with the node, the text and the id an icon node would draw; a note is never asked, and a generic word (now also "bus" and "schema") is not a product (#240).
- Draw.io `validate` places an unconstrained edge end where Draw.io's router does (an L between diagonal boxes), and warns when a route runs through a node, not only a caption, or when two edges share one line into the same port (#242, #246).
- Draw.io `validate` prints `info` lines for an icon no edge touches and an edge that ends on a container's border, naming its children; the Draw.io build report notes the boundary edge too, and Excalidraw's notes the icon, since a scene cannot tell one. Neither changes PASS or the exit code (#244, #245).
- Draw.io `validate` warns when a title, legend or edge label lies across a container's border or over its name, and when a page fit to 1920px wide draws its labels under 9px; each page line now counts its icons (#243, #247).
- Draw.io boundaries take `labelAlign` (`left`, `center`, `right`) to move their name along the top; an unknown value keeps the default and is listed under `unknownKinds`, and a spec without it builds byte-identical (#250).
- `analyze --find "<label>"`, in both engines, returns the full id of the cell or shape a label names, with its page and geometry, even in a compressed Draw.io page; it prints no page XML or image data, and `--cells` stays label-free. The editing references send a named component there (#266).

### Changed

- Fetched logos, made icons and libraries installed from the public catalogue are cached in the store, `~/.arkitect/<engine>/` (or `$ARKITECT_HOME`), beside your learned style, so a plugin update no longer loses them. What was cached inside the plugin before is still read from there; nothing new is written there (#257).

### Fixed

- The Draw.io numbered-flow pattern says what to number: one sequence per page, from 1, on edges only; entry points and parallel paths are not steps, so they stay unnumbered or take letters. A new eval case measures it (#251).
- Asked about a diagram's style, an agent that loaded no skill promised to remember it for later diagrams. The Claude Code plugin now carries one hook: for a prompt that asks about a diagram's style, and no other, it adds the rule that a style is kept only by `/learn-drawio-style` or `/learn-excalidraw-style`, and sends back once a final reply that still makes the promise (#265).
- AGENTS.md and the Excalidraw skill no longer say `style` is a field in neither engine: Excalidraw applies a top-level `style`, and only one on a node, edge or boundary is dropped and listed under `unknownFields`. A test holds the contract to the builder (#268).
- Both drawing skills' report step, and AGENTS.md's, names each validate warning left with every id it gives, as a defect still there, and each defect seen in the render and left by page, never "minor" or "a few"; a new eval case holds the report to it (#248). Both validators say it where the agent reads it: the PASS line counts the warnings, and a last line says each is a defect to fix or quote with its ids.
- The eval script's syntax test passes `scripts/eval.sh` relative to the repository, so it no longer fails on Windows when the `bash` on PATH is WSL's (#267).

## [2.0.1] — 2026-09-22

### Fixed

- The `.gitignore` advice names Draw.io Desktop's own autosave, `.$*.bkp`, a
  full copy of the diagram left beside any file it has open, as well as our
  `*.backup-*`. This repository ignores it too, and `docs/privacy.md` lists it
  (#252).
- The Draw.io skill's default reading was brought 300 bytes under its
  12,000-byte budget, where it was 13 before #256; #252 then took 17, leaving
  283. The comparison pattern says the same in
  fewer words, and `SKILL.md` drops a non-negotiable that step 4 already states
  and shortens one sentence. This makes room for #240, #248 and #252 (#253).
- An Excalidraw node and the caption or sublabel under it share a group, so
  dragging an icon in the app takes its name with it. A library item keeps its
  own group inside the node's. It adds `groupIds` and moves no coordinate, so
  it ships as a patch; the committed examples are rebuilt and draw the same
  (#190).
- Draw.io renders leave a 20px margin round the drawing. Desktop's border
  defaults to 0, so every PNG was cropped flush and the legend or the last
  caption touched its edge. `--padding N` changes it and `0` restores the old
  crop exactly; the PowerShell adapter takes `-Padding`. The three template
  PNGs are re-rendered; the contact sheets are Chrome screenshots and did not
  change (#249).
- A key at the top of a spec that neither builder reads is named under
  `unknownFields`, with a hint for `edge`, `node` and `boundary`, and in
  Excalidraw for `pages` and `context`. A misspelled `edges` used to drop every
  connector without a word. A key starting with `_` is a comment, as in the
  committed templates (#221).
- The Draw.io skill no longer says there is no PDF export: `render --format pdf`
  has written one since the renderer was added, and `references/rendering.md`
  now shows it. A test fails if either skill denies a format its renderer
  accepts (#256).

## [2.0.0] — 2026-09-21

Every change is to generated output, which is what makes this a major: four
to Excalidraw's, and two to both engines' - a node with an `icon` and no
`kind`, and a node named only in generic words, which no longer draws a
cloud vendor's mark. Saved scenes and diagrams are untouched and still open
and validate; rebuild a spec to get the new output. A scene built before
2.0.0 can draw a validator warning for a frame ahead of its children or a
zero-length connector, and a rebuild clears both.

### Changed

- Excalidraw boundaries are sized from everything their nodes draw, in both
  axes. Only a caption's height was counted, so a caption or sublabel wider
  than its icon, box or cylinder hung out of its own scope or frame while
  validation passed. A scope is also at least as wide as its own inside label.
  Arrows still leave the artwork. Both committed examples moved: eight texts
  in `aws-data-platform` and the "Analytics warehouse" caption in
  `starter-architecture` sat across their scope's edge. Saved scenes are
  untouched; rebuild a spec to pick it up (#191).
- Excalidraw text is measured as wide as the app draws it. The estimate ran
  narrow in every font family (Virgil: 18% at the median, 46% at worst), and
  the app clips free text to the width in the file, so captions, legend
  entries, scope labels and titles opened with letters missing, and note text
  wrapped past its box. Widths now come from a table of per-character
  advances measured with the app's own fonts; our PNG renders never showed
  the clipping. Both committed examples are rebuilt (#222).
- An Excalidraw edge from a node to itself is drawn as a loop over one of the
  node's corners, bound at both ends, instead of two points at its centre that
  drew a bare arrowhead over its label. A loop is always an elbow arrow, the
  one kind the app re-routes whole when the node moves. Loops take the
  top-right, top-left, bottom-right and bottom-left corners in turn; a fifth on
  one node is refused, and a bottom loop that crosses a caption is listed under
  `notes`. The validator warns about a zero-length connector, which every loop
  built before this has (#159).
- An Excalidraw frame comes straight after its own members in the scene,
  as the app expects and its renderer relies on to clip them. The builder
  wrote every frame first. Scopes outside any frame stay at the back, and an
  edge between frames stays on top. The validator warns about a frame ahead of
  its children, which every frame scene built before this has (#192).
- In both builders, a node with an `icon` and no `kind` draws as an icon, as
  the Excalidraw skill already said it would. It drew as a plain box and
  nothing reported it: in the 2.0.0 eval batch an agent followed the skill,
  got three boxes, and reported three icons. A node that names another kind as
  well draws that kind, and the report's `notes` names the icon it left out;
  the Draw.io report gains `notes` for it (#228).
- Neither icon search draws a cloud vendor's own mark for a query made only of
  generic words. `service` drew AWS's Service glyph, `storage` Google Cloud
  Storage and `function` GCP's Cloud Functions, so an internal service came
  out labelled as running on that vendor, twice in the 2.0.0 eval batch. Such a
  query now comes back flagged with the reason, and a node named that way
  gets a placeholder or labelled box; a vendor-neutral mark still draws, and so
  does the vendor's own when a Draw.io spec's `context` names it or the node
  gives the exact ref. Azure's App Service, Function App and Log Analytics are
  named in generic words only, so they now need one or the other. The
  compact answer for such a query offers the placeholder node and only
  vendor-neutral choices: while it listed the vendor's mark first, agents
  took it two runs in three (#231).

## [1.7.0] — 2026-09-21

### Added

- `arkitect install codex` also writes a Codex skill,
  `.agents/skills/arkitect/SKILL.md`, which Codex picks up from its
  description or runs as `$arkitect`. Its paths are absolute, so it works from
  any folder of the project, and it says what the engine guides mean by
  `${CLAUDE_PLUGIN_ROOT}`, which Codex never sets. `install codex-skill --dir ~`
  puts it in the user scope for every project. `AGENTS.md` is still written, and
  the `codex` alias now names both adapters (#127).

- A Draw.io spec can build more than one page. The docs offered pages three
  times - the engine table, the interview ladder, "two pages or one
  comparison" - and the builder wrote exactly one `<diagram>`, so an agent
  that asked and heard yes was left with hand-written XML or a silent single
  page. `pages: [{ name, id, title, boundaries, nodes, edges, legend }]` builds
  one page each, sharing `layout` and `context`; ids are per page, an edge
  across pages is refused and says which page the other end is on, and every
  report path names its page; the file carries its page count, as Draw.io's
  own do. A spec without `pages` builds byte-identical.
  The new `as-is-to-be` template is the worked example, with a PNG per page,
  and Excalidraw's ladder now offers two frames, the pages it can build
  (#184).

- Both builders name a box drawn where a boundary was meant, under
  `looksLikeBoundary` in the build report. A boundary owns what is inside it;
  a plain box laid over the same nodes draws much the same picture, owns
  nothing, and validated cleanly. The eval run behind this issue went further
  than that: its accounts were `width: 2, height: 2`, grid cells read as
  pixels, which draws a 2px dot with its label lost behind an icon. So the list
  carries both - a plain shape bigger than another node and around its centre,
  and any width or height under 10px - each with a hint pointing at
  `boundaries`. The build still succeeds; a backdrop with nothing inside, a
  note, a text and a real boundary stay silent, and so does every committed
  template (#204).

### Removed

- `.codex/prompts/diagram.md` and the instructions to copy it. Codex has
  deprecated custom prompts for skills; the docs invoked it as `/diagram` where
  Codex spells it `/prompts:diagram`; and its paths resolved only inside the
  Arkitect checkout. A copy already installed keeps working (#127).

## [1.6.3] — 2026-09-21

### Fixed

- Either release workflow can be re-run after a partial failure. Prepare used to
  refuse the branch it had pushed itself, so a `gh pr create` that failed left a
  release branch with no pull request and no way forward but by hand; publish
  created and pushed the tag before the release, so a failed `gh release create`
  left a tag a rerun tripped over. Both now look at what is already on the remote
  before they change anything, and resume only a state that matches: the branch
  is taken **as it stands**, with any correction made on it, and opened as a
  draft so the same person still reads it. A branch naming another version, a tag
  pointing anywhere but the merge commit, and a pull request closed unmerged are
  refused with the reason — nothing is force-pushed, no tag is moved, no branch
  is deleted. The decisions are `release.mjs resume-prepare` and
  `resume-publish`, unit-tested on every state (#120).

- The numbered-flow pattern is a recipe the builder can execute. Section 7 of
  the Draw.io catalog taught filled blue circles sat on the connectors, drawn
  from a raw ellipse style, and the builder has no such kind: a model following
  the selector reached an unknown kind and an unfilled rectangle, or
  hand-written XML — inventing ids, styles and connector-relative placement,
  which is the work the scripts are supposed to own. A sequence keeps its
  meaning in the edge labels, so the section now says to number them
  (`"label": "1. Submit request"`) and points at a `numbered-flow` fragment in
  `patterns.json` that builds. What the corpus actually drew is recorded in the
  style guide, off the default reading path. Section 7 is 288 bytes, down from
  369 (#193).

- A spec field neither builder knows is named in the build report instead of
  being dropped in silence. It was the one spec mistake that passed without a
  word: a missing edge target is refused, an unknown `kind` is listed, but an
  invented or misspelled key built cleanly and the agent that wrote it believed
  it had taken effect. An eval run put `"style": "strokeColor=#232f3e;..."` on
  five boundaries, got house colours back, and was never told. Unknown keys on
  nodes, edges and boundaries now appear under `unknownFields` with their path,
  their value and the fields that part does take; `style` — what an agent
  reaches for when the house style will not give it what it wants — is answered
  rather than only named. The build still succeeds, because a spec written
  against a field a later version adds still has to build. Both engines, and a
  test that no committed template warns (#205).

- Every workflow pins an action that declares Node 24, and no job rides
  `ubuntu-latest`. GitHub forces `checkout@v4` and `setup-node@v4` onto Node 24
  and annotates every run saying so; those are now v7, and `cache` is v6 — v5
  is the first major of each to declare node24. `ubuntu-latest` becomes Ubuntu
  26 on 19 October 2026, which would move the image everything is verified on
  without anyone choosing it, so the test matrix names both `ubuntu-24.04` and
  `ubuntu-26.04`, the Draw.io Desktop export runs on both, and every other job
  is pinned to 24.04. Dropping one then takes a line and has green evidence
  behind it. A test holds the pins and the labels (#122).

- Both skills write the seven report headings out as a bare list before
  qualifying them. Step 9 named each one in bold with a parenthetical, nine
  lines in all, and about a third of runs dropped or renamed one. The Render
  heading now says what to cite when only an SVG exists: the validator's own
  overlap, label and crossing findings, quoted as the validator's, not a
  description of a picture nobody saw. Two eval graders that failed correct
  runs are fixed. What is left - a run that drops the headings altogether - is
  #215 (#208).

## [1.6.2] — 2026-09-20

### Fixed

- An eval run now reads a render instead of only watching the renderer being
  called, so a layout regression can no longer score 1.00. No PNG can be made
  inside `claude plugin eval`'s sandbox — Chrome exits SIGABRT on
  `socket() failed: Operation not permitted`, with or without `--no-sandbox`,
  and Draw.io's `xvfb-run` exits 1 without saying why — but `--format svg`
  needs no browser, so `excalidraw-generate-architecture` asks for an SVG
  beside the scene and grades the file itself. `evals/README.md` records what
  renders inside a run and what does not, with the measurements (#136).

- A PNG render that fails because the host refuses the browser a socket is sent
  to `--format svg` instead of to `--no-sandbox`, which cannot help: the two
  failures share the words "Operation not permitted", and the wrong advice cost
  a run in the sandbox, then said nothing at all the second time. Every failed
  PNG now names a way out, and the Excalidraw skill's own fallback drops
  `--width`, which is PNG-only and made the documented retry exit 2 (#136).

- A render that succeeds and still cannot be looked at no longer invites a
  report describing it. Making the eval's render work showed three runs in three
  writing sentences like "the layout is clean: no label collision, adequate
  spacing between nodes" while holding only an SVG — markup, which reads back as
  text, so the layout in them came from the spec the agent had just written. The
  SVG handover now says what the file is and is not good for, and both skills'
  **Render** heading rules out describing a picture you did not see (#136).

- An SVG is no longer called a "geometry-faithful preview". Two runs quoted that
  phrase as their warrant for judging spacing from it, and `SKILL.md` and
  `references/rendering.md` both told their reader to judge layout from "the
  preview". Both sentences now name the PNG, where the claim is true, and say
  what an SVG is instead. The residual — report headings that get dropped,
  merged or renamed, and a Render section that still overreaches about once in
  three runs, on `main` as much as here — is measured in #208 (#136).

## [1.6.1] — 2026-09-20

### Changed

- `evals/README.md` counts each engine separately, and the test that keeps it
  honest no longer holds the two equal. Their contents have never mirrored each
  other case for case, and a count that has to stay even is a reason not to
  cover something (#201).

- The landing-zone eval case asks the judge one question at a time. Its
  `says-which-engine-and-why` grader wanted three things at once — name the
  format, give a reason over the alternative, state the assumptions — so a red
  said nothing about which had failed, and a run whose engine sentence was fine
  failed it for writing no Assumptions heading. That heading is now a `regex`
  like the Engine one, the assumptions are a judgement of their own, and the
  engine criterion says what counts as a reason: a property that tells the two
  engines apart, not a virtue they share. The judge had split 3–0 in both
  directions on materially the same sentence (#180).

### Fixed

- A diagram wanted "for the README" is drawn in Excalidraw again. A skill is
  selected on its `description`, before `AGENTS.md` §1 is read, and the two
  disagreed: §1 routes the README to Excalidraw, the trigger text never mentioned
  it, and Draw.io claimed every unqualified architecture request. Both runs of a
  README-leaning prompt drew Draw.io — and cited the README as the reason. Each
  description now carries its own signals from §1, a test reads those signals out
  of §1 rather than repeating them, and the Excalidraw half of the engine-choice
  case is in the suite (#201).

- The report says which engine was chosen and why, when the user named none.
  The choice itself was right every time — `arkitect-drawio` fires, Excalidraw
  never does, a valid `.drawio` lands — but the report shape was **File ·
  Assumptions · Icons · Validation · Render · Deviations**, with nowhere to put
  the reason, so it was never written in four runs out of four. Both report
  shapes now carry an **Engine** heading, required only when the user named no
  engine, and `AGENTS.md` §2 says the same. A mechanical grader checks that the
  heading is there; whether the reason is a reason stays with the judge (#180).

- `docs/maintenance.md` gains invariant 2b: a rule lands in the step that
  performs it. A rule about what the agent *does* does not govern what the agent
  *writes*, and that has now cost two fixes. #186 forbade the hosted editor in
  the step about opening a file, while the failing replies opened nothing and
  closed with a link; #180 had no slot in the report for a reason it was asked
  to give. A rule about the reply belongs in the report step, and where it can,
  in the report's own shape — a missing heading is visible, a forgotten sentence
  is not.

## [1.6.0] — 2026-09-20

### Added

- `AGENTS.md` states what Arkitect optimises for, and it is not a preference:
  stay functional and lightweight, and give good output on whatever model is
  driving, a small local one as much as a frontier one. Context is the scarce
  resource, the thinking that needs no model stays in code, a check a script
  can make is never left to the model or to an LLM judge, and a capability the
  docs promise has to be reachable by the documented route. `README.md`,
  `CONTRIBUTING.md` and `docs/maintenance.md` carry it too, since those are
  where decisions about what ships get made, and a test fails if any of them
  drops it. Nothing was added to either `SKILL.md`: the per-skill reading
  budget is the thing this statement protects.
- `docs/audit-prompt.md`, the prompt that finds the next patch, minor and major
  work and **files it as issues**. It scores against those two constraints
  rather than against taste, requires evidence per finding, and writes each
  issue in the house shape with one `release:` label. Before filing anything it
  has to read the existing issues, closed as well as open, and classify every
  candidate as new, already covered, or settled — a closed issue is a decision
  already made, and re-filing it argues with that decision. Fifteen issues is
  the cap, one finding each, and what it rejected is reported too, so the same
  ground is not audited twice.

- Four eval cases for parts of the contract nothing tested: that an edit
  analyzes the file rather than reading it whole, backs it up, and follows the
  style of the file in front of it rather than the style guide; that an agent
  given no engine picks one and says why; that a product with no mark anywhere
  gets an honest placeholder rather than some other product's logo; and that
  "for the README" still hands over a real scene rather than a Mermaid block.
  Each one found real behaviour on its first run. `evals/README.md`'s case
  count and its tree are now checked against the cases that exist, so neither
  can go stale unnoticed (#177).

- `arkitect drawio backup <file>` and `arkitect excalidraw backup <file>` write
  the same timestamped sibling the builders write, for the one editing route
  they do not cover: a hand edit, a script, MCP `set_page`. The editing step in
  both skills now reads `analyze → back up → edit → validate` and names that
  command. It used to say "call `backupExisting()` or copy the file yourself",
  which is two choices and an import, in a reference file a small model does not
  carry into the edit — an agent asked to add a cache to an existing diagram
  wrote no backup in three runs out of three, on the one route where the user
  already has work worth losing (#179).

- `scripts/eval.sh` runs the eval suite in one command, with the workarounds a
  run needs already applied. It checks the prerequisites (`--check` does only
  that, and spends nothing), caps the spend, and writes the JSON, the HTML
  report, the log and a one-screen summary under `evals/results/<stamp>/`.
  Two refusals cost an afternoon to find and are now handled rather than
  rediscovered: on Windows every Bash-granting case is refused, so the script
  says to use WSL; and the sandbox refuses to start at all when the Docker
  credential store holds a symlink, which Docker Desktop's WSL integration
  always creates. `DOCKER_CONFIG` does not move that check, so the run gets an
  isolated `HOME` linking only `~/.claude` and `~/.claude.json` - your real
  `~/.docker` is never touched. `scripts/eval-summary.mjs` prints the summary
  from any `--json` output on its own, and exits 1 if a case scored below 1
  (#134).

### Changed

- The eval suite checks what it can and judges only what it cannot. Every
  generation and icon case gained `regex` graders for the six report headings,
  the saved file name and each expected icon id, and each `llm` grader was
  narrowed to the one judgement no pattern can make - usually "does the Render
  section describe something that actually happened". Two of them replaced
  judgements that had demonstrably failed: a Haiku judge passed a run where dbt
  was drawn as a text label while the report claimed proper icons throughout,
  and the "are the accounts drawn as boundaries" criterion scored pass, fail,
  fail on unchanged code - it now counts `container=1` in the built file. Those
  cases run three times, so a flapping judge reads as a spread rather than one
  verdict that happened to land, and a test holds the composition so a case
  cannot drift back to judge-only checks (#135).



### Fixed

- An assumption no longer covers for changing what the user said. Asked for two
  workload accounts, an agent drew three — "I included a third for better visual
  balance in the landing zone pattern" — and listed it under Assumptions, where
  a reader looks for gaps that were filled, not facts that were changed. Both
  skills now say an assumption fills a gap and never overrides a stated fact,
  and that a component the user specified is never added, removed or renumbered:
  if the stated count draws awkwardly, draw the stated count and say the layout
  is tight. The same reply also offered a PowerPoint and PDF export that does
  not exist, so both report steps say to offer nothing Arkitect cannot do. A
  grader on the landing-zone case fails a third workload boundary (#183).

- A reply no longer offers the user the hosted draw.io editor. Step 8 of the
  Draw.io skill said what the agent may open, and a closing sentence about where
  the file can be opened did not read as governed by it; it now names Draw.io
  Desktop and the VS Code extension as the only two places a reply may point at,
  and says that offering a hosted-editor URL is the same act as opening one.
  The same rule is in the report step, where the closing sentence is actually
  written: an eval run still produced "Open it in [Draw.io](https://app.diagrams.net)"
  once in four runs with the rule only in step 8.
  `AGENTS.md` and `README.md` listed `app.diagrams.net` as a place to edit later,
  which told every agent reading the contract the opposite of the rule. The
  mechanical grader that catches it by URL (#185) now runs on all three Draw.io
  cases that write a closing sentence, not one (#186).

- `scripts/eval.sh` is executable in a fresh clone. It was committed 0644,
  because git records that by default for a file authored on Windows, so the
  command `evals/README.md` documents answered `Permission denied`. A test now
  fails if any committed `.sh` loses the mode git stores, naming the file and
  the `git update-index --chmod=+x` that fixes it - the working-tree bit says
  nothing on Windows, so the stored mode is the only thing worth checking
  (#181).

- The four `stays-manual` eval cases run again. `context.scaffold_script` is the
  path to a script file, resolved against the case directory, not inline bash:
  every one of them inlined its fixture, so `claude plugin eval` refused the
  case with `path "mkdir -p eval-input ..." does not exist` before the agent
  started, and all four scored 0 without ever testing what they exist to test —
  that `learn-*` and `apply-*` never fire on their own. Each fixture now lives
  in a `scaffold.sh` beside its `case.yaml`, and a test refuses an inlined,
  missing, misplaced or CRLF scaffold, since `bash` fails on the `\r` and a
  Windows clone would otherwise produce one (#133).

- `scripts/eval.sh` no longer overrides a case's `runs:`. It forwarded its own
  default of 1 on every call, which would have flattened the three runs the
  generation and icon cases now declare to one. Without `--runs` it passes
  nothing, and a test fails if `--runs` is forwarded unconditionally again
  (#135).
- The eval summary no longer prints a score for a run that errored before the
  agent answered. Such a run still scores 0.10 to 0.33, because its
  `not_contains` graders pass on the empty reply - a session-limit failure read
  as a weak run rather than as no run at all. Errored runs now show `?`, the
  footer counts them, and the summary exits 1 (#135).

## [1.5.2] — 2026-09-19

### Fixed

- A leading UTF-8 byte order mark no longer makes a valid JSON file invalid.
  Windows PowerShell's `Set-Content -Encoding UTF8` writes one, so a spec saved
  that way was refused as "not valid JSON", which is the one thing it certainly
  was. One mark is ignored — and only one, at the very start, so a file that
  really is malformed stays malformed — by a shared reader every entry point
  uses: both builders' specs, scenes, libraries, the validator, and the style
  override, findings and record files that already stripped one separately.
  Unicode in labels is untouched and a BOM-bearing spec builds a byte-identical
  diagram to the same spec without one (#156).
- Excalidraw frame membership follows the spec's `parent` rather than whether
  an element happens to fit inside its node's routing box. A free icon caption
  or a sublabel sits outside that box by construction, so it used to lose the
  frame its node declared, while a node that merely overlapped a framed one
  gained it; a scope nested in a frame gave its contents no membership at all.
  Everything a node or a nested scope draws now moves with the frame, an edge
  joins only when both ends are in it, and a frame parented to a frame — which
  Excalidraw does not support — is reported under `notes` (#158).
- The two supported Windows render helpers, `render-drawio.ps1` and
  `render-excalidraw.ps1`, are thin adapters over the tested Node renderers
  rather than second implementations of export, browser discovery and
  screenshotting. Both tested only whether a file existed at the output path, so
  an exporter that produced nothing was reported as `rendered` over whatever
  image was already there, with exit 0 — and the Excalidraw one then deleted the
  good SVG. A failed render now exits non-zero, never says it rendered, leaves
  the previous output byte-identical, and leaves an SVG behind when it was the
  PNG rasterisation that failed. Every documented parameter still maps to one
  renderer flag; `-DrawioExe` defaults to discovery, and a run that finds no
  browser exits 1 saying so rather than 0 (#157).
- A layout or style value set explicitly to null takes the builder's default in
  both engines, as it is documented to and as leaving the field out does, rather
  than being spread over that default: `colPitch: null` no longer collapses
  every column onto one another, and `nodeWidth: null` no longer draws a node
  with no width. A finite coordinate whose layout arithmetic overflows is
  refused before anything is drawn, naming the field responsible, instead of
  being written out as `pageWidth="Infinity"` or as the null JSON has to use
  for a number it cannot hold; no non-finite geometry reaches a file (#153).
- Draw.io validation checks that the file is well-formed XML before it checks
  anything else, over the wrapper and over each compressed page once decoded,
  so a mismatched or unclosed tag, a repeated attribute, an unquoted value or a
  raw ampersand is a failure naming the line and column instead of a clean PASS
  recovered from by a forgiving tag scanner. A declaration and comments around
  the root are XML and now pass, where the two wrapper string checks they
  replace refused them (#155).
- Excalidraw validation checks the shape of a document, its elements, bindings,
  points and embedded files before measuring any of them, so a malformed scene
  or library comes back as an ordinary structured failure naming the field
  instead of a stack trace with no result, one bad file no longer costs a batch
  the files after it, and a non-numeric width or height is an error rather than
  the same warning a legitimately zero-width arrow gets (#154).

## [1.5.1] — 2026-09-19

### Fixed

- A downloaded Excalidraw library is parsed in a staging file beside the target
  and only then put in place, so a malformed `browse --install --force`
  replacement leaves the installed library and the registry byte-identical
  instead of destroying a working library and breaking icon search (#152).
- `learn --help` prints the usage instead of performing the learn and replacing
  your style record; both engines now reject unknown flags, missing and repeated
  values, stray arguments, missing source files and incompatible modes before
  reading or writing anything (#151).

### Security

- The Excalidraw preview SVG no longer carries anything a scene file put there:
  colours, numbers, the fill pattern id and the image data URL are checked
  against a grammar instead of interpolated, so a crafted scene can no longer
  write its own attribute or `<script>` into a preview that runs when the file
  is opened in a browser (#150).

## [1.5.0] — 2026-09-18

### Added

- `excalidraw build --seed N` builds the same scene byte for byte on every run (#119).
- `icon --compact` in both engines answers an icon search in one line under 1KB; the skills use it (#117).

### Changed

- The Excalidraw skill and its largest pattern now read 10,484 bytes, down from 11,891 (#137).

## [1.4.0] — 2026-09-18

### Added

- The Excalidraw validator warns when an arrow runs through a node it does not
  connect, and `build-diagram` lists each one under `crossings` by spec ids,
  e.g. `edge a->c crosses node b` (#125).

### Changed

- The 36 bundled Excalidraw libraries are committed as compact JSON, 11.2 MB
  instead of 21.1 MB with every parsed value unchanged, and
  `index-libraries.mjs --build` compacts a library before indexing it (#118).
- The plugin manifest declares `./skills/` as its skills path instead of the
  whole repository, so `claude plugin eval` no longer warns that `evals/`
  overlaps it (#138).

### Fixed

- `release.mjs draft` accepts a model answer with CRLF line endings, fenced or
  not, and writes it to the changelog as LF (#121).

## [1.3.0] — 2026-09-18

### Fixed

- Draw.io rendering on Linux uses `xvfb-run` when `DISPLAY` names a local X
  server whose socket is not there, as inside a sandbox or container, instead
  of exporting nothing; a failed page now says why (#113)
- Excalidraw PNG rendering on Linux prefers a packaged Chrome or Edge to
  Chromium, and Ubuntu's snap `chromium-browser` wrapper comes last; a failed
  render drops Chromium's start-up chatter from its message and, when the
  browser could not nest its own sandbox, says to retry with `--no-sandbox` (#113)
- Both builders create a missing output folder instead of failing with a stack
  trace (#113)

### Changed

- Both drawing skills read at most 12,000 bytes before the chosen example,
  down from 34,621 (Draw.io) and 46,646 (Excalidraw): `SKILL.md` keeps one
  short workflow and a pattern selector, and editing, icons, logos, libraries
  and rendering move to `references/` behind a named condition (#113)
- Both skills draw instead of asking when the request already names the
  components and flows, treat a product the user did not name as a stated
  assumption, report under fixed headings (File, Assumptions, Icons,
  Validation, Render, Deviations) with the render as it happened, write the
  spec next to the output, and never send the user to the hosted Draw.io
  editor (#113)
- The eval cases load under `claude plugin eval` (schema 1.1), carry the
  engine in their names, and expect the marks that are bundled today (#113)

## [1.2.1] — 2026-09-18

### Fixed

- A test callback that returns a promise fails instead of counting as passed
  before its assertions ran; the three suites share one harness, and the
  library-verification test settles before it asserts (#114)
- `excalidraw build`, `analyze`, `validate` and `icon` refuse an unknown flag,
  a missing value or a stray file with exit 2 in one line, as the Draw.io
  commands do, and name a missing or malformed file without a stack trace (#116)
- Both builders refuse a spec whose numbers are not usable — a string
  coordinate, a size of 0 or less, a boundary spanning under one cell — naming
  each field, instead of writing `NaN` or negative geometry; a Draw.io node or
  boundary without `col` or `row` is drawn at 0, as in Excalidraw (#115)

## [1.2.0] — 2026-09-18

### Added

- Releases are cut by two workflows: `release prepare` bumps both manifests,
  dates `[Unreleased]` (drafting it with a model only when empty) and opens a
  `release/vX.Y.Z` pull request; merging it tags and publishes a GitHub Release
  with that section as its notes (#88)
- The 3,092 `brands` marks are reviewed on record, with a record that states
  what a catch-all review can confirm, and every pack must now have one (#72)
- A discontinued, renamed, absorbed, acquired or archived product carries a
  `status`: `find-icon` shows its caveat and successor, a build lists it under
  `icons.lifecycle`, and the drift check lists facts a year old; twelve
  products are recorded as of 2026-09-16 (#83)
- Every shipped mark in the 14 curated packs is reviewed on record, and every
  pack but the `brands` catch-all must now have a review record (#81)
- Every shipped AWS and Google Cloud mark is reviewed on record in
  `reviews/aws.json` and `reviews/gcp.json`, and the review test covers every
  pack with a record (#73)
- The quarterly drift check now covers the 45 `local-files` sources: a
  project logo redrawn or gone upstream, a changed licence file, and a
  repository newly archived, dormant or moved are reported, against the
  `upstreamRepo` state each source now records (#74, #82)
- Every set of packs sharing one exact icon title carries a judgement row
  in the resolver answer key, and a test fails when a new tie appears that no
  row covers (#75)
- Every exact icon count a doc quotes is checked against the catalog, the
  Excalidraw library index and the two answer keys, and the failure names the
  value to write (#78)
- Draw.io ids that draw identical artwork name each other: the catalog's
  `sameArtworkAs`, shown by `find-icon`, and a build reports nodes that use
  different ids for the same picture under `sameArtwork` (#77)
- Learned Draw.io style can change what gets drawn: `/apply-drawio-style` turns
  findings into a per-install override of named tokens and edge kinds that
  every CLI build merges in, `--defaults` ignores and `--print-style` shows (#89)
- Learned Excalidraw style can change what gets drawn too:
  `/apply-excalidraw-style`, `excalidraw findings`/`apply`, and `excalidraw
  build --defaults`/`--print-style` work as Draw.io's do, on one override layer
  both engines share (#90)
- Excalidraw can use all shared Draw.io marks via `drawio:<pack>/<slug>` or as
  a name-match fallback, embedded with provenance (#17)
- A 362-query icon-resolution answer key guards against confident wrong
  matches and rank-1 precision regressions (#15)
- Weekly/quarterly checks catch a removed or drifted upstream icon source and
  open an issue (#10, #9)
- Every committed Draw.io library is proven to load the way Draw.io itself
  reads one; GCP's masked/filtered legacy marks render correctly (#12, #13)
- Apache Iceberg, Pinot and Beam ship real icons from the ASF's own licensed
  originals (#11)
- Every shipped Azure mark is reviewed against its caption, with the review on
  record (#18)
- JAX, Flax, LightGBM, CatBoost, Metaflow and SigNoz ship their own
  project-licensed logos; nine more products catalogued on-demand with a
  recorded licence finding (#20)
- 123 products a modern data/ML/platform stack uses now all resolve — 38 ship
  their artwork, the rest are catalogued on-demand with the blocking licence
  named (#20)
- QuickSight resolves under the name AWS renamed it to; Aqua Security promoted
  out of the catch-all (#20)
- Teleport, Argo CD, Playwright and dlt get icons from sources already pinned
  in the repo, no new licence needed (#20)
- `excalidraw render` writes a real PNG on any OS using a local Edge, Chrome or
  Chromium (#39)

### Changed

- Naming a stack in a spec’s `context.packs` now settles an exact-title tie.
  Azure and `primitives` both ship a mark titled Monitor, and neither could be
  drawn unattended, because the context bonus sat below the margin a tie needs.
  A runner-up inside the named packs still settles nothing (#75)
- `docs/status.md` records what is done on main, what is left and in what
  order, dated, with every issue outcome reconciled against the repository
- Both engines share one backup and retention implementation, keeping their
  existing imports and generated output (#97)
- The AWS pack is rebuilt from Amazon's official July 2026 icon package: 311
  icons, up from 243, embedded verbatim and pinned by sha256 (#8)
- The AgentCore icon's five raster-only feature marks shrink from 4.65 MB to
  73 KB via a dependency-free area-average resampler (#7)
- 66 products are promoted from the generic `brands` catch-all into their
  proper curated packs (#19)
- Seven on-demand marks (Hudi, Samza, ActiveMQ, ZooKeeper, Crossplane, Flux,
  Open Policy Agent) now record why their official artwork can't ship (#11)
- The artwork licence bar is explicit: permissive licences ship, copyleft
  (MPL/LGPL/GPL/AGPL/SSPL/BUSL) does not, with two named brand-policy
  exceptions (#20)
- A vendor's published logo policy is checked ahead of the repository licence
  it happens to live in, in both directions (#20)
- `tests/icon-queries.json` grew to 492 rows; rank-1 precision is 96.4%, up
  from 94.5% (#20)
- Rebuilding a diagram no longer piles up unlimited backups — both builders
  keep the newest five plus the oldest and prune the rest, `--keep-backups N`
  (#49)

### Removed

- The `changelog.d/` fragment system, its CI gate and the `skip-changelog`
  label (#32) — entries are written directly into this file's `[Unreleased]`
  section again, as before #32. The fragment mechanism solved real PR
  conflicts, but the folder, naming scheme, issue-linking regex and assembly
  tool were more apparatus than a project this size needs.

### Fixed

- `databases/vespa` and `databases/nebula` no longer draw Piaggio's Vespa
  scooter and the nebula.tv streaming service; both are on-demand Vespa.ai and
  NebulaGraph entries, and `Red Hat OpenShift` and `Mailchimp` are spelled as
  their owners spell them (#81)
- Twelve AWS and ten Google Cloud captions their file names mangled read as
  the product is named: `AWS X-Ray`, `AWS re:Post`, `Identity-Aware Proxy`
  and the rest; ids and upstream spellings still resolve (#73)
- A wide wordmark is no longer drawn as a hairline. A lockup's short side now
  clears a third of the 78px footprint and its long side never passes twice it,
  so Metaflow's 6:1 mark is 156x26 instead of 78x13. Nine marks are redrawn;
  no artwork byte and no payload digest changes (#76)
- `docs/drawio-icons.md` no longer understates the Draw.io answer key: it
  claimed 375 queries and 28 that must come back flagged, where the file held
  neither number, and a test now keeps the sentence honest (#78)
- An on-demand icon with no pinned artwork file no longer hands back a
  `fetch-logo --url <logo URL from ...>` command no one can run: catalog rows
  say `artwork: "pinned"` or `"none pinned"`, only the 36 pinned entries carry a
  command, and `find-icon`, the build report, `--list-packs` and `pack-index.md`
  tell the two apart (#84)
- `build-packs` refuses a mark whose every fill, stroke and gradient stop is
  white, the dark-background half of a logo pair that draws an empty tile on a
  light canvas, and `--verify` checks every committed payload for it (#85)
- The repository-wide checks read the files git says are ours - tracked, plus
  new ones that are not ignored - instead of walking the working tree past
  three hand-written skip lists, so a local agent install in the repository
  root no longer fails the docs-link and redaction guards on a stranger's
  Markdown
- The 12 Azure review contact sheets are untracked: 6.3 MB that `.gitignore`,
  `package.json` and two docs all described as not being in the repository,
  and a check now fails on any tracked file gitignore excludes
- `icon-build.mjs` no longer carries a raw NUL byte, which made every diff and
  grep treat the file as binary; the two tar type bytes it compared against
  were unreachable anyway
- A spec naming an icon by its exact catalog id now draws that id's own mark:
  `<pack>/<slug>` is looked up as an id, not passed through text search, which
  drew another product's mark for 752 of the 4,843 committed ids (#95)
- A fetched logo is sized from the root `<svg>` element's own attributes, so a
  child `<rect>` or a `stroke-width` can no longer set its aspect, and both
  engines now read the same bytes the same way (#96)
- An invalid installer argument is refused before any adapter is written, a
  prototype-key command is a usage error rather than a crash, and an unknown
  test suite or flag is rejected (#97)
- The docs no longer show stale CLI examples or overstate what a preview
  needs, and the README introduction is shorter (#97)
- The Excalidraw library README links to `docs/excalidraw-libraries.md`
  instead of a page that no longer exists, and the docs link check now reads
  first-party Markdown inside library folders (#87)
- A plugin update no longer wipes what the learning skills learned: records,
  source lists and notes live in `~/.arkitect/` (`ARKITECT_HOME`), outside the
  plugin (#89)
- Long file-type extensions render readably instead of shrinking to 5.65px
  (#14)
- Draw.io `validate`/`build`/`analyze` no longer misread a flag's value as a
  file, or silently skip an unchecked page (#37)
- `contact-sheet.mjs --png` no longer leaves a Chrome profile (cookies,
  history) behind in the skill directory (#44)
- The npm package is trimmed from 106 MB/153 MB to 16 MB/47 MB packed/unpacked
  by excluding local-only caches and profiles (#38)
- A spec naming a missing node, parent or edge endpoint is refused before
  anything is written, in both engines (#36)
- Two rebuilds in the same second no longer overwrite each other's backup
  (#35)
- A name fragment (`tempo`, `cube`, `active directory`) no longer resolves
  confidently to an unrelated product (#21)
- A non-square icon no longer stretches to a square cell; size now fits the
  longest side
- Excalidraw's name-only fallback no longer draws an unrelated product;
  unresolved names become a reported placeholder instead (#22)
- gRPC and Memcached icons render again after their embedded SVG's dropped
  namespace declarations were restored
- A broken SVG icon payload can no longer pass validation; every payload is
  now parsed by a strict XML checker (#33)
- gRPC renders in its brand colour instead of black, via a new `paint: tint`
  flag for single-colour devicon marks (#31)
- Draw.io edges no longer route straight through an icon's caption; `validate`
  warns on any route that still crosses one (#45)
- `doctor` finds Draw.io Desktop the same way `render` does, instead of
  checking 4 hard-coded paths (#46)
- The documented fresh-clone test count is checked by the suite itself instead
  of drifting silently across 4 files (#47)
- An unknown node/edge `kind` (a typo) is named in the build report instead of
  silently drawing a fallback with no trace (#48)
- The committed worked examples are proven to match a fresh build from their
  spec: the Draw.io starter byte for byte, the Excalidraw examples element by
  element through a projection that drops ids, seeds, nonces, timestamps and
  index keys (#50)
- `AGENTS.md` and both engine `SKILL.md` files no longer contradict each other
  on icon-search order, spec-vs-hand-written-XML, or the render/commit policy
- The Draw.io icon search's own hint no longer suggests a command that prints
  base64 icon bytes into an agent's context
- `pack-index.md` and `ATTRIBUTION.md` are regenerated after drifting out of
  sync with the current icon catalog
- The bundled-icon count no longer drifts independently across `plugin.json`,
  `marketplace.json`, `package.json` and the installer's adapter text
- `learn-excalidraw-style/SKILL.md` no longer contradicts itself about whether
  the shipped style record already carries real evidence
- A Draw.io search, `--cell` and a build size a shipped mark at its library
  cell, so Restate is placed at 78x69 instead of 78x71 (#80)

## [1.1.0] — 2026-09-12

Eighteen Draw.io icon packs instead of one AWS palette, and a resolver that says
when it is not sure.

### Added

- **Seventeen new icon packs**, ~4,500 new marks, built by `build-packs.mjs`
  from `assets/libraries/sources.json` — a pinned manifest where every upstream
  carries an exact version or a recorded sha256.
  - Vendor sets, embedded verbatim: `azure` (638), `gcp` (249).
  - Curated: `data-platforms`, `databases`, `ai-frameworks`, `ml-training`,
    `streaming-orchestration`, `observability`, `devops`, `security-identity`,
    `github`, `saas-collab`, `languages-runtimes`.
  - Generated from Lucide and Octicon glyphs: `agents` (33 agent-architecture
    concepts), `primitives` (43 generic concepts), `file-types` (35 document
    sheets badged with an extension).
  - `brands` (3,158) as a catch-all, ranked strictly below every curated pack.
- **Pack-aware resolution.** `find-icon.mjs` ranks across every pack, gains
  `--list-packs`, `--pack` and `--context`, and returns a confidence verdict
  with alternatives instead of always handing back its best guess.
- **Spec-level icon steering.** `context.packs` on a spec biases ties toward the
  stack being drawn; `pack` on a node pins it outright.
- **On-demand catalogue entries.** 69 products whose marks carry no
  redistribution licence are catalogued with a URL, a licence note and the exact
  `fetch-logo` command — and no bytes. `build-diagram.mjs` refuses to draw them
  rather than substituting another product's mark.
- **Contact sheets** for every pack, committed as PNGs, because no structural
  check can notice that a service is wearing the wrong artwork.
- `contact-sheet.mjs` and `write-pack-docs.mjs`; `arkitect drawio packs` and
  `arkitect drawio sheets`.
- `references/pack-index.md` and `assets/libraries/ATTRIBUTION.md`, both
  generated from the catalog so they cannot drift from what shipped.

### Changed

- **Icon titles are readable.** `Arch Amazon-Route-53 64` is now
  `Amazon Route 53`. The old palette captions, plural forms and acronyms are all
  kept as aliases, so `s3`, `data factory` and
  `Arch Amazon-Simple-Storage-Service 64` all still resolve.
- `icon-catalog.json` is pack-aware: namespaced ids, per-icon licence and
  source, and `bytes: committed | on-demand`. Still metadata only.
- `arkitect drawio library` is now `arkitect drawio packs`.

### Removed

- `AWS-v1.drawio` and `AWS-icons.merged.drawio` were content-identical, and
  `AWS-icons.drawio.xml` was a 237-entry subset missing the six AgentCore
  icons. One survives as `aws.drawio` with its artwork untouched; deleting the
  other two reclaims 8.8 MB, which nearly pays for everything added above.
- `extract-library.mjs`, which verified that two AWS palettes byte-matched.
  `build-packs.mjs --verify` checks what matters now: that every committed
  library still matches the manifest it was built from.

### Fixed

- Simple Icons lists "Terraform" as an alias of OpenTofu, which put a fork one
  point behind the real product. The catch-all no longer carries names a curated
  pack already owns.

## [1.0.0] — 2026-09-08

First public release. Two diagram engines, one contract, no dependencies.

### Draw.io

- Native `.drawio` generation from a JSON spec: grid layout, boundaries,
  five connector kinds, an auto-generated legend, collision-free placement.
- A 243-entry AWS Architecture Icons palette, searchable by product name, with
  duplicate titles disambiguated by index, dimensions and payload hash.
- Real product logos for non-AWS components: fetched from a URL you name,
  transparency-checked, embedded in the cell rather than linked.
- A structural validator and a page-scoped analyzer that never pulls XML or
  labels into context.
- PNG rendering through Draw.io Desktop, with the 1-based `--page-index`
  off-by-one corrected.

### Excalidraw

- Native `.excalidraw` generation with every arrow bound at both ends,
  boundaries sized from their contents, and seven connector kinds.
- 36 bundled icon libraries — 1,162 items, all native vector geometry — covering
  AWS, Azure, GCP, Snowflake, the data-platform stack, DevOps tooling and
  general IT logos, with numbered contact sheets for the 239 unnamed items.
- Icons built from real logos: `--trace` converts a flat SVG into native
  Excalidraw geometry, holes and fill rules included.
- The public library catalogue, searchable and installable from the command
  line.
- An honest placeholder for anything unresolvable, named in the build report.
- A dependency-free SVG renderer that reproduces the hand-drawn stroke, plus PNG
  rasterisation through headless Edge or Chrome.
- Excalidraw in Docker: the official image, read-only, no backend, nothing
  uploaded.

### Both

- A learned house style per engine, every rule carrying its evidence count and
  confidence, with defaults marked as defaults.
- Two user-invoked learning skills that fold your own diagrams into the record —
  merging rather than replacing, and lowering confidence on contradiction.
- Structural-statistics-only style records: no labels, page names, paths or image
  payloads, enforced by a test.
- `bin/arkitect.mjs`: one command surface over both engines, plus `doctor` and
  `install`.
- Agent adapters for Claude Code (a 4-skill plugin), Codex, Cursor, OpenCode,
  GitHub Copilot, Antigravity and Pi, generated with the install path baked in.
- An offline test suite of 118 checks across both engines and the toolkit,
  including a redaction check that fails the build if anything from a
  reference diagram leaks into the repository.
