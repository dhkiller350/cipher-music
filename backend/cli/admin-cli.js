#!/usr/bin/env node
'use strict';

/**
 * Cipher Music — Admin CLI
 *
 * Manage users and payments directly from the terminal.
 *
 * Usage:
 *   node cli/admin-cli.js <command> [options]
 *
 * Commands:
 *   user:list        [--search <q>] [--banned] [--page <n>] [--limit <n>]
 *   user:get         <userId|email>
 *   user:ban         <userId|email> [--reason <text>]
 *   user:unban       <userId|email>
 *   user:delete      <userId|email>
 *   user:set-plan    <userId|email> --plan <free|premium|family>
 *   user:set-role    <userId|email> --role <user|admin>
 *   user:reset-pwd   <userId|email> --password <new-password>
 *
 *   payment:list     [--status <s>] [--userId <id>] [--page <n>] [--limit <n>]
 *   payment:get      <paymentId>
 *   payment:status   <paymentId> --status <s> [--reason <text>]
 *   payment:create   --userId <id> --email <e> --amount <n> --plan <p> [--currency <c>]
 *
 *   maintenance:on
 *   maintenance:off
 *   maintenance:status
 *
 *   stats
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const { createHash } = require('crypto');

// ── Models (loaded after DB connection) ────────────────────────────────────────
let User, Payment, Config;

// ── CLI arg parsing ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag, defaultValue = null) {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

function hasFlag(flag) {
  return args.includes(`--${flag}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function printJSON(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function resolveUser(identifier) {
  if (!identifier) throw new Error('User identifier (id or email) is required');
  const isId = mongoose.Types.ObjectId.isValid(identifier);
  const user = isId
    ? await User.findById(identifier).select('-sessions -passwordHash')
    : await User.findOne({ email: identifier.toLowerCase() }).select('-sessions -passwordHash');
  if (!user) throw new Error(`User not found: ${identifier}`);
  return user;
}

// ── Confirm admin access via PIN ───────────────────────────────────────────────
async function confirmAdminAccess() {
  const storedHash = process.env.ADMIN_PIN_HASH;
  if (!storedHash) return; // no PIN configured — skip check

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const pin = await new Promise((resolve) => {
    rl.question('Enter admin PIN: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const enteredHash = createHash('sha256').update(pin).digest('hex');
  if (enteredHash !== storedHash) {
    console.error('❌  Invalid admin PIN');
    process.exit(1);
  }
}

// ── Connect to DB ──────────────────────────────────────────────────────────────
async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');
  await mongoose.connect(uri);

  // Require models after connection so Mongoose is ready
  User = require('../src/models/User');
  Payment = require('../src/models/Payment');
  Config = require('../src/models/Config');
}

// ════════════════════════════════════════════════════════════════════════════════
//  COMMAND HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

async function cmdUserList() {
  const search = getFlag('search');
  const banned = hasFlag('banned') ? true : undefined;
  const page = parseInt(getFlag('page', 1), 10);
  const limit = parseInt(getFlag('limit', 20), 10);

  const filter = {};
  if (search) filter.$or = [{ email: { $regex: search, $options: 'i' } }, { username: { $regex: search, $options: 'i' } }];
  if (banned !== undefined) filter.banned = banned;

  const [users, total] = await Promise.all([
    User.find(filter).select('-sessions -passwordHash').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  console.log(`\nUsers (${users.length} of ${total}):\n`);
  for (const u of users) {
    console.log(`  ${u._id}  ${u.email.padEnd(35)}  ${u.username.padEnd(20)}  plan=${u.subscription?.plan || 'free'}  banned=${u.banned}  role=${u.role}`);
  }
  console.log();
}

async function cmdUserGet() {
  const identifier = args[1];
  const user = await resolveUser(identifier);
  printJSON(user.toJSON ? user.toJSON() : user);
}

async function cmdUserBan() {
  const identifier = args[1];
  const reason = getFlag('reason', 'Banned via CLI');
  const user = await resolveUser(identifier);
  user.banned = true;
  user.banReason = reason;
  user.sessions = [];
  await user.save();
  console.log(`✅  User ${user.email} banned. Reason: ${reason}`);
}

async function cmdUserUnban() {
  const identifier = args[1];
  const user = await resolveUser(identifier);
  user.banned = false;
  user.banReason = null;
  await user.save();
  console.log(`✅  User ${user.email} unbanned.`);
}

async function cmdUserDelete() {
  const identifier = args[1];
  const user = await resolveUser(identifier);

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await new Promise((resolve) => {
    rl.question(`⚠️  Permanently delete ${user.email} and all their data? (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });

  if (confirm !== 'yes') {
    console.log('Aborted.');
    return;
  }

  await User.findByIdAndDelete(user._id);
  await Payment.deleteMany({ userId: user._id });
  console.log(`✅  User ${user.email} deleted.`);
}

async function cmdUserSetPlan() {
  const identifier = args[1];
  const plan = getFlag('plan');
  if (!plan) throw new Error('--plan <free|premium|family> is required');
  const user = await resolveUser(identifier);
  user.subscription.plan = plan;
  await user.save();
  console.log(`✅  ${user.email} plan set to ${plan}.`);
}

async function cmdUserSetRole() {
  const identifier = args[1];
  const role = getFlag('role');
  if (!role) throw new Error('--role <user|admin> is required');
  const user = await resolveUser(identifier);
  user.role = role;
  await user.save();
  console.log(`✅  ${user.email} role set to ${role}.`);
}

async function cmdUserResetPwd() {
  const identifier = args[1];
  const password = getFlag('password');
  if (!password) throw new Error('--password <new-password> is required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const user = await User.findById((await resolveUser(identifier))._id).select('+passwordHash');
  await user.setPassword(password);
  user.sessions = []; // invalidate all sessions
  await user.save();
  console.log(`✅  Password reset for ${user.email}. All sessions revoked.`);
}

async function cmdPaymentList() {
  const status = getFlag('status');
  const userId = getFlag('userId');
  const page = parseInt(getFlag('page', 1), 10);
  const limit = parseInt(getFlag('limit', 20), 10);

  const filter = {};
  if (status) filter.status = status;
  if (userId) filter.userId = userId;

  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  console.log(`\nPayments (${payments.length} of ${total}):\n`);
  for (const p of payments) {
    console.log(`  ${p._id}  ${p.userEmail.padEnd(35)}  plan=${p.plan}  amount=${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}  status=${p.status}`);
  }
  console.log();
}

async function cmdPaymentGet() {
  const id = args[1];
  if (!id) throw new Error('paymentId is required');
  const payment = await Payment.findById(id).lean();
  if (!payment) throw new Error(`Payment not found: ${id}`);
  printJSON(payment);
}

async function cmdPaymentStatus() {
  const id = args[1];
  if (!id) throw new Error('paymentId is required');
  const status = getFlag('status');
  if (!status) throw new Error('--status is required');
  const reason = getFlag('reason');

  const payment = await Payment.findById(id);
  if (!payment) throw new Error(`Payment not found: ${id}`);
  payment.setStatus(status, reason || 'Updated via CLI');
  await payment.save();
  console.log(`✅  Payment ${id} status set to ${status}.`);
}

async function cmdPaymentCreate() {
  const userId = getFlag('userId');
  const email = getFlag('email');
  const amount = parseInt(getFlag('amount', 0), 10);
  const plan = getFlag('plan');
  const currency = getFlag('currency', 'usd');
  const notes = getFlag('notes', 'Created via CLI');

  if (!userId || !email || !plan) {
    throw new Error('--userId, --email, and --plan are required');
  }

  const payment = new Payment({ userId, userEmail: email, amount, currency, plan, notes, status: 'succeeded' });
  payment.statusHistory.push({ status: 'succeeded', changedAt: new Date(), reason: 'Created via CLI' });
  await payment.save();
  console.log(`✅  Payment created: ${payment._id}`);
}

async function cmdMaintenanceOn() {
  await Config.set('platform_status', 'maintenance', 'cli');
  console.log('✅  Maintenance mode ON — platform is now in maintenance.');
}

async function cmdMaintenanceOff() {
  await Config.set('platform_status', 'active', 'cli');
  console.log('✅  Maintenance mode OFF — platform is now active.');
}

async function cmdMaintenanceStatus() {
  const status = await Config.get('platform_status', 'active');
  console.log(`Maintenance mode: ${status === 'maintenance' ? '🔴 ON' : '🟢 OFF'} (status=${status})`);
}

async function cmdStats() {
  const [totalUsers, bannedUsers, premiumUsers, totalPayments, succeededRevenue] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ banned: true }),
    User.countDocuments({ 'subscription.plan': { $ne: 'free' }, 'subscription.status': 'active' }),
    Payment.countDocuments(),
    Payment.aggregate([{ $match: { status: 'succeeded' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);

  console.log('\n📊  Platform Stats\n');
  console.log(`  Users total:     ${totalUsers}`);
  console.log(`  Users banned:    ${bannedUsers}`);
  console.log(`  Premium users:   ${premiumUsers}`);
  console.log(`  Payments total:  ${totalPayments}`);
  console.log(`  Revenue:         $${((succeededRevenue[0]?.total ?? 0) / 100).toFixed(2)}`);
  console.log();
}

function printHelp() {
  console.log(`
Cipher Music — Admin CLI

Usage: node cli/admin-cli.js <command> [options]

User commands:
  user:list        [--search <q>] [--banned] [--page <n>] [--limit <n>]
  user:get         <userId|email>
  user:ban         <userId|email> [--reason <text>]
  user:unban       <userId|email>
  user:delete      <userId|email>
  user:set-plan    <userId|email> --plan <free|premium|family>
  user:set-role    <userId|email> --role <user|admin>
  user:reset-pwd   <userId|email> --password <new-password>

Payment commands:
  payment:list     [--status <s>] [--userId <id>] [--page <n>] [--limit <n>]
  payment:get      <paymentId>
  payment:status   <paymentId> --status <s> [--reason <text>]
  payment:create   --userId <id> --email <e> --amount <cents> --plan <p>

Maintenance commands:
  maintenance:on
  maintenance:off
  maintenance:status

Other:
  stats
  help
`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  if (!command || command === 'help') {
    printHelp();
    process.exit(0);
  }

  try {
    await confirmAdminAccess();
    await connect();

    const handlers = {
      'user:list': cmdUserList,
      'user:get': cmdUserGet,
      'user:ban': cmdUserBan,
      'user:unban': cmdUserUnban,
      'user:delete': cmdUserDelete,
      'user:set-plan': cmdUserSetPlan,
      'user:set-role': cmdUserSetRole,
      'user:reset-pwd': cmdUserResetPwd,
      'payment:list': cmdPaymentList,
      'payment:get': cmdPaymentGet,
      'payment:status': cmdPaymentStatus,
      'payment:create': cmdPaymentCreate,
      'maintenance:on': cmdMaintenanceOn,
      'maintenance:off': cmdMaintenanceOff,
      'maintenance:status': cmdMaintenanceStatus,
      'stats': cmdStats,
    };

    const handler = handlers[command];
    if (!handler) {
      console.error(`Unknown command: ${command}\nRun "node cli/admin-cli.js help" for usage.`);
      process.exit(1);
    }

    await handler();
  } catch (err) {
    console.error(`❌  Error: ${err.message}`);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
