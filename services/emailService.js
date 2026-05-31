import nodemailer from 'nodemailer';
import path from 'path';

/**
 * Validates a single email address using a robust regular expression.
 * @param {string} email 
 * @returns {boolean}
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const cleaned = email.trim();
  // Standard RFC 5322 regex validation
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(cleaned);
}

/**
 * Utility to pause execution for a given number of milliseconds.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends bulk job application emails one by one with a delay to prevent SMTP blocking.
 * Streams real-time progress callbacks for every sent/failed email.
 * 
 * @param {Object} params
 * @param {string[]} params.emails - List of target email addresses
 * @param {string} params.subject - Subject line of the email
 * @param {string} params.message - Email HTML or Text body template
 * @param {Object} params.resumeFile - Uploaded multer file metadata (optional)
 * @param {Function} params.onProgress - Callback to pipe updates back to the client
 */
export async function sendBulkEmails({ emails, subject, message, resumeFile, onProgress }) {
  const total = emails.length;
  const sent = [];
  const failed = [];

  // Create standard transporter using environment credentials
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('Gmail SMTP credentials are not configured in the backend environment variables (.env).');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // true for port 465
    auth: {
      user: user.trim(),
      pass: pass.replace(/\s+/g, '').trim(), // Remove any spaces standard in Google App passwords
    },
  });

  // Verify connection configuration before triggering the loop
  try {
    await transporter.verify();
    console.log('✅ SMTP connection authenticated and ready.');
  } catch (error) {
    console.error('❌ SMTP Auth verification failed:', error);
    throw new Error(`Failed to authenticate with Gmail SMTP server. Check credentials. Technical reason: ${error.message}`);
  }

  // Pre-process attachments if a file exists
  const attachments = [];
  if (resumeFile) {
    attachments.push({
      filename: resumeFile.originalname,
      path: resumeFile.path, // Absolute filepath to temporary folder
    });
  }

  // Sequentially send to each email
  for (let i = 0; i < total; i++) {
    const rawEmail = emails[i];
    const email = rawEmail ? rawEmail.trim() : '';

    // Step 1: Validate Email
    if (!validateEmail(email)) {
      const errorMsg = 'Invalid email address format';
      failed.push({ email, error: errorMsg });
      console.warn(`[Validation Failed] ${email || 'Empty email'}`);
      
      // Update progress reporter immediately (no SMTP call made, no delay needed)
      if (onProgress) {
        onProgress({
          index: i + 1,
          total,
          email,
          status: 'failed',
          error: errorMsg,
          sentCount: sent.length,
          failedCount: failed.length,
        });
      }
      continue;
    }

    // Step 2: Rate limiting delay (2 seconds) before sending, EXCEPT for the very first email
    if (i > 0) {
      console.log(`[Rate Limiting] Pausing for 2 seconds before emailing ${email}...`);
      await delay(2000);
    }

    // Step 3: Dispatch Email
    try {
      console.log(`[Sending] Dispatching email to ${email} (${i + 1}/${total})...`);
      
      const mailOptions = {
        from: `"${process.env.EMAIL_NAME || 'Karan Negi'}" <${user}>`,
        to: email,
        subject: subject,
        // Using HTML for rich email rendering while preserving line breaks
        html: message.replace(/\n/g, '<br>'),
        attachments: attachments,
      };

      const info = await transporter.sendMail(mailOptions);
      sent.push({ email, messageId: info.messageId });
      console.log(`[Success] Email successfully sent to ${email}`);

      if (onProgress) {
        onProgress({
          index: i + 1,
          total,
          email,
          status: 'success',
          sentCount: sent.length,
          failedCount: failed.length,
        });
      }
    } catch (err) {
      console.error(`[Error] Failed to send email to ${email}:`, err);
      const errDetail = err.message || 'Unknown SMTP error occurred';
      failed.push({ email, error: errDetail });

      if (onProgress) {
        onProgress({
          index: i + 1,
          total,
          email,
          status: 'failed',
          error: errDetail,
          sentCount: sent.length,
          failedCount: failed.length,
        });
      }
    }
  }

  return { sent, failed };
}
