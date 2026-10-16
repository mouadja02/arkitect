// The earlier turn: the agent wrote a spec beside the scene, built, validated,
// rendered and reported. fixture.mjs puts both files back before the next
// turn. The history shows the spec it wrote and the report, not the commands:
// those name the install by its full path, which no file in the repository
// may, and $CLAUDE_PLUGIN_ROOT in their place is empty in the agent's shell,
// so a history spelling them that way taught a command that fails.
// `node history.mjs` rewrites history.jsonl, and tests/toolkit.mjs checks it.
import { writeHistory } from '../../fixtures.mjs';
import { SPEC } from './fixture.mjs';

export const SESSION = '00000000-0000-4000-8000-00000000e418';

export const TURNS = [
  { user: 'Sketch our order flow in Excalidraw for the README: the shop front calls the Orders API, which puts '
    + 'each order on an SQS queue; a fulfilment worker consumes it and writes to Postgres. Save it to '
    + 'docs/orders.excalidraw.' },
  { tool: 'Write', input: { file_path: 'docs/orders.spec.json', content: `${JSON.stringify(SPEC, null, 2)}\n` },
    result: 'File created successfully at: docs/orders.spec.json' },
  { assistant: 'Built with the arkitect-excalidraw skill: the spec above, then its builder, validator and renderer.\n\n'
    + '**File**: `docs/orders.excalidraw`, built from `docs/orders.spec.json` beside it.\n\n'
    + '**Engine**: Excalidraw, as asked, for the README.\n\n'
    + '**Assumptions**: one region; the worker runs on its own host. Both are in the note on the canvas.\n\n'
    + '**Icons**: React for the shop front, SQS and Postgres from the bundled libraries; the Orders API and the '
    + 'worker are plain boxes.\n\n'
    + '**Validation**: PASS, no warnings.\n\n'
    + '**Render**: I looked at `.analysis/renders/orders.png`: five boxes left to right, every arrow bound and labelled.\n\n'
    + '**Deviations**: none.' },
];

writeHistory(import.meta, TURNS, { sessionId: SESSION });
