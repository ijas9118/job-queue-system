# CI/CD Decision: GitHub Actions vs Jenkins

## TL;DR: GitHub Actions ✅

For your use case (portfolio, MERN stack, single developer):

| Factor            | GitHub Actions | Jenkins        |
| ----------------- | -------------- | -------------- |
| **Cost**          | FREE           | ₹300-500/month |
| **Setup Time**    | 15 minutes     | 2-3 hours      |
| **Maintenance**   | Zero           | Ongoing        |
| **For Portfolio** | ✅ Perfect     | ❌ Overkill    |

**Verdict**: Use GitHub Actions. It's free, integrated, and perfect for portfolio projects.

---

## Cost Comparison

**GitHub Actions**: ₹0/month

- Free tier: 2,000 CI/CD minutes/month
- Your usage: ~150 minutes/month
- Cost: ₹0 ✅

**Jenkins**: ₹550+/month

- EC2 server: ₹550/month
- Maintenance: 2 hours/month
- Setup: 3 hours (one-time)
- Cost: ₹570+/month ❌

---

## Implementation

See [[DEPLOYMENT/05-CI-CD-GitHub-Actions]] for complete setup.

### Quick Steps

1. Copy `.github/workflows/deploy.yml`
2. Add secrets to GitHub
3. Push code → Auto-deploys!

**Time: 15 minutes**

---

## What You Get

✅ Automated testing on every push
✅ Automatic deployment if tests pass
✅ Prevents broken code from deploying
✅ Deploy without SSH-ing into server
✅ Professional-looking pipeline
✅ Zero cost (free tier)
✅ Zero maintenance

---

## Related Documentation

- [[DEPLOYMENT/05-CI-CD-GitHub-Actions]] - Actual implementation
- [[DEPLOYMENT/02-AWS-Portfolio-Setup]] - AWS setup
- [[DEPLOYMENT/03-On-Demand-Portfolio]] - On-demand deployment
- [[TESTING/00-Strategy]] - Testing strategy
