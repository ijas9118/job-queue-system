# AWS Cost Analysis (Indian Rupees)

## TL;DR: Is it Worth It?

| Scenario | Monthly Cost (INR) | Use Case | Worth It? |
|----------|-------------------|----------|----------|
| **Local only** | ₹0 | Learning, development | ✅ Yes (free!) |
| **Portfolio (with free tier)** | ₹500-1000 | Show on resume, interviews | ✅ Yes |
| **Portfolio (after 1 year)** | ₹2500-3500 | Continuous showcase | ⚠️ Maybe (depends on opportunity) |
| **Production (low load)** | ₹8000-12000 | Small business | ❌ No (too expensive) |
| **Production (heavy load)** | ₹50000+ | Scaling business | ✅ Yes (justified ROI) |

**Bottom line for you**: Deploy on AWS with free tier for 12 months, then decide if worth continuing.

---

## Detailed Cost Breakdown (2026 Prices)

### Year 1: Free Tier (12 Months)

#### Option A: Minimal Setup

```
Service                    Tier          Monthly Cost (INR)
─────────────────────────────────────────────────────
EC2 t2.micro              Free tier     ₹0 (750 hrs/month)
RDS db.t2.micro           Free tier     ₹0 (750 hrs/month)
ElastiCache t3.micro      Paid          ₹1000
Data Transfer             Free tier     ₹0 (100GB/month)
CloudFront                Free tier     ₹0 (50GB/month)
CloudWatch Logs           Free tier     ₹0 (5GB/month)
S3 (dashboard CDN)        Free tier     ₹0 (5GB/month)
─────────────────────────────────────────────────────
TOTAL YEAR 1              MONTHLY       ₹1000/month
TOTAL YEAR 1              ANNUAL        ₹12,000 (~$145)
```

**Note**: You also get ₹3500 in free tier credits, covering most of this!

#### Option B: Slightly Better Performance

```
Service                    Configuration  Monthly Cost (INR)
─────────────────────────────────────────────────────
EC2 t2.micro              Free tier       ₹0
RDS db.t3.micro           Not free tier   ₹1200
ElastiCache cache.t3.micro Paid          ₹1000
Load Balancer (ALB)       -              ₹650
Data Transfer (50GB)      -              ₹300
Backup Storage            30GB           ₹200
─────────────────────────────────────────────────────
TOTAL YEAR 1              MONTHLY        ₹3350/month
```

---

### Year 2+: Post Free Tier

#### Scenario A: Minimal (Just Showcase)

```
┌─ Stop when not in use ─────────────────┐
│ Stop EC2 + RDS + Redis = ₹0 cost       │
│ Turn on for interviews/demo = ₹500/hr  │
│ ~5 hours/month usage = ₹2500 total     │
└────────────────────────────────────────┘

Annual cost: ₹30,000/year (~$360)
Worthwhile? YES for portfolio
```

#### Scenario B: Always-On (Professional Showcase)

```
EC2 t3.micro                    ₹550
RDS db.t3.micro                 ₹1100
ElastiCache cache.t3.micro      ₹800
Load Balancer (optional)        ₹650
Data Transfer                   ₹200
CloudWatch/Logs                 ₹100
S3 + Backups                    ₹300
─────────────────────────────────────
TOTAL                           ₹3700/month
ANNUAL                          ₹44,400/year (~$530)

Worthwhile? Maybe - depends on opportunities
```

#### Scenario C: Comfortable Scale

```
EC2 t3.small (2 instances)      ₹1100
RDS db.t3.small                 ₹2200
ElastiCache cache.t3.small      ₹1600
Load Balancer                   ₹650
Data Transfer (200GB)           ₹800
Backup storage                  ₹300
CloudWatch Advanced             ₹200
─────────────────────────────────────
TOTAL                           ₹6850/month
ANNUAL                          ₹82,200/year (~$985)

Worthwhile? Maybe - if generating revenue
```

---

## AWS Free Tier Explained

### Your Free Tier Benefits (12 Months)

You get:

1. **EC2**: 750 hours/month of **t2.micro** OR **t3.micro**
   - That's ~24 hours/day for a month
   - ₹0 cost
   - Limited to 30GB storage

2. **RDS**: 750 hours/month of **db.t2.micro** OR **db.t3.micro**
   - ₹0 cost
   - Limited to 20GB storage

3. **ElastiCache**: NOT included in free tier
   - ₹800-1000/month regardless

4. **Data Transfer**: 100GB/month OUT of AWS
   - ₹0 cost
   - Sufficient for portfolio

5. **CloudFront**: 50GB/month
   - ₹0 cost
   - Good for CDN

6. **S3**: 5GB/month
   - ₹0 cost
   - Good for dashboard hosting

7. **CloudWatch**: 5GB logs/month
   - ₹0 cost
   - Monitoring and alerts

### Important Notes

- Free tier is **per account**, not per service
- Starts when you create account, not when you launch instances
- **Automatically stops** after 12 months (charges kick in)
- You can request extension (rare but possible)

### Track Free Tier Usage

```bash
# AWS Console → Billing & Cost Management → Billing Dashboard
# See your free tier usage live

# Or via CLI
aws ce get-cost-and-usage \
  --time-period Start=2026-01-01,End=2026-01-31 \
  --granularity DAILY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region ap-south-1
```

---

## Service Pricing Details (as of 2026)

### EC2 (per hour, ap-south-1 region)

```
Instance Type  Free Tier?  Cost/Hour  Cost/Month (730 hrs)
───────────────────────────────────────────────────────
t2.micro       Yes (750h)  ₹0.75      ₹550 (after free)
t2.small       No          ₹1.50      ₹1,095
t3.micro       No          ₹0.75      ₹550
t3.small       No          ₹1.50      ₹1,095
t3.medium      No          ₹3.00      ₹2,190

+ Data transfer out: ₹6/GB (first 100GB free)
```

### RDS PostgreSQL (per hour, ap-south-1)

```
Instance Type    Free Tier?  Cost/Hour  Cost/Month
────────────────────────────────────────────────
db.t2.micro      Yes (750h)  ₹1.50      ₹1,095 (after free)
db.t2.small      No          ₹3.00      ₹2,190
db.t3.micro      No          ₹1.50      ₹1,095
db.t3.small      No          ₹3.00      ₹2,190

Storage: ₹1/GB/month
Backups: ₹0.20/GB/month
```

### ElastiCache Redis (per hour, ap-south-1)

```
Node Type        Cost/Hour  Cost/Month (730 hrs)
──────────────────────────────────────────────
cache.t3.micro   ₹1.40      ₹1,022
cache.t3.small   ₹2.80      ₹2,044
cache.t3.medium  ₹5.60      ₹4,088
cache.r5.large   ₹12.80     ₹9,344

(No free tier for ElastiCache!)
```

### Elastic Load Balancer (ALB)

```
Type        Cost/Hour  Cost/Month
────────────────────────────────
ALB         ₹0.90      ₹657
NLB         ₹0.90      ₹657

Per LCU:    ₹9/month (low traffic free)
```

### Data Transfer

```
Direction               Cost
────────────────────────────────────────
INTO AWS                ₹0/GB (always free)
OUT of AWS (first 100GB) ₹0/GB (free)
OUT of AWS (100-10TB)   ₹6/GB
Between regions         ₹6/GB
CloudFront out          ₹5.50-6.50/GB
```

### Storage

```
Service         Cost
─────────────────────────────────
S3 Standard     ₹2/GB/month
S3 Glacier      ₹0.30/GB/month
EBS Volume      ₹4/GB/month
Backup (RDS)    ₹0.20/GB/month
```

---

## Realistic Scenarios

### Scenario 1: Portfolio Showcase (RECOMMENDED)

```yaml
Goal: Show working system on resume

Deployment:
  - EC2 t2.micro: Free tier
  - RDS db.t2.micro: Free tier
  - ElastiCache cache.t3.micro: ₹1000
  - Data transfer: ₹0
  - Total: ₹1000/month

Cost Profile:
  Year 1: ₹12,000 total (with free tier credits: potentially free)
  Year 2: Can stop when not in use = ₹2000-3000/month on demand
  
Decision: ✅ ABSOLUTELY WORTH IT
  - Shows cloud experience to recruiters
  - Costs basically nothing year 1
  - Can be paused to minimize future costs
  - Portfolio gold
```

### Scenario 2: Learning Project (GOOD)

```yaml
Goal: Learn AWS and job queue patterns

Deployment:
  - Local development: ₹0
  - Deploy to AWS only for testing
  - Use free tier only
  
Cost Profile:
  Year 1: ₹0-500/month
  Year 2: Stop using, ₹0
  
Decision: ✅ DEFINITELY WORTH IT
  - Free/cheap learning experience
  - Can pause anytime
  - Gain AWS expertise
```

### Scenario 3: Production Service

```yaml
Goal: Run as actual business

Deployment:
  - EC2 t3.small (2+ instances): ₹2200
  - RDS db.t3.small: ₹2200
  - ElastiCache cache.t3.small: ₹1600
  - Load balancer: ₹650
  - Data transfer: ₹500
  - Backups & monitoring: ₹500
  - Total: ₹7650/month

Cost Profile:
  Year 1: ₹7650/month (even with free tier, not applicable)
  Year 2: ₹7650+/month (needs revenue to justify)
  
Decision: ⚠️ ONLY IF GENERATING REVENUE
  - High operational cost
  - Need 10x revenue to break even
  - Consider Lambda/serverless instead
```

---

## Cost Optimization Checklist

### Immediately

- [ ] Use free tier services first
- [ ] Right-size instances (t2/t3.micro)
- [ ] Stop instances when not using
- [ ] Enable auto-shutdown schedules
- [ ] Delete unneeded resources

### Short-term

- [ ] Set billing alerts (₹3000/month)
- [ ] Use Reserved Instances (30% savings)
- [ ] Consolidate to one region (ap-south-1)
- [ ] Enable S3 lifecycle policies
- [ ] Delete old backups

### Long-term

- [ ] Monitor AWS Trusted Advisor
- [ ] Right-size after usage analysis
- [ ] Consider Compute Savings Plans
- [ ] Use spot instances for non-critical
- [ ] Migrate to serverless if applicable

---

## Getting Free ₹3500 AWS Credits

### How to Get Free Tier + Credits

1. **Create account**: Get 12 months free tier
2. **Activate student account** (if student): Extra ₹3500 credits
3. **AWS Promotional Credits**: Sometimes ₹3500 codes for starters

### Using Promotional Credits

```
You get: ₹3500 credits
Your Year 1 cost: ₹12,000 (with minimal setup)
Covered by credits: ₹3500
You pay: ₹8,500 out of pocket

OR

Use only free tier: ₹0 personal cost
Credits go unused
```

---

## Monthly Budget Recommendation

### For Portfolio/Resume

```
Recommended Monthly Budget: ₹2,000

Covers:
- EC2: ₹0 (free tier)
- RDS: ₹0 (free tier)
- ElastiCache: ₹1000
- Extra buffer: ₹1000

This budget comfortable, never hit limit
```

### Monitoring Actual Costs

```bash
# Every month, check AWS Billing
# AWS Console → Billing → Cost Explorer

# Set up alerts
# AWS Console → Billing → Budgets
# Alert: ₹2500 (80% of budget)

# Never get surprised!
```

---

## Related Documentation

- [[DEPLOYMENT/02-AWS-Portfolio-Setup]] - Step-by-step setup
- [[DEPLOYMENT/00-Overview]] - Architecture overview
- [[TECH-STACK/00-Overview]] - Why these technologies
