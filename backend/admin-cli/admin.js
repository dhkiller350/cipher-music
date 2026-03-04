#!/usr/bin/env node
'use strict';

/**
 * Cipher Music — Admin CLI (admin-cli/admin.js)
 *
 * Usage (run from the backend/ directory):
 *   node admin-cli/admin.js list-users
 *   node admin-cli/admin.js ban-user <USER_ID>
 *   node admin-cli/admin.js list-payments
 *
 * Reads DB_URL from .env (or the environment).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');

const [, , command, ...cmdArgs] = process.argv;

async function connect() {
  const DB_URL = process.env.DB_URL || process.env.MONGODB_URI;
  if (!DB_URL) {
    console.error('Error: DB_URL environment variable is not set');
    process.exit(1);
  }
  await mongoose.connect(DB_URL);
}

async function listUsers() {
  const User = require('../models/User');
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).lean();
  if (!users.length) {
    console.log('No users found.');
    return;
  }
  console.log(`\nUsers (${users.length}):\n`);
  for (const u of users) {
    console.log(
      `  ${String(u._id).padEnd(26)}  ${u.email.padEnd(35)}  username=${u.username}  subscription=${u.subscription}  banned=${u.banned}  role=${u.role}`
    );
  }
  console.log();
}

async function banUser(userId) {
  if (!userId) {
    console.error('Usage: node admin-cli/admin.js ban-user <USER_ID>');
    process.exit(1);
  }
  const User = require('../models/User');
  const user = await User.findByIdAndUpdate(userId, { banned: true }, { new: true }).select('-passwordHash');
  if (!user) {
    console.error(`User not found: ${userId}`);
    process.exit(1);
  }
  console.log(`✅  User ${user.email} has been banned.`);
}

async function listPayments() {
  let Payment;
  try {
    Payment = require('../src/models/Payment');
  } catch {
    console.error('Payment model not available. Ensure the src/ backend is installed.');
    process.exit(1);
  }
  const payments = await Payment.find().sort({ createdAt: -1 }).limit(50).lean();
  if (!payments.length) {
    console.log('No payments found.');
    return;
  }
  console.log(`\nPayments (${payments.length}):\n`);
  for (const p of payments) {
    console.log(
      `  ${String(p._id).padEnd(26)}  ${p.userEmail.padEnd(35)}  plan=${p.plan}  amount=$${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}  status=${p.status}`
    );
  }
  console.log();
}

function printHelp() {
  console.log(`
Cipher Music — Admin CLI

Usage: node admin-cli/admin.js <command> [args]

Commands:
  list-users           List all users
  ban-user <USER_ID>   Ban a user by their MongoDB ID
  list-payments        List recent payments
  help                 Show this help message
`);
}

(async () => {
  if (!command || command === 'help') {
    printHelp();
    process.exit(0);
  }

  try {
    await connect();

    switch (command) {
      case 'list-users':
        await listUsers();
        break;
      case 'ban-user':
        await banUser(cmdArgs[0]);
        break;
      case 'list-payments':
        await listPayments();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`❌  Error: ${err.message}`);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
