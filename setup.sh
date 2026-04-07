#!/bin/bash

# 投标邮件极速发送系统 - 环境初始化脚本
# 支持 macOS 和 Linux

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印函数
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检测操作系统
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)

print_info "检测到操作系统: $OS"

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 安装 Node.js (使用 nvm)
install_node() {
    print_info "正在安装 Node.js..."
    
    if ! command_exists nvm; then
        print_info "安装 nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
        
        # 加载 nvm
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi
    
    # 安装 Node.js 20 LTS
    nvm install 20
    nvm use 20
    nvm alias default 20
    
    print_success "Node.js 安装完成"
    node --version
    npm --version
}

# macOS 安装依赖
setup_macos() {
    print_info "配置 macOS 环境..."
    
    # 检查 Homebrew
    if ! command_exists brew; then
        print_info "安装 Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    
    # 安装 git
    if ! command_exists git; then
        print_info "安装 Git..."
        brew install git
    fi
    
    # 安装 Node.js
    if ! command_exists node; then
        install_node
    else
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -lt 18 ]; then
            print_warning "Node.js 版本过低，建议升级"
            read -p "是否升级 Node.js? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                install_node
            fi
        else
            print_success "Node.js 已安装: $(node --version)"
        fi
    fi
}

# Linux 安装依赖
setup_linux() {
    print_info "配置 Linux 环境..."
    
    # 检测包管理器
    if command_exists apt-get; then
        PKG_MANAGER="apt-get"
        UPDATE_CMD="sudo apt-get update"
        INSTALL_CMD="sudo apt-get install -y"
    elif command_exists yum; then
        PKG_MANAGER="yum"
        UPDATE_CMD="sudo yum update -y"
        INSTALL_CMD="sudo yum install -y"
    elif command_exists dnf; then
        PKG_MANAGER="dnf"
        UPDATE_CMD="sudo dnf update -y"
        INSTALL_CMD="sudo dnf install -y"
    else
        print_error "不支持的包管理器"
        exit 1
    fi
    
    print_info "使用包管理器: $PKG_MANAGER"
    
    # 更新包列表
    print_info "更新包列表..."
    $UPDATE_CMD
    
    # 安装基础工具
    print_info "安装基础工具..."
    $INSTALL_CMD curl wget git
    
    # 安装 Node.js
    if ! command_exists node; then
        print_info "安装 Node.js..."
        
        # 使用 NodeSource 安装 Node.js 20
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        
        if [ "$PKG_MANAGER" == "apt-get" ]; then
            sudo apt-get install -y nodejs
        else
            $INSTALL_CMD nodejs
        fi
        
        print_success "Node.js 安装完成"
    else
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -lt 18 ]; then
            print_warning "Node.js 版本过低，建议升级"
        else
            print_success "Node.js 已安装: $(node --version)"
        fi
    fi
}

# 安装项目依赖
install_project_deps() {
    print_info "安装项目依赖..."
    
    # 检查 package.json
    if [ ! -f "package.json" ]; then
        print_error "未找到 package.json，请在项目根目录运行此脚本"
        exit 1
    fi
    
    # 安装 npm 依赖
    npm install
    
    print_success "项目依赖安装完成"
}

# 创建启动脚本
create_start_scripts() {
    print_info "创建启动脚本..."
    
    # 创建 start.sh
    cat > start.sh << 'EOF'
#!/bin/bash

# 启动投标邮件极速发送系统

echo "启动投标邮件极速发送系统..."
echo ""

# 检查端口占用
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "警告: 端口 $1 已被占用"
        return 1
    fi
    return 0
}

# 启动后端
echo "启动后端服务..."
if check_port 3001; then
    npm run server &
    SERVER_PID=$!
    echo "后端服务 PID: $SERVER_PID"
fi

# 等待后端启动
sleep 2

# 启动前端
echo "启动前端服务..."
if check_port 5173; then
    npm run dev &
    FRONTEND_PID=$!
    echo "前端服务 PID: $FRONTEND_PID"
fi

echo ""
echo "系统启动完成!"
echo "前端地址: http://localhost:5173"
echo "后端地址: http://localhost:3001"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待中断信号
trap "kill $SERVER_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait
EOF

    chmod +x start.sh
    
    # 创建 Windows 启动脚本
    cat > start.bat << 'EOF'
@echo off
chcp 65001 >nul
echo 启动投标邮件极速发送系统...
echo.

echo 启动后端服务...
start "后端服务" cmd /k "npm run server"

timeout /t 2 /nobreak >nul

echo 启动前端服务...
start "前端服务" cmd /k "npm run dev"

echo.
echo 系统启动完成!
echo 前端地址: http://localhost:5173
echo 后端地址: http://localhost:3001
pause
EOF

    print_success "启动脚本创建完成"
}

# 主函数
main() {
    echo "========================================"
    echo "  投标邮件极速发送系统 - 环境初始化"
    echo "========================================"
    echo ""
    
    # 根据操作系统执行不同配置
    case $OS in
        macos)
            setup_macos
            ;;
        linux)
            setup_linux
            ;;
        *)
            print_error "不支持的操作系统: $OSTYPE"
            exit 1
            ;;
    esac
    
    echo ""
    print_info "安装项目依赖..."
    install_project_deps
    
    echo ""
    create_start_scripts
    
    echo ""
    echo "========================================"
    print_success "环境初始化完成!"
    echo "========================================"
    echo ""
    echo "使用方式:"
    echo "  1. 同时启动前后端: ./start.sh"
    echo "  2. 单独启动后端:   npm run server"
    echo "  3. 单独启动前端:   npm run dev"
    echo ""
    echo "访问地址:"
    echo "  前端: http://localhost:5173"
    echo "  后端: http://localhost:3001"
    echo ""
}

# 运行主函数
main
