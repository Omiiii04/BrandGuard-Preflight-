/**
 * auditLogger.test.js — Unit tests for auditLogger service and AuditLog model.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const AuditLog = require('../src/models/AuditLog');
const {
  logEvent,
  logEventSafe,
  extractActorId,
  AUDIT_EVENTS,
} = require('../src/services/auditLogger');

describe('auditLogger Service & AuditLog Model', () => {
  const mockOrgId = new mongoose.Types.ObjectId();
  const mockUserId = new mongoose.Types.ObjectId();
  const mockSourceId = new mongoose.Types.ObjectId();

  describe('extractActorId()', () => {
    it('extracts ObjectId from an ObjectId, string, or user object', () => {
      assert.deepEqual(extractActorId(mockUserId), mockUserId);
      assert.equal(extractActorId(mockUserId.toString()).toString(), mockUserId.toString());
      assert.deepEqual(extractActorId({ _id: mockUserId }), mockUserId);
      assert.equal(extractActorId({ sub: mockUserId.toString() }).toString(), mockUserId.toString());
      assert.equal(extractActorId(null), null);
      assert.equal(extractActorId('invalid-id'), null);
    });
  });

  describe('logEvent() validation', () => {
    it('throws error when orgId is missing (tenant isolation violation)', async () => {
      await assert.rejects(
        async () => {
          await logEvent({
            eventType: 'draft_submitted',
            entityType: 'draft',
          });
        },
        { message: /orgId is required/ }
      );
    });

    it('throws error when eventType is missing', async () => {
      await assert.rejects(
        async () => {
          await logEvent({
            orgId: mockOrgId,
            entityType: 'draft',
          });
        },
        { message: /eventType is required/ }
      );
    });

    it('throws error when entityType is missing', async () => {
      await assert.rejects(
        async () => {
          await logEvent({
            orgId: mockOrgId,
            eventType: 'draft_submitted',
          });
        },
        { message: /entityType is required/ }
      );
    });
  });

  describe('AuditLog Document Instantiation & Append-Only Guarantees', () => {
    it('creates a valid AuditLog document in memory', () => {
      const entry = new AuditLog({
        orgId: mockOrgId,
        actor: mockUserId,
        eventType: AUDIT_EVENTS.SOURCE_UPLOADED,
        entityType: 'source',
        entityId: mockSourceId,
        metadata: { fileName: 'brand_guide.pdf' },
      });

      assert.deepEqual(entry.orgId, mockOrgId);
      assert.deepEqual(entry.actor, mockUserId);
      assert.equal(entry.eventType, 'source_uploaded');
      assert.equal(entry.entityType, 'source');
      assert.deepEqual(entry.entityId, mockSourceId);
      assert.equal(entry.metadata.fileName, 'brand_guide.pdf');
      assert.ok(entry.timestamp instanceof Date);
    });

    it('rejects updates on existing AuditLog instances (immutability pre-save hook)', async () => {
      const entry = new AuditLog({
        orgId: mockOrgId,
        eventType: AUDIT_EVENTS.EXPIRY_WARNING,
        entityType: 'source',
      });

      // Simulate a document that has already been persisted (not new)
      entry.isNew = false;

      await assert.rejects(
        async () => {
          await entry.save();
        },
        { message: /AuditLog records are append-only and cannot be updated/ }
      );
    });
  });

  describe('logEventSafe()', () => {
    it('returns null and does not throw when parameters are invalid', async () => {
      const result = await logEventSafe({
        // Missing orgId, eventType, etc.
      });
      assert.equal(result, null);
    });
  });
});
