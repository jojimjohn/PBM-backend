/**
 * Atomic document sequence generator.
 * Uses INSERT ON DUPLICATE KEY UPDATE to increment without race conditions.
 * Gaps occur when transactions roll back after incrementing — this is intentional.
 * Reclaiming gaps would require table-level locks and introduce deadlock risk.
 */
async function getNextSequence(trx, type, year, month, pad = 4) {
  const mm = String(month).padStart(2, '0');

  await trx.raw(
    `INSERT INTO document_sequences (document_type, year, month, last_sequence)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE last_sequence = last_sequence + 1`,
    [type, year, month]
  );

  const row = await trx('document_sequences')
    .where({ document_type: type, year, month })
    .first('last_sequence');

  const seq = String(row.last_sequence).padStart(pad, '0');
  return `${type}-${year}-${mm}-${seq}`;
}

module.exports = { getNextSequence };
