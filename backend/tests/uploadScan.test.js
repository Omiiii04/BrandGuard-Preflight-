/**
 * uploadScan.test.js — Tests for uploadScan middleware and validation.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateFileType,
  performAvScan,
  MAX_FILE_SIZE,
  ALLOWED_EXTENSIONS,
  EICAR_SIGNATURE,
} = require('../src/middleware/uploadScan');

describe('uploadScan validation middleware', () => {
  describe('File-type allow-list', () => {
    it('accepts valid PDF files', () => {
      const res = validateFileType('guideline.pdf', 'application/pdf');
      assert.equal(res.valid, true);
    });

    it('accepts valid DOCX files', () => {
      const res = validateFileType(
        'brand_rules.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      assert.equal(res.valid, true);
    });

    it('accepts valid Markdown files', () => {
      const res1 = validateFileType('terminology.md', 'text/markdown');
      assert.equal(res1.valid, true);

      const res2 = validateFileType('README.markdown', 'text/plain');
      assert.equal(res2.valid, true);
    });

    it('rejects disallowed file types (.exe, .sh, .jpg, .zip)', () => {
      const rejectedFiles = [
        ['malware.exe', 'application/x-msdownload'],
        ['script.sh', 'application/x-sh'],
        ['image.jpg', 'image/jpeg'],
        ['archive.zip', 'application/zip'],
        ['doc.js', 'text/javascript'],
      ];

      for (const [name, mime] of rejectedFiles) {
        const res = validateFileType(name, mime);
        assert.equal(res.valid, false, `Expected ${name} to be rejected`);
        assert.match(res.error, /not permitted/i);
      }
    });

    it('rejects missing filenames', () => {
      const res = validateFileType('', 'application/pdf');
      assert.equal(res.valid, false);
    });
  });

  describe('Size cap (10 MB)', () => {
    it('enforces 10 MB maximum limit (10485760 bytes)', () => {
      assert.equal(MAX_FILE_SIZE, 10 * 1024 * 1024);
    });
  });

  describe('Anti-Virus (AV) scan stub', () => {
    it('passes clean file buffers', async () => {
      const cleanBuffer = Buffer.from('# Brand Guidelines\nApproved terminology.');
      const result = await performAvScan(cleanBuffer, 'clean.md');
      assert.equal(result, true);
    });

    it('rejects files containing the EICAR test signature', async () => {
      const maliciousBuffer = Buffer.from(
        `PREAMBLE\n${EICAR_SIGNATURE}\nPOSTSCRIPT`
      );

      await assert.rejects(
        async () => {
          await performAvScan(maliciousBuffer, 'eicar.pdf');
        },
        {
          name: 'Error',
          message: /Malicious content detected/i,
        }
      );
    });
  });
});
