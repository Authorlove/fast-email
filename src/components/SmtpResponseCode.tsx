import { HelpCircle } from 'lucide-react';

// SMTP response code descriptions
const SMTP_CODES: Record<string, string> = {
  '211': '系统状态或系统帮助回复',
  '214': '帮助信息',
  '220': '服务就绪',
  '221': '服务关闭传输通道',
  '235': '认证成功',
  '250': '请求邮件操作完成',
  '251': '非本地用户，将转发',
  '252': '无法验证收件人',
  '354': '开始邮件输入',
  '421': '服务不可用',
  '450': '邮箱不可用',
  '451': '本地处理错误',
  '452': '系统存储不足',
  '455': '服务器无法处理',
  '500': '语法错误，无法识别命令',
  '501': '参数语法错误',
  '502': '命令未实现',
  '503': '命令序列错误',
  '504': '命令参数未实现',
  '535': '认证失败',
  '550': '邮箱不可用或拒绝访问',
  '551': '非本地用户',
  '552': '超出存储配额',
  '553': '邮箱名称不允许',
  '554': '交易失败',
  'ERROR': '发送失败或网络错误',
};

// eslint-disable-next-line react-refresh/only-export-components
export function getSmtpCodeDescription(code: string): string {
  return SMTP_CODES[code] || '未知响应码';
}

interface SmtpResponseCodeProps {
  code: string;
}

export default function SmtpResponseCode({ code }: SmtpResponseCodeProps) {
  const description = getSmtpCodeDescription(code);

  return (
    <div className="flex items-center gap-1 group">
      <span className="font-mono">{code || '-'}</span>
      <div className="relative">
        <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help hover:text-blue-500 transition-colors" />
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-slate-800 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-10">
          <div className="font-medium mb-0.5">{code}</div>
          <div className="text-slate-300">{description}</div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800" />
        </div>
      </div>
    </div>
  );
}
