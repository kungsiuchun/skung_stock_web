import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const migrationPath = new URL('../migrations/0016_spx_gex_pressure_projection.sql', import.meta.url)

type SnapshotInput = {
  minute: number
  snapshotId: string
  valid: boolean
}

function buildSnapshot({ minute, snapshotId, valid }: SnapshotInput) {
  const auditedCell = {
    expdate: '2026-08-26',
    strike: 6_500,
    netGex: 123_456_789,
    model: valid ? 'black_scholes_gamma_exposure_blended_iv' : 'invalid_model',
    callIv: 0.2,
    putIv: 0.21,
    gammaIv: 0.205,
  }

  return JSON.stringify({
    session: {
      snapshotTimeEt: '2026-08-26 10:30 ET',
      snapshotMinuteEt: minute,
      collectedMinuteEt: minute + 2,
      collectedTimeEt: '2026-08-26 10:32 ET',
      generatedAt: '2026-08-26T14:32:00.000Z',
      spot: 6_505.25,
    },
    zeroDte: { expiry: '2026-08-26' },
    canonical: {
      schemaVersion: 1,
      replayGrade: 'NORMALIZED_CANONICAL',
      provider: 'cboe',
      snapshotId,
      payloadHash: `hash-${snapshotId}`,
    },
    source: { calculationEngineVersion: 2 },
    cells: [
      auditedCell,
      {
        ...auditedCell,
        strike: 6_510,
        netGex: -98_765_432,
      },
      {
        ...auditedCell,
        expdate: '2026-08-27',
        strike: 6_500,
        netGex: 999,
      },
    ],
  })
}

test('0016 applies to SQLite, backfills only canonical 0DTE cells, and cascades deletion', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE TABLE spx_gex_intraday_snapshots (
        trading_date TEXT NOT NULL,
        snapshot_minute_et INTEGER NOT NULL,
        snapshot_time_et TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        ticker TEXT NOT NULL DEFAULT 'SPX',
        spot REAL NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (trading_date, snapshot_minute_et)
      );
    `)

    const insertSnapshot = db.prepare(`
      INSERT INTO spx_gex_intraday_snapshots (
        trading_date, snapshot_minute_et, snapshot_time_et, generated_at,
        ticker, spot, snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'SPX', ?, ?, ?, ?)
    `)
    const createdAt = '2026-08-26T14:32:00.000Z'
    insertSnapshot.run(
      '2026-08-26',
      630,
      '2026-08-26 10:30 ET',
      createdAt,
      6505.25,
      buildSnapshot({ minute: 630, snapshotId: 'canonical-slot', valid: true }),
      createdAt,
      createdAt,
    )
    insertSnapshot.run(
      '2026-08-26',
      645,
      '2026-08-26 10:45 ET',
      createdAt,
      6505.25,
      buildSnapshot({ minute: 645, snapshotId: 'invalid-slot', valid: false }),
      createdAt,
      createdAt,
    )

    db.exec(await readFile(migrationPath, 'utf8'))

    const rows = db
      .prepare(`
        SELECT snapshot_minute_et, snapshot_id, payload_hash, expiry, gex_json
        FROM spx_gex_pressure_projections
        ORDER BY snapshot_minute_et
      `)
      .all() as Array<{
      snapshot_minute_et: number
      snapshot_id: string
      payload_hash: string
      expiry: string
      gex_json: string
    }>

    assert.deepEqual(rows.map(({ snapshot_minute_et, snapshot_id, payload_hash, expiry }) => ({
      snapshot_minute_et,
      snapshot_id,
      payload_hash,
      expiry,
    })), [{
      snapshot_minute_et: 630,
      snapshot_id: 'canonical-slot',
      payload_hash: 'hash-canonical-slot',
      expiry: '2026-08-26',
    }])
    assert.deepEqual(JSON.parse(rows[0].gex_json), [
      { strike: 6500, netGex: 123456789 },
      { strike: 6510, netGex: -98765432 },
    ])

    db.prepare(`
      DELETE FROM spx_gex_intraday_snapshots
      WHERE trading_date = ? AND snapshot_minute_et = ?
    `).run('2026-08-26', 630)
    const remainingProjectionRows = db
      .prepare('SELECT COUNT(*) AS count FROM spx_gex_pressure_projections')
      .get() as { count: number }
    assert.equal(remainingProjectionRows.count, 0)
  } finally {
    db.close()
  }
})
