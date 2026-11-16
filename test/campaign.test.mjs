import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { test } from 'node:test';
import { Donation, holdingLimit, megabyte } from '../public/campaign.mjs';
import { freshExperience, updateExperience, sceneFor } from '../public/experience.mjs';
import { sceneDescriptions } from '../public/scenes.mjs';

test('each mobile and desktop preview pack contains ten valid WebP frames', async () => {
  for (let first = 1; first <= sceneDescriptions.length; first += 10) {
    for (const suffix of ['', '-p']) {
      const key = String(first).padStart(2, '0') + suffix;
      const { default: frames } = await import('../public/scenes/previews/' + key + '.mjs');
      assert.equal(frames.length, Math.min(10, sceneDescriptions.length - first + 1));
      for (const frame of frames) {
        const buffer = Buffer.from(frame, 'base64');
        assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
        assert.equal(buffer.readUInt32LE(4) + 8, buffer.length);
      }
    }
  }
});

test('every scene has a Korean description and a WebP for both screen orientations', async () => {
  for (const [index, description] of sceneDescriptions.entries()) {
    assert.match(description, /[가-힣]/);
    for (const suffix of ['', '-p']) {
      const name = String(index + 1).padStart(2, '0') + suffix + '.webp';
      const file = await open(new URL('../public/scenes/' + name, import.meta.url));
      try {
        const { buffer } = await file.read(Buffer.alloc(12), 0, 12, 0);
        assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', name);
        assert.equal(buffer.toString('ascii', 8, 12), 'WEBP', name);
        assert.equal(buffer.readUInt32LE(4) + 8, (await file.stat()).size, name);
      } finally {
        await file.close();
      }
    }
  }
});

test('repeat donations add real bytes, reuse the oldest blocks at capacity and return together', () => {
  const donation = new Donation();
  assert.equal(donation.byteLength, 0);
  let accepted = 0;
  for (const n of [4, 8, 16, 16, 16, 8, 4, 16, 16]) {
    accepted += n * megabyte;
    assert.equal(donation.hold(n), n * megabyte);
    assert.equal(donation.byteLength, Math.min(holdingLimit * megabyte, accepted));
  }
  for (const invalid of [0, 5, 500, NaN, '8']) assert.throws(() => donation.hold(invalid));
  assert.equal(donation.byteLength, holdingLimit * megabyte);
  donation.release();
  donation.release();
  assert.equal(donation.byteLength, 0);
  assert.equal(donation.hold(4), 4 * megabyte);
  donation.release();
});

test('a new allocation failure preserves all earlier gifts', t => {
  const account = new Donation();
  account.hold(8);
  const fill = t.mock.method(crypto, 'getRandomValues', () => { throw new RangeError(); });
  assert.throws(() => account.hold(16));
  assert.equal(account.byteLength, 8 * megabyte);
  fill.mock.restore();
  assert.equal(account.hold(4), 4 * megabyte);
  assert.equal(account.byteLength, 12 * megabyte);
  account.release();
});

test('each experience starts at one and both gift types keep working beyond the final scene', () => {
  const other = freshExperience();
  let mine = freshExperience();
  for (let i = 0; i < 35; i++) mine = updateExperience(mine, {type:'virtual', epoch:0, bytes:0});
  assert.equal(mine.virtualGifts,35);
  assert.equal(mine.donatedBytes,0);
  assert.equal(sceneFor(mine),36);
  mine = updateExperience(mine, {type:'actual', epoch:0, bytes:8 * megabyte});
  assert.equal(mine.realGifts,1);
  assert.equal(mine.donatedBytes,8 * megabyte);
  assert.equal(sceneFor(mine),37);
  for (let i = 0; i < 30; i++) mine = updateExperience(mine, {type:'virtual', epoch:0, bytes:0});
  assert.equal(sceneFor(mine),60);
  assert.equal(mine.virtualGifts,65);
  assert.equal(sceneFor(other),1);
});

test('returning visitors see their original photo and unlock the extension with their next gift', () => {
  for (const [gifts, photo] of [[0,1], [12,13], [29,30], [100,30]]) {
    const legacy = { epoch: 2, revision: gifts, realGifts: gifts, virtualGifts: 0, donatedBytes: gifts * 4 * megabyte };
    assert.equal(sceneFor(legacy), photo);
    const next = updateExperience(legacy, {type:'virtual', epoch:2, bytes:0});
    assert.equal(sceneFor(next), photo + 1);
    assert.equal(next.realGifts, gifts);
  }
});

test('reset clears only that browser and stale queued gifts cannot restore it', () => {
  const old = updateExperience(freshExperience(), {type:'actual',bytes:16 * megabyte,epoch:0});
  const clean = updateExperience(old, {type:'reset'});
  assert.equal(sceneFor(clean),1);
  assert.equal(clean.donatedBytes,0);
  assert.equal(clean.realGifts,0);
  assert.equal(clean.virtualGifts,0);
  assert.equal(clean.epoch,1);
  assert.equal(updateExperience(clean, {type:'virtual',epoch:0, bytes:0}),clean);
  assert.equal(sceneFor(updateExperience(clean, {type:'virtual', epoch:1, bytes:0})),2);
  assert.equal(sceneFor(old),2);
});
