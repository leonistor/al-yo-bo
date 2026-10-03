import { describe, expect, test } from 'bun:test';

import { ValidationError } from '../src/errors.ts';
import { createExportService } from '../src/services/export.ts';
import { makeDb } from './support.ts';

describe('ExportService', () => {
  test('rejects an empty formats list before touching the serializers', async () => {
    const db = makeDb();
    const service = createExportService({ db, datasetId: db.datasetId });

    await expect(service.run({}, [])).rejects.toBeInstanceOf(ValidationError);
  });
});
