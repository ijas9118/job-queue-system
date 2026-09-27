# AWS Portfolio Deployment

## Strategy: Minimal Cost, Maximum Impact

For portfolio/resume showcase, we want:
- ✅ **Live production system** (impressive for interviews)
- ✅ **Real AWS services** (shows cloud understanding)
- ✅ **Minimal cost** (~₹500-800/month)
- ✅ **Auto-scaling demos** (shows architectural thinking)
- ✅ **Easy to pause** (turn off when not in use)

## Recommended Architecture for Portfolio

```
Internet
    ↓
CloudFront (CDN)            ← Free tier eligible
    ↓
EC2 (t3.micro)              ← ₹500-800/month
    ├── API (Node.js)
    ├── Worker (Node.js)
    └── Dashboard (static)
         ↓
    RDS PostgreSQL (db.t3.micro)  ← ₹1000-1200/month
         ↓
    ElastiCache Redis (cache.t3.micro) ← ₹800-1000/month
```

### Total: ~₹2300-3000/month (first 12 months)

**With free tier credits**: Potentially free for 12 months!

---

## Step-by-Step AWS Setup

### 1. AWS Account Setup

```bash
# Create account
# Go to aws.amazon.com
# Sign up (you get ₹3500 in free tier credits for 12 months)

# Create IAM user (don't use root account)
# Services → IAM → Users → Create user
# Attach policy: AdministratorAccess (for dev account)

# Generate access key
# Save Access Key ID and Secret Access Key securely
```

### 2. Local AWS CLI Setup

```bash
# Install AWS CLI
brew install awscli  # macOS
# or
sudo apt-get install awscliv2  # Linux

# Configure credentials
aws configure

# You'll be prompted:
# AWS Access Key ID: <paste from IAM>
# AWS Secret Access Key: <paste from IAM>
# Default region: ap-south-1  (Mumbai - lowest latency for India)
# Default output: json

# Verify
aws sts get-caller-identity
```

### 3. Create EC2 Instance (Application Server)

```bash
# Via AWS Console (easiest for portfolio)
# Services → EC2 → Instances → Launch Instances

# Configuration:
# - Name: job-queue-api-worker
# - AMI: Ubuntu 24.04 LTS
# - Instance type: t3.micro (free tier + cheap)
# - Security group: Create new
#   - Allow SSH (port 22) from your IP
#   - Allow HTTP (port 80) from anywhere
#   - Allow HTTPS (port 443) from anywhere
#   - Allow port 3000 (API) from anywhere
# - Key pair: Create new → Save .pem file securely
# - Storage: 20GB (free tier eligible)
# - Launch!

# SSH into instance
chmod 600 ~/Downloads/job-queue-key.pem
ssh -i ~/Downloads/job-queue-key.pem ubuntu@<instance-public-ip>
```

### 4. Setup EC2 Instance

```bash
# On EC2 instance:

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js & pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

npm install -g pnpm

# Verify
node --version  # Should be 20+
pnpm --version  # Should be 8+

# Install Docker (optional, for containerization later)
sudo apt-get install -y docker.io
sudo usermod -aG docker ubuntu
```

### 5. Deploy Application to EC2

```bash
# On EC2 instance:

# Clone repository
git clone <your-repo-url> ~/job-queue-system
cd ~/job-queue-system

# Install dependencies
pnpm install --prod

# Create .env file
cat > .env.production << 'EOF'
# Database
DATABASE_URL=postgresql://username:password@<rds-endpoint>:5432/job_queue

# Redis
REDIS_URL=redis://<elasticache-endpoint>:6379

# Auth
JWT_SECRET=<generate-random-secret>
JWT_ACCESS_EXPIRY=900              # 15 minutes
JWT_REFRESH_EXPIRY=604800          # 7 days

# API
API_PORT=3000
NODE_ENV=production

# Logging
LOG_LEVEL=info
EOF

# Start application (use PM2 for process management)
npm install -g pm2

# Start processes
pm2 start "pnpm --filter api run start" --name "api"
pm2 start "pnpm --filter worker run start" --name "worker"

# Auto-restart on reboot
pm2 startup
pm2 save

# Check status
pm2 status

# View logs
pm2 logs
```

### 6. Create RDS PostgreSQL Database

```bash
# Via AWS Console
# Services → RDS → Create database

# Configuration:
# - Engine: PostgreSQL
# - Version: 15
# - Template: Free tier
# - Identifier: job-queue-db
# - Master username: postgres
# - Master password: <strong-password>
# - Instance class: db.t3.micro
# - Storage: 20GB
# - Public accessibility: No (connect only from EC2)
# - Create new security group
# - Database name: job_queue
# - Create!

# Wait ~5 minutes for creation

# Get endpoint
# RDS → Databases → job-queue-db → Connectivity & security
# Copy endpoint (e.g., job-queue-db.xxxx.ap-south-1.rds.amazonaws.com)

# Run migrations from EC2
ssh -i key.pem ubuntu@<ec2-ip>
cd ~/job-queue-system
export DATABASE_URL="postgresql://postgres:password@<rds-endpoint>:5432/job_queue"
pnpm --filter database run migrate:prod
```

### 7. Create ElastiCache Redis

```bash
# Via AWS Console
# Services → ElastiCache → Redis clusters → Create cluster

# Configuration:
# - Name: job-queue-redis
# - Engine: Redis
# - Version: 7.x
# - Node type: cache.t3.micro
# - Number of nodes: 1
# - Automatic failover: Disabled (saves cost)
# - Parameter group: default
# - Security group: Allow from EC2 security group
# - Create!

# Wait ~3 minutes

# Get endpoint
# ElastiCache → Redis → job-queue-redis
# Copy Primary endpoint (e.g., job-queue-redis.xxxx.ng.0001.aps1.cache.amazonaws.com:6379)
```

### 8. Serve Dashboard from CloudFront (Optional)

```bash
# Build dashboard for production
pnpm --filter dashboard run build

# Upload to S3
aws s3 mb s3://job-queue-portfolio-bucket

aws s3 sync dist/apps/dashboard s3://job-queue-portfolio-bucket

# Create CloudFront distribution
# AWS Console → CloudFront → Create distribution
# - Origin: S3 bucket
# - Compress objects automatically: Yes
# - Create!

# Wait ~5 minutes

# Access at CloudFront domain
# CloudFront → Distributions → Get domain name
```

---

## Cost Breakdown (First Year with Free Tier)

### Free Tier (First 12 Months)

| Service | Free Tier | Your Cost |
|---------|-----------|-----------|
| **EC2** | 750 hours/month t2.micro | ₹0 (if using t2.micro) |
| **RDS** | 750 hours/month db.t2.micro | ₹0 (if using t2.micro) |
| **ElastiCache** | None | ₹800 |
| **Data Transfer** | 100GB/month | ₹0 |
| **CloudFront** | 50GB/month | ₹0 |

**First year: ~₹800/month** (just ElastiCache)

### After Free Tier (Year 2+)

| Service | Instance Type | Cost/Month (INR) |
|---------|---------------|------------------|
| **EC2** | t3.micro | ₹550 |
| **RDS PostgreSQL** | db.t3.micro | ₹1,100 |
| **ElastiCache Redis** | cache.t3.micro | ₹800 |
| **Data Transfer (minimal)** | Internal AWS | ₹0 |
| **CloudFront (if used)** | 10GB/month | ₹200 |
| **S3 (for backups)** | ~10GB storage | ₹250 |
| **Backup storage** | Manual snapshots | ₹100 |
| **Misc (logs, monitoring)** | CloudWatch, etc. | ₹100 |

**Total after year 1: ~₹3,100/month**

---

## Cost Optimization Strategies

### 1. Stop When Not Showcasing (Save 100%)

```bash
# Stop EC2 (keeps data, no compute cost)
aws ec2 stop-instances --instance-ids i-xxxxx --region ap-south-1

# Stop RDS (keeps data, no DB cost)
# AWS Console → RDS → Stop database

# Stop ElastiCache
# AWS Console → ElastiCache → Stop cluster

# When you need it again, just start them
aws ec2 start-instances --instance-ids i-xxxxx --region ap-south-1

# Savings: ₹2500+/month when stopped!
```

### 2. Use t3.micro for Everything (Burstable, Cheap)

```
t3.micro specs:
- 1 vCPU (burst up to 3.5 GHz)
- 1 GB RAM
- Enough for demo/portfolio
- ₹550/month post free-tier
```

### 3. Auto-Shutdown Schedule

```bash
# Create Lambda function to auto-stop instances at night
# Schedule: 9 PM IST daily
# Saves 50% on compute costs

# AWS Console → Lambda → Create function
# Runtime: Python 3.11
# Add scheduler trigger

# Code:
import boto3
ec2 = boto3.client('ec2', region_name='ap-south-1')
ec2.stop_instances(InstanceIds=['i-xxxxx'])
```

### 4. Use Reserved Instances (Year 1 Commitment)

```
Standard 1-year RI:
- EC2 t3.micro: ₹4,000/year (vs ₹6,600 on-demand)
- RDS db.t3.micro: ₹8,000/year (vs ₹13,200 on-demand)
- Savings: ~₹7,800/year
```

### 5. Right-Size Gradually

```
Start with:
- t3.micro for everything (budget)
- See actual usage

If traffic grows:
- Scale to t3.small/medium
- Add read replicas for RDS
- Add more ElastiCache nodes
```

---

## Monitoring & Alerts

### CloudWatch Dashboard

```bash
# AWS Console → CloudWatch → Dashboards → Create dashboard

# Add widgets:
- EC2 CPU utilization
- RDS connection count
- Redis commands/sec
- Network in/out
- API response times
```

### Set Up Cost Alerts

```bash
# AWS Console → Billing → Budgets → Create budget

# Set budget: ₹3,000/month
# Email alert if 80% threshold exceeded
# Never get surprised by bills!
```

---

## Security Best Practices

### 1. Security Groups

```bash
# Only allow necessary traffic
# API: Accept only from your IP + CloudFront
# RDS: Accept only from EC2
# Redis: Accept only from EC2

aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxx \
  --protocol tcp \
  --port 3000 \
  --cidr 0.0.0.0/0  # OR specific IP
```

### 2. Database Credentials

```bash
# Don't commit credentials to git
# Use AWS Secrets Manager

# AWS Console → Secrets Manager → Store secret
# Name: job-queue/db-password
# Fetch in code: boto3.client('secretsmanager').get_secret_value()
```

### 3. Enable Backups

```bash
# RDS: Enable automated backups (7 days retention)
# CloudWatch: Enable monitoring
# CloudTrail: Enable for audit trail
```

### 4. Update Dependencies Regularly

```bash
pnpm update --latest
pnpm audit

# Deploy updates to EC2
git pull
pnpm install
pm2 restart api worker
```

---

## Deploying Updates

### Push Changes to Production

```bash
# On EC2:
cd ~/job-queue-system
git pull origin main

# If package changes
pnpm install --prod

# If database changes
pnpm --filter database run migrate:prod

# Restart services
pm2 restart api worker

# Check status
pm2 logs

# Verify dashboard
curl http://localhost:3000/health
```

---

## Related Documentation

- [[DEPLOYMENT/00-Overview]] - Overview
- [[DEPLOYMENT/03-AWS-Production-Setup]] - Production-grade setup
- [[DEPLOYMENT/04-Cost-Analysis]] - Detailed cost analysis
- [[TECH-STACK/00-Overview]] - Tech choices
