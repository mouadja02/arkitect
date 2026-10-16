// The earlier turn: the request of drawio-interview-when-vague, and the first
// question of the interview ladder, asked the way AGENTS.md §2.1 asks it.
// `node history.mjs` rewrites history.jsonl, and tests/toolkit.mjs checks it
// matches.
import { writeHistory } from '../../fixtures.mjs';

export const SESSION = '00000000-0000-4000-8000-00000000d418';

export const TURNS = [
  { user: "I'd like an architecture diagram of our platform for the client's architecture review board next "
    + "Thursday. I'm at my desk all day, so ask me whatever you need." },
  { assistant: 'Happy to. A review board will take whatever is drawn as a claim about your system, so I will ask '
    + 'one thing at a time, each with the answer I would pick, and stop as soon as what is left could not change '
    + 'the drawing.\n\n'
    + '**What should the diagram cover?**\n\n'
    + 'My recommendation: one end-to-end flow, the one the board is most likely to probe, rather than the whole '
    + 'platform. A whole-platform view at review-board detail usually runs to forty boxes and answers no one '
    + 'question well.' },
];

writeHistory(import.meta, TURNS, { sessionId: SESSION });
