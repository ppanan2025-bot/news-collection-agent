import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReadOnlySql, SqlGuardError } from '../src/lib/sqlGuard.mjs';

const allowed = [
  'SELECT 1',
  "select * from articles where title like '%delete%'",
  'WITH x AS (SELECT 1) SELECT * FROM x',
  'SHOW TABLES',
  'EXPLAIN SELECT * FROM articles WHERE id = 1',
  'SELECT 1;',
  'DESCRIBE articles',
  'SELECT `update` FROM t -- trailing comment',
  'SELECT "it\'s; fine" AS s',
];
const rejected = [
  'SELECT 1; DROP TABLE articles',
  'WITH x AS (SELECT 1) DELETE FROM articles',
  "UPDATE articles SET verification_status='corroborated'",
  '/*!50000 DROP TABLE x*/',
  'SELECT /*+ MAX_EXECUTION_TIME(1) */ 1',
  "SELECT * FROM a INTO OUTFILE '/tmp/x'",
  "SELECT * FROM a INTO DUMPFILE '/tmp/x'",
  'SELECT * FROM articles FOR UPDATE',
  'SELECT * FROM articles LOCK IN SHARE MODE',
  'SELECT SLEEP(10)',
  'SELECT BENCHMARK(1000000, MD5(1))',
  "select load_file('/etc/passwd')",
  'sElEcT 1; dElEtE FROM articles',
  '-- c\nDELETE FROM articles',
  '',
  '   ',
  'SELECT ' + 'x'.repeat(10001),
  'SET @a=1',
  'DELETE FROM articles',
  'INSERT INTO articles VALUES (1)',
  'DROP TABLE articles',
  'EXPLAIN ANALYZE DELETE FROM articles',
  'CALL p()',
  "SELECT 'a' INTO @x",
  'SELECT GET_LOCK("x", 1)',
  "SELECT 1 /* unterminated",
];
for (const sql of allowed) test(`allows: ${sql.slice(0, 60)}`, () => assert.equal(assertReadOnlySql(sql), true));
for (const sql of rejected) {
  test(`rejects: ${JSON.stringify(sql.slice(0, 60))}`, () => assert.throws(() => assertReadOnlySql(sql), SqlGuardError));
}
test('non-string input rejected', () => assert.throws(() => assertReadOnlySql(undefined), SqlGuardError));
