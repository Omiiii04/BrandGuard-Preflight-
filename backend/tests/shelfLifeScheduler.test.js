/**
 * shelfLifeScheduler.test.js — Unit and logic tests for shelfLifeScheduler.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Source = require('../src/models/Source');
const mlOrchestrator = require('../src/services/mlOrchestrator');
const {
  checkExpiringItems,
  startShelfLifeScheduler,
  stopShelfLifeScheduler,
  getSchedulerStatus,
} = require('../src/services/shelfLifeScheduler');

describe('shelfLifeScheduler Service', () => {
  const mockOrgId = new mongoose.Types.ObjectId();
  const mockUserId = new mongoose.Types.ObjectId();

  describe('checkExpiringItems() logic', () => {
    it('generates expiry_warning for items expiring within 30 days and marks past items as expired', async () => {
      const now = new Date('2026-10-27T00:00:00Z');

      // Candidate 1: Expiring in 10 days
      const expiringSoonSource = {
        _id: new mongoose.Types.ObjectId(),
        orgId: mockOrgId,
        owner: mockUserId,
        fileName: 'policy_2026.pdf',
        expiryDate: new Date('2026-11-06T00:00:00Z'),
        status: 'ready',
      };

      // Candidate 2: Already expired 2 days ago
      const expiredSource = {
        _id: new mongoose.Types.ObjectId(),
        orgId: mockOrgId,
        owner: mockUserId,
        fileName: 'old_contract.docx',
        expiryDate: new Date('2026-10-25T00:00:00Z'),
        status: 'ready',
      };

      // Stub Source.find and AuditLog.prototype.save
      const AuditLog = require('../src/models/AuditLog');
      const originalFind = Source.find;
      const originalUpdateOne = Source.updateOne;
      const originalAuditSave = AuditLog.prototype.save;
      const originalUpdateSourceMetadata = mlOrchestrator.updateSourceMetadata;
      const originalMlServiceUrl = process.env.ML_SERVICE_URL;

      let updatedId = null;
      let updatedStatus = null;
      const savedAuditEvents = [];
      const syncOrder = [];
      const metadataUpdates = [];

      process.env.ML_SERVICE_URL = 'http://ml:8000';
      mlOrchestrator.updateSourceMetadata = async (payload) => {
        metadataUpdates.push(payload);
        syncOrder.push('ml-index');
        return { updated: true, sourceId: String(payload.sourceId), orgId: String(payload.orgId), passageCount: 1 };
      };

      AuditLog.prototype.save = async function () {
        savedAuditEvents.push(this.toObject());
        return this;
      };

      Source.find = function () {
        return {
          lean: async function () {
            return [expiringSoonSource, expiredSource];
          },
        };
      };

      Source.updateOne = async function (filter, update) {

        updatedId = filter._id;
        updatedStatus = update.$set.status;
        syncOrder.push('mongo');
        return { modifiedCount: 1 };
      };

      try {
        const results = await checkExpiringItems({ now, warningDays: 30 });

        assert.equal(results.warningsGenerated, 1);
        assert.equal(results.expiredCount, 1);
        assert.equal(results.details.length, 2);

        // Verify expiring soon entry
        const warningItem = results.details.find((d) => d.status === 'expiring_soon');
        assert.ok(warningItem);
        assert.equal(warningItem.fileName, 'policy_2026.pdf');
        assert.equal(warningItem.daysRemaining, 10);

        // Verify expired entry and DB update
        const expiredItem = results.details.find((d) => d.status === 'expired');
        assert.ok(expiredItem);
        assert.equal(expiredItem.fileName, 'old_contract.docx');
        assert.deepEqual(updatedId, expiredSource._id);
        assert.equal(updatedStatus, 'expired');
        assert.equal(metadataUpdates.length, 1);
        assert.equal(metadataUpdates[0].status, 'expired');
        assert.deepEqual(syncOrder, ['ml-index', 'mongo'], 'ML index must be deactivated before the DB status changes');

        // Verify AuditLog events recorded
        assert.equal(savedAuditEvents.length, 2);
        assert.ok(savedAuditEvents.some((e) => e.eventType === 'expiry_warning'));
        assert.ok(savedAuditEvents.some((e) => e.eventType === 'source_expired'));
      } finally {
        Source.find = originalFind;
        Source.updateOne = originalUpdateOne;
        AuditLog.prototype.save = originalAuditSave;
        mlOrchestrator.updateSourceMetadata = originalUpdateSourceMetadata;
        if (originalMlServiceUrl === undefined) delete process.env.ML_SERVICE_URL;
        else process.env.ML_SERVICE_URL = originalMlServiceUrl;
      }

    });
  });

  it('leaves a source retryable when ML index expiry synchronization fails', async () => {
    const source = {
      _id: new mongoose.Types.ObjectId(),
      orgId: mockOrgId,
      owner: mockUserId,
      fileName: 'retry-expiry-policy.md',
      expiryDate: new Date('2026-10-25T00:00:00Z'),
      status: 'ready',
    };
    const originalFind = Source.find;
    const originalUpdateOne = Source.updateOne;
    const originalUpdateSourceMetadata = mlOrchestrator.updateSourceMetadata;
    const originalMlServiceUrl = process.env.ML_SERVICE_URL;
    let databaseUpdates = 0;

    process.env.ML_SERVICE_URL = 'http://ml:8000';
    Source.find = () => ({ lean: async () => [source] });
    Source.updateOne = async () => {
      databaseUpdates += 1;
      return { modifiedCount: 1 };
    };
    mlOrchestrator.updateSourceMetadata = async () => {
      throw new Error('simulated ML outage');
    };

    try {
      const results = await checkExpiringItems({
        now: new Date('2026-10-27T00:00:00Z'),
        warningDays: 30,
      });

      assert.equal(results.expiredCount, 0);
      assert.equal(databaseUpdates, 0, 'MongoDB status must remain retryable when the index could not be updated');
      assert.equal(results.details[0].status, 'expiry_sync_failed');
    } finally {
      Source.find = originalFind;
      Source.updateOne = originalUpdateOne;
      mlOrchestrator.updateSourceMetadata = originalUpdateSourceMetadata;
      if (originalMlServiceUrl === undefined) delete process.env.ML_SERVICE_URL;
      else process.env.ML_SERVICE_URL = originalMlServiceUrl;
    }
  });

  describe('Scheduler lifecycle (start, stop, status)', () => {
    it('manages cron lifecycle properly', () => {
      stopShelfLifeScheduler();
      assert.equal(getSchedulerStatus().running, false);

      const task = startShelfLifeScheduler('0 0 * * *');
      assert.ok(task);
      assert.equal(getSchedulerStatus().running, true);

      stopShelfLifeScheduler();
      assert.equal(getSchedulerStatus().running, false);
    });
  });
});
