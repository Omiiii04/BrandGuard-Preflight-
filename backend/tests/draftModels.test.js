/**
 * draftModels.test.js — Unit tests for Draft and DraftVersion Mongoose models.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Draft = require('../src/models/Draft');
const DraftVersion = require('../src/models/DraftVersion');
const { sha256 } = require('../src/utils/hash');

describe('Draft & DraftVersion Mongoose Models', () => {
  const validOrgId = new mongoose.Types.ObjectId();
  const validAuthorId = new mongoose.Types.ObjectId();
  const validDraftId = new mongoose.Types.ObjectId();

  describe('Draft Model validation', () => {
    it('successfully validates a complete Draft document', async () => {
      const draft = new Draft({
        orgId: validOrgId,
        author: validAuthorId,
        status: 'draft',
        format: 'text',
        intent: {
          purpose: 'Promotional announcement for winter collection',
          audience: 'Existing UK customers aged 25-45',
          mustSay: ['free returns', '14-day trial'],
        },
        title: 'Winter Collection Promo',
        currentVersion: 1,
      });

      const err = draft.validateSync();
      assert.equal(err, undefined);
      assert.equal(draft.status, 'draft');
      assert.equal(draft.format, 'text');
      assert.equal(draft.currentVersion, 1);
    });

    it('rejects Draft missing required intent fields', async () => {
      const draft = new Draft({
        orgId: validOrgId,
        author: validAuthorId,
        status: 'draft',
        intent: {
          purpose: '',
          // audience missing
        },
      });

      const err = draft.validateSync();
      assert.ok(err);
      assert.ok(err.errors['intent.purpose']);
      assert.ok(err.errors['intent.audience']);
    });

    it('rejects Draft with invalid status or format', async () => {
      const draft = new Draft({
        orgId: validOrgId,
        author: validAuthorId,
        status: 'invalid-status',
        format: 'mp4',
        intent: {
          purpose: 'Test',
          audience: 'Test',
          mustSay: ['Test'],
        },
      });

      const err = draft.validateSync();
      assert.ok(err);
      assert.ok(err.errors['status']);
      assert.ok(err.errors['format']);
    });
  });

  describe('DraftVersion Model validation', () => {
    it('validates a correct DraftVersion document with SHA-256 hash', async () => {
      const content = 'All orders come with free returns within 14 days.';
      const contentHash = sha256(content);

      const version = new DraftVersion({
        draftId: validDraftId,
        orgId: validOrgId,
        versionNumber: 1,
        content,
        contentHash,
        diff: '',
        author: validAuthorId,
      });

      const err = version.validateSync();
      assert.equal(err, undefined);
      assert.equal(version.versionNumber, 1);
      assert.equal(version.contentHash.length, 64);
    });

    it('rejects DraftVersion with malformed or missing SHA-256 hash', async () => {
      const version = new DraftVersion({
        draftId: validDraftId,
        orgId: validOrgId,
        versionNumber: 1,
        content: 'Some draft text',
        contentHash: 'not-a-valid-sha256-hex',
      });

      const err = version.validateSync();
      assert.ok(err);
      assert.ok(err.errors['contentHash']);
    });

    it('rejects DraftVersion with missing draftId or orgId', async () => {
      const version = new DraftVersion({
        versionNumber: 1,
        content: 'Content',
        contentHash: sha256('Content'),
      });

      const err = version.validateSync();
      assert.ok(err);
      assert.ok(err.errors['draftId']);
      assert.ok(err.errors['orgId']);
    });
  });
});
