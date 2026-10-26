/**
 * sourceModel.test.js — Tests for Source Mongoose model validation and fields.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Source = require('../src/models/Source');

describe('Source Mongoose Model', () => {
  it('validates a properly constructed Source document', () => {
    const validOrgId = new mongoose.Types.ObjectId();
    const validOwnerId = new mongoose.Types.ObjectId();
    const effectiveDate = new Date('2026-01-01');
    const expiryDate = new Date('2027-01-01');

    const source = new Source({
      orgId: validOrgId,
      fileName: 'brand_guide.pdf',
      storageRef: 'sources/org123/brand_guide.pdf',
      fileSize: 1048576,
      mimeType: 'application/pdf',
      type: 'guideline',
      owner: validOwnerId,
      ownerName: 'Jane Doe',
      version: '2.0',
      effectiveDate,
      expiryDate,
      status: 'active',
    });

    const error = source.validateSync();
    assert.equal(error, undefined);
    assert.equal(source.fileName, 'brand_guide.pdf');
    assert.equal(source.version, '2.0');
    assert.equal(source.ownerName, 'Jane Doe');
    assert.equal(source.expiryDate.toISOString(), expiryDate.toISOString());
    assert.equal(source.status, 'active');
  });

  it('fails validation when required fields are missing', () => {
    const emptySource = new Source({});
    const error = emptySource.validateSync();
    assert.ok(error);
    assert.ok(error.errors.orgId, 'orgId should be required');
    assert.ok(error.errors.fileName, 'fileName should be required');
    assert.ok(error.errors.storageRef, 'storageRef should be required');
    assert.ok(error.errors.fileSize, 'fileSize should be required');
  });

  it('fails validation when invalid type is provided', () => {
    const source = new Source({
      orgId: new mongoose.Types.ObjectId(),
      fileName: 'invalid.pdf',
      storageRef: 'sources/invalid.pdf',
      fileSize: 500,
      type: 'unsupported-type',
    });

    const error = source.validateSync();
    assert.ok(error);
    assert.ok(error.errors.type);
  });

  it('fails validation when invalid status is provided', () => {
    const source = new Source({
      orgId: new mongoose.Types.ObjectId(),
      fileName: 'invalid.pdf',
      storageRef: 'sources/invalid.pdf',
      fileSize: 500,
      status: 'unknown-status',
    });

    const error = source.validateSync();
    assert.ok(error);
    assert.ok(error.errors.status);
  });
});
