#!/usr/bin/env node
// Print the spec a scene was built from, to change and rebuild (#388). It
// rides on the first node's customData, which the app keeps through a save.
import { specCli } from '../../arkitect-drawio/scripts/lib/spec-cli.mjs';
import { specOf, changedSince } from './build-diagram.mjs';
import { readSceneText } from './lib/excalidraw-core.mjs';

process.exit(specCli(process.argv.slice(2), {
  specOf, savedSince: changedSince, kind: 'excalidraw', read: (file) => readSceneText(file).text,
}));
