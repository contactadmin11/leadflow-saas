/**
 * LeadFlow MongoDB Atlas Setup Wizard
 * Run this script once to configure and test your MongoDB connection.
 * 
 * Usage:
 *   node setup.js
 */

const readline = require('readline');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const mongoose = require('mongoose');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

const ENV_PATH = path.join(__dirname, '.env');

function generateSecret(len = 64) {
  return crypto.randomBytes(len).toString('hex').slice(0, len);
}

function generateKey32() {
  return crypto.randomBytes(16).toString('hex'); // 32 chars hex
}

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         LeadFlow SaaS — MongoDB Atlas Setup Wizard          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('This wizard will configure your .env file and test your database.');
  console.log('');
  console.log('━━━ STEP 1: GET YOUR MONGODB ATLAS URI ━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  1. Go to: https://cloud.mongodb.com');
  console.log('  2. Sign up (free) or log in');
  console.log('  3. Create a FREE M0 cluster (choose any cloud/region)');
  console.log('  4. Database Access → Add New User:');
  console.log('     - Username: leadflow');
  console.log('     - Password: (generate a strong one, save it!)');
  console.log('     - Role: Atlas Admin');
  console.log('  5. Network Access → Add IP Address → 0.0.0.0/0 (Allow All)');
  console.log('  6. Click "Connect" → "Drivers" → Copy the connection string');
  console.log('');
  console.log('  The connection string looks like:');
  console.log('  mongodb+srv://leadflow:PASSWORD@cluster0.xxxxx.mongodb.net');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const mongoUri = await ask('Paste your MongoDB Atlas connection string: ');
  if (!mongoUri.trim().startsWith('mongodb')) {
    console.log('\n❌ That does not look like a MongoDB URI. Try again.\n');
    rl.close();
    return;
  }

  // Ensure database name is appended
  let uri = mongoUri.trim();
  if (!uri.includes('/leadflow')) {
    uri = uri.replace('/?', '/leadflow?');
    if (!uri.includes('/leadflow')) uri += '/leadflow?retryWrites=true&w=majority';
  }

  console.log('\n⏳ Testing MongoDB connection...');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    await mongoose.connection.close();
    console.log('✅ MongoDB connection successful!\n');
  } catch (err) {
    console.log('\n❌ Connection failed:', err.message);
    console.log('   Check your username/password and network access settings.');
    console.log('   Make sure 0.0.0.0/0 is in Network Access on Atlas.\n');
    rl.close();
    return;
  }

  const adminPwd    = await ask('Set your ADMIN panel password (for license management): ');
  const appSecretIn = await ask('App secret (press Enter to auto-generate): ');

  const secrets = {
    MONGODB_URI:        uri,
    JWT_ACCESS_SECRET:  generateSecret(64),
    JWT_REFRESH_SECRET: generateSecret(64),
    ENCRYPTION_KEY:     generateKey32(),
    ADMIN_PASSWORD:     adminPwd.trim() || 'admin' + Date.now(),
    ADMIN_JWT_SECRET:   generateSecret(64),
    APP_SECRET:         appSecretIn.trim() || generateSecret(32),
    NODE_ENV:           'development',
    PORT:               '3001',
    CLIENT_URL:         'http://localhost:3001',
    JWT_ACCESS_EXPIRES: '15m',
    JWT_REFRESH_EXPIRES:'7d',
    RATE_LIMIT_MAX:     '200',
    RATE_LIMIT_WINDOW_MS:'900000',
    AUTH_RATE_LIMIT_MAX: '10'
  };

  const envContent = Object.entries(secrets)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  fs.writeFileSync(ENV_PATH, envContent + '\n');

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    ✅ Setup Complete!                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  .env file created with all secrets.');
  console.log('');
  console.log('  ⚠️  IMPORTANT — Save these values somewhere safe:');
  console.log(`  Admin Password : ${secrets.ADMIN_PASSWORD}`);
  console.log(`  App Secret     : ${secrets.APP_SECRET}`);
  console.log('');
  console.log('  Add this App Secret to your frontend api.js:');
  console.log(`  window.LEADFLOW_APP_SECRET = '${secrets.APP_SECRET}';`);
  console.log('');
  console.log('━━━ START THE SERVER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  npm start');
  console.log('  Then open: http://localhost:3001');
  console.log('');

  // Also update the APP_SECRET in client api.js automatically
  const apiJsPath = path.join(__dirname, '..', 'client', 'js', 'api.js');
  if (fs.existsSync(apiJsPath)) {
    let apiJs = fs.readFileSync(apiJsPath, 'utf-8');
    if (!apiJs.includes('X-App-Secret')) {
      // Add secret header injection to _request method
      apiJs = apiJs.replace(
        "if (_accessToken) opts.headers['Authorization'] = `Bearer ${_accessToken}`;",
        `if (_accessToken) opts.headers['Authorization'] = \`Bearer \${_accessToken}\`;\n    if (window.LEADFLOW_APP_SECRET) opts.headers['X-App-Secret'] = window.LEADFLOW_APP_SECRET;`
      );
      fs.writeFileSync(apiJsPath, apiJs);
      console.log('  ✅ api.js updated with App Secret header.');
    }
    console.log('  Add to client/index.html <head>:');
    console.log(`  <script>window.LEADFLOW_APP_SECRET='${secrets.APP_SECRET}';</script>`);
    console.log('');
  }

  rl.close();
}

main().catch(err => { console.error(err); rl.close(); process.exit(1); });
