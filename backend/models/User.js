'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    banned: {
      type: Boolean,
      default: false,
    },
    banReason: {
      type: String,
      default: null,
    },
    subscription: {
      type: String,
      default: 'free',
    },
    recentPlayed: [
      {
        songId: { type: String, required: true },
        date: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    settings: {
      theme: { type: String, default: 'dark' },
      notifications: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
