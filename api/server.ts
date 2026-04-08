import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { encrypt, decrypt, hashApiKey } from './crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'default-secret-change-in-production';
const API_KEY_HASH = process.env.API_KEY_HASH ? hashApiKey(process.env.API_KEY_HASH) : null;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:5173', 'http://localhost:3000'];

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_FILE = path.join(DATA_DIR, 'send-logs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create data directory:', error);
  }
}

ensureDataDir();

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));

const authenticate = (req: Request, res: Response, next: NextFunction) => {
  if (!API_KEY_HASH) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const apiKey = authHeader.slice(7);
  if (hashApiKey(apiKey) !== API_KEY_HASH) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  next();
};

app.use('/api', authenticate);

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
    isEncrypted?: boolean;
  }>;
  defaultSettings: {
    advanceMs: number;
    maxAttachmentSize: number;
    autoSaveDraft: boolean;
  };
}

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
    const settings = JSON.parse(data);
    return decryptSettings(settings);
  } catch {
    return null;
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  const encryptedSettings = encryptSettings(settings);
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(encryptedSettings, null, 2), 'utf-8');
}

function encryptSettings(settings: Settings): Settings {
  return {
    ...settings,
    smtpConfigs: settings.smtpConfigs.map(config => {
      if (config.isEncrypted) return config;
      return {
        ...config,
        password: encrypt(config.password, ENCRYPTION_SECRET),
        isEncrypted: true
      };
    })
  };
}

function decryptSettings(settings: Settings): Settings {
  return {
    ...settings,
    smtpConfigs: settings.smtpConfigs.map(config => {
      if (!config.isEncrypted) return config;
      try {
        return {
          ...config,
          password: decrypt(config.password, ENCRYPTION_SECRET),
          isEncrypted: false
        };
      } catch {
        return { ...config, password: '', isEncrypted: false };
      }
    })
  };
}

function createTransporter(smtp: SmtpConfig) {
  const isStartTLS = smtp.port === 587;
  
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure && !isStartTLS,
    requireTLS: isStartTLS,
    auth: smtp.auth,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    }
  });
}

app.post('/api/smtp/test', async (req: Request, res: Response) => {
  const startTime = process.hrtime.bigint();
  
  try {
    const { smtp }: TestSmtpRequest = req.body;
    
    const transporter = createTransporter(smtp);
    await transporter.verify();
    
    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1000000;
    
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

app.post('/api/email/send', async (req: Request, res: Response) => {
  const requestStartTime = Date.now();
  
  try {
    const { smtp, to, subject, body, attachments }: SendEmailRequest = req.body;
    
    const transporter = createTransporter(smtp);
    const preparedAttachments = attachments?.map(att => ({
      filename: att.filename,
      content: Buffer.from(att.content, 'base64'),
    })) || [];
    const attachmentSize = attachments?.reduce((sum, att) => sum + att.content.length, 0) || 0;
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

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now(), secure: !!API_KEY_HASH });
});

// Serve frontend static files in production
const DIST_DIR = path.join(__dirname, '..', 'dist');
app.use(express.static(DIST_DIR));

// Catch-all route to serve index.html for SPA routing
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`Email server running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Security: ${API_KEY_HASH ? 'API Key enabled' : 'API Key disabled (not recommended for production)'}`);
});
