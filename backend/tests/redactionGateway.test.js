/**
 * redactionGateway.test.js — Unit and middleware tests for redactionGateway.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  redactContent,
  loadOrgWatchlist,
  redactionGateway,
  escapeRegExp,
} = require('../src/middleware/redactionGateway');
const Org = require('../src/models/Org');

describe('Redaction Gateway (redactionGateway.js)', () => {
  describe('redactContent() function', () => {
    it('replaces exact watchlist matches with [REDACTED] in copy while keeping original', () => {
      const original = 'Welcome to the launch of Project Nova featuring Acme Ultra.';
      const watchlist = ['Project Nova', 'Acme Ultra'];

      const result = redactContent(original, watchlist);

      assert.equal(result.original, original);
      assert.equal(result.redactedContent, 'Welcome to the launch of [REDACTED] featuring [REDACTED].');
      assert.equal(result.hasRedactions, true);
      assert.equal(result.totalReplacements, 2);
      assert.equal(result.redactions.length, 2);
    });

    it('performs case-insensitive term matching', () => {
      const original = 'project nova is great. PROJECT NOVA is our biggest secret.';
      const watchlist = ['Project Nova'];

      const result = redactContent(original, watchlist);

      assert.equal(result.redactedContent, '[REDACTED] is great. [REDACTED] is our biggest secret.');
      assert.equal(result.totalReplacements, 2);
      assert.equal(result.redactions[0].count, 2);
    });

    it('matches longer phrases before shorter substrings (descending length ordering)', () => {
      const original = 'Announcement about Project Nova Alpha and Nova separately.';
      // Note the watchlist has "Nova" and longer "Project Nova Alpha"
      const watchlist = ['Nova', 'Project Nova Alpha'];

      const result = redactContent(original, watchlist);

      assert.equal(result.redactedContent, 'Announcement about [REDACTED] and [REDACTED] separately.');
      assert.equal(result.totalReplacements, 2);
      // Project Nova Alpha was replaced as a whole, not "Project [REDACTED] Alpha"
      assert.ok(!result.redactedContent.includes('Project [REDACTED]'));
    });

    it('respects word boundaries so terms do not redact inside unrelated words', () => {
      const original = 'Nova will innovate new solutions for our clients.';
      const watchlist = ['Nova'];

      const result = redactContent(original, watchlist);

      assert.equal(result.redactedContent, '[REDACTED] will innovate new solutions for our clients.');
      assert.equal(result.totalReplacements, 1);
      assert.ok(result.redactedContent.includes('innovate'));
    });

    it('safely handles empty content, empty watchlist, or non-string inputs', () => {
      const emptyWatchlist = redactContent('Hello world', []);
      assert.equal(emptyWatchlist.redactedContent, 'Hello world');
      assert.equal(emptyWatchlist.hasRedactions, false);
      assert.equal(emptyWatchlist.totalReplacements, 0);

      const emptyContent = redactContent('', ['Secret']);
      assert.equal(emptyContent.redactedContent, '');
      assert.equal(emptyContent.hasRedactions, false);

      const nullContent = redactContent(null, ['Secret']);
      assert.equal(nullContent.redactedContent, '');
      assert.equal(nullContent.hasRedactions, false);
    });

    it('escapes special regex characters in confidential terms', () => {
      const original = 'The code is [TOP-SECRET] and $1,000,000 prize.';
      const watchlist = ['[TOP-SECRET]', '$1,000,000'];

      const result = redactContent(original, watchlist);

      assert.equal(result.redactedContent, 'The code is [REDACTED] and [REDACTED] prize.');
      assert.equal(result.totalReplacements, 2);
    });
  });

  describe('loadOrgWatchlist() helper', () => {
    it('returns watchlist directly from cached req.org if present', async () => {
      const cachedOrg = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Acme',
        watchlist: ['Project Falcon', 'Client Omega'],
      };

      const list = await loadOrgWatchlist(cachedOrg._id, cachedOrg);
      assert.deepEqual(list, ['Project Falcon', 'Client Omega']);
    });

    it('fetches watchlist from Org model when not cached', async () => {
      const orgId = new mongoose.Types.ObjectId();
      const originalFindById = Org.findById;

      Org.findById = function (id) {
        return {
          select: function () {
            return {
              lean: async function () {
                return { _id: orgId, watchlist: ['Embargoed Brand'] };
              },
            };
          },
        };
      };

      try {
        const list = await loadOrgWatchlist(orgId);
        assert.deepEqual(list, ['Embargoed Brand']);
      } finally {
        Org.findById = originalFindById;
      }
    });

    it('returns empty array when orgId is missing or query fails', async () => {
      const list = await loadOrgWatchlist(null);
      assert.deepEqual(list, []);
    });
  });

  describe('redactionGateway middleware execution', () => {
    it('populates req.redactedContent, req.redactions, and logs redactions', async () => {
      const req = {
        org: {
          _id: new mongoose.Types.ObjectId(),
          watchlist: ['Project Titan'],
        },
        body: {
          content: 'Launch of Project Titan is scheduled for next month.',
        },
      };

      const res = {};
      let nextCalled = false;

      // Capture console.log
      let loggedMessage = '';
      const originalLog = console.log;
      console.log = function (msg) {
        loggedMessage += msg + ' ';
      };

      try {
        await redactionGateway(req, res, () => {
          nextCalled = true;
        });

        assert.equal(nextCalled, true);
        assert.equal(req.redactedContent, 'Launch of [REDACTED] is scheduled for next month.');
        assert.equal(req.body.redactedContent, 'Launch of [REDACTED] is scheduled for next month.');
        assert.equal(req.hasRedactions, true);
        assert.equal(req.redactions.length, 1);
        assert.equal(req.redactions[0].term, 'Project Titan');
        assert.equal(req.redactions[0].count, 1);
        assert.ok(loggedMessage.includes('Project Titan'));
      } finally {
        console.log = originalLog;
      }
    });

    it('extracts content from plain-text req.file if body.content is absent', async () => {
      const req = {
        org: {
          _id: new mongoose.Types.ObjectId(),
          watchlist: ['Confidential Project'],
        },
        file: {
          originalname: 'draft_announcement.md',
          mimetype: 'text/markdown',
          buffer: Buffer.from('Here is the plan for Confidential Project release.'),
        },
        body: {},
      };

      let nextCalled = false;
      await redactionGateway(req, {}, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.equal(req.redactedContent, 'Here is the plan for [REDACTED] release.');
      assert.equal(req.hasRedactions, true);
    });
  });
});
