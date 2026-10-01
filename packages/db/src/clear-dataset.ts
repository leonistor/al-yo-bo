import { createInterface } from 'node:readline/promises';

import { checkpoint, openDatabase } from './connection.ts';
import { setupDatabase } from './migrations.ts';
import { clearDatasetContent, countDatasetContent, getDatasetByName } from './queries/datasets.ts';

/** Runs when neither the CLI argument nor `DEFAULT_DATASET` sets a dataset. */
const FALLBACK_DATASET = 'default';

const USAGE = `Clear all content in one dataset (bookmarks, vocabulary, staged imports).

Usage:
  bun run db:clear [dataset] [--yes]

Arguments:
  dataset     Dataset name to clear. Defaults to DEFAULT_DATASET, then "${FALLBACK_DATASET}".

Options:
  -y, --yes   Skip the interactive confirmation prompt.
  -h, --help  Show this help.

The dataset row itself is kept so the name can be reused for a fresh import.
Other datasets are never touched. Qdrant points for removed bookmarks are
repaired from SQLite at the next server startup.`;

interface ClearOptions {
  dataset: string;
  yes: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ClearOptions {
  let dataset: string | undefined;
  let yes = false;
  let help = false;

  for (const arg of argv) {
    if (arg === '-y' || arg === '--yes') {
      yes = true;
    } else if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (dataset === undefined) {
      dataset = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return {
    dataset: dataset ?? process.env.DEFAULT_DATASET ?? FALLBACK_DATASET,
    yes,
    help,
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const db = openDatabase();
  setupDatabase(db);

  const dataset = getDatasetByName(db, options.dataset);
  if (!dataset) {
    console.log(`Dataset "${options.dataset}" does not exist — nothing to clear.`);
    process.exit(0);
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.error('Refusing to clear without confirmation in a non-interactive shell; pass --yes.');
      process.exit(1);
    }
    const counts = countDatasetContent(db, dataset.id);
    console.log(`Dataset "${dataset.name}" currently holds:`);
    console.log(JSON.stringify(counts, null, 2));
    const confirmed = await confirm(
      `Delete ALL of the above? This cannot be undone. [y/N] `,
    );
    if (!confirmed) {
      console.log('Aborted — nothing was deleted.');
      process.exit(0);
    }
  }

  const report = clearDatasetContent(db, dataset.id);
  checkpoint(db);
  console.log(`Cleared dataset "${dataset.name}" (${dataset.id})`);
  console.log(JSON.stringify(report, null, 2));
}
