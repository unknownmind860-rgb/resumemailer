import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

// Load environment variables
dotenv.config();

const user = process.env.EMAIL_USER;
const pass = process.env.EMAIL_APP_PASSWORD;

console.log('\n=======================================');
console.log('        🕵️‍♂️ SMTP CREDENTIALS DIAGNOSTIC');
console.log('=======================================');

console.log('1. Raw Environment Values (as JSON strings):');
console.log('   EMAIL_USER:        ', JSON.stringify(user));
console.log('   EMAIL_APP_PASSWORD:', JSON.stringify(pass));

if (!user || !pass) {
  console.error('\n❌ ERROR: One or both environment variables are missing in your backend/.env file!');
  process.exit(1);
}

console.log('\n2. Character Length Analysis:');
console.log('   EMAIL_USER raw length:        ', user.length);
console.log('   EMAIL_APP_PASSWORD raw length:', pass.length);

const cleanedUser = user.trim();
const cleanedPass = pass.replace(/\s+/g, '').trim();

console.log('   Cleaned EMAIL_USER length:    ', cleanedUser.length);
console.log('   Cleaned PASSWORD length:      ', cleanedPass.length);

console.log('\n3. Verification Details:');
if (cleanedPass.length !== 16) {
  console.log(`   ⚠️ WARNING: Google App Passwords are ALWAYS exactly 16 letters long.`);
  console.log(`      Your cleaned password length is ${cleanedPass.length} letters.`);
  console.log(`      If it is not 16, it is either missing characters or is your regular Gmail password (which is blocked by Google).`);
} else {
  console.log(`   ✅ Password length matches standard 16-character format.`);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: cleanedUser,
    pass: cleanedPass,
  },
});

console.log('\n4. Initiating SMTP Handshake Test...');

transporter.verify((error, success) => {
  if (error) {
    console.error('\n❌ SMTP Auth Verification FAILED!');
    console.error('   Google rejected the login. Technical error:');
    console.error('  ', error.message || error);
    console.log('\n💡 TROUBLESHOOTING TIP:');
    console.log('   If length is 16 and still failing, you might have generated the');
    console.log('   App Password on a different Google Account than negikaran860@gmail.com!');
    console.log('   Make sure you are logged into negikaran860@gmail.com in the browser tab');
    console.log('   when you visit: https://myaccount.google.com/apppasswords');
  } else {
    console.log('\n=======================================');
    console.log('   🎉 SUCCESS! Credentials are 100% correct.');
    console.log('   Nodemailer authenticated successfully.');
    console.log('=======================================');
  }
  console.log('=======================================\n');
});
