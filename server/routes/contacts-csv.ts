import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { z } from 'zod';
import db from '../db';
import { parseContactsFile } from '../lib/csv';
import { audit } from '../lib/audit';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

const previewQuery = z.object({
  phoneCol: z.string().optional(),
  nameCol: z.string().optional(),
  delimiter: z.string().max(2).optional(),
});

router.post('/preview', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const opts = previewQuery.parse(req.query);
    const result = parseContactsFile(
      req.file.buffer,
      { phone: opts.phoneCol, name: opts.nameCol },
      { delimiter: opts.delimiter },
    );
    res.json({
      total: result.total,
      invalid: result.invalid,
      sample: result.rows.slice(0, 20),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/commit', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const opts = previewQuery.parse(req.query);
    const userId = req.user!.id;
    const { rows } = parseContactsFile(
      req.file.buffer,
      { phone: opts.phoneCol, name: opts.nameCol },
      { delimiter: opts.delimiter },
    );
    if (rows.length === 0) return res.json({ inserted: 0, updated: 0 });

    const phones = rows.map((r) => r.phone);
    const existing = await db('contacts')
      .where({ userId })
      .whereIn('phone', phones)
      .whereNull('deletedAt');
    const byPhone = new Map(existing.map((c) => [c.phone, c]));

    const toInsert: any[] = [];
    let updated = 0;
    for (const r of rows) {
      const ex = byPhone.get(r.phone);
      if (ex) {
        if (r.name && r.name !== ex.name) {
          // eslint-disable-next-line no-await-in-loop
          await db('contacts').where({ id: ex.id }).update({ name: r.name });
          updated++;
        }
      } else {
        toInsert.push({
          id: crypto.randomUUID(),
          name: r.name ?? null,
          phone: r.phone,
          blacklisted: false,
          userId,
        });
      }
    }
    if (toInsert.length > 0) await db.batchInsert('contacts', toInsert, 200);
    await audit({
      userId,
      action: 'create',
      entityType: 'contacts-csv',
      metadata: { inserted: toInsert.length, updated },
      ip: req.ip,
    });
    res.json({ inserted: toInsert.length, updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
