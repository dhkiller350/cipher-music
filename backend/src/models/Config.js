'use strict';

const mongoose = require('mongoose');

/**
 * Key-value store for global platform configuration.
 * Used for maintenance mode toggle, feature flags, etc.
 */
const configSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    updatedBy: {
      type: String, // admin user email
      default: null,
    },
  },
  { timestamps: true }
);

configSchema.statics.get = async function (key, defaultValue = null) {
  const doc = await this.findOne({ key }).lean();
  return doc ? doc.value : defaultValue;
};

configSchema.statics.set = async function (key, value, updatedBy = null) {
  return this.findOneAndUpdate(
    { key },
    { value, updatedBy },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Returns true when platform_status === 'maintenance'.
 * Non-admin requests should be blocked when this returns true.
 */
configSchema.statics.isMaintenanceMode = async function () {
  const status = await this.get('platform_status', 'active');
  return status === 'maintenance';
};

const Config = mongoose.model('Config', configSchema);

module.exports = Config;
