#!/usr/bin/env node

const crypto = require('crypto');

console.log('🔐 Fast Email 安全密钥生成工具\n');

console.log('='.repeat(60));

const encryptionSecret = crypto.randomBytes(32).toString('hex');
console.log('\n📝 ENCRYPTION_SECRET (用于加密 SMTP 密码):');
console.log(encryptionSecret);
console.log('\n将此值设置到 Render 的 ENCRYPTION_SECRET 环境变量中\n');

console.log('='.repeat(60));

const apiKey = 'fk_' + crypto.randomBytes(32).toString('hex');
console.log('\n🔑 API Key (用于前端认证):');
console.log(apiKey);
console.log('\n1. 将此值设置到 Render 的 API_KEY_HASH 环境变量中');
console.log('2. 在前端应用中输入此 API Key\n');

console.log('='.repeat(60));
console.log('\n⚠️  重要提示：');
console.log('1. 请妥善保存这些密钥，丢失后无法恢复');
console.log('2. 不要将这些密钥提交到 Git 仓库');
console.log('3. 定期轮换 API Key 以确保安全');
console.log('4. ENCRYPTION_SECRET 一旦设置就不要更改，否则已加密的密码无法解密\n');
