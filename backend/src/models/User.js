'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

const settingsSchema = new mongoose.Schema(
  {
    theme: { type: String, default: 'dark' },
    audioQuality: { type: String, enum: ['low', 'medium', 'high'], default: 'high' },
    notifications: { type: Boolean, default: true },
    autoplay: { type: Boolean, default: true },
    crossfade: { type: Number, default: 0, min: 0, max: 12 },
  },
  { _id: false }
);

const recentPlayedSchema = new mongoose.Schema(
  {
    trackId: { type: String, required: true },
    title: { type: String },
    artist: { type: String },
    thumbnail: { type: String },
    playedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    deviceName: { type: String },
    userAgent: { type: String },
    ip: { type: String },
    refreshTokenHash: { type: String, required: true },
    lastSeen: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [32, 'Username must be at most 32 characters'],
      match: [/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, underscores, and hyphens'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // never returned in queries by default
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    subscription: {
      plan: { type: String, enum: ['free', 'premium', 'family'], default: 'free' },
      status: { type: String, enum: ['active', 'canceled', 'past_due', 'none'], default: 'none' },
      expiresAt: { type: Date, default: null },
      stripeCustomerId: { type: String, default: null },
      stripeSubscriptionId: { type: String, default: null },
    },
    banned: {
      type: Boolean,
      default: false,
    },
    banReason: {
      type: String,
      default: null,
    },
    recentPlayed: {
      type: [recentPlayedSchema],
      default: [],
    },
    settings: {
      type: settingsSchema,
      default: () => ({}),
    },
    sessions: {
      type: [sessionSchema],
      default: [],
    },
    // Sync vector clock — incremented on each write so devices can merge state
    syncVersion: {
      type: Number,
      default: 0,
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.sessions;
        return ret;
      },
    },
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
// email and username indexes are already created by unique:true above
// Additional compound or non-unique indexes can be added here if needed.

// ── Instance methods ───────────────────────────────────────────────────────────

/** Hash and set password */
userSchema.methods.setPassword = async function (plaintext) {
  this.passwordHash = await bcrypt.hash(plaintext, SALT_ROUNDS);
};

/** Verify password against stored hash */
userSchema.methods.verifyPassword = async function (plaintext) {
  return bcrypt.compare(plaintext, this.passwordHash);
};

/**
 * Add a track to recentPlayed (capped at 100, deduplicated).
 */
userSchema.methods.addRecentPlayed = function (track) {
  // Remove existing entry for same trackId
  this.recentPlayed = this.recentPlayed.filter((t) => t.trackId !== track.trackId);
  // Prepend new entry
  this.recentPlayed.unshift({ ...track, playedAt: new Date() });
  // Cap at 100
  if (this.recentPlayed.length > 100) {
    this.recentPlayed = this.recentPlayed.slice(0, 100);
  }
};

const User = mongoose.model('User', userSchema);

module.exports = User;
