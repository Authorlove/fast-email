import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mail, 
  Clock, 
  Server, 
  FileText, 
  Send, 
  CheckCircle, 
  AlertCircle, 
  Settings,
  History,
  Shield,
  Wifi,
  Play,
  Pause,
  RotateCcw,
  Download,
  Trash2,
  Plus,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import RichTextEditor from '../components/RichTextEditor';
import SmtpResponseCode from '../components/SmtpResponseCode';

// API Base URL
const API_BASE_URL = 'http://localhost:3001/api';

// Types
interface SmtpConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  useSSL: boolean;
  isActive: boolean;
  latency?: number;
}

interface EmailContent {
  to: string;
  subject: string;
  body: string;
  attachments: Attachment[];
}

interface Attachment {
  id: string;
  name: string;
  size: number;
  md5: string;
  content: string;
}

interface ScheduleConfig {
  targetTime: string;
  advanceMs: number;
  enabled: boolean;
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
  smtpConfigs: SmtpConfig[];
  defaultSettings: {
    advanceMs: number;
    maxAttachmentSize: number;
    autoSaveDraft: boolean;
  };
}

interface NtpStatus {
  synced: boolean;
  offset: number;
  lastSync: number;
  server: string;
}

interface SecuritySettings {
  autoAddUUID: boolean;
  attachmentMD5: boolean;
  smtpEncrypt: boolean;
}

// Utility functions
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Simple hash function for file identification (not cryptographically secure)
const calculateFileHash = async (file: File): Promise<string> => {
  try {
    // Try SHA-256 first (widely supported)
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
  } catch {
    // Fallback: use file metadata-based hash
    const encoder = new TextEncoder();
    const data = encoder.encode(`${file.name}:${file.size}:${file.lastModified}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// API functions for local file storage
const api = {
  // Logs
  async getLogs(): Promise<SendLog[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/logs`);
      const data = await response.json();
      return data.success ? data.logs : [];
    } catch {
      return [];
    }
  },
  
  async saveLog(log: SendLog): Promise<void> {
    await fetch(`${API_BASE_URL}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(log)
    });
  },
  
  async deleteLog(id: string): Promise<void> {
    await fetch(`${API_BASE_URL}/logs/${id}`, { method: 'DELETE' });
  },
  
  async clearLogs(): Promise<void> {
    await fetch(`${API_BASE_URL}/logs`, { method: 'DELETE' });
  },
  
  // Settings
  async getSettings(): Promise<Settings | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/settings`);
      const data = await response.json();
      return data.success ? data.settings : null;
    } catch {
      return null;
    }
  },
  
  async saveSettings(settings: Settings): Promise<void> {
    await fetch(`${API_BASE_URL}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  }
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
};

// Main Component
export default function Home() {
  // State
  const [smtpConfigs, setSmtpConfigs] = useState<SmtpConfig[]>([
    {
      id: '1',
      name: 'QQ邮箱',
      host: 'smtp.qq.com',
      port: 587,
      username: 'arthur.xqw@qq.com',
      password: 'knzuqawsrldybbid',
      useSSL: false, // Port 587 uses STARTTLS, not direct SSL
      isActive: true
    }
  ]);
  
  const [emailContent, setEmailContent] = useState<EmailContent>({
    to: '',
    subject: '',
    body: '',
    attachments: []
  });
  
  const [schedule, setSchedule] = useState<ScheduleConfig>({
    targetTime: '',
    advanceMs: 100,
    enabled: false
  });
  
  const [logs, setLogs] = useState<SendLog[]>([]);
  const [ntpStatus, setNtpStatus] = useState<NtpStatus>({
    synced: false,
    offset: 0,
    lastSync: 0,
    server: 'pool.ntp.org'
  });
  
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'compose' | 'smtp' | 'logs' | 'settings'>('compose');
  const [showAddSmtp, setShowAddSmtp] = useState(false);
  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>({
    autoAddUUID: true,
    attachmentMD5: true,
    smtpEncrypt: true
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sendTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update current time every 10ms for millisecond precision display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10);
    return () => clearInterval(interval);
  }, []);

  // Check server health and load data
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`, { 
          method: 'GET',
          signal: AbortSignal.timeout(3000)
        });
        if (response.ok) {
          setServerStatus('online');
        } else {
          setServerStatus('offline');
        }
      } catch {
        setServerStatus('offline');
      }
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  // Load settings and logs from local files when server is online
  useEffect(() => {
    if (serverStatus === 'online') {
      const loadData = async () => {
        try {
          // Load settings
          const settings = await api.getSettings();
          if (settings) {
            setSmtpConfigs(settings.smtpConfigs);
            setSchedule(prev => ({
              ...prev,
              advanceMs: settings.defaultSettings.advanceMs
            }));
          } else {
            // Save default settings if none exist
            await api.saveSettings({
              smtpConfigs,
              defaultSettings: {
                advanceMs: schedule.advanceMs,
                maxAttachmentSize: 10,
                autoSaveDraft: false
              }
            });
          }
          
          // Load logs
          const logs = await api.getLogs();
          setLogs(logs);
        } catch (error) {
          console.error('Failed to load data:', error);
        }
      };
      
      loadData();
    }
  }, [serverStatus]);

  // Auto-save settings when smtpConfigs change
  useEffect(() => {
    if (serverStatus === 'online') {
      const timeout = setTimeout(() => {
        api.saveSettings({
          smtpConfigs,
          defaultSettings: {
            advanceMs: schedule.advanceMs,
            maxAttachmentSize: 10,
            autoSaveDraft: false
          }
        });
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [smtpConfigs, schedule.advanceMs, serverStatus]);

  // NTP sync simulation
  const syncNtp = useCallback(async () => {
    toast.promise(
      new Promise((resolve) => {
        setTimeout(() => {
          setNtpStatus(prev => ({
            ...prev,
            synced: true,
            offset: Math.random() * 10 - 5,
            lastSync: Date.now()
          }));
          resolve(true);
        }, 1000);
      }),
      {
        loading: '正在同步NTP时间...',
        success: 'NTP时间同步成功',
        error: 'NTP同步失败'
      }
    );
  }, []);

  // Auto sync NTP every hour
  useEffect(() => {
    syncNtp();
    const interval = setInterval(syncNtp, 3600000);
    return () => clearInterval(interval);
  }, [syncNtp]);

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      try {
        // Check file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`附件 "${file.name}" 超过10MB限制`);
          continue;
        }

        const fileHash = await calculateFileHash(file);
        
        // Read file as base64
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        
        const newAttachment: Attachment = {
          id: generateUUID(),
          name: file.name,
          size: file.size,
          md5: fileHash,
            content: content.split(',')[1] || content
        };
        
        setEmailContent(prev => ({
          ...prev,
          attachments: [...prev.attachments, newAttachment]
        }));
        
        toast.success(`附件 "${file.name}" 上传成功`, {
            description: `Hash: ${fileHash.substring(0, 16)}...`
          });
      } catch (error) {
        console.error('File upload error:', error);
        toast.error(`附件 "${file.name}" 上传失败`, {
          description: error instanceof Error ? error.message : '未知错误'
        });
      }
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove attachment
  const removeAttachment = (id: string) => {
    setEmailContent(prev => ({
      ...prev,
      attachments: prev.attachments.filter(a => a.id !== id)
    }));
    toast.success('附件已删除');
  };

  // Test SMTP latency via backend API
  const testSmtpLatency = async (config: SmtpConfig) => {
    if (serverStatus !== 'online') {
      toast.error('后端服务器未启动，请先运行 npm run server');
      return Infinity;
    }

    const start = performance.now();
    try {
      const response = await fetch(`${API_BASE_URL}/smtp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtp: {
            host: config.host,
            port: config.port,
            secure: config.useSSL,
            auth: {
              user: config.username,
              pass: config.password
            }
          }
        })
      });

      const data = await response.json();
      const latency = data.latency || Math.round(performance.now() - start);
      
      setSmtpConfigs(prev => prev.map(c => 
        c.id === config.id ? { ...c, latency } : c
      ));
      
      if (data.success) {
        toast.success(`${config.name} 连接成功`, {
          description: `延迟: ${latency}ms`
        });
      } else {
        toast.error(`${config.name} 连接失败`, {
          description: data.message
        });
      }
      
      return latency;
    } catch (error) {
      toast.error(`${config.name} 连接失败`, {
        description: error instanceof Error ? error.message : '网络错误'
      });
      return Infinity;
    }
  };

  // Test all SMTP servers
  const testAllSmtp = async () => {
    if (serverStatus !== 'online') {
      toast.error('后端服务器未启动，请先运行 npm run server');
      return;
    }
    
    toast.promise(
      Promise.all(smtpConfigs.map(testSmtpLatency)),
      {
        loading: '正在测试所有SMTP服务器...',
        success: '所有服务器测试完成',
        error: '测试过程中出现错误'
      }
    );
  };

  // Send email via backend API
  const sendEmail = async () => {
    if (!emailContent.to || !emailContent.subject) {
      toast.error('请填写收件人和邮件主题');
      return;
    }

    if (serverStatus !== 'online') {
      toast.error('后端服务器未启动，请先运行 npm run server');
      return;
    }

    const activeSmtp = smtpConfigs.find(s => s.isActive);
    if (!activeSmtp) {
      toast.error('请至少激活一个SMTP服务器');
      return;
    }

    setIsSending(true);
    const logId = generateUUID();
    const scheduledTime = schedule.enabled && schedule.targetTime 
      ? new Date(schedule.targetTime).getTime() 
      : Date.now();
    
    const newLog: SendLog = {
      id: logId,
      timestamp: Date.now(),
      scheduledTime,
      actualSendTime: 0,
      serverResponseTime: 0,
      receivedTime: 0,
      status: 'pending',
      responseCode: '',
      smtpServer: activeSmtp.name,
      attachmentSize: emailContent.attachments.reduce((sum, a) => sum + a.size, 0),
      from: activeSmtp.username,
      to: emailContent.to,
      subject: emailContent.subject
    };
    
    setLogs(prev => [newLog, ...prev]);

    try {
      const response = await fetch(`${API_BASE_URL}/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtp: {
            host: activeSmtp.host,
            port: activeSmtp.port,
            secure: activeSmtp.useSSL,
            auth: {
              user: activeSmtp.username,
              pass: activeSmtp.password
            }
          },
          to: emailContent.to,
          subject: emailContent.subject,
          body: emailContent.body,
          attachments: emailContent.attachments.map(att => ({
            filename: att.name,
            content: att.content,
            encoding: 'base64'
          }))
        })
      });

      const data = await response.json();
      
      if (data.success) {
        const now = Date.now();
        setLogs(prev => prev.map(log => 
          log.id === logId 
            ? {
                ...log,
                actualSendTime: data.timestamp,
                serverResponseTime: data.serverResponseTime,
                receivedTime: now,
                status: 'success',
                responseCode: data.responseCode
              }
            : log
        ));
        
        toast.success('邮件发送成功', {
          description: `服务器响应: ${data.responseCode}, 耗时: ${data.serverResponseTime}ms`
        });
      } else {
        throw new Error(data.error || '发送失败');
      }
    } catch (error) {
      setLogs(prev => prev.map(log => 
        log.id === logId 
          ? {
              ...log,
              actualSendTime: Date.now(),
              status: 'failed',
              error: error instanceof Error ? error.message : '未知错误'
            }
          : log
      ));
      
      toast.error('邮件发送失败', {
        description: error instanceof Error ? error.message : '未知错误'
      });
    } finally {
      setIsSending(false);
    }
  };

  // Schedule send
  const scheduleSend = () => {
    if (!schedule.targetTime) {
      toast.error('请设置目标发送时间');
      return;
    }

    const targetTime = new Date(schedule.targetTime).getTime();
    const now = Date.now();
    const delay = targetTime - now - schedule.advanceMs;

    if (delay <= 0) {
      toast.error('目标时间已过，请重新设置');
      return;
    }

    setSchedule(prev => ({ ...prev, enabled: true }));
    
    toast.success(`已设置定时发送`, {
      description: `将在 ${new Date(targetTime).toLocaleString()} 发送 (提前 ${schedule.advanceMs}ms 启动)`
    });

    sendTimeoutRef.current = setTimeout(() => {
      sendEmail();
      setSchedule(prev => ({ ...prev, enabled: false }));
    }, delay);
  };

  // Cancel scheduled send
  const cancelSchedule = () => {
    if (sendTimeoutRef.current) {
      clearTimeout(sendTimeoutRef.current);
      sendTimeoutRef.current = null;
    }
    setSchedule(prev => ({ ...prev, enabled: false }));
    toast.info('定时发送已取消');
  };

  // Export logs to CSV
  const exportLogs = () => {
    const headers = ['时间戳', '预设时间', '实际发送时间', '服务器响应时间', '成功收到时间', '状态', '响应码', '发件人', '收件人', '主题', 'SMTP服务器', '附件大小', '错误信息'];
    const rows = logs.map(log => [
      new Date(log.timestamp).toISOString(),
      new Date(log.scheduledTime).toISOString(),
      log.actualSendTime ? new Date(log.actualSendTime).toISOString() : '-',
      log.serverResponseTime + 'ms',
      log.receivedTime ? new Date(log.receivedTime).toISOString() : '-',
      log.status,
      log.responseCode,
      log.from || '-',
      log.to || '-',
      log.subject || '-',
      log.smtpServer,
      formatFileSize(log.attachmentSize),
      log.error || '-'
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `email_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    
    toast.success('日志已导出');
  };

  // Clear logs
  const clearLogs = async () => {
    if (serverStatus === 'online') {
      await api.clearLogs();
    }
    setLogs([]);
    toast.success('日志已清空');
  };

  // Add SMTP config
  const addSmtpConfig = (config: Omit<SmtpConfig, 'id'>) => {
    const newConfig: SmtpConfig = {
      ...config,
      id: generateUUID()
    };
    setSmtpConfigs(prev => [...prev, newConfig]);
    setShowAddSmtp(false);
    toast.success('SMTP服务器已添加');
  };

  // Remove SMTP config
  const removeSmtpConfig = (id: string) => {
    setSmtpConfigs(prev => prev.filter(c => c.id !== id));
    toast.success('SMTP服务器已删除');
  };

  // Toggle SMTP active state
  const toggleSmtpActive = (id: string) => {
    setSmtpConfigs(prev => prev.map(c => 
      c.id === id ? { ...c, isActive: !c.isActive } : c
    ));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">投标邮件极速发送系统</h1>
                <p className="text-sm text-slate-500">毫秒级精准发送，提升中标概率</p>
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              {/* Server Status */}
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                serverStatus === 'online' ? 'bg-green-50 text-green-700' :
                serverStatus === 'offline' ? 'bg-red-50 text-red-700' :
                'bg-amber-50 text-amber-700'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  serverStatus === 'online' ? 'bg-green-500' :
                  serverStatus === 'offline' ? 'bg-red-500' :
                  'bg-amber-500 animate-pulse'
                }`} />
                <span className="text-xs font-medium">
                  {serverStatus === 'online' ? '服务器在线' :
                   serverStatus === 'offline' ? '服务器离线' :
                   '检查中...'}
                </span>
              </div>

              {/* NTP Status */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg">
                <Clock className={`w-4 h-4 ${ntpStatus.synced ? 'text-green-500' : 'text-amber-500'}`} />
                <div className="text-right">
                  <div className="text-xs text-slate-500">当前时间</div>
                  <div className="text-sm font-mono font-semibold text-slate-700">
                    {formatTime(currentTime)}
                  </div>
                </div>
                <button 
                  onClick={syncNtp}
                  className="ml-2 p-1 hover:bg-slate-200 rounded"
                  title="同步NTP时间"
                >
                  <RotateCcw className="w-3 h-3 text-slate-400" />
                </button>
              </div>
              
              {/* NTP Sync Status */}
              <div className={`flex items-center gap-1.5 text-xs ${ntpStatus.synced ? 'text-green-600' : 'text-amber-600'}`}>
                {ntpStatus.synced ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                <span>{ntpStatus.synced ? `已同步 (偏移: ${ntpStatus.offset.toFixed(1)}ms)` : '未同步'}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            {[
              { id: 'compose', label: '撰写邮件', icon: Mail },
              { id: 'smtp', label: 'SMTP配置', icon: Server },
              { id: 'logs', label: '发送日志', icon: History },
              { id: 'settings', label: '系统设置', icon: Settings }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id 
                    ? 'border-blue-600 text-blue-600' 
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'compose' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Email Compose Form */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Mail className="w-5 h-5 text-blue-600" />
                  邮件内容
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">收件人邮箱</label>
                    <input
                      type="email"
                      value={emailContent.to}
                      onChange={e => setEmailContent(prev => ({ ...prev, to: e.target.value }))}
                      placeholder="recipient@example.com"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">邮件主题</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={emailContent.subject}
                        onChange={e => setEmailContent(prev => ({ ...prev, subject: e.target.value }))}
                        placeholder="输入邮件主题"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      />
                      <button
                        onClick={() => {
                          const uuid = generateUUID().substring(0, 8);
                          setEmailContent(prev => ({ 
                            ...prev, 
                            subject: prev.subject + (prev.subject ? ' ' : '') + `[${uuid}]`
                          }));
                          toast.success('已添加防重放UUID');
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition-colors"
                        title="添加防重放UUID"
                      >
                        <Shield className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">点击盾牌图标添加UUID，防止重放攻击</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">邮件正文</label>
                    <RichTextEditor
                      value={emailContent.body}
                      onChange={(value) => setEmailContent(prev => ({ ...prev, body: value }))}
                      placeholder="输入邮件正文内容..."
                    />
                  </div>
                </div>
              </div>

              {/* Attachments */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  附件管理
                </h2>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-blue-500 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  点击上传附件
                </button>
                
                {emailContent.attachments.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {emailContent.attachments.map(attachment => (
                      <div key={attachment.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-slate-400" />
                          <div>
                            <div className="text-sm font-medium text-slate-700">{attachment.name}</div>
                            <div className="text-xs text-slate-500">
                              {formatFileSize(attachment.size)} · MD5: {attachment.md5.substring(0, 16)}...
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => removeAttachment(attachment.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    
                    <div className="pt-2 border-t border-slate-200">
                      <div className="text-sm text-slate-600">
                        总计: <span className="font-medium">{emailContent.attachments.length}</span> 个附件, 
                        {' '}<span className="font-medium">{formatFileSize(emailContent.attachments.reduce((sum, a) => sum + a.size, 0))}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Schedule & Send Panel */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  定时发送
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">目标发送时间</label>
                    <input
                      type="datetime-local"
                      step="0.001"
                      value={schedule.targetTime}
                      onChange={e => setSchedule(prev => ({ ...prev, targetTime: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">提前启动时间 (ms)</label>
                    <input
                      type="number"
                      value={schedule.advanceMs}
                      onChange={e => setSchedule(prev => ({ ...prev, advanceMs: parseInt(e.target.value) || 0 }))}
                      min={0}
                      max={1000}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    <p className="mt-1 text-xs text-slate-500">建议值: 100ms，用于补偿网络延迟</p>
                  </div>
                  
                  {schedule.enabled ? (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-center gap-2 text-amber-700 mb-2">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">定时发送已启用</span>
                      </div>
                      <button
                        onClick={cancelSchedule}
                        className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <Pause className="w-4 h-4" />
                        取消定时
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={scheduleSend}
                      disabled={!schedule.targetTime || serverStatus !== 'online'}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <Clock className="w-4 h-4" />
                      设置定时发送
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Send */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Send className="w-5 h-5 text-blue-600" />
                  立即发送
                </h2>
                
                <button
                  onClick={sendEmail}
                  disabled={isSending || !emailContent.to || !emailContent.subject || serverStatus !== 'online'}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2 font-medium"
                >
                  {isSending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      发送中...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      立即发送
                    </>
                  )}
                </button>
                
                {serverStatus !== 'online' && (
                  <p className="mt-2 text-xs text-red-500 text-center">
                    后端服务器离线，无法发送邮件
                  </p>
                )}
                
                <div className="mt-4 space-y-2 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>SMTP直连，跳过本地客户端</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>邮件预加载，减少IO延迟</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>自动选择最优线路</span>
                  </div>
                </div>
              </div>

              {/* Active SMTP Info */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-600" />
                  当前SMTP
                </h2>
                
                {smtpConfigs.filter(s => s.isActive).map(config => (
                  <div key={config.id} className="p-3 bg-slate-50 rounded-lg">
                    <div className="font-medium text-slate-700">{config.name}</div>
                    <div className="text-sm text-slate-500">{config.host}:{config.port}</div>
                    <div className="text-sm text-slate-500">{config.username}</div>
                    {config.latency !== undefined && (
                      <div className="text-xs text-slate-400 mt-1">
                        延迟: {config.latency}ms
                      </div>
                    )}
                  </div>
                ))}
                
                {smtpConfigs.filter(s => s.isActive).length === 0 && (
                  <div className="text-sm text-amber-600 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    未配置SMTP服务器
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'smtp' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">SMTP服务器配置</h2>
              <div className="flex gap-2">
                <button
                  onClick={testAllSmtp}
                  disabled={serverStatus !== 'online'}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-slate-700 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Wifi className="w-4 h-4" />
                  测试所有服务器
                </button>
                <button
                  onClick={() => setShowAddSmtp(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  添加服务器
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {smtpConfigs.map(config => (
                <div key={config.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${config.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
                      <h3 className="font-semibold text-slate-900">{config.name}</h3>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => toggleSmtpActive(config.id)}
                        className={`p-1.5 rounded transition-colors ${config.isActive ? 'text-green-600 hover:bg-green-50' : 'text-slate-400 hover:bg-slate-100'}`}
                        title={config.isActive ? '禁用' : '启用'}
                      >
                        {config.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => testSmtpLatency(config)}
                        disabled={serverStatus !== 'online'}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:text-slate-400 disabled:hover:bg-transparent"
                        title="测试延迟"
                      >
                        <Wifi className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeSmtpConfig(config.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">服务器地址</span>
                      <span className="font-mono text-slate-700">{config.host}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">端口</span>
                      <span className="font-mono text-slate-700">{config.port}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">SSL/TLS</span>
                      <span className={config.useSSL ? 'text-green-600' : 'text-slate-400'}>
                        {config.useSSL ? '已启用' : '未启用'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">用户名</span>
                      <span className="font-mono text-slate-700">{config.username || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">密码</span>
                      <span className="font-mono text-slate-700">{'*'.repeat(config.password?.length || 0)}</span>
                    </div>
                    {config.latency !== undefined && (
                      <div className="flex justify-between pt-2 border-t border-slate-100">
                        <span className="text-slate-500">延迟</span>
                        <span className={`font-mono font-medium ${config.latency < 100 ? 'text-green-600' : config.latency < 200 ? 'text-amber-600' : 'text-red-600'}`}>
                          {config.latency}ms
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {showAddSmtp && (
              <AddSmtpModal 
                onClose={() => setShowAddSmtp(false)} 
                onAdd={addSmtpConfig} 
              />
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">发送日志</h2>
              <div className="flex gap-2">
                <button
                  onClick={exportLogs}
                  disabled={logs.length === 0}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-slate-700 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  导出CSV
                </button>
                <button
                  onClick={clearLogs}
                  disabled={logs.length === 0}
                  className="px-4 py-2 bg-red-50 hover:bg-red-100 disabled:bg-slate-50 disabled:text-slate-400 text-red-600 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  清空日志
                </button>
              </div>
            </div>

            {logs.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                <History className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500">暂无发送记录</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">时间</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">发件人</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">收件人</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">主题</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">响应码</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">服务器响应</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">附件大小</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {logs.map(log => (
                        <tr key={log.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {formatTime(log.timestamp)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                              log.status === 'success' ? 'bg-green-100 text-green-700' :
                              log.status === 'failed' ? 'bg-red-100 text-red-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {log.status === 'success' ? <CheckCircle className="w-3 h-3" /> :
                               log.status === 'failed' ? <AlertCircle className="w-3 h-3" /> :
                               <Clock className="w-3 h-3" />}
                              {log.status === 'success' ? '成功' :
                               log.status === 'failed' ? '失败' : '发送中'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700 max-w-[120px] truncate" title={log.from}>
                            {log.from || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700 max-w-[120px] truncate" title={log.to}>
                            {log.to || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700 max-w-[150px] truncate" title={log.subject}>
                            {log.subject || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            <SmtpResponseCode code={log.responseCode || ''} />
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {log.serverResponseTime ? `${log.serverResponseTime}ms` : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {formatFileSize(log.attachmentSize)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-2xl space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                NTP时间同步设置
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">NTP服务器</label>
                  <input
                    type="text"
                    value={ntpStatus.server}
                    onChange={e => setNtpStatus(prev => ({ ...prev, server: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                
                <div className="p-4 bg-slate-50 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-500">同步状态:</span>
                      <span className={`ml-2 font-medium ${ntpStatus.synced ? 'text-green-600' : 'text-amber-600'}`}>
                        {ntpStatus.synced ? '已同步' : '未同步'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">时间偏移:</span>
                      <span className="ml-2 font-medium">{ntpStatus.offset.toFixed(2)}ms</span>
                    </div>
                    <div>
                      <span className="text-slate-500">上次同步:</span>
                      <span className="ml-2 font-medium">
                        {ntpStatus.lastSync ? new Date(ntpStatus.lastSync).toLocaleString() : '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">同步间隔:</span>
                      <span className="ml-2 font-medium">1小时</span>
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={syncNtp}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  立即同步
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                安全设置
              </h2>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium text-slate-700">自动添加防重放UUID</div>
                    <div className="text-sm text-slate-500">每次发送时自动在主题中添加唯一标识</div>
                  </div>
                  <button
                    onClick={() => setSecuritySettings(prev => ({ ...prev, autoAddUUID: !prev.autoAddUUID }))}
                    className={`w-11 h-6 rounded-full relative transition-colors ${securitySettings.autoAddUUID ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${securitySettings.autoAddUUID ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium text-slate-700">附件MD5校验</div>
                    <div className="text-sm text-slate-500">发送前自动校验附件完整性</div>
                  </div>
                  <button
                    onClick={() => setSecuritySettings(prev => ({ ...prev, attachmentMD5: !prev.attachmentMD5 }))}
                    className={`w-11 h-6 rounded-full relative transition-colors ${securitySettings.attachmentMD5 ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${securitySettings.attachmentMD5 ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium text-slate-700">SMTP密码加密存储</div>
                    <div className="text-sm text-slate-500">使用AES-256加密保存认证信息</div>
                  </div>
                  <button
                    onClick={() => setSecuritySettings(prev => ({ ...prev, smtpEncrypt: !prev.smtpEncrypt }))}
                    className={`w-11 h-6 rounded-full relative transition-colors ${securitySettings.smtpEncrypt ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${securitySettings.smtpEncrypt ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-600" />
                系统信息
              </h2>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">系统版本</span>
                  <span className="font-mono text-slate-700">v1.0.0</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">后端API</span>
                  <span className="font-mono text-slate-700">{API_BASE_URL}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">服务器状态</span>
                  <span className={`font-mono ${serverStatus === 'online' ? 'text-green-600' : 'text-red-600'}`}>
                    {serverStatus === 'online' ? '在线' : serverStatus === 'offline' ? '离线' : '检查中'}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">时区</span>
                  <span className="font-mono text-slate-700">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">语言</span>
                  <span className="font-mono text-slate-700">{navigator.language}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Add SMTP Modal Component
function AddSmtpModal({ onClose, onAdd }: { onClose: () => void; onAdd: (config: Omit<SmtpConfig, 'id'>) => void }) {
  const [form, setForm] = useState({
    name: '',
    host: '',
    port: 587,
    username: '',
    password: '',
    useSSL: true,
    isActive: true
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(form);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">添加SMTP服务器</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">服务器名称</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="例如：企业邮箱"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">服务器地址</label>
            <input
              type="text"
              required
              value={form.host}
              onChange={e => setForm(prev => ({ ...prev, host: e.target.value }))}
              placeholder="smtp.example.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">端口</label>
            <input
              type="number"
              required
              value={form.port}
              onChange={e => setForm(prev => ({ ...prev, port: parseInt(e.target.value) }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">用户名</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
              placeholder="your@email.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">密码/授权码</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useSSL"
              checked={form.useSSL}
              onChange={e => setForm(prev => ({ ...prev, useSSL: e.target.checked }))}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="useSSL" className="text-sm text-slate-700">使用SSL/TLS加密</label>
          </div>
          
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
