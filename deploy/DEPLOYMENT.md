# Unified Accounting System (UAS) Enterprise Deployment Guide

## Production Domain: `https://qat.world` & `https://www.qat.world`

This guide details the steps to deploy the Unified Accounting System (UAS) in a high-availability production environment running Ubuntu 22.04 / 24.04 LTS.

---

### 1. Prerequisites & Server Setup

Ensure the server has Node.js 20+ LTS, npm 10+, Nginx, and Certbot installed:

```bash
# 1. Update OS packages
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git build-essential

# 3. Create dedicated system user for UAS
sudo adduser --system --group --home /var/www/uas-accounting-system uas
```

---

### 2. Clone Repository & Install Dependencies

```bash
# 1. Clone repository to /var/www/uas-accounting-system
sudo git clone https://github.com/your-org/uas-accounting-system.git /var/www/uas-accounting-system
cd /var/www/uas-accounting-system

# 2. Set file permissions
sudo chown -R uas:uas /var/www/uas-accounting-system

# 3. Install production dependencies
sudo -u uas npm ci

# 4. Generate Prisma Client and synchronize database schema
sudo -u uas npx prisma generate
sudo -u uas npx prisma db push

# 5. Seed initial enterprise chart of accounts and baseline users (if fresh install)
sudo -u uas npx tsx prisma/seed.ts
```

---

### 3. Production Build

```bash
# Run Next.js 16 production build
sudo -u uas npm run build
```

---

### 4. Configure Systemd Daemon Service

Copy the provided systemd service file:

```bash
sudo cp /var/www/uas-accounting-system/deploy/uas-qat.service /etc/systemd/system/uas-qat.service

# Reload systemd, enable service on boot, and start it
sudo systemctl daemon-reload
sudo systemctl enable uas-qat
sudo systemctl start uas-qat

# Verify service status
sudo systemctl status uas-qat
```

---

### 5. SSL Certificate & Nginx Reverse Proxy Setup

1. **Obtain SSL Certificate from Let's Encrypt**:
   ```bash
   sudo certbot certonly --nginx -d qat.world -d www.qat.world
   ```

2. **Deploy Nginx Configuration**:
   ```bash
   sudo cp /var/www/uas-accounting-system/deploy/nginx-qat.world.conf /etc/nginx/sites-available/qat.world.conf
   sudo ln -sf /etc/nginx/sites-available/qat.world.conf /etc/nginx/sites-enabled/

   # Test Nginx syntax
   sudo nginx -t

   # Reload Nginx
   sudo systemctl reload nginx
   ```

---

### 6. Zero-State Onboarding & First-Time Super Admin Access

When deployed to a fresh environment:
1. Navigate to `https://qat.world`.
2. Login with the initial credentials or complete the First-Run Setup Wizard.
3. Open the **User Profile Drawer** from the Top Command Bar to customize display name, email, phone, and update the default password.
4. Access the **System Tab** to manage user permissions, dynamic RBAC overrides, and project access scopes.

