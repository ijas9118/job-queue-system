# CI/CD Pipeline with GitHub Actions

## Automated Deployment to AWS

Deploy updates automatically when you push to main branch.

## Setup GitHub Actions

### 1. Create Secrets in GitHub

```bash
# Go to GitHub repo → Settings → Secrets and variables → Actions

# Add these secrets:
# AWS_ACCESS_KEY_ID
# AWS_SECRET_ACCESS_KEY
# AWS_EC2_INSTANCE_ID (from EC2 dashboard)
# EC2_USER (ubuntu)
# EC2_HOST (your EC2 public IP)
# EC2_KEY (private key content)
# DATABASE_URL (from RDS)
# REDIS_URL (from ElastiCache)
# JWT_SECRET (random string)
```

### 2. Create Workflow File

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to AWS

on:
  push:
    branches: [main]
  workflow_dispatch: # Manual trigger

env:
  AWS_REGION: ap-south-1

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: job_queue
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Get pnpm store directory
        id: pnpm-cache
        shell: bash
        run: |
          echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT

      - name: Setup pnpm cache
        uses: actions/cache@v3
        with:
          path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-

      - name: Install dependencies
        run: pnpm install

      - name: Run linter
        run: pnpm lint

      - name: Run type check
        run: pnpm type-check

      - name: Run tests
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/job_queue
          REDIS_URL: redis://localhost:6379
        run: pnpm test

      - name: Build packages
        run: pnpm build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: success()

    steps:
      - uses: actions/checkout@v3

      - name: Configure SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.EC2_KEY }}" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H ${{ secrets.EC2_HOST }} >> ~/.ssh/known_hosts

      - name: Deploy to EC2
        run: |
          ssh -i ~/.ssh/id_rsa ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} << 'EOF'
          cd ~/job-queue-system

          # Pull latest code
          git pull origin main

          # Install dependencies
          pnpm install --prod

          # Run migrations
          export DATABASE_URL="${{ secrets.DATABASE_URL }}"
          pnpm --filter database run migrate:prod || true

          # Rebuild dashboard if needed
          pnpm --filter dashboard run build || true

          # Restart services
          pm2 restart api worker

          # Check health
          sleep 5
          pm2 logs --lines 5
          EOF

      - name: Verify deployment
        run: |
          sleep 5
          curl -f http://${{ secrets.EC2_HOST }}:3000/health || exit 1

      - name: Notify on success
        if: success()
        run: echo "✅ Deployment successful!"

      - name: Notify on failure
        if: failure()
        run: echo "❌ Deployment failed!"
```

### 3. Environment-Specific Configuration

Create `.github/workflows/production-deploy.yml` (more careful, requires approval):

```yaml
name: Production Deploy (Requires Approval)

on:
  push:
    branches: [main]
    paths-ignore:
      - 'docs/**'
      - '*.md'

jobs:
  test:
    runs-on: ubuntu-latest
    # ... same as above ...

  approval:
    needs: test
    runs-on: ubuntu-latest
    environment:
      name: production
    steps:
      - name: Waiting for approval
        run: echo "Deployment waiting for approval..."

  deploy:
    needs: approval
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: echo "Deploying to production..."
      # ... deployment steps ...
```

---

## Manual Deployment Commands

If you prefer deploying manually:

```bash
# SSH into EC2
ssh -i ~/key.pem ubuntu@<ec2-ip>

# Update code
cd ~/job-queue-system
git pull origin main

# Install updates
pnpm install --prod

# Run migrations
export DATABASE_URL="postgresql://..."
export REDIS_URL="redis://..."
pnpm --filter database run migrate:prod

# Restart services
pm2 restart api worker

# Check status
pm2 status
pm2 logs

# Verify health
curl http://localhost:3000/health
```

---

## Monitoring Deployments

### Check Recent Deployments

```bash
# GitHub Actions → Deployments → View deployment

# Or via CLI
gh run list --workflow=deploy.yml
gh run view <run-id> --log
```

### View Logs on EC2

```bash
# SSH into EC2
ssh -i ~/key.pem ubuntu@<ec2-ip>

# View API logs
pm2 logs api

# View Worker logs
pm2 logs worker

# View all logs
pm2 logs

# Clear logs
pm2 flush
```

### CloudWatch Monitoring

```bash
# AWS Console → CloudWatch → Logs

# Or via CLI
aws logs tail /aws/ec2/job-queue-system --follow
```

---

## Rollback on Failure

### Automatic Rollback

```yaml
# In deploy.yml, add post-step:
- name: Rollback on failure
  if: failure()
  run: |
    ssh -i ~/.ssh/id_rsa ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} << 'EOF'
    cd ~/job-queue-system
    git revert HEAD --no-edit
    pnpm install --prod
    pm2 restart api worker
    EOF
```

### Manual Rollback

```bash
# SSH into EC2
ssh -i ~/key.pem ubuntu@<ec2-ip>

# View commit history
git log --oneline

# Rollback to previous commit
git revert HEAD --no-edit

# Redeploy
pnpm install --prod
pm2 restart api worker
```

---

## Release Process

### 1. Create Release Branch

```bash
# Local machine
git checkout -b release/v1.0.0

# Make final changes
vim apps/api/package.json
vim apps/worker/package.json
vim apps/dashboard/package.json

# Commit
git commit -m "Bump version to 1.0.0"
git push origin release/v1.0.0

# Create Pull Request
# GitHub → New PR → base: main, compare: release/v1.0.0
```

### 2. Merge and Deploy

```bash
# GitHub → Merge Pull Request
# This triggers CI/CD pipeline automatically

# Deployment runs automatically
# Check GitHub Actions → Deployments
```

### 3. Create GitHub Release (Optional)

```bash
# GitHub → Releases → Draft new release
# Tag: v1.0.0
# Title: Version 1.0.0
# Description: What's new in this version
# Publish Release
```

---

## Troubleshooting CI/CD

### Deployment Hangs

```yaml
- name: Deploy with timeout
  timeout-minutes: 10
  run: # deployment commands
```

### SSH Connection Fails

```bash
# Check EC2 security group allows SSH
aws ec2 describe-security-groups --group-ids sg-xxxxx

# Verify key is correct
ssh-keygen -y -f ~/key.pem

# Test SSH manually
ssh -vvv -i ~/key.pem ubuntu@<ec2-ip>
```

### Database Migration Fails

```bash
# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# Check migrations status
pnpm --filter database run migrate:status

# Manually reset (DANGEROUS)
pnpm --filter database run migrate:reset
pnpm --filter database run migrate:prod
```

### Services Fail to Start

```bash
# SSH into EC2 and check logs
pm2 logs api --lines 50
pm2 logs worker --lines 50

# Restart individually
pm2 stop api
pm2 start "pnpm --filter api run start" --name "api"
pm2 logs api
```

---

## Status Checks

### GitHub Branch Protection

Set up branch protection to require CI/CD pass:

```
GitHub → Settings → Branches → Add rule
Branch name pattern: main

Require:
- ✅ Status checks to pass before merging
- Select "test" job from Actions
- ✅ Require branches to be up to date
```

This ensures:

- Tests pass before deploying
- No failing code reaches production
- Safer deployments

---

## Notifications

### Slack Integration (Optional)

```yaml
- name: Notify Slack on success
  if: success()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "✅ Deployment successful!"
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}

- name: Notify Slack on failure
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "❌ Deployment failed!"
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

## Cost Impact

GitHub Actions pricing:

```
GitHub Free tier: 2000 free CI/CD minutes/month
Your usage: ~5 mins per deployment × 20 deployments = 100 mins

Result: ✅ FREE (well under limit)
```

---

## Related Documentation

- [[DEPLOYMENT/02-AWS-Portfolio-Setup]] - AWS setup
- [[DEPLOYMENT/04-Cost-Analysis-INR]] - Cost breakdown
- [[TESTING/00-Strategy]] - Testing before deploy
