import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import type { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Data directory for local storage
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_FILE = path.join(DATA_DIR, 'send-logs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create data directory:', error);
  }
}

// Initialize data directory
ensureDataDir();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Types
interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface SendEmailRequest {
  smtp: SmtpConfig;
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    content: string;
    encoding: string;
  }>;
}

interface TestSmtpRequest {
  smtp: SmtpConfig;
}

interface SendLog {
  id: string;
  timestamp: number;
  scheduledTime: number;
  actualSendTime: number;
  serverResponseTime: number;
  receivedTime: number;
  status: 'success' | 'failed' | 'pending';
  responseCode: string;
  smtpServer: string;
  error?: string;
  attachmentSize: number;
  from: string;
  to: string;
  subject: string;
}

interface Settings {
  smtpConfigs: Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    password: string;
    useSSL: boolean;
    isActive: boolean;
    latency?: number;
  }>;
  defaultSettings: {
    advanceMs: number;
    maxAttachmentSize: number;
    autoSaveDraft: boolean;
  };
}

// File storage helpers
async function readLogs(): Promise<SendLog[]> {
  try {
    const data = await fs.readFile(LOGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeLogs(logs: SendLog[]): Promise<void> {
  await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

async function readSettings(): Promise<Settings | null> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// Create transporter with proper TLS settings
function createTransporter(smtp: SmtpConfig) {
  // For port 587, use STARTTLS (secure: false, requireTLS: true)
  // For port 465, use SSL/TLS (secure: true)
  const isStartTLS = smtp.port === 587;
  
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure && !isStartTLS, // true for 465, false for other ports
    requireTLS: isStartTLS, // Use STARTTLS for 587
    auth: smtp.auth,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates
      minVersion: 'TLSv1.2'
    }
  });
}

// Test SMTP connection and measure latency
app.post('/api/smtp/test', async (req: Request, res: Response) => {
  const startTime = process.hrtime.bigint();
  
  try {
    const { smtp }: TestSmtpRequest = req.body;
    
    const transporter = createTransporter(smtp);

    // Verify connection
    await transporter.verify();
    
    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    
    res.json({
      success: true,
      latency: Math.round(latencyMs),
      message: 'SMTP connection successful'
    });
  } catch (error) {
    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1000000;
    
    res.status(400).json({
      success: false,
      latency: Math.round(latencyMs),
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Send email endpoint
app.post('/api/email/send', async (req: Request, res: Response) => {
  const requestStartTime = Date.now();
  
  try {
    const { smtp, to, subject, body, attachments }: SendEmailRequest = req.body;
    
    // Create transporter with proper settings
    const transporter = createTransporter(smtp);

    // Prepare attachments
    const preparedAttachments = attachments?.map(att => ({
      filename: att.filename,
      content: Buffer.from(att.content, 'base64'),
    })) || [];

    // Calculate attachment size
    const attachmentSize = attachments?.reduce((sum, att) => sum + att.content.length, 0) || 0;

    // Send email with timing
    const sendStartTime = process.hrtime.bigint();
    
    const info = await transporter.sendMail({
      from: smtp.auth.user,
      to,
      subject,
      html: body,
      attachments: preparedAttachments,
    });
    
    const sendEndTime = process.hrtime.bigint();
    const serverResponseTime = Number(sendEndTime - sendStartTime) / 1000000;
    
    const responseCode = info.response ? info.response.split(' ')[0] : '250';
    
    // Save success log
    const now = Date.now();
    const log: SendLog = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      timestamp: now,
      scheduledTime: now,
      actualSendTime: now,
      serverResponseTime: Math.round(serverResponseTime),
      receivedTime: now,
      status: 'success',
      responseCode,
      smtpServer: smtp.host,
      attachmentSize,
      from: smtp.auth.user,
      to,
      subject
    };
    
    const logs = await readLogs();
    logs.unshift(log);
    // Keep only last 1000 logs
    if (logs.length > 1000) {
      logs.length = 1000;
    }
    await writeLogs(logs);
    
    res.json({
      success: true,
      messageId: info.messageId,
      responseCode,
      serverResponseTime: Math.round(serverResponseTime),
      totalTime: Date.now() - requestStartTime,
      timestamp: Date.now(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Save error log
    const errorNow = Date.now();
    const log: SendLog = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      timestamp: errorNow,
      scheduledTime: errorNow,
      actualSendTime: errorNow,
      serverResponseTime: 0,
      receivedTime: 0,
      status: 'failed',
      responseCode: 'ERROR',
      smtpServer: req.body.smtp?.host || 'unknown',
      error: errorMessage,
      attachmentSize: 0,
      from: req.body.smtp?.auth?.user || '',
      to: req.body.to || '',
      subject: req.body.subject || ''
    };
    
    const logs = await readLogs();
    logs.unshift(log);
    if (logs.length > 1000) {
      logs.length = 1000;
    }
    await writeLogs(logs);
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      timestamp: Date.now(),
    });
  }
});

// Logs API
app.get('/api/logs', async (_req: Request, res: Response) => {
  try {
    const logs = await readLogs();
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read logs'
    });
  }
});

app.post('/api/logs', async (req: Request, res: Response) => {
  try {
    const log: SendLog = req.body;
    const logs = await readLogs();
    logs.unshift(log);
    // Keep only last 1000 logs
    if (logs.length > 1000) {
      logs.length = 1000;
    }
    await writeLogs(logs);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save log'
    });
  }
});

app.delete('/api/logs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const logs = await readLogs();
    const filtered = logs.filter(log => log.id !== id);
    await writeLogs(filtered);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete log'
    });
  }
});

app.delete('/api/logs', async (_req: Request, res: Response) => {
  try {
    await writeLogs([]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear logs'
    });
  }
});

// Settings API
app.get('/api/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await readSettings();
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read settings'
    });
  }
});

app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const settings: Settings = req.body;
    await writeSettings(settings);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save settings'
    });
  }
});

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Email server running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
