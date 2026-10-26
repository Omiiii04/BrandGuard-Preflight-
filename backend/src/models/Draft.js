/**
 * Draft.js — Content Draft Mongoose model.
 *
 * Implements Draft entity from OpenAPI spec & SDD (Section 2.6):
 * Represents a brand marketing draft submitted for compliance checking,
 * containing author, status lifecycle, format, and intent guidelines.
 */

const mongoose = require('mongoose');

const DRAFT_STATUSES = ['draft', 'checked', 'in-review', 'approved', 'published'];
const DRAFT_FORMATS = ['text', 'docx', 'pdf'];

const draftSchema = new mongoose.Schema(
  {
    /** Reference to the owning organisation tenant */
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
      index: true,
    },

    /** Reference to the user author who submitted the draft */
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * Review lifecycle status:
     *   - draft: newly submitted or edited
     *   - checked: ML pipeline analysis complete
     *   - in-review: human review in progress
     *   - approved: signed off by brand manager
     *   - published: finalized for public release
     */
    status: {
      type: String,
      enum: DRAFT_STATUSES,
      default: 'draft',
      index: true,
    },

    /** Original format of the draft asset */
    format: {
      type: String,
      enum: DRAFT_FORMATS,
      default: 'text',
    },

    /**
     * Intent form parameters defining marketing objectives and constraints:
     *   - purpose: primary communication objective
     *   - audience: intended recipient segment
     *   - mustSay: mandatory disclaimers, key messages, or required phrases
     */
    intent: {
      purpose: {
        type: String,
        required: true,
        trim: true,
      },
      audience: {
        type: String,
        required: true,
        trim: true,
      },
      mustSay: {
        type: [String],
        required: true,
        default: [],
      },
    },

    /** Optional descriptive title */
    title: {
      type: String,
      trim: true,
      maxlength: 255,
    },

    /** Original uploaded filename if submitted via file */
    fileName: {
      type: String,
      trim: true,
    },

    /** Object storage key in MinIO (e.g., drafts/<orgId>/<uuid>-<filename>) */
    storageRef: {
      type: String,
      trim: true,
    },

    /** Uploaded file size in bytes */
    fileSize: {
      type: Number,
      min: 0,
    },

    /** Latest version number associated with this draft */
    currentVersion: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: 'drafts',
  }
);

// Compound indexes for tenant-isolated querying
draftSchema.index({ orgId: 1, createdAt: -1 });
draftSchema.index({ orgId: 1, status: 1 });
draftSchema.index({ orgId: 1, author: 1 });

const Draft = mongoose.model('Draft', draftSchema);
Draft.DRAFT_STATUSES = DRAFT_STATUSES;
Draft.DRAFT_FORMATS = DRAFT_FORMATS;

module.exports = Draft;
