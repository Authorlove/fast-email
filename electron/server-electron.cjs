const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs/promises');
const path = require('path');

let DATA_DIR;
let LOGS_FILE;
let SETTINGS_FILE;

let electronApp = null;
try {
  const electron = require('electron');
  electronApp = electron.app;
} catch (e) {}

function initializeDataDir() {
  if (electronApp) {
    DATA_DIR = path.join(electronApp.getPath('userData'), 'data');
  } else {
    DATA_DIR = path.join(__dirname, '..', 'data');
  }
  LOGS_FILE = path.join(DATA_DIR, 'send-logs.json');
  SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
}

initializeDataDir();

const app = express();

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create data directory:', error);
  }
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

async function readLogs() {
  try {
    const data = await fs.readFile(LOGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeLogs(logs) {
  await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

async function readSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function writeSettings(settings) {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

const transporterCache = new Map();

function createTransporter(smtp) {
  const isStartTLS = smtp.port === 587;
  const cacheKey = `${smtp.host}:${smtp.port}:${smtp.auth.user}`;
  
  if (!transporterCache.has(cacheKey)) {
    const transporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 5,
      maxMessages: 1000,
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
    
    transporter.verify().catch(err => {
      console.error('Failed to warm up SMTP connection:', err);
    });
    
    transporterCache.set(cacheKey, transporter);
  }
  
  return transporterCache.get(cacheKey);
}

app.post('/api/smtp/test', async (req, res) => {
  const startTime = process.hrtime.bigint();
  
  try {
    const { smtp } = req.body;
    
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

app.post('/api/email/send', async (req, res) => {
  const requestStartTime = Date.now();
  
  try {
    const { smtp, to, subject, body, attachments, scheduledTime } = req.body;
    
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
    const log = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      timestamp: now,
      scheduledTime: scheduledTime || requestStartTime,
      actualSendTime: requestStartTime,
      duration: now - requestStartTime,
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
      duration: now - requestStartTime,
      totalTime: Date.now() - requestStartTime,
      timestamp: requestStartTime,
      receivedTime: now,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    const errorNow = Date.now();
    const log = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      timestamp: errorNow,
      scheduledTime: req.body.scheduledTime || requestStartTime,
      actualSendTime: requestStartTime,
      duration: errorNow - requestStartTime,
      serverResponseTime: 0,
      receivedTime: errorNow,
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
      timestamp: requestStartTime,
      duration: errorNow - requestStartTime,
      receivedTime: errorNow,
    });
  }
});

app.get('/api/logs', async (_req, res) => {
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

app.post('/api/logs', async (req, res) => {
  try {
    const log = req.body;
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

app.delete('/api/logs/:id', async (req, res) => {
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

app.delete('/api/logs', async (_req, res) => {
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

app.get('/api/settings', async (_req, res) => {
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

app.post('/api/settings', async (req, res) => {
  try {
    const settings = req.body;
    await writeSettings(settings);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save settings'
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

async function startServer() {
  await ensureDataDir();
  
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 3001;
      console.log(`Email server running on port ${port}`);
      console.log(`Data directory: ${DATA_DIR}`);
      resolve(port);
    });
  });
}

module.exports = { startServer };
