# On-Demand Portfolio Deployment (No Free Tier)

## Strategy: Deploy Only When Interviewing

**Philosophy**: Pay only for what you use. Spin up before interviews, pause after.

## Realistic Monthly Costs (INR) - No Free Tier

### Scenario: Active Interviewing (5-10 hours/month)

```
You're in active interview mode:
├─ Run live demos: ~5 hours
├─ Portfolio reviews: ~3 hours  
├─ Each time: Spin up for 2-3 hours
└─ Total active: ~5-10 hours/month

Cost Breakdown per hour:
├─ EC2 t3.micro:      ₹0.75/hour
├─ RDS db.t3.micro:   ₹1.50/hour
├─ ElastiCache:       ₹1.40/hour
└─ Total per hour:    ₹3.65/hour

Monthly Cost (8 hours):   ₹3.65 × 8 = ₹29/month
Monthly Cost (10 hours):  ₹3.65 × 10 = ₹37/month
Monthly Cost (20 hours):  ₹3.65 × 20 = ₹73/month

⭐ ACTUAL MONTHLY COST: ₹30-100/month (when actively interviewing)
```

### When NOT Interviewing: ₹0/month

```
Services PAUSED (not deleted):
├─ EC2: Stopped = ₹0 (data saved)
├─ RDS: Stopped = ₹0 (data saved)
├─ ElastiCache: Stopped = ₹0 (data saved)
└─ Storage charges only: ~₹50/month

TOTAL WHEN PAUSED: ~₹50/month (just storage)
```

### Realistic Annual Cost

```
Active Interview Mode (3 months):  ₹30 × 3 = ₹90
Paused (9 months):                ₹50 × 9 = ₹450
─────────────────────────────────────────────
ANNUAL TOTAL:                      ₹540/year

Average per month: ₹45/month

⭐ THAT'S INCREDIBLY CHEAP!
```

---

## Setup Architecture (Optimized for Pause)

### Minimal Setup

```
┌─────────────────────────────────┐
│  EC2 t3.micro (API + Worker)   │
│  ✅ Cheapest compute           │
│  ✅ Can pause/resume           │
│  ✅ No ongoing cost when paused │
└─────────────────────────────────┘
           ↓
┌─────────────────────────────────┐
│  RDS db.t3.micro PostgreSQL    │
│  ✅ Auto-stops with EC2        │
│  ✅ Keeps data when stopped    │
│  ✅ Resume instantly           │
└─────────────────────────────────┘
           ↓
┌─────────────────────────────────┐
│  ElastiCache cache.t3.micro    │
│  ✅ Pause when EC2 off         │
│  ✅ Minimal cost               │
│  ✅ Quick to spin up           │
└─────────────────────────────────┘
```

### Cost Per Instance (Monthly, No Free Tier)

| Service | Instance | Monthly (720 hrs) | Paused | Notes |
|---------|----------|------------------|--------|-------|
| **EC2** | t3.micro | ₹550 | ₹0 | ✅ Pauseable |
| **RDS** | db.t3.micro | ₹1,100 | ₹0 | ✅ Pauseable |
| **ElastiCache** | cache.t3.micro | ₹1,022 | ₹0 | ✅ Pauseable |
| **Storage (EBS)** | 20GB | ₹80 | ₹80 | Always charged |
| **Storage (RDS)** | 20GB | ₹200 | ₹200 | Always charged |
| **Backup storage** | ~5GB | ₹50 | ₹50 | Optional, can delete |
| **Data transfer** | Out of AWS | ₹0-100 | ₹0 | Usually free |
| **CloudWatch logs** | Basic | ₹50 | ₹50 | Minimal |
| | | | |
| **Total if running** | All | ₹3,052/month | - | ~₹4/hour |
| **Total if paused** | All | - | ~₹410/month | Storage only |

---

## Quick Start: On-Demand Deployment

### Phase 1: Initial Setup (30 minutes, one-time)

```bash
# 1. Create EC2 instance (Ubuntu 24.04 LTS)
# AWS Console → EC2 → Launch Instance
# Configuration:
#   - Instance type: t3.micro
#   - Storage: 20GB
#   - Save key pair as job-queue-key.pem

# 2. SSH into instance
ssh -i ~/job-queue-key.pem ubuntu@<ec2-public-ip>

# 3. Install dependencies
sudo apt-get update && sudo apt-get upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
npm install -g pnpm pm2

# 4. Clone repository
git clone <your-repo> ~/job-queue-system
cd ~/job-queue-system
pnpm install --prod

# 5. Create RDS PostgreSQL manually
# AWS Console → RDS → Create Database
# - Engine: PostgreSQL 15
# - Instance: db.t3.micro
# - Storage: 20GB
# - No public access
# Get endpoint when ready

# 6. Create ElastiCache Redis manually
# AWS Console → ElastiCache → Create Cluster
# - Engine: Redis 7.x
# - Node type: cache.t3.micro
# - No public access
# Get endpoint when ready

# 7. Configure environment
cat > ~/.env.production << 'EOF'
DATABASE_URL=postgresql://postgres:password@<rds-endpoint>:5432/job_queue
REDIS_URL=redis://<elasticache-endpoint>:6379
JWT_SECRET=<random-secret>
API_PORT=3000
NODE_ENV=production
LOG_LEVEL=info
EOF

# 8. Run migrations (first time only)
export $(cat ~/.env.production | xargs)
pnpm --filter database run migrate:prod

# 9. Start services
pm2 start "pnpm --filter api run start" --name "api"
pm2 start "pnpm --filter worker run start" --name "worker"
pm2 save

echo "✅ Setup complete! System is running."
```

### Phase 2: When NOT Interviewing (Pause Everything)

```bash
# Stop services to save money
aws ec2 stop-instances \
  --instance-ids i-<your-instance-id> \
  --region ap-south-1

# Also stop RDS (optional but saves more)
aws rds stop-db-instance \
  --db-instance-identifier job-queue-db \
  --region ap-south-1

# Also stop ElastiCache (optional but saves more)
aws elasticache stop-replication-group \
  --replication-group-id job-queue-redis \
  --region ap-south-1

# Cost when paused: ~₹50-100/month (storage only)
echo "✅ Everything paused. Cost: ~₹50/month"
```

### Phase 3: When Interview Upcoming (Resume)

```bash
# Resume in 2-3 minutes!
aws ec2 start-instances \
  --instance-ids i-<your-instance-id> \
  --region ap-south-1

# Check status
aws ec2 describe-instances \
  --instance-ids i-<your-instance-id> \
  --region ap-south-1 \
  --query 'Reservations[0].Instances[0].State.Name'

# SSH in when running
ssh -i ~/job-queue-key.pem ubuntu@<ec2-public-ip>

# Check services
pm2 status

# If services not running
pm2 start "pnpm --filter api run start" --name "api"
pm2 start "pnpm --filter worker run start" --name "worker"

# Health check
curl http://localhost:3000/health

# System is live and ready for demo!
echo "✅ System ready. Interviewer can access it now."
```

---

## Automation Scripts

### Auto-Pause Script (Run Monthly)

Create `scripts/pause-portfolio.sh`:

```bash
#!/bin/bash

set -e

INSTANCE_ID="i-xxxxxxxxx"
DB_INSTANCE="job-queue-db"
REDIS_CLUSTER="job-queue-redis"
REGION="ap-south-1"

echo "🛑 Pausing portfolio deployment..."

# Stop EC2
echo "Stopping EC2..."
aws ec2 stop-instances --instance-ids $INSTANCE_ID --region $REGION

# Stop RDS
echo "Stopping RDS..."
aws rds stop-db-instance \
  --db-instance-identifier $DB_INSTANCE \
  --region $REGION

# Stop ElastiCache
echo "Stopping ElastiCache..."
aws elasticache stop-replication-group \
  --replication-group-id $REDIS_CLUSTER \
  --region $REGION

echo "✅ Portfolio paused!"
echo "💰 Monthly cost: ~₹50 (storage only)"
```

### Auto-Resume Script (Run Before Interview)

Create `scripts/resume-portfolio.sh`:

```bash
#!/bin/bash

set -e

INSTANCE_ID="i-xxxxxxxxx"
DB_INSTANCE="job-queue-db"
REDIS_CLUSTER="job-queue-redis"
REGION="ap-south-1"

echo "🚀 Resuming portfolio deployment..."

# Start EC2
echo "Starting EC2..."
aws ec2 start-instances --instance-ids $INSTANCE_ID --region $REGION

# Start RDS
echo "Starting RDS..."
aws rds start-db-instance \
  --db-instance-identifier $DB_INSTANCE \
  --region $REGION

# Start ElastiCache
echo "Starting ElastiCache..."
aws elasticache start-replication-group \
  --replication-group-id $REDIS_CLUSTER \
  --region $REGION

echo "⏳ Waiting for services to start (3-5 minutes)..."
sleep 180

# Check status
echo "✅ Services starting!"
echo "📍 Access dashboard when EC2 is running state"
```

### Make Scripts Executable

```bash
chmod +x scripts/pause-portfolio.sh
chmod +x scripts/resume-portfolio.sh

# Add to git (but not secrets)
git add scripts/
git commit -m "Add pause/resume scripts"
```

---

## Monthly Cost Tracking

### Monitor AWS Costs

```bash
# Check daily costs
aws ce get-cost-and-usage \
  --time-period Start=2026-07-01,End=2026-07-31 \
  --granularity DAILY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region ap-south-1

# Set billing alert
# AWS Console → Billing → Budgets
# Set budget: ₹500/month
# Alert: 80% threshold = ₹400
```

### Expected Costs When Running

```
Active Interviewing (Interview scheduled):
├─ Run system: 2-3 hours
├─ Cost: ₹8-11
└─ After: Stop everything

Per Interview Demo:
├─ Setup time: 0 (already done)
├─ Run time: 1-2 hours  
├─ Cost: ₹4-7
└─ Done: Pause

Monthly (3 interviews):
├─ 3 × 2 hours = 6 hours running
├─ 6 × ₹4/hour = ₹24
├─ Storage (always): ₹50
└─ Total: ₹74/month
```

---

## Resume/Portfolio Setup

### Dashboard Public URL

When running, give recruiters this link:

```
http://<your-ec2-public-ip>:3000

Or set up domain (optional):
- Buy domain: ₹300/year
- Point to EC2 IP: DNS A record
- Then share: http://portfolio.yourname.com
```

### What to Show

```
✅ Dashboard (real-time job visualization)
✅ Submit a job (shows queuing)
✅ Worker processing (Redis monitoring)
✅ Retry logic (trigger failure, watch retry)
✅ DLQ (show error handling)
✅ Database schema (explain design)
✅ Code (GitHub repository)
```

---

## Estimated Interview Cost Breakdown

### Scenario: 1-Month Active Interview Mode

```
Setup (first time):
  └─ Initial deployment: ₹0 (one-time from script)

Interview Period (1 month):
  └─ 4 interviews × 2 hours each = 8 hours
  └─ 8 hours × ₹4/hour = ₹32

Storage (always on):
  └─ EBS + RDS + backups = ₹50

CloudWatch/misc:
  └─ ₹20

Total for 1 month active: ₹102/month

But if you only run during interviews:
  └─ Only ₹32 for actual demos
  └─ Plus ₹50 for paused storage
  └─ = ₹82/month when paused

✅ Net cost per month: ₹82-102
```

---

## Comparison: Local vs AWS Portfolio

### Option A: Local Only (FREE)

```
Pros:
- ✅ No AWS costs
- ✅ Full control
- ✅ Easy to modify

Cons:
- ❌ "Let me show you on my laptop" (less professional)
- ❌ Internet required during interview
- ❌ Can't share link for async review
- ❌ Doesn't show cloud experience
```

### Option B: AWS On-Demand (₹80-100/month when active)

```
Pros:
- ✅ "Live system on AWS" (professional)
- ✅ Shareable link for portfolio
- ✅ Shows cloud architecture knowledge
- ✅ Can demo anytime
- ✅ Costs ~₹5 per interview

Cons:
- ❌ Small monthly cost (₹50+ storage)
- ❌ Requires AWS knowledge
- ❌ Need credentials management
```

### My Recommendation

**AWS Option** is worth the cost because:
- ₹100/month is basically free (cost of 1 coffee)
- Shows real cloud experience
- Professional impression on recruiters
- Shareable portfolio link
- Can explain architectural decisions

---

## Implementation Timeline

### Week 1: Setup
- [ ] Create AWS account (5 mins)
- [ ] Create EC2 instance (10 mins)
- [ ] Create RDS database (10 mins)
- [ ] Create ElastiCache (10 mins)
- [ ] Deploy application (15 mins)
- [ ] Test everything (15 mins)
- **Total: 1 hour**

### Week 2: Prepare
- [ ] Create pause/resume scripts (15 mins)
- [ ] Test pause/resume cycle (30 mins)
- [ ] Prepare demo (30 mins)
- [ ] Update resume with portfolio link (15 mins)
- **Total: 1.5 hours**

### Ongoing: Interview Mode
- [ ] Run resume script (2 mins)
- [ ] Wait for services (5 mins)
- [ ] Demo to recruiter (30 mins)
- [ ] Run pause script (2 mins)
- **Per interview: 40 mins**

---

## Cost Optimization Tips

### 1. Delete Unused Backups
```bash
# RDS automatic backups can pile up
# AWS Console → RDS → Automated backups
# Keep only 7 days: Saves ₹30-50/month
```

### 2. Right-Size Instances
```bash
# If traffic minimal, t3.micro is perfect
# Don't upgrade unless needed
```

### 3. Disable CloudWatch Detailed Monitoring
```bash
# AWS Console → CloudWatch → Detailed monitoring
# Disable for portfolio (basic is free)
```

### 4. Use on-demand Pricing
```bash
# Don't buy reserved instances (1-year commitment)
# You pause often, so on-demand is cheaper
```

---

## What to Put in Resume

```
Portfolio Website: http://<your-ec2-public-ip>:3000

Live demonstration of:
- Distributed job queue system (BullMQ)
- RESTful API (Fastify) with OpenAPI docs
- Angular real-time dashboard
- PostgreSQL database design
- Worker process with concurrency control
- Error handling & retry logic
- Dead-letter queue pattern

GitHub: <your-repo-link>
Architecture: Fastify + Angular + PostgreSQL + Redis, deployed on AWS EC2/RDS/ElastiCache
Patterns: Idempotency, exponential backoff, graceful shutdown, RBAC
```

---

## Quick Reference: Pause/Resume

```bash
# When NOT interviewing (monthly):
./scripts/pause-portfolio.sh
# Cost: ₹50/month

# When interview scheduled (before call):
./scripts/resume-portfolio.sh
# Cost: ₹4/hour

# Check status
aws ec2 describe-instances --instance-ids i-xxxx --region ap-south-1

# Share with recruiter
echo "Dashboard: http://<ec2-public-ip>:3000"
```

---

## Related Documentation

- [[DEPLOYMENT/02-AWS-Portfolio-Setup]] - Initial setup details
- [[DEPLOYMENT/04-Cost-Analysis-INR]] - Detailed cost breakdown
- [[DEPLOYMENT/05-CI-CD-GitHub-Actions]] - Auto-deploy updates
- [[DEPLOYMENT/01-Local-Development]] - Local alternative
