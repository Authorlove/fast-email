# 部署指南

本指南介绍如何将 Fast Email 项目自动部署到 Vercel（前端）和 Render（后端）。

## 前置准备

### 1. GitHub 仓库
确保你的代码已推送到 GitHub 仓库。

### 2. Vercel 配置

#### 步骤 1：创建 Vercel 项目
1. 访问 [vercel.com](https://vercel.com) 并登录
2. 点击 "New Project"
3. 导入你的 GitHub 仓库
4. 在配置页面：
   - Framework Preset: 选择 `Vite`
   - Root Directory: 保持默认
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. 点击 "Deploy"

#### 步骤 2：获取 Vercel 凭证
1. 在 Vercel 项目页面，进入 Settings → General
2. 复制以下信息：
   - `Project ID`
   - `Team ID`（如果是个人项目，使用个人 ID）
3. 生成 Token：访问 [vercel.com/account/tokens](https://vercel.com/account/tokens)，创建一个新的 token

#### 步骤 3：配置 GitHub Secrets
在 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret
添加以下 secrets：
- `VERCEL_TOKEN`: 你的 Vercel token
- `VERCEL_ORG_ID`: 你的 Vercel Team ID 或个人 ID
- `VERCEL_PROJECT_ID`: 你的 Vercel Project ID

### 3. Render 配置

#### 步骤 1：创建 Render 项目
1. 访问 [render.com](https://render.com) 并登录
2. 点击 "New +" → "Web Service"
3. 导入你的 GitHub 仓库
4. 配置服务：
   - Name: `fast-email-api`
   - Runtime: `Node`
   - Region: 选择离你最近的区域
   - Branch: `main`
   - Build Command: `npm install`
   - Start Command: `npm run server`
   - Plan: 选择 `Free`
5. 点击 "Create Web Service"

#### 步骤 2：获取 Render 凭证
1. 在 Render 服务页面，查看 URL（会在部署后显示）
2. 获取 API Key：
   - 点击右上角头像 → Account Settings → API Keys
   - 创建新的 API Key
3. 获取 Service ID：
   - 在 Render 服务页面，URL 格式为 `https://dashboard.render.com/web/srv-xxxxx`
   - `srv-xxxxx` 就是 Service ID

#### 步骤 3：配置 GitHub Secrets
在 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret
添加以下 secrets：
- `RENDER_API_KEY`: 你的 Render API Key
- `RENDER_SERVICE_ID`: 你的 Render Service ID

### 4. 更新前端 API 地址

部署完成后，需要更新前端代码中的 API 地址，将 `localhost:3001` 替换为 Render 提供的 URL。

## 本地 / 私有服务器部署 (推荐)

如果你希望将 Fast Email 部署在自己的服务器或本地环境，可以通过 Docker 轻松完成。本地部署的优势是前端和后端可以运行在同一个服务下。

### 使用 Docker Compose 部署

1. **确保服务器已安装 Docker 和 Docker Compose**
2. **克隆代码并启动服务**
   ```bash
   git clone https://github.com/your-username/fast-email.git
   cd fast-email
   docker-compose up -d
   ```
3. **访问应用**
   打开浏览器访问 `http://localhost:3001` (或你的服务器 IP 地址 `http://<server-ip>:3001`)。

### 环境变量配置 (可选)

编辑 `docker-compose.yml` 可以配置环境变量：
- `ENCRYPTION_SECRET`: 用于加密本地存储的 SMTP 密码（推荐修改）。
- `API_KEY_HASH`: 启用后，需在客户端设置对应的 API Key 方可使用服务。
- `ALLOWED_ORIGINS`: 限制允许的跨域来源。

---

## 使用 GitHub Actions 自动部署

配置完成后，每次推送到 `main` 分支都会自动触发部署：

1. **前端** 自动部署到 Vercel
2. **后端** 自动部署到 Render（前端部署成功后）

## 手动触发部署

你也可以在 GitHub 仓库 → Actions → "Deploy to Vercel and Render" → Run workflow 手动触发部署。

## 验证部署

部署完成后：
- 访问 Vercel 提供的 URL 验证前端
- 访问 `{Render_URL}/api/health` 验证后端健康检查

## 注意事项

1. **Render 免费版**会在 15 分钟无活动后休眠，首次请求可能需要几秒启动时间
2. 确保 `main` 分支是你的主要分支
3. Secrets 不会在日志中显示，确保安全
4. 如需修改部署配置，编辑 `.github/workflows/deploy.yml` 文件
