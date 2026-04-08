# 安全配置指南

本指南介绍如何安全地部署 Fast Email 到云端。

## 🔐 安全特性

### 1. SMTP 密码加密
- 使用 **AES-256-GCM** 加密算法
- PBKDF2 密钥派生（100,000 次迭代）
- 每个密码使用唯一的 salt 和 IV
- 自动加密存储，自动解密使用

### 2. API Key 认证
- Bearer Token 认证方式
- API Key 使用 SHA-256 哈希存储
- 可选启用（生产环境建议启用）

### 3. CORS 安全配置
- 白名单机制，只允许指定域名访问
- 支持多域名配置

## 🚀 部署配置

### Render 环境变量

在 Render 控制面板 → 你的服务 → Environment → Environment Variables 中添加：

| 变量名 | 说明 | 必填 | 示例 |
|--------|------|------|------|
| `ENCRYPTION_SECRET` | 加密密钥（用于加密 SMTP 密码） | ✅ | `your-strong-encryption-key-here` |
| `API_KEY_HASH` | API Key（用于认证访问） | ⚠️ | `fk_abc123xyz...` |
| `ALLOWED_ORIGINS` | 允许的前端域名（逗号分隔） | ⚠️ | `https://your-app.vercel.app` |
| `PORT` | 服务端口 | ❌ | `10000`（Render 默认） |

#### 生成 ENCRYPTION_SECRET

使用强随机字符串作为加密密钥，建议 32 字符以上：

```bash
# 在终端运行生成随机密钥
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 生成 API_KEY_HASH

1. 在终端运行以下命令生成 API Key：

```bash
node -e "
const crypto = require('crypto');
const apiKey = 'fk_' + crypto.randomBytes(32).toString('hex');
console.log('API Key:', apiKey);
console.log('Save this key - you will need it in the frontend!');
"
```

2. 将生成的 API Key 复制，设置到 Render 的 `API_KEY_HASH` 环境变量中
3. 在前端应用中输入这个 API Key

### Vercel 环境变量（可选）

如果需要在 Vercel 前端中配置默认 API 地址：

在 Vercel 项目 → Settings → Environment Variables：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `VITE_API_BASE_URL` | 后端 API 地址 | `https://your-api.onrender.com/api` |

## 📝 使用说明

### 1. 前端配置 API Key

1. 访问你的前端应用
2. 在设置页面输入你的 API Key
3. API Key 会保存在浏览器的 localStorage 中

### 2. 更新现有密码

如果已有未加密的 SMTP 配置：
1. 系统会在保存时自动加密
2. 无需手动操作

## 🔒 安全最佳实践

### 生产环境必须

1. **启用 API Key** - 不要在生产环境中禁用认证
2. **使用强 ENCRYPTION_SECRET** - 至少 32 字符的随机字符串
3. **配置 ALLOWED_ORIGINS** - 只允许你的前端域名访问
4. **启用 HTTPS** - Vercel 和 Render 默认提供 HTTPS
5. **定期轮换 API Key** - 如发现泄露立即更换

### 数据存储注意事项

⚠️ **重要**：Render 免费版的文件系统是临时的
- 重启服务后数据会丢失
- 生产环境建议使用数据库（PostgreSQL、Redis 等）
- 或者使用外部存储服务

### 网络安全

- 所有 API 通信使用 HTTPS
- SMTP 连接使用 SSL/TLS
- 不要在公共网络中传输未加密的敏感信息

## 🛠️ 故障排除

### API 认证失败

检查：
1. API Key 是否正确输入
2. Render 环境变量 `API_KEY_HASH` 是否正确设置
3. 前端是否正确发送 `Authorization: Bearer <key>` 头

### 密码解密失败

检查：
1. `ENCRYPTION_SECRET` 是否与加密时一致
2. 不要在部署后更改 `ENCRYPTION_SECRET`（会导致现有密码无法解密）

### CORS 错误

检查：
1. `ALLOWED_ORIGINS` 是否包含你的前端域名
2. 域名格式是否正确（不要包含路径）
3. 多个域名用逗号分隔，不要有空格

## 📚 相关文件

- `api/crypto.ts` - 加密工具模块
- `api/server.ts` - 服务器安全配置
- `src/pages/Home.tsx` - 前端认证逻辑
- `render.yaml` - Render 部署配置
