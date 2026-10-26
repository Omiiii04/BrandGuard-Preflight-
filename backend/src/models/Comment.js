/**
 * Comment.js — Collaboration and Review Comment Mongoose model.
 *
 * Implements Comment entity from OpenAPI spec & SDD (Section 2.9):
 * Represents a threaded comment, approval action, change request, or override rationale
 * associated with a draft and optional finding.
 */

'use strict';

const mongoose = require('mongoose');

const COMMENT_ACTIONS = ['comment', 'approve', 'request-changes', 'override'];

const commentThreadItemSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorName: {
      type: String,
      trim: true,
      default: '',
    },
    authorRole: {
      type: String,
      trim: true,
      default: 'reviewer',
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const commentSchema = new mongoose.Schema(
  {
    /** Owning organisation tenant */
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
      index: true,
    },

    /** Target draft container */
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Draft',
      required: true,
      index: true,
    },

    /** Optional finding reference */
    findingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Finding',
      default: null,
      index: true,
    },

    /** Action type */
    action: {
      type: String,
      enum: COMMENT_ACTIONS,
      default: 'comment',
      index: true,
    },

    /** UI type identifier */
    type: {
      type: String,
      default: 'comment',
    },

    /** Initial comment author */
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    authorName: {
      type: String,
      trim: true,
      default: '',
    },

    authorRole: {
      type: String,
      trim: true,
      default: 'reviewer',
    },

    /** Root comment body text */
    text: {
      type: String,
      required: true,
      trim: true,
    },

    /** Required when action = override */
    reason: {
      type: String,
      trim: true,
      default: null,
    },

    /** Threaded replies */
    thread: {
      type: [commentThreadItemSchema],
      default: [],
    },

    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'comments',
  }
);

commentSchema.index({ orgId: 1, draftId: 1, createdAt: 1 });
commentSchema.index({ orgId: 1, findingId: 1 });

const Comment = mongoose.model('Comment', commentSchema);
Comment.COMMENT_ACTIONS = COMMENT_ACTIONS;

module.exports = Comment;
