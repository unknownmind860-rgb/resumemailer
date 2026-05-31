import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { sendBulkEmails } from './services/emailService.js';

// Resolve current directory path for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Create Express Application
const app = express();
const PORT = process.env.PORT || 5000;

// Security Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(morgan('dev'));

// CORS Configuration
app.use(cors({
  origin: '*', // In production, replace with specific frontend domain
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup temporary upload directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate a secure unique filename keeping the original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Multer File filter for strict formats
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.docx', '.doc'];
  const allowedMimeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ];

  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;

  if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(mime)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and DOC/DOCX files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Strict 5MB file size limit
  },
  fileFilter: fileFilter
});

// Rate limiting to avoid API abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per window
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

app.use('/send-emails', apiLimiter);

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

/**
 * POST /send-emails
 * Accepts multipart/form-data with fields:
 * - emails: Comma or newline separated string of recipient email addresses
 * - subject: Email subject line
 * - message: Rich text email body template
 * - resume: File upload (PDF/DOCX)
 * 
 * Responses are streamed in real-time as NDJSON (Newline Delimited JSON).
 */
app.post('/send-emails', upload.single('resume'), async (req, res) => {
  let uploadedFilePath = req.file ? req.file.path : null;

  try {
    const { emails: rawEmails, subject, message } = req.body;

    // Validate textual fields
    if (!rawEmails) {
      throw new Error('Recipients list (emails) is required.');
    }
    if (!subject || !subject.trim()) {
      throw new Error('Email subject line is required.');
    }
    if (!message || !message.trim()) {
      throw new Error('Email body/message template is required.');
    }

    // Split and parse recipient email addresses from text (comma or newline separated)
    const emails = rawEmails
      .split(/[\n,]/)
      .map(email => email.trim())
      .filter(email => email.length > 0);

    if (emails.length === 0) {
      throw new Error('Recipients list does not contain any valid email structures.');
    }

    // Prepare client header for streaming JSON response
    res.setHeader('Content-Type', 'application/json-stream; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send connection initialization event
    res.write(JSON.stringify({ type: 'start', total: emails.length }) + '\n');

    console.log(`[Job Started] Preparing to send bulk emails to ${emails.length} recipients...`);

    // Call the bulk email dispatcher and stream intermediate states back to express client
    const summary = await sendBulkEmails({
      emails,
      subject,
      message,
      resumeFile: req.file,
      onProgress: (progressUpdate) => {
        // Stream progress report chunk
        res.write(JSON.stringify({ type: 'progress', ...progressUpdate }) + '\n');
      }
    });

    // Send final completion summary event
    res.write(JSON.stringify({
      type: 'complete',
      total: emails.length,
      sentCount: summary.sent.length,
      failedCount: summary.failed.length,
      sentList: summary.sent,
      failedList: summary.failed,
    }) + '\n');

    res.end();
  } catch (error) {
    console.error('❌ Error handling /send-emails:', error);
    
    // If headers have not been sent yet, send a standard JSON error response.
    // Otherwise, write an error event into the stream before ending.
    if (!res.headersSent) {
      res.status(400).json({ error: error.message || 'An error occurred while preparing the bulk transmission.' });
    } else {
      res.write(JSON.stringify({ type: 'error', error: error.message || 'Transmission aborted due to server error.' }) + '\n');
      res.end();
    }
  } finally {
    // SECURITY CRITICAL: Delete the uploaded file from the server's disk once transmission completes
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath, (err) => {
        if (err) {
          console.error(`❌ Failed to delete temporary file ${uploadedFilePath}:`, err);
        } else {
          console.log(`🗑️ Successfully cleaned up temporary upload: ${uploadedFilePath}`);
        }
      });
    }
  }
});

// Multer and Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('💥 Global Error Handler triggered:', err.message);
  
  // Cleanup file on error
  if (req.file && req.file.path) {
    fs.unlink(req.file.path, () => {});
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeded. Maximum upload size allowed is 5MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }

  res.status(500).json({ error: err.message || 'A severe internal server error occurred.' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Bulk HR Resumemailer backend active on http://localhost:${PORT}`);
});
